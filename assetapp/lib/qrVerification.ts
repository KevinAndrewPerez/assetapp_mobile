/**
 * Signed asset QR verification, performed on the phone.
 *
 * The web app verifies a scanned sticker inside Laravel (`App\Support\QrPayload`
 * + `App\Support\QrVerification`), but the phone has no Laravel session, so it
 * cannot call `/qr/verify`. It does the same work locally instead: read the
 * payload (see `qrPayload.ts`), check the signature against the deployment's
 * public keys, then look the identifier up in the shared database. The rules
 * and the wording of every outcome are deliberately identical to the web's so
 * one sticker never gets two verdicts:
 *
 *   1. a payload whose signature does not match its key is refused, and its
 *      identifier is *not* looked up - a forgery must not borrow real details
 *   2. a payload naming a key we do not hold is "unknown key", not "fake"
 *   3. a plain asset code is an unsigned sticker (printed before signing) and
 *      still resolves, always labelled unsigned
 *   4. with no public keys at all the verdict is "verification unavailable" -
 *      never "fake" - so a genuine sticker is never libelled by a build that
 *      simply cannot check it
 *   5. a revoked sticker is refused even though its signature is genuine
 *
 * The keys come from `EXPO_PUBLIC_QR_PUBLIC_KEYS` when set, otherwise from the
 * web app's public `/qr/public-keys` endpoint, cached on the device for a day.
 * Only public keys travel: the signing secret never leaves the server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { webOrigin } from './mediaUrl';
import { writeAudit } from './auditService';
import { fetchActorProfile, type ActorProfile } from './access';
import { QR_ACCESS_DETAIL, viewerMaySee } from './qrAccess';
import { parseQrPayload, payloadMessage, type ParsedQrPayload } from './qrPayload';
import {
  keyringFromCache,
  keyringFromEnv as parseEnvKeyring,
  keyringFromResponse as parseResponseKeyring,
  serializeKeyring,
  type QrKeyring,
} from './qrKeyring';
import { verifyQrSignature } from './qrSignature';

export type { ParsedQrPayload } from './qrPayload';
export {
  decodeSignature,
  encodeSignature,
  isQrPayload,
  normalizeAssetCode,
  parseQrPayload,
  payloadMessage,
} from './qrPayload';

/* ── Outcomes ───────────────────────────────────────────────────────────── */

export type QrStatus =
  | 'valid'
  | 'legacy_unsigned'
  | 'invalid_signature'
  | 'unknown_key'
  | 'unknown_asset'
  | 'asset_revoked'
  | 'malformed'
  | 'unsupported'
  | 'unavailable';

export type QrTone = 'ok' | 'warning' | 'danger' | 'neutral';

export type ScannedAsset = { id: string; code: string; name: string };

export type QrScanResult = {
  status: QrStatus;
  label: string;
  tone: QrTone;
  detail: string;
  signed: boolean;
  keyId: string | null;
  code: string | null;
  /**
   * The asset behind a sticker that passed its checks, or null. Null is also
   * used when the sticker is genuine but belongs to an account outside the
   * viewer's access — exactly like the web's `asset: null, permitted: false`.
   */
  asset: ScannedAsset | null;
  /** May this viewer see the asset behind the sticker? */
  permitted: boolean;
};

