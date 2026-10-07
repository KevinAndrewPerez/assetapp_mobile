/**
 * The app's one way to put a photo into Supabase Storage.
 *
 * Why this file exists: photos registered from the phone were silently missing
 * from the `assets` bucket while the web app's uploads landed fine, and nothing
 * on the device said why. The bucket, the key and the RLS policies were all
 * proven good (`node scripts/storage-doctor.js --write` uploads from Node), so
 * the failure had to be in the device-side path — reading the picked file or
 * sending its bytes. Both of those steps now have fallbacks, and when every
 * fallback fails the caller gets a message naming the real error instead of a
 * generic "upload failed":
 *
 *   read  picker base64  →  expo-file-system  →  fetch(uri)  →  XMLHttpRequest
 *   send  supabase-js    →  raw Storage REST fetch  →  REST multipart form
 *
 * What the `assets` bucket's policies allow, proven against the live project by
 * `scripts/storage-doctor.js` and `scripts/media-upload-check.js --live`:
 *
 *   INSERT          allowed with `x-upsert: false` (what this file sends)
 *   UPDATE / upsert denied — Supabase answers
 *                   `400 new row violates row-level security policy`, so an
 *                   upload must never ask to replace an existing object; a
 *                   name collision is retried under a fresh key instead
 *   SELECT / list   the publishable key gets an empty list back, so nothing in
 *                   this app may rely on listing the bucket
 *   DELETE          denied — probes have to be cleaned up in the dashboard
 *
 * The stored result is verified with a real GET on the public URL, because a
 * 200 from the upload call is not proof that the object is readable — and an
 * unreadable object is exactly what "the photo is missing" looks like.
 */
import * as FileSystem from 'expo-file-system/legacy';

import {
  LARGE_MEDIA_BYTES,
  type MediaAsset,
  type UploadedMedia,
  base64ToBytes,
  buildObjectKey,
  contentTypeFor,
  describeUploadError,
  fileNameOf,
  formatBytes,
  normalizeMedia,
} from './mediaUploadCore';
import { STORAGE_BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';

export type { MediaAsset, UploadedMedia } from './mediaUploadCore';
export { buildObjectKey, contentTypeFor, describeUploadError, extensionFor } from './mediaUploadCore';

type ReadResult = { bytes: Uint8Array; via: string; attempts: string[] };

/** `data:image/png;base64,…` — a 1×1 transparent PNG, the app's upload probe. */
const PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error ?? {});

/** Strategy: expo-file-system (works for `file://` URIs, the picker's normal output). */
const readViaFileSystem = async (uri: string): Promise<Uint8Array> => {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  if (!base64) throw new Error('expo-file-system returned no data');
  return base64ToBytes(base64);
};

/**
 * Strategy: `fetch(uri)` + `arrayBuffer()`.
 *
 * Handles `content://` URIs on Android (which the file-system reader can
 * reject) and any http(s) source; skipped quietly when the runtime's Response
 * has no `arrayBuffer`.
 */
