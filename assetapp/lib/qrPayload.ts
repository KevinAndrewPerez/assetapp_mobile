/**
 * The text inside an asset's QR code - reading and writing it, with no React
 * Native dependency, so the format can be exercised outside the app.
 *
 * Version 1 of the payload is a compact, canonical, uppercased token:
 *
 *     NUT1-<asset code>-<key id>-<signature>
 *
 * Everything here mirrors `App\Support\QrPayload` on the web: the same prefix,
 * the same canonical fields, and the same base32 (RFC 4648, no padding)
 * signature encoding, chosen because it keeps the whole payload inside QR
 * alphanumeric mode - roughly half the modules of a byte-mode code, which is
 * what keeps a 20mm sticker readable. A payload the phone accepts must be one
 * the server would accept, byte for byte; this file is where that is decided.
 */

/** Marker and version of the current format. */
export const PREFIX = 'NUT1';
export const VERSION = 1;

/** Longest scanned text we will even parse (mirrors the server's cap). */
export const MAX_TEXT_LENGTH = 512;

/** Base32 (RFC 4648, no padding) - QR alphanumeric mode, case-free. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `NUT` + up to two version digits + separator. */
const FAMILY_PATTERN = /^NUT([0-9]{1,2})[-:]/i;

/** Raw signature lengths we accept, in bytes (Ed25519 is 64, DER P-256 ~70). */
const MIN_SIGNATURE_BYTES = 32;
const MAX_SIGNATURE_BYTES = 160;

/** `assets.Asset_code` accepts letters, numbers, dot, dash, slash, underscore. */
const ASSET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._\-/]{1,49}$/;

export type ParsedQrPayload = {
  type: 'signed' | 'legacy' | 'unsupported' | 'malformed';
  version: number | null;
  code: string | null;
  keyId: string | null;
  signature: Uint8Array | null;
  detail: string;
};

const blank = { version: null, code: null, keyId: null, signature: null };

/** Uppercase, trimmed, spaces collapsed to dashes (mirrors AssetCode::normalize). */
export const normalizeAssetCode = (code: unknown): string =>
  String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');

export const isValidAssetCode = (code: string): boolean => ASSET_CODE_PATTERN.test(normalizeAssetCode(code));

/** Does this text claim to be one of our payloads (any version)? */
export const isQrPayload = (text: string): boolean => FAMILY_PATTERN.test(String(text ?? '').replace(/^\s+/, ''));

/** ASCII-only messages: the payload charset is A-Z, 0-9 and `-`. */
export const asciiBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

/** Raw signature bytes as uppercase base32 (QR alphanumeric mode). */
export const encodeSignature = (signature: Uint8Array): string => {
  let encoded = '';
  let bits = 0;
  let value = 0;

  for (const byte of signature) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32[(value >> bits) & 0x1f];
    }
  }

  if (bits > 0) encoded += BASE32[(value << (5 - bits)) & 0x1f];
  return encoded;
};

/**
 * Decode a base32 signature, or null when it is not a canonical encoding of an
 * acceptable signature. Re-encoding what was decoded and comparing keeps one
 * signature from having several spellings, so a tampered payload cannot hide
 * behind a different-but-equivalent string.
 */
export const decodeSignature = (encoded: string): Uint8Array | null => {
  const text = String(encoded ?? '').trim().toUpperCase();
  if (text === '' || text === '0' || text.length > 260) return null;

  const decoded: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of text) {
    const index = BASE32.indexOf(character);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((value >> bits) & 0xff);
    }
  }

  const bytes = Uint8Array.from(decoded);
  // Leftover bits are only valid when they are zero, which re-encoding catches.
  if (bytes.length === 0 || encodeSignature(bytes) !== text) return null;
  if (bytes.length < MIN_SIGNATURE_BYTES || bytes.length > MAX_SIGNATURE_BYTES) return null;

  return bytes;
};

/**
 * Read scanned text into one of four outcomes, never throwing - the same four
 * `QrPayload::parse` produces on the web.
 *
 *  - `signed`      a well-formed v1 payload (signature not checked here)
 *  - `legacy`      a plain asset code - a sticker printed before signing
 *  - `unsupported` not a NU Trace sticker, or a payload version we do not know
 *  - `malformed`   a payload of ours that cannot be read
 */
export function parseQrPayload(scanned: unknown): ParsedQrPayload {
  const text = String(scanned ?? '').trim();

  // `...blank` comes first everywhere: it carries nulls, and a spread after a
  // real value would silently replace that value with null.
  if (text === '') return { ...blank, type: 'malformed', detail: 'Nothing was scanned.' };
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      ...blank,
      type: 'malformed',
      detail: `The scanned text is too long to be a NU Trace sticker (${text.length} characters).`,
    };
  }

  if (!isQrPayload(text)) {
    if (isValidAssetCode(text)) {
      return { ...blank, type: 'legacy', code: normalizeAssetCode(text), detail: 'Plain asset code, no signature.' };
    }
    return { ...blank, type: 'unsupported', detail: 'This is not a NU Trace sticker.' };
  }

  const version = Number(FAMILY_PATTERN.exec(text)?.[1] ?? 0);

  if (version !== VERSION) {
    return {
      ...blank,
      type: 'unsupported',
      version,
      detail: `This sticker uses payload version ${version}, which this app does not know.`,
    };
  }

  const fields = text.split('-');
  if (fields.length < 4 || fields[0].toUpperCase() !== PREFIX) {
    return { ...blank, type: 'malformed', version, detail: 'The sticker payload is incomplete.' };
  }

  const signatureEncoded = fields.pop() as string;
  const keyId = String(fields.pop() ?? '').toUpperCase();
  const code = normalizeAssetCode(fields.slice(1).join('-'));

  if (code === '' || !isValidAssetCode(code)) {
    return { ...blank, type: 'malformed', version, detail: 'The sticker payload does not carry a usable asset code.' };
  }

  if (!/^[A-Z0-9]{1,16}$/.test(keyId)) {
    return { ...blank, type: 'malformed', version, detail: 'The sticker payload does not name a usable signing key.' };
  }

  const signature = decodeSignature(signatureEncoded);
  if (signature === null) {
    return { ...blank, type: 'malformed', version, detail: 'The sticker signature cannot be read.' };
  }

  return { type: 'signed', version, code, keyId, signature, detail: 'Signed sticker.' };
}

/** The exact bytes a signature covers: the payload's first three fields. */
export const payloadMessage = (code: string, keyId: string): Uint8Array =>
  asciiBytes(`${PREFIX}-${normalizeAssetCode(code)}-${keyId.toUpperCase()}`);