/** Status => the words and colour the interface shows, matching the web app. */
export const QR_STATES: Record<QrStatus, { label: string; tone: QrTone; detail: string }> = {
  valid: {
    label: 'Verified sticker',
    tone: 'ok',
    detail: 'The signature is genuine and matches the asset in the database.',
  },
  legacy_unsigned: {
    label: 'Unsigned sticker',
    tone: 'warning',
    detail:
      'Printed before signed codes were introduced. The code was matched against the database, but it carries no signature.',
  },
  invalid_signature: {
    label: 'Failed authenticity check',
    tone: 'danger',
    detail:
      'The signature does not match this payload. The sticker has been altered or was not produced by this system.',
  },
  unknown_key: {
    label: 'Unknown signing key',
    tone: 'danger',
    detail:
      'The sticker names a signing key this system does not hold. It is either forged or signed with a key that was retired without keeping its public half.',
  },
  unknown_asset: {
    label: 'Asset not found',
    tone: 'warning',
    detail: 'The code does not belong to any asset in this database.',
  },
  asset_revoked: {
    label: 'Sticker revoked',
    tone: 'danger',
    detail: "The Asset Management Office revoked this asset's sticker. Do not rely on it.",
  },
  malformed: {
    label: 'Damaged payload',
    tone: 'danger',
    detail: 'The sticker carries a NU Trace payload that cannot be read.',
  },
  unsupported: {
    label: 'Not a NU Trace code',
    tone: 'neutral',
    detail: 'This is not a NU Trace sticker.',
  },
  unavailable: {
    label: 'Verification unavailable',
    tone: 'neutral',
    detail:
      'This app has no public keys for the deployment, so the signature could not be checked. The sticker is neither confirmed nor rejected.',
  },
};

/** Statuses that must not be acted on (an altered, revoked, or damaged sticker). */
export const QR_BLOCKING: QrStatus[] = ['invalid_signature', 'unknown_key', 'asset_revoked', 'malformed'];

/* ── Public keys ────────────────────────────────────────────────────────── */

type Keyring = QrKeyring;

const KEYRING_CACHE = '@nutrace/qr-public-keys';
/** Re-fetch at most once a day; a key rotation is a rare, deliberate event. */
const KEYRING_TTL_MS = 24 * 60 * 60 * 1000;

let memoryKeyring: Keyring | null = null;
let loading: Promise<Keyring> | null = null;

/** `EXPO_PUBLIC_QR_PUBLIC_KEYS`, if the deployment pinned a public ring. */
const keyringFromEnv = (): Keyring =>
  parseEnvKeyring(String(process.env.EXPO_PUBLIC_QR_PUBLIC_KEYS || '').trim());

