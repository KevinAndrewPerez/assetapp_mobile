/**
 * The public half of the QR signing keyring — reading it, never holding
 * anything that can sign.
 *
 * The web (`App\Support\QrSigner`) keeps the private keys on the server and
 * publishes only verifying material at `/qr/public-keys`:
 *
 *     { "keys": { "V1": { "algorithm": "ed25519", "public": "<base64>" } } }
 *
 * `EXPO_PUBLIC_QR_PUBLIC_KEYS` may pin the same ring in the app's environment,
 * using the server's env vocabulary (`V1:ed25519-public:<base64>`).
 *
 * Deliberately rejected here: `ed25519` / `ecdsa-p256` entries supplied through
 * the app environment. Those names mean *secret material* in the server's
 * configuration; the phone must never be given one, and quietly deriving a
 * public key from a seed would reward the mistake by shipping the seed in the
 * bundle. A pinned entry that is not a `-public` key is ignored, so the sticker
 * it would have verified reads as "unknown signing key" instead of putting a
 * signing secret on the device.
 *
 * Pure functions and types only: no React Native, no database, so the parser
 * can be exercised outside the app (`scripts/qr-rules-check.mjs`).
 */
import { decode as decodeBase64, encode as encodeBase64 } from 'base64-arraybuffer';

export type QrKeyAlgorithm = 'ed25519' | 'ecdsa-p256';

export type QrPublicKey = {
  algorithm: QrKeyAlgorithm;
  /** Ed25519: 32 bytes. P-256: uncompressed point `04 || X || Y`, 65 bytes. */
  public: Uint8Array;
};

export type QrKeyring = Record<string, QrPublicKey>;

/** A key id is printed in the payload; the server's pattern is the same. */
export const KEY_ID_PATTERN = /^[A-Z0-9]{1,16}$/;

const ed25519Bytes = (bytes: Uint8Array): boolean => bytes.length === 32;
const p256Point = (bytes: Uint8Array): boolean => bytes.length === 65 && bytes[0] === 0x04;

const bytesOf = (base64: unknown): Uint8Array | null => {
  const text = String(base64 ?? '').trim();
  if (text === '') return null;
  try {
    return new Uint8Array(decodeBase64(text));
  } catch {
    return null;
  }
};

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Build one ring entry from already-decoded material, or reject it. */
const entryFor = (algorithm: unknown, base64: unknown): QrPublicKey | null => {
  const kind = String(algorithm ?? '').trim().toLowerCase();
  const bytes = bytesOf(base64);
  if (!bytes) return null;

  if (kind === 'ed25519' && ed25519Bytes(bytes)) return { algorithm: 'ed25519', public: bytes };
  if (kind === 'ecdsa-p256' && p256Point(bytes)) return { algorithm: 'ecdsa-p256', public: bytes };
  return null;
};

/**
 * Pin a ring from the app environment: `<id>:<algorithm>:<base64>` entries.
 * Only `ed25519-public` and `ecdsa-p256-public` are accepted.
 */
export function keyringFromEnv(raw: string | null | undefined): QrKeyring {
  const ring: QrKeyring = {};

  for (const entry of String(raw ?? '').split(',')) {
    const parts = entry.trim().split(':', 3);
    if (parts.length !== 3) continue;

    const id = parts[0].trim().toUpperCase();
    const algorithm = parts[1].trim().toLowerCase();
    if (!KEY_ID_PATTERN.test(id)) continue;

    if (algorithm !== 'ed25519-public' && algorithm !== 'ecdsa-p256-public') continue;
    const key = entryFor(algorithm.replace('-public', ''), parts[2]);
    if (key) ring[id] = key;
  }

  return ring;
}

/** Read the `/qr/public-keys` body, validating every entry. */
export function keyringFromResponse(body: unknown): QrKeyring {
  const ring: QrKeyring = {};
  const keys = (body as { keys?: Record<string, { algorithm?: unknown; public?: unknown }> } | null)?.keys;

  if (!keys || typeof keys !== 'object') return ring;

  for (const [rawId, entry] of Object.entries(keys)) {
    const id = rawId.trim().toUpperCase();
    if (!KEY_ID_PATTERN.test(id)) continue;

    const key = entryFor(entry?.algorithm, entry?.public);
    if (key) ring[id] = key;
  }

  return ring;
}

/** The serialisable form kept in the device cache — public halves only. */
export function serializeKeyring(ring: QrKeyring): Record<string, { algorithm: QrKeyAlgorithm; public: string }> {
  const serialised: Record<string, { algorithm: QrKeyAlgorithm; public: string }> = {};

  for (const [id, key] of Object.entries(ring)) {
    serialised[id] = { algorithm: key.algorithm, public: encodeBase64(arrayBufferOf(key.public)) };
  }

  return serialised;
}

/** Read the cache entry written by `serializeKeyring`; anything else is empty. */
export function keyringFromCache(cached: unknown): QrKeyring {
  return keyringFromResponse({ keys: cached });
}
