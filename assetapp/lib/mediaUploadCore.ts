/**
 * Pure media-upload helpers — no React Native, no Supabase, no I/O.
 *
 * Everything here is deterministic string/byte work, which is exactly the part
 * that used to be wrong in the upload path: the old code guessed the file
 * extension by splitting the picker URI (`file:///…/ImagePicker/xyz.jpeg?t=1`),
 * so a URI without a dot produced an object key with no extension and a
 * `text/plain` content type, and a `#` or `?` anywhere in an asset code
 * corrupted the key.
 *
 * Kept import-free on purpose so `scripts/media-upload-check.js` can exercise it
 * in plain Node against the real byte output.
 */

/** What the image/file pickers hand back (a superset of expo-image-picker's asset). */
export type MediaAsset = {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

/** Extensions the storage bucket may hold, and the content type each one means. */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** MIME type → extension, for when the picker gives a type but no usable name. */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const DEFAULT_EXTENSION = 'jpg';
export const DEFAULT_CONTENT_TYPE = 'image/jpeg';

/**
 * Photos bigger than this are still uploaded — the picker already downsizes
 * them — but they are worth a line in the log, because a multi-megabyte base64
 * string is what runs a low-memory Android device out of heap.
 */
export const LARGE_MEDIA_BYTES = 8 * 1024 * 1024;

const splitReference = (value: string): string => String(value ?? '').split('?')[0].split('#')[0];

/**
 * Accept either a bare URI string (older call sites) or a full picker asset.
 * Returns null for anything empty, so callers can guard once.
 */
export function normalizeMedia(input: string | MediaAsset | null | undefined): MediaAsset | null {
  if (!input) return null;
  const media: MediaAsset = typeof input === 'string' ? { uri: input } : input;
  const uri = String(media.uri ?? '').trim();
  if (!uri) return null;
  return {
    uri,
    base64: media.base64 ?? null,
    mimeType: media.mimeType ? String(media.mimeType) : null,
    fileName: media.fileName ? String(media.fileName) : null,
    fileSize: typeof media.fileSize === 'number' ? media.fileSize : null,
  };
}

const extensionOf = (name: string): string => {
  const clean = splitReference(name);
  const tail = clean.includes('.') ? clean.split('.').pop() ?? '' : '';
  return tail.toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * The extension to store under.
 *
 * Order matters: the picker's own file name and MIME type are trustworthy, the
 * URI is not (Android hands out `content://` URIs with no extension at all).
 */
export function extensionFor(input: string | MediaAsset | null | undefined, fallback = DEFAULT_EXTENSION): string {
  const media = normalizeMedia(input);
  if (!media) return fallback;

  const fromName = media.fileName ? extensionOf(media.fileName) : '';
  if (EXTENSION_CONTENT_TYPES[fromName]) return fromName;

  const fromUri = extensionOf(media.uri);
  if (EXTENSION_CONTENT_TYPES[fromUri]) return fromUri;

  const fromMime = media.mimeType ? MIME_EXTENSIONS[String(media.mimeType).toLowerCase().split(';')[0].trim()] : '';
  if (fromMime) return fromMime;

  return fallback;
}

/** The `Content-Type` the stored object must carry. */
export function contentTypeFor(input: string | MediaAsset | null | undefined): string {
  const media = normalizeMedia(input);
  const mime = media?.mimeType ? String(media.mimeType).toLowerCase().split(';')[0].trim() : '';
  if (mime && (MIME_EXTENSIONS[mime] || mime.startsWith('image/'))) {
    return mime === 'image/jpg' ? DEFAULT_CONTENT_TYPE : mime;
  }
  return EXTENSION_CONTENT_TYPES[extensionFor(media)] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * One path segment of an object key.
 *
 * Asset codes are free text in this project (`AST-042`, `IT / Room 3`, codes
 * with `#` or `?` typed by hand), and a stray `/`, `#` or space in a key breaks
 * the upload or the public URL. Everything outside `[A-Za-z0-9._-]` collapses
 * to a single `-`, which is also what the web's stored names look like.
 */
export function sanitizeKeySegment(value: unknown, maxLength = 60): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  const capped = cleaned.slice(0, maxLength).replace(/[.\-]+$/g, '');
  return capped || 'asset';
}

/**
 * Object key for a new photo, e.g. `photos/AST-042_1789373457957.jpg`.
 *
 * `now` is injectable so the key is reproducible in tests.
 */
export function buildObjectKey(
  folder: string,
  prefix: unknown,
  input: string | MediaAsset | null | undefined,
  now: number = Date.now(),
): string {
  const cleanFolder = String(folder ?? '').replace(/^\/+|\/+$/g, '') || 'photos';
  const name = `${sanitizeKeySegment(prefix)}_${now}.${extensionFor(input)}`;
  return `${cleanFolder}/${name}`;
}

/** The file name part of an object key. */
export function fileNameOf(objectKey: string): string {
  return String(objectKey ?? '').split('/').pop() || 'asset-photo';
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET[index]] = index;
  }
  return table;
})();