const fetchRemoteKeyring = async (): Promise<Keyring> => {
  const response = await fetch(`${webOrigin()}/qr/public-keys`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Key endpoint answered HTTP ${response.status}.`);
  return parseResponseKeyring(await response.json());
};

const readCachedKeyring = async (): Promise<{ keys: Keyring; fetchedAt: number } | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEYRING_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      keys?: Record<string, { algorithm?: string; public?: string }>;
      fetchedAt?: number;
    };
    return { keys: keyringFromCache(parsed.keys), fetchedAt: Number(parsed.fetchedAt) || 0 };
  } catch {
    return null;
  }
};

const writeCachedKeyring = async (keys: Keyring, fetchedAt: number): Promise<void> => {
  try {
    await AsyncStorage.setItem(
      KEYRING_CACHE,
      JSON.stringify({ keys: serializeKeyring(keys), fetchedAt }),
    );
  } catch {
    // A cache write failure only costs a re-fetch next launch.
  }
};

/**
 * The deployment's public keys, ready for verification.
 *
 * Order: app env (a pinned keyring), then the device cache, then the web app's
 * `/qr/public-keys`. A stale cache is preferred over no keys when the network
 * is down - "unavailable" is honest, but so is a key that worked yesterday.
 */
export function loadQrPublicKeys(): Promise<Keyring> {
  const fromEnv = keyringFromEnv();
  if (Object.keys(fromEnv).length > 0) return Promise.resolve(fromEnv);
  if (memoryKeyring) return Promise.resolve(memoryKeyring);
  if (loading) return loading;

  loading = (async () => {
    try {
      const cached = await readCachedKeyring();
      const fresh = cached && Date.now() - cached.fetchedAt < KEYRING_TTL_MS;

      if (cached && fresh) {
        memoryKeyring = cached.keys;
        return cached.keys;
      }

      try {
        const keys = await fetchRemoteKeyring();
        memoryKeyring = keys;
        await writeCachedKeyring(keys, Date.now());
        return keys;
      } catch (error) {
        console.warn('QR public keys could not be fetched:', error);
        memoryKeyring = cached?.keys ?? {};
        return memoryKeyring;
      }
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** Forget the in-memory ring (used when a fresh fetch is wanted). */
export const clearQrKeyCache = (): void => {
  memoryKeyring = null;
};

/* ── Verification ───────────────────────────────────────────────────────── */

/**
 * Check one signature. Returns null - not false - when the key cannot be used,
 * so "we cannot check this" stays distinct from "this does not match".
 */
const checkSignature = (code: string, keyId: string, signature: Uint8Array, key: QrKeyring[string]): boolean | null =>
  verifyQrSignature(payloadMessage(code, keyId), signature, key);

// `department_id` lives on the owner's `users` row, not on `assets` (the web's
// AssetQr lookup joins the same way). It is read for the access check only and
// never returned to the screen.
const ASSET_SELECT = 'id, Asset_code, Asset_name, qr_revoked_at, user_id, users:user_id(department_id)';

const toScannedAsset = (row: any): ScannedAsset => ({
  id: String(row?.id ?? ''),
  code: String(row?.Asset_code ?? ''),
  name: String(row?.Asset_name ?? ''),
});

const ownerDepartment = (row: any): number | null => {
  const owner = Array.isArray(row?.users) ? row.users[0] : row?.users;
  const id = Number(owner?.department_id);
  return Number.isFinite(id) ? id : null;
};

/** Escape a value used as a LIKE pattern; asset codes may contain `_`. */
const escapeLike = (value: string): string => String(value).replace(/[\\%_]/g, (char) => `\\${char}`);

/** Resolve a (trusted) code to its asset row, case-insensitively where needed. */
async function findAssetByCode(code: string): Promise<{ row: any; asset: ScannedAsset | null }> {
  const exact = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .eq('Asset_code', code)
    .limit(1)
    .maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data) return { row: exact.data, asset: toScannedAsset(exact.data) };

  // Stickers printed before the code was normalised can differ in casing. The
  // code is a value, not a pattern: an `_` in it must not match any character.
  const loose = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .ilike('Asset_code', escapeLike(code))
    .limit(1)
    .maybeSingle();
  if (loose.error) throw loose.error;

  return { row: loose.data ?? null, asset: loose.data ? toScannedAsset(loose.data) : null };
}

/* ── Who may see the asset behind a sticker ─────────────────────────────── */

/** The live account of the person holding the phone, or null when it is gone. */
async function loadViewer(): Promise<ActorProfile | null> {
  try {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return null;
    const stored = JSON.parse(raw) as { id?: unknown; user_id?: unknown };
    return await fetchActorProfile((stored?.id ?? stored?.user_id ?? null) as string | number | null);
  } catch {
    // No account could be verified: show the verdict, never the asset details.
    return null;
  }
}

/**
 * Resolve one scan exactly the way the web server resolves it, without the
 * server: payload -> signature -> database -> revocation.
 */
export async function verifyScannedQr(raw: unknown): Promise<QrScanResult> {
  const parsed: ParsedQrPayload = parseQrPayload(raw);
  let status: QrStatus;
  let detail: string | null = null;
  let asset: ScannedAsset | null = null;
  let permitted = false;

  switch (parsed.type) {
    case 'malformed':
      status = 'malformed';
      detail = parsed.detail;
      break;
    case 'unsupported':
      status = 'unsupported';
      detail = parsed.detail;
      break;
    case 'legacy':
      status = 'legacy_unsigned';
      break;
    default: {
      const keyId = String(parsed.keyId);
      const ring = await loadQrPublicKeys();

      if (Object.keys(ring).length === 0) {
        status = 'unavailable';
      } else if (!ring[keyId]) {
        status = 'unknown_key';
      } else {
        const verified = checkSignature(String(parsed.code), keyId, parsed.signature as Uint8Array, ring[keyId]);
        status = verified === true ? 'valid' : verified === false ? 'invalid_signature' : 'unknown_key';
      }
      break;
    }
  }

  // A sticker whose signature failed is not looked up: the identifier in it
  // cannot be trusted, so reporting an asset for it would dress up a forgery
  // with genuine details.
  const blockedBeforeLookup: QrStatus[] = ['invalid_signature', 'unknown_key', 'malformed', 'unsupported'];

  if (!blockedBeforeLookup.includes(status) && parsed.code !== null) {
    try {
      const found = await findAssetByCode(parsed.code);

      if (found.row === null) {
        status = 'unknown_asset';
      } else if (found.row.qr_revoked_at) {
        status = 'asset_revoked';
      } else {
        // The sticker resolves. Whether its details may be shown is a separate
        // question from whether the signature is genuine — the web asks the
        // same one and never returns the asset when the answer is no.
        const viewer = await loadViewer();
        permitted = viewerMaySee(viewer, {
          userId: found.row.user_id ?? null,
          departmentId: ownerDepartment(found.row),
        });

        if (permitted) {
          asset = toScannedAsset(found.row);
        } else if (!QR_BLOCKING.includes(status)) {
          detail = QR_ACCESS_DETAIL;
        }
      }
    } catch (error) {
      console.warn('QR asset lookup failed:', error);
      // The database could not be reached - that is not the sticker's fault.
      return {
        status: 'unavailable',
        ...QR_STATES.unavailable,
        detail: 'The asset database could not be reached, so this sticker was neither confirmed nor rejected.',
        signed: parsed.type === 'signed',
        keyId: parsed.keyId,
        code: parsed.code,
        asset: null,
        permitted: false,
      };
    }
  }

  const state = QR_STATES[status];
  return {
    status,
    label: state.label,
    tone: state.tone,
    detail: detail ?? state.detail,
    signed: parsed.type === 'signed',
    keyId: parsed.keyId,
    code: parsed.code,
    asset,
    permitted,
  };
}

/* ── Suspicious-scan logging ────────────────────────────────────────────── */

/**
 * One sticker rescanned a dozen times is one event, not a dozen log rows. The
 * scanner already stops after a verdict; this covers "Scan again" on the same
 * forged sticker and keeps a burst from flooding the shared trail. It is a
 * courtesy, not the security boundary — the database must still refuse bulk
 * writes from a client that ignores it.
 */
const RECENT_SCAN_MS = 60 * 1000;
const RECENT_SCAN_LIMIT = 200;
const recentScans = new Map<string, number>();

const isRepeatScan = (key: string): boolean => {
  const now = Date.now();

  for (const [seen, at] of recentScans) {
    if (now - at > RECENT_SCAN_MS) recentScans.delete(seen);
  }

  if (recentScans.has(key)) return true;

  recentScans.set(key, now);
  while (recentScans.size > RECENT_SCAN_LIMIT) {
    const oldest = recentScans.keys().next().value;
    if (oldest === undefined) break;
    recentScans.delete(oldest);
  }

  return false;
};

/**
 * Keep a suspicious scan in the shared audit trail, the way the web logs it
 * server-side. Only genuine security events are recorded - an unsigned legacy
 * sticker or an unreachable key endpoint is not an accusation.
 */
export async function recordSuspiciousScan(result: QrScanResult, actorId?: string | number | null): Promise<void> {
  if (!QR_BLOCKING.includes(result.status)) return;

  if (isRepeatScan(`${result.status}|${result.keyId ?? ''}|${result.code ?? ''}`)) return;

  await writeAudit({
    actorId: actorId ?? null,
    actionType: 'UPDATE',
    description: `Scanned QR sticker rejected (${result.label}).`,
    notes: [
      `status=${result.status}`,
      result.keyId ? `key_id=${result.keyId}` : null,
      result.code ? `code=${result.code}` : null,
      `detail=${result.detail}`,
    ]
      .filter(Boolean)
      .join(' | '),
  });
}