const readViaFetch = async (uri: string): Promise<Uint8Array> => {
  const response = await fetch(uri);
  if (!response.ok && response.status !== 0) {
    throw new Error(`fetch(${uri}) answered ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('fetch(uri) returned no data');
  return new Uint8Array(arrayBuffer);
};

/** Strategy: XMLHttpRequest with `responseType: 'arraybuffer'` — reads local files RN's fetch refuses. */
const readViaXhr = (uri: string): Promise<Uint8Array> =>
  new Promise<Uint8Array>((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', uri, true);
      xhr.responseType = 'arraybuffer';
      xhr.onerror = () => reject(new Error(`XHR could not read ${uri}`));
      xhr.onload = () => {
        if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
          reject(new Error(`XHR read answered ${xhr.status}`));
          return;
        }
        const buffer = xhr.response as ArrayBuffer | null;
        if (!buffer || buffer.byteLength === 0) {
          reject(new Error('XHR returned no data'));
          return;
        }
        resolve(new Uint8Array(buffer));
      };
      xhr.send(null);
    } catch (error) {
      reject(error);
    }
  });

/**
 * The photo's bytes, however they can be had.
 *
 * The picker's own base64 is first because it needs no file access at all: if
 * the picker handed us the bytes, nothing downstream can fail to find the file.
 */
export async function readMediaBytes(input: string | MediaAsset): Promise<ReadResult> {
  const media = normalizeMedia(input);
  if (!media) throw new Error('No photo was provided');

  const attempts: string[] = [];

  if (media.base64) {
    const bytes = base64ToBytes(media.base64);
    if (bytes.byteLength > 0) {
      return { bytes, via: 'picker', attempts: ['picker: ok'] };
    }
    attempts.push('picker: empty base64');
  }

  const strategies: { via: string; run: () => Promise<Uint8Array> }[] = [
    { via: 'file-system', run: () => readViaFileSystem(media.uri) },
    { via: 'fetch', run: () => readViaFetch(media.uri) },
    { via: 'xhr', run: () => readViaXhr(media.uri) },
  ];

  for (const strategy of strategies) {
    try {
      const bytes = await strategy.run();
      if (bytes.byteLength === 0) throw new Error('no data');
      attempts.push(`${strategy.via}: ok`);
      return { bytes, via: strategy.via, attempts };
    } catch (error) {
      attempts.push(`${strategy.via}: ${messageOf(error).slice(0, 120)}`);
    }
  }

  throw new Error(
    `The photo file could not be read from the device (tried: ${attempts.join(' | ')}). `
      + 'Retake the photo and try again.',
  );
}

const encodeKeyPath = (objectKey: string): string =>
  objectKey
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const restObjectUrl = (objectKey: string): string =>
  `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${encodeKeyPath(objectKey)}`;

/** Transport 1: the Supabase client (ArrayBuffer body, the documented RN path). */
const sendViaSupabaseClient = async (
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
  upsert: boolean,
): Promise<void> => {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectKey, bytes, {
    contentType,
    cacheControl: '3600',
    upsert,
  });
  if (error) throw error;
};

/** Transport 2: the same Storage REST endpoint, without the client's fetch wrapper. */
const sendViaRestFetch = async (
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
  upsert: boolean,
): Promise<void> => {
  const response = await fetch(restObjectUrl(objectKey), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'content-type': contentType,
      'cache-control': 'max-age=3600',
      'x-upsert': String(upsert),
    },
    body: bytes as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Storage answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
};

/**
 * Transport 3: multipart form data with a Blob part.
 *
 * This is what the Supabase client itself does for Blob bodies, so it is a
 * genuinely different code path in React Native (native multipart upload)
 * rather than a variation of the same one.
 */
const sendViaRestForm = async (
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
  upsert: boolean,
): Promise<void> => {
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', new Blob([bytes as unknown as BlobPart], { type: contentType }), fileNameOf(objectKey));

  const response = await fetch(restObjectUrl(objectKey), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-upsert': String(upsert),
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Storage (multipart) answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
};

const publicUrlOf = (objectKey: string): string =>
  supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectKey).data?.publicUrl ?? '';

/**
 * Is the object really readable at its public URL?
 *
 * A stored-but-unreadable object is indistinguishable from a missing photo in
 * the UI, so the upload is not called successful until this GET succeeds.
 */
const verifyPublicRead = async (publicUrl: string): Promise<void> => {
  if (!publicUrl) throw new Error('No public URL was produced for the uploaded object');
  const attempt = async () => {
    const response = await fetch(publicUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`public URL answered ${response.status}`);
  };
  try {
    await attempt();
  } catch (firstError) {
    // A brand-new object can take a moment to appear through the CDN.
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await attempt();
    } catch {
      throw firstError;
    }
  }
};

/** Everything needed to store one file, all optional except the media itself. */
export type StoreMediaOptions = {
  /** Folder inside the single `assets` bucket (`photos`, `profile_photos`, …). */
  folder: string;
  /** Name prefix, normally the asset code (`AST-042`, `BULK`, a user id). */
  prefix: string | number | null | undefined;
  media: string | MediaAsset;
  /**
   * Ask Storage to replace an existing object at the same key.
   *
   * Defaults to FALSE on purpose: the `assets` bucket's policies grant INSERT
   * but no UPDATE, and Supabase answers an upsert with
   * `400 new row violates row-level security policy`. A collision is handled by
   * storing under a fresh key instead (see `storeMedia`).
   */
  upsert?: boolean;
  /** Skip the public-URL verification (only useful for non-public buckets). */
  skipVerify?: boolean;
};

/**
 * Store one photo and return everything the database row needs.
 *
 * Throws an `Error` whose message names the real cause; callers show it to the
 * user, so a failure is never silent.
 */
export async function storeMedia(options: StoreMediaOptions): Promise<UploadedMedia> {
  const media = normalizeMedia(options.media);
  if (!media) throw new Error('No photo was provided');

  let objectKey = buildObjectKey(options.folder, options.prefix, media);
  const contentType = contentTypeFor(media);
  const upsert = options.upsert ?? false;

  if (media.fileSize && media.fileSize > LARGE_MEDIA_BYTES) {
    console.warn(
      `[mediaUpload] large photo ${formatBytes(media.fileSize)} — ${objectKey}. `
        + 'A smaller source image avoids low-memory failures on Android.',
    );
  }

  const read = await readMediaBytes(media);
  const attempts: string[] = [...read.attempts];

  const transports: { name: string; send: typeof sendViaSupabaseClient }[] = [
    { name: 'supabase-js', send: sendViaSupabaseClient },
    { name: 'rest-fetch', send: sendViaRestFetch },
    { name: 'rest-form', send: sendViaRestForm },
  ];

  let stored = false;
  for (let round = 0; round < 2 && !stored; round += 1) {
    for (const transport of transports) {
      try {
        await transport.send(objectKey, read.bytes, contentType, upsert);
        attempts.push(`${transport.name}: ok`);
        stored = true;
        break;
      } catch (error) {
        const message = messageOf(error);
        attempts.push(`${transport.name}: ${message.slice(0, 160)}`);

        // This bucket has no UPDATE policy, so "already exists" can never be
        // answered by upserting — the photo is stored under a fresh key
        // instead, which is what the retry round does.
        if (/already exists|duplicate|resource already exists/i.test(message) && !upsert) {
          objectKey = buildObjectKey(options.folder, options.prefix, media, Date.now() + round + 1);
          attempts.push(`retrying with a new key: ${objectKey}`);
          break;
        }
      }
    }
  }

  if (!stored) {
    throw new Error(`${describeUploadError(attempts.join(' | '))} [${objectKey} · ${formatBytes(read.bytes.byteLength)}]`);
  }

  const publicUrl = publicUrlOf(objectKey);

  if (!options.skipVerify) {
    try {
      await verifyPublicRead(publicUrl);
    } catch (error) {
      throw new Error(
        `The photo was sent to Storage but cannot be read back (${messageOf(error)}). `
          + 'Check that the "assets" bucket is public.',
      );
    }
  }

  return {
    objectKey,
    fileName: fileNameOf(objectKey),
    publicUrl,
    contentType,
    size: read.bytes.byteLength,
    transport: attempts[attempts.length - 1].split(':')[0],
    readVia: read.via,
  };
}

export type StorageProbeResult = {
  ok: boolean;
  detail: string;
  objectKey?: string;
  transport?: string;
  readVia?: string;
};

/**
 * Upload a 1×1 PNG through the exact same pipeline the photos use, so the
 * answer to "can this phone write to Storage?" comes from the phone.
 */
export async function probeStorageUpload(folder = 'photos'): Promise<StorageProbeResult> {
  try {
    const stored = await storeMedia({
      folder,
      prefix: '_selftest',
      media: { uri: '', base64: PROBE_PNG_BASE64, mimeType: 'image/png', fileName: 'selftest.png' },
    });
    return {
      ok: true,
      detail: `uploaded and read back ${stored.objectKey} via ${stored.transport}`,
      objectKey: stored.objectKey,
      transport: stored.transport,
      readVia: stored.readVia,
    };
  } catch (error) {
    return { ok: false, detail: describeUploadError(error) };
  }
}

/** The probe object key's bytes, for callers that want to render/compare it. */
export const probePngBytes = (): Uint8Array => base64ToBytes(PROBE_PNG_BASE64);