/**
 * Decode base64 into raw bytes, without the `base64-arraybuffer` hop.
 *
 * Tolerates whitespace/newlines and an optional `data:…;base64,` prefix, and
 * ignores `=` padding — all of which appear in real picker output.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const raw = String(base64 ?? '');
  const comma = raw.indexOf(',');
  const body = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '=') break;
    const value = BASE64_LOOKUP[char];
    if (value === undefined) continue; // whitespace, newlines, URLs-safe noise
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

/** Human-size formatting for the messages shown to the user. */
export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const messageOf = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const anyError = error as { message?: unknown; error?: unknown; statusCode?: unknown; status?: unknown };
  const message = typeof anyError.message === 'string' ? anyError.message : String(anyError.error ?? '');
  const status = anyError.statusCode ?? anyError.status;
  return status ? `${message} (${status})` : message;
};

/**
 * Turn whatever the storage client threw into something the person holding the
 * phone can act on — and keep the raw text, because the raw text is what
 * diagnoses the next surprise.
 */
export function describeUploadError(error: unknown): string {
  const raw = messageOf(error).trim();
  const lower = raw.toLowerCase();

  if (lower.includes('bucket not found')) {
    return 'The Storage bucket "assets" does not exist in this Supabase project. Create it (public), then retry.';
  }
  if (lower.includes('row-level security') || lower.includes('violates row-level security') || lower.includes('unauthorized') || lower.includes('403')) {
    return 'Supabase Storage refused the write (permission denied). The bucket needs an INSERT policy for the app key.';
  }
  if (lower.includes('already exists') || lower.includes('duplicate') || lower.includes('resource already exists')) {
    return 'An object with this name already exists in Storage. Retrying with a new name usually fixes it.';
  }
  if (lower.includes('network request failed') || lower.includes('failed to fetch') || lower.includes('timeout') || lower.includes('timed out')) {
    return `The phone could not reach Supabase Storage (${raw || 'network error'}). Check the connection and retry.`;
  }
  if (lower.includes('invalid key') || lower.includes('invalid path') || lower.includes('key is invalid')) {
    return 'Storage rejected the file path for this photo.';
  }
  if (lower.includes('payload too large') || lower.includes('413') || lower.includes('max file size') || lower.includes('entity too large')) {
    return 'The photo is larger than the bucket allows. Retake it or pick a smaller one.';
  }
  if (lower.includes('mime') || lower.includes('content type')) {
    return 'Storage rejected the file type of this photo.';
  }
  return raw || 'The upload failed for an unknown reason.';
}

/** Everything a successful upload needs to tell the caller. */
export type UploadedMedia = {
  objectKey: string;
  fileName: string;
  publicUrl: string;
  contentType: string;
  size: number;
  /** Which code path actually stored the file (`supabase-js`, `rest-fetch`, `rest-form`). */
  transport: string;
  /** Which code path produced the bytes (`picker`, `file-system`, `fetch`, `xhr`). */
  readVia: string;
};

/**
 * A compact, copy-pasteable report of one upload attempt — attached to the
 * error the user sees so a failed photo on a real phone can be diagnosed
 * without a debugger.
 */
export type UploadAttemptLog = {
  objectKey: string;
  contentType: string;
  bytes: number;
  readVia: string;
  attempts: string[];
};
