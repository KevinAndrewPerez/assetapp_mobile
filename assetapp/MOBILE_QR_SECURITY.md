# Signed QR codes and fake-sticker detection (mobile)

Scope: reading and verifying asset stickers on the phone, matching the web's
`App\Support\QrPayload` / `QrSigner` / `QrVerification` on `NUTrace` `origin/main`.
No sticker printing, no printer work, no asset migration, no new asset module.

## 1. What the inspection found

The web already signs stickers and publishes the verifying half of its keyring:

- payload `NUT1-<Asset_code>-<key id>-<base32 signature>`; the signed message is
  `NUT1-<Asset_code>-<key id>`, so the code and key id cannot be altered;
- Ed25519 (libsodium) with an ECDSA P-256 / SHA-256 fallback;
- private key only in `QR_SIGNING_KEYS` on the server, never in a response;
- `GET /qr/public-keys` returns `{configured, keys: {id: {algorithm, public}}}`;
- `assets.qr_payload` stores the exact text printed, `assets.qr_revoked_at`
  revokes a sticker;
- the phone has no Laravel session, so it cannot call `/qr/verify` — the public
  key endpoint exists precisely so it can verify locally.

The phone's parser and outcome vocabulary were already present and close to the
web. The gaps were in the edges:

| Gap | Fix |
|---|---|
| A scanned sticker was resolved without the web's viewer check: any account that reached a scanner saw the asset's details. | `verifyScannedQr` now reads the live account (`fetchActorProfile`, including department) and returns asset details only when the web's `permitted` rule allows it. |
| The optional pinned keyring accepted `ed25519` / `ecdsa-p256` entries — names that mean **secret material** in the server's configuration. | `lib/qrKeyring.ts` accepts only `ed25519-public` / `ecdsa-p256-public` from the app environment. A misplaced secret is ignored rather than decoded. |
| Keyring parsing, signature checking and caching were tangled with React Native, so they could not be tested. | Extracted `lib/qrKeyring.ts` (parsing/serialising) and `lib/qrSignature.ts` (Ed25519 + P-256 verification), both pure. |
| The case-insensitive asset-code fallback used the scanned code as a LIKE pattern. | `_` and `%` are escaped; the code is a value, not a pattern. |
| A scan outside the viewer's access looked like "asset not found" in the pullout flow. | The pullout scanner now shows the verification verdict and its access detail instead of a misleading "not found". |

## 2. Verification order (identical to the web)

1. **Parse** — empty/oversized → `malformed`; foreign text or an unknown
   `NUTx` version → `unsupported`; a plain asset code → `legacy_unsigned`;
   a well-formed v1 token → `signed`.
2. **Signature** — no keys at all → `unavailable`; a key id not in the ring →
   `unknown_key`; signature mismatch → `invalid_signature`; match → `valid`.
3. **Lookup** — only a payload whose signature did not fail is looked up, by
   `Asset_code` from the database. A forgery never borrows real details.
4. **Revocation** — `qr_revoked_at` → `asset_revoked`.
5. **Access** — office (`Admin`) sees everything; a Department Head sees assets
   whose owner is in their department; an Employee sees assets assigned to
   them; an inactive or missing account sees no details.
6. **Logging** — `invalid_signature`, `unknown_key`, `asset_revoked` and
   `malformed` are written to the shared `audit_logs` trail, without the
   payload, signature or key material. The same sticker rescanned within a
   minute is logged once (the scan lock already stops the camera from firing
   repeatedly).

| Outcome | Label | Blocking? |
|---|---|---|
| `valid` | Verified sticker | no |
| `legacy_unsigned` | Unsigned sticker | no (details shown) |
| `invalid_signature` | Failed authenticity check | yes |
| `unknown_key` | Unknown signing key | yes |
| `asset_revoked` | Sticker revoked | yes |
| `malformed` | Damaged payload | yes |
| `unsupported` | Not a NU Trace code | no (no asset) |
| `unknown_asset` | Asset not found | no (no asset) |
| `unavailable` | Verification unavailable | no (details only if the asset resolves and access allows) |

Network failures and a missing keyring are never reported as fake. A sticker
that passes is still only proof that *this system minted that code*; the asset's
live row supplies name, status and owner, and a copied genuine sticker still
verifies — the same documented limitation as the web.

## 3. Key management

- Signing keys stay in the web deployment's environment; the mobile bundle has
  no signing key and no code path that could use one.
- The phone fetches public keys from `/qr/public-keys`, caches them for 24 hours
  and keeps a stale cache as a fallback. A failed fetch with no cache is
  `unavailable`.
- `EXPO_PUBLIC_QR_PUBLIC_KEYS` may pin the ring (e.g. on managed devices). Only
  `-public` entries are accepted; a secret entry is dropped.
- Rotation works the way the web documents it: retire the old key as
  `ed25519-public` / `ecdsa-p256-public`, and printed stickers still verify.

## 4. Compatibility

- Existing stickers are **v1 signed**; no format change was made, so no reprint
  is required.
- Stickers printed before signing (plain code) are still accepted and always
  labelled `Unsigned sticker` — never verified.
- Revocation is honoured from `assets.qr_revoked_at`.
- The phone does not generate stickers for printing. Its existing QR preview
  still shows the plain asset code; printing signed payloads remains the web's
  job (`/admin/assets/labels`, stored `qr_payload`).

## 4a. Assets registered from the phone

