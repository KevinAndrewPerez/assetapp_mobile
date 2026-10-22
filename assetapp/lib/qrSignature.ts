/**
 * Checking one QR signature — the cryptographic half, kept pure and separate
 * from the database and the scanner.
 *
 * The server signs with libsodium (Ed25519) or OpenSSL (ECDSA P-256 over
 * SHA-256). The phone must accept both, because a deployment may use either and
 * a retired key may live on as a public entry with the other algorithm. Noble's
 * P-256 verifier hashes raw message bytes with SHA-256 by default and accepts
 * OpenSSL's DER signatures when told `format: 'der'`; `lowS: false` is required
 * because OpenSSL does not normalise S, which Laravel's signer relies on.
 *
 * The return value is deliberately three-valued:
 *
 *   true   the signature matches this key and message
 *   false  the key is usable and the signature does not match
 *   null   the key/signature cannot be used at all (caller: "unknown key")
 *
 * Treating "cannot check" as "fake" is the one mistake this module exists to
 * prevent: a genuine sticker must never be accused because of an unusable key.
 *
 * No React Native imports, so the verification path is testable in Node
 * (`scripts/qr-rules-check.mjs`).
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';

import type { QrPublicKey } from './qrKeyring';

/**
 * @param message the exact bytes the signature covers (`payloadMessage`)
 * @param signature raw signature bytes, decoded from the payload's base32
 * @param key the public key named by the payload's key id
 */
export function verifyQrSignature(
  message: Uint8Array,
  signature: Uint8Array,
  key: QrPublicKey | null | undefined,
): boolean | null {
  if (!key || signature.length === 0) return null;

  try {
    if (key.algorithm === 'ed25519') {
      if (key.public.length !== 32) return null;
      return ed25519.verify(signature, message, key.public);
    }

    if (key.algorithm === 'ecdsa-p256') {
      if (key.public.length !== 65 || key.public[0] !== 0x04) return null;
      return p256.verify(signature, message, key.public, { format: 'der', lowS: false });
    }
  } catch {
    // A malformed point or signature is "we cannot check this", not "forged".
    return null;
  }

  return null;
}
