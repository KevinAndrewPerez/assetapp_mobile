// The signed-sticker rules, checked without a camera, a phone or a database:
// `node scripts/qr-rules-check.mjs`.
//
// The payload/keyring/signature modules are pure (no React Native), so the same
// code the app runs is exercised here. Signatures are produced with OpenSSL
// through Node's `crypto` module — the same library Laravel's QrSigner uses —
// and with noble's Ed25519, so both server paths are covered.
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

import {
  decodeSignature,
  encodeSignature,
  isValidAssetCode,
  normalizeAssetCode,
  parseQrPayload,
  payloadMessage,
} from '../lib/qrPayload.ts';
import {
  KEY_ID_PATTERN,
  keyringFromCache,
  keyringFromEnv,
  keyringFromResponse,
  serializeKeyring,
} from '../lib/qrKeyring.ts';
import { QR_ACCESS_DETAIL, viewerMaySee } from '../lib/qrAccess.ts';
import { verifyQrSignature } from '../lib/qrSignature.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
};

const bytes = (...values) => Uint8Array.from(values);
const base64 = (value) => Buffer.from(value).toString('base64');

/* ── payload parsing (mirrors App\Support\QrPayload::parse) ─────────────── */

const signature = bytes(...Array.from({ length: 64 }, (_, index) => index));
const encoded = encodeSignature(signature);
const payload = `NUT1-AST-0001-V1-${encoded}`;

const signed = parseQrPayload(payload);
check('a v1 payload parses as signed', signed.type, 'signed');
check('the asset code is read', signed.code, 'AST-0001');
check('the key id is read', signed.keyId, 'V1');
check('the signature decodes', Array.from(signed.signature ?? []), Array.from(signature));

check('a plain code is legacy, not signed', parseQrPayload('ast-0001').type, 'legacy');
check('a legacy code is normalised', parseQrPayload(' ast-0001 ').code, 'AST-0001');
check('a URL is not a NU Trace code', parseQrPayload('https://example.com/asset/AST-0001').type, 'unsupported');
check('a v2 payload is unsupported, not fake', parseQrPayload('NUT2-AST-0001-V1-AAAA').type, 'unsupported');
check('a v2 payload keeps its version', parseQrPayload('NUT2-AST-0001-V1-AAAA').version, 2);
check('nothing scanned is malformed', parseQrPayload('').type, 'malformed');
check('a truncated signature is malformed', parseQrPayload('NUT1-AST-0001-V1-XXXX').type, 'malformed');
check('an empty signature is malformed', parseQrPayload('NUT1-AST-0001-V1-').type, 'malformed');
check('an oversized payload is malformed', parseQrPayload('NUT1-' + 'AST-0001-'.repeat(60)).type, 'malformed');
check('a key id outside A-Z0-9 is malformed', parseQrPayload(payload.replace('-V1-', '-V1!-')).type, 'malformed');
check('a bad asset code is malformed', parseQrPayload(`NUT1--V1-${encoded}`).type, 'malformed');
check('a non-canonical signature is malformed', parseQrPayload(`NUT1-AST-0001-V1-${encoded}AB`).type, 'malformed');
// A payload with too few fields is read as a different (valid-looking) code
// rather than rejected outright — the same as the web parser. Its signature
// then fails, so it is never mistaken for a genuine sticker.
check(
  'a payload missing a field still has to pass the signature check',
  parseQrPayload(`NUT1-AST-0001-${encoded}`).type,
  'signed',
);

/* ── base32 signature encoding ──────────────────────────────────────────── */

check('signature encoding round-trips', Array.from(decodeSignature(encoded) ?? []), Array.from(signature));
check('the encoded signature is canonical', encodeSignature(signature), encoded);
check('lower-case encoding is accepted', Array.from(decodeSignature(encoded.toLowerCase()) ?? []), Array.from(signature));
check('the payload stays in QR alphanumeric characters', /^[A-Z0-9.\-/_]+$/.test(payload), true);

/* ── asset-code helpers (mirror AssetCode) ──────────────────────────────── */

check('spaces become dashes', normalizeAssetCode(' nu 9001 '), 'NU-9001');
check('valid codes pass', isValidAssetCode('AST-0001'), true);
check('too-short codes fail', isValidAssetCode('A'), false);
check('underscores and dots are accepted', isValidAssetCode('LAB_1.2'), true);
check('a URL fails', isValidAssetCode('https://example.com/AST-1'), false);

/* ── keyring: public halves only ────────────────────────────────────────── */

const edPublic = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const edRing = keyringFromEnv(`v1:ed25519-public:${base64(edPublic)}`);
check('a pinned public Ed25519 key is accepted', Object.keys(edRing), ['V1']);
check('the algorithm is recorded', edRing.V1?.algorithm, 'ed25519');
check('the public bytes survive decoding', Array.from(edRing.V1?.public ?? []), Array.from(edPublic));

const seedOnly = keyringFromEnv(`v1:ed25519:${base64(new Uint8Array(32).fill(3))}`);
check('a pinned SECRET entry is ignored', Object.keys(seedOnly), []);
check('an unknown algorithm is ignored', Object.keys(keyringFromEnv(`v1:magic:${base64(edPublic)}`)), []);
check('a malformed base64 entry is ignored', Object.keys(keyringFromEnv('v1:ed25519-public:not base64!')), []);
check('a wrong-length key is ignored', Object.keys(keyringFromEnv(`v1:ed25519-public:${base64(new Uint8Array(31))}`)), []);
check('an invalid key id is refused by the pattern', KEY_ID_PATTERN.test('bad key!'), false);