The phone cannot mint a signed sticker, and must not be given the ability to:
that requires the private key. Consequences, stated plainly:

- `lib/assetService.ts` (`registerAsset`, and the replacement flows) inserts the
  asset with no `qr_payload`. The asset is registered, and the Assets screens
  show it immediately.
- Its QR preview/print is an **unsigned** code. Scanning it still finds the
  asset, and the scanner says **Unsigned sticker** — never "verified" and never
  "fake".
- The web signs it on its next registration/print path, or in bulk with
  `php artisan qr:resign` (which targets assets with no payload or no stored
  sticker image). After that, `assets.qr_payload` is populated and the phone's
  QR modal shows the signed payload.
- `scripts/qr-live-probe.js` reports how many assets have no stored payload, so
  the gap is visible rather than silent.

Secure signing during mobile registration would need a server-side signing
service that can authenticate the caller. The mobile app has no session a
server can verify (it uses the Supabase publishable key and a password RPC), so
adding one means introducing proper auth or a backend endpoint first — out of
this task's compatible mobile-only scope.

## 5. Files

- `lib/qrPayload.ts` — format, parsing, base32 signature encoding (unchanged
  rules, now exercised by tests).
- `lib/qrKeyring.ts` — public-key parsing, response/cache serialisation.
- `lib/qrSignature.ts` — Ed25519 and OpenSSL-compatible P-256 verification.
- `lib/qrAccess.ts` — the viewer rule (office / department head / employee).
- `lib/qrVerification.ts` — resolution order, key loading, access check, audit.
- `lib/access.ts` — the live profile now carries `departmentId`.
- `components/asset-scanner.tsx` — renders every outcome, blocks refused
  stickers, one scan fires once.
- `components/QRViewModal.tsx` — shows the stored signed payload when the web
  has signed the asset, and says plainly when a code is unsigned.
- `app/asset-registry.tsx` — the registration preview no longer implies it is
  the signed sticker.
- `app/pullout.tsx` — distinguishes "not allowed" from "not found".
- `scripts/qr-rules-check.mjs` — 62 pure assertions.
- `scripts/qr-live-probe.js` — read-only live check.

## 6. Checks run

```
npx tsc --noEmit                                  exit 0
npx eslint <changed files>                        0 errors
node scripts/qr-rules-check.mjs                   62/62 assertions
node scripts/qr-live-probe.js                     all live checks pass
npx expo export --platform android                exit 0 (dist removed)
```

The live probe is the strongest compatibility evidence: it fetched the deployed
keyring and verified **178/178 stored web-generated stickers** with the app's own
parser and signature verifier, and confirmed that an altered code is refused for
all of them. It also confirmed the `assets` columns and owner→department join
resolve, and that `/qr/public-keys` publishes only `algorithm` and `public`.

## 6a. Acceptance criteria

| Criterion | Status |
|---|---|
| 1. A valid signed code verifies | Verified: 178/178 live stickers + Ed25519/P-256 harness cases. |
| 2. An altered payload fails | Verified: altered code/signature cases; 0/178 altered codes accepted live. |
| 3. An unknown identifier is rejected | Resolver returns `unknown_asset`; no live fixture exists that carries a genuine signature for an unregistered code (the signing key is server-side). |
| 4. A malformed payload warns clearly | 12 parser cases (`qr-rules-check.mjs`) + the `Damaged payload` UI state. |
| 5. A legacy code is not called verified | Parser and labels verified; the live database currently has no legacy stickers. |
| 6. Network failure is not "fake" | Separate `unavailable` path for keys and for the database; not exercised on a device. |
| 7. Details come from the database | Verified by code path and the live owner/department join; no asset data is read from the payload. |
| 8. Access rules apply | Nine-case access matrix in `qr-rules-check.mjs`, mirroring the web. |
| 9. Private keys never reach the app | No key material in source or `.env`; pinned env accepts `-public` only; live endpoint publishes only `algorithm`/`public`. |
| 10. Suspicious events are logged | Implemented in both scanner entry points; not executed live (would write audit rows). |
| 11. Repeated scans do not duplicate actions | One-shot scan lock + camera callback disabled while checking/showing a verdict; not device-tested. |
| 12. Existing QR workflows still work | `tsc` + Android bundle pass; on-device camera run not performed. |
| 13. Web compatibility | 178/178 stored web stickers verify with the app's code. |
| 14. Other workflows continue | `tsc` and bundle pass; no signatures or schemas changed. |

## 7. Limitations

- **No Node backend in the mobile path.** The brief assumes one; the phone talks
  to Supabase/PostgREST directly, so verification runs on the device against
  public keys. This is the web's own design for mobile (the public-key endpoint
  exists for it), but it means a modified app could skip the display of a
  verdict. It cannot forge a signature.
- **Camera/on-device test not run.** Verification, parsing, key handling and the
  live keyring/sticker corpus were tested; the camera UI was not exercised on a
  device.
- **Client-submitted logs.** Suspicious scans use the shared `audit_logs` table;
  Supabase RLS, not the app, must stop a client from deleting them or flooding
  the table.
- **Key endpoint trust.** Keys are fetched over the configured web origin; use
  HTTPS, or pin the keyring with `EXPO_PUBLIC_QR_PUBLIC_KEYS`.
- A genuine sticker copied onto a different object still verifies. Signatures
  prove origin, not physical presence or current custody.