const responseRing = keyringFromResponse({
  configured: true,
  keys: {
    V1: { algorithm: 'ed25519', public: base64(edPublic) },
    V2: { algorithm: 'ecdsa-p256', public: base64(new Uint8Array(65)) },
    V3: { algorithm: 'ed25519', public: base64(new Uint8Array(5)) },
    'bad id': { algorithm: 'ed25519', public: base64(edPublic) },
  },
});
check('the public-key response is read', Object.keys(responseRing), ['V1']);
check('a malformed response key is ignored', responseRing.V3, undefined);
check('a bad response key id is ignored', responseRing['bad id'], undefined);

const serialised = serializeKeyring(edRing);
check('serialisation keeps the algorithm', serialised.V1?.algorithm, 'ed25519');
check('serialisation emits base64 public bytes', serialised.V1?.public, base64(edPublic));
check('the cached ring round-trips', Object.keys(keyringFromCache(serialised)), ['V1']);
check('cache junk is ignored', Object.keys(keyringFromCache({ nope: 1 })), []);

/* ── Ed25519 signatures (libsodium on the web) ──────────────────────────── */

const { ed25519 } = await import('@noble/curves/ed25519.js');
const edKeypair = ed25519.keygen();
const edKey = { algorithm: 'ed25519', public: edKeypair.publicKey };
const message = payloadMessage('AST-0001', 'V1');
const edSignature = ed25519.sign(message, edKeypair.secretKey);

check('a genuine Ed25519 signature verifies', verifyQrSignature(message, edSignature, edKey), true);
check(
  'an altered asset code fails',
  verifyQrSignature(payloadMessage('AST-0002', 'V1'), edSignature, edKey),
  false,
);
check(
  'an altered key id fails',
  verifyQrSignature(payloadMessage('AST-0001', 'V2'), edSignature, edKey),
  false,
);
const flipped = Uint8Array.from(edSignature);
flipped[0] ^= 0x01;
check('an altered signature fails', verifyQrSignature(message, flipped, edKey), false);
check(
  'another key fails',
  verifyQrSignature(message, edSignature, { algorithm: 'ed25519', public: ed25519.keygen().publicKey }),
  false,
);
check('a missing key cannot be checked', verifyQrSignature(message, edSignature, null), null);
check(
  'a wrong-length public key cannot be checked',
  verifyQrSignature(message, edSignature, { algorithm: 'ed25519', public: new Uint8Array(31) }),
  null,
);

/* ── ECDSA P-256 over SHA-256 (OpenSSL on the web) ──────────────────────── */

const ecPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = ecPair.publicKey.export({ format: 'jwk' });
const p256Point = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]);
const p256Key = { algorithm: 'ecdsa-p256', public: new Uint8Array(p256Point) };
const opensslSignature = crypto.sign('sha256', Buffer.from(message), ecPair.privateKey);

check('an OpenSSL P-256 signature verifies', verifyQrSignature(message, opensslSignature, p256Key), true);
check(
  'a tampered P-256 message fails',
  verifyQrSignature(payloadMessage('AST-0002', 'V1'), opensslSignature, p256Key),
  false,
);
check(
  'a malformed P-256 point cannot be checked',
  verifyQrSignature(message, opensslSignature, { algorithm: 'ecdsa-p256', public: new Uint8Array(65) }),
  null,
);

/* ── who may see the asset behind a sticker (web QrVerification::permitted) ── */

const admin = { id: '1', role: 'Admin', status: 'Active', departmentId: 1 };
const head = { id: '2', role: 'Department Head', status: 'Active', departmentId: 1 };
const employee = { id: '3', role: 'Employee', status: 'Active', departmentId: 1 };
const otherDepartment = { id: '4', role: 'Department Head', status: 'Active', departmentId: 2 };
const deactivated = { id: '5', role: 'Admin', status: 'Inactive', departmentId: 1 };
const ownAsset = { userId: 3, departmentId: 1 };
const colleagueAsset = { userId: 2, departmentId: 1 };
const outsideAsset = { userId: 9, departmentId: 2 };
const unownedAsset = { userId: null, departmentId: null };

check('the office sees every asset', viewerMaySee(admin, outsideAsset), true);
check('a department head sees their department', viewerMaySee(head, colleagueAsset), true);
check('a department head does not see another department', viewerMaySee(otherDepartment, ownAsset), false);
check('an employee sees their own asset', viewerMaySee(employee, ownAsset), true);
check('an employee does not see a colleague\'s asset', viewerMaySee(employee, colleagueAsset), false);
check('an unowned asset is office-only', viewerMaySee(employee, unownedAsset), false);
check('a deactivated account sees nothing', viewerMaySee(deactivated, ownAsset), false);
check('a missing account sees nothing', viewerMaySee(null, ownAsset), false);
check('access denial explains itself without calling the sticker fake',
  QR_ACCESS_DETAIL.includes('outside your account'),
  true);

/* ── what never appears in a mobile bundle ──────────────────────────────── */

const shippingRing = JSON.stringify(serializeKeyring(edRing));
check('serialised keys never include the Ed25519 seed', shippingRing.includes(base64(edKeypair.secretKey)), false);
check('serialised keys carry only algorithm and public', Object.keys(serialised.V1 ?? {}).sort(), ['algorithm', 'public']);

console.log('');
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('All QR rule assertions passed.');
