# Turning NUTrace Mobile into an installable app

This app is an Expo (SDK 57) project, so the same code that runs in Expo Go can be built
into a real Android APK/AAB (and an iOS app) with no code changes. Everything below runs
from this folder (`assetapp_mobile/assetapp`).

## What is already configured

| Concern | Where | Value |
| --- | --- | --- |
| App name / scheme | `app.json` | `NUTrace` / `nutrace://` |
| Android package | `app.json` | `com.nutrace.assetapp` |
| iOS bundle id | `app.json` | `com.nutrace.assetapp` |
| Camera (QR scanning) | `expo-camera` plugin | permission text + `recordAudioAndroid: false` |
| Photo library / camera upload | `expo-image-picker` plugin | library + camera copy, microphone disabled |
| Backend config | `app.json` → `extra` | Supabase URL + publishable key are **baked into the bundle** |
| Build profiles | `eas.json` | `development`, `preview` (APK), `production` (AAB) |

`lib/supabase.ts` reads `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` first
and falls back to `app.json → extra`. Because the values are in `extra`, a build works even
if `.env` is not uploaded — no device-side configuration is needed.

## Always run the pre-flight first (takes ~1 minute, saves a failed build)

```bash
npm run preflight:build          # or: node scripts/preflight-build.js ios
```

It reproduces the two things that break EAS builds here, locally:

1. **The SDK 56+ guard** — our code must never import `@react-navigation/*`. expo-router
   has its own vendored navigation now, and a production bundle refuses to build with:
   *"expo-router is no longer compatible with react-navigation"*. This can look fine in
   Expo Go on your machine (a warm Metro cache or a local `.env` override hides it) and
   only fail on the clean build machine, which is exactly what happened before.
   Use `import { Stack } from 'expo-router'`, `import { Drawer } from 'expo-router/drawer'`,
   and `import { ThemeProvider, DefaultTheme, DarkTheme } from 'expo-router'` instead.
2. **The Gradle step that failed** — `:app:createReleaseUpdatesResources`
   (`expo-updates` → `createManifestForBuildAsync` → Metro) is run with the local `.env`
   overrides stripped, so it sees what EAS sees.

If it prints `✓ release android bundle OK`, you are safe to run `eas build`.

> Important: **never** add `EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1` to `.env` to
> silence that guard. It hides the problem locally while the cloud build keeps failing.

## Option A — cloud build, no Android SDK required (recommended)

1. Create a free Expo account, then in this folder:
   ```bash
   npx eas-cli login
   npx eas-cli init          # links the project, writes extra.eas.projectId into app.json
   ```
2. Build an installable APK:
   ```bash
   npx eas-cli build --platform android --profile preview
   ```
   The first run asks to generate a keystore — let it (EAS stores it for future builds).
3. When it finishes, open the build page / scan the QR with the phone and install the APK
   (Android will ask you to allow installing from this source).

Subsequent builds: same command. Bump `version` / `android.versionCode` in `app.json` for
each release you hand out.

### If the build errors, read the right log

| Message | Meaning | What to do |
| --- | --- | --- |
| `Failed to upload the project tarball/metadata … getaddrinfo ENOTFOUND storage.googleapis.com` | Your computer could not resolve Google's storage host. Nothing is wrong with the project. | Retry. If it repeats: turn off any VPN/proxy, `ipconfig /flushdns`, switch DNS to `1.1.1.1`/`8.8.8.8`, or build from another network (phone hotspot). |
| `Gradle build failed with unknown error. See logs for the "Run gradlew" phase` | Real build failure — the summary is generic, the cause is higher up the log. | Open the build page → *Run gradlew* log, search for `@build-script-error-begin`; or run `npm run preflight:build` locally, which performs the same step. |
| `Execution failed for task ':app:createReleaseUpdatesResources'` | The expo-updates manifest step (what the pre-flight covers). | Fix what the pre-flight reports. |

## Option B — build locally (needs JDK 17 + Android SDK)

```bash
npx expo run:android               # debug build with the dev menu
npx expo run:android --variant release   # release build (no dev menu, fastest)
```
The APK lands in `android/app/build/outputs/apk/release/`. This path creates `android/` and
`ios/` folders (prebuild) — keep building with EAS instead if you would rather not maintain
them. Note `app.json` changes only reach a prebuilt native folder after
`npx expo prebuild --clean`.

## Shipping to the Play Store

```bash
npx eas-cli build --platform android --profile production     # .aab
npx eas-cli submit --platform android --profile production    # uploads it
```

## iOS

`npx eas-cli build --platform ios --profile production` (needs an Apple Developer account;
EAS walks you through credentials). TestFlight distribution is the usual next step.

## Development client (optional but nicer than Expo Go)

Expo Go cannot exercise every native feature (photo library has limits, and the media
library warning you saw comes from Expo Go itself). A development build removes those
limits:
```bash
npx eas-cli build --platform android --profile development
# install the APK, then
npx expo start --dev-client
```

## Before you build a release, check

- **`EXPO_PUBLIC_MAIL_API_KEY`** — the key that lets the app mail the reset code itself
  (see the forgot-password section). Without it the app falls back to the website's mailer,
  which never delivers on the current deployment.
- **`EXPO_PUBLIC_WEB_URL`** — only needed for photos uploaded *through the web app*
  (Laravel `public` disk). Every file reference in the database today is a Supabase Storage
  URL, so images work as-is; if web uploads start being used, either put the deployed web
  origin in `.env` (`EXPO_PUBLIC_WEB_URL=https://…`) or set `PRODUCTION_WEB_URL` in
  `lib/mediaUrl.ts`. Without it, a release build cannot guess the server and logs a warning.
- **HTTP vs HTTPS** — a release APK blocks cleartext `http://` by default. Supabase is
  HTTPS, so nothing to do; point the web origin at an `https://` URL (e.g. the Railway
  deployment) rather than a LAN IP.
- **Permissions** — camera is requested on first scan, photos on first upload. The app no
  longer asks for the microphone.

## Sanity checks that run in this repo

```bash
npx tsc --noEmit                  # types
npm run preflight:build           # the exact EAS bundle step + the react-navigation guard
npx expo-doctor                   # Expo config / dependency health (needs internet)
npx expo export --platform android  # real release-mode Metro bundle, catches import errors
node scripts/import-cycles.js     # no circular imports (Metro warnings)
node scripts/db-audit.js          # read-only: every query the app runs, against live Supabase
node scripts/db-sequence-check.js # read-only: stale id sequences that break INSERTs
node scripts/db-password-check.js # rolled back: a password set in the app can sign in
node scripts/reset-handshake-check.js  # can the app drive the site's forgot-password form
node scripts/reset-code-store-check.js # the reset-code row the app writes, as both apps read it
node scripts/reset-mail-doctor.js      # what the website does (and does not) send
node scripts/db-transfer-check.js # read-only: Transfer list/statuses/history + the duplicate-code lookup
node scripts/media-upload-check.js        # the photo pipeline's pure half, compiled and run in Node
node scripts/media-upload-check.js --live # + both HTTP upload transports, byte-for-byte
node scripts/storage-doctor.js            # read-only: bucket names, .env wiring, storage.from() calls
node scripts/storage-doctor.js --write    # + prove this machine can upload to every folder
node scripts/generate-logo.js     # rebuilds the icon / adaptive layers / splash / favicon
```

## Logo assets

`assets/images/logo-source.png` is the official NUTrace artwork (navy field, white
"A", gold pin and orbit, white package). `node scripts/generate-logo.js` re-colours it
to the app tokens — navy `#0C134F` (`colors.navy900`) and gold `#FDB833`
(`colors.gold500`) — and writes every asset `app.json` points at, including the
transparent adaptive foreground and the white monochrome silhouette. It also emits
`scripts/logo-preview.html` (git-ignored), a self-contained page for checking the icon
at launcher sizes before building. To change the artwork, replace
`logo-source.png` and re-run the script; nothing else needs editing.

The sign-in, register and forgot-password screens show the same file through
`components/brand-logo.tsx`, so the in-app mark and the launcher icon can never
drift apart. **Icon and splash changes need a new native build** (`npx eas-cli build`
or `npx expo prebuild`), not just a JS reload.

## Transfer module (employee relocation)

`app/transfer.tsx` + `lib/transferService.ts`. Picking an employee shows the assets
currently assigned to them (`assets.user_id`), then the admin chooses the receiving
employee and a reason before confirming. On confirm the app writes, in order:

1. one `requests` row — `request_type = Transfer`, `status = Approved`, `user_id` = from,
   `assign_to_user_id` = to, `asset_id = NULL` (a transfer is bulk);
2. one `request_items` row per asset;
3. `assets.user_id` is repointed (code, QR, acquisition data and every repair /
   maintenance / replacement record are untouched);
4. `asset_accountability`: the old row is closed (`Is_Current = 0`) and a new current row
   is opened with `Assign_date`, `transfer_reason` and `request_id`;
5. `audit_logs` — one summary row plus one `TRANSFER` row per asset;
6. `notifications` for both employees.

No new tables are needed. The 🟢 CURRENT / 🔄 REASSIGNED / ⚠️ TRANSFER PENDING statuses are
derived from the transfer history (an approved transfer for that employee), never from
"this employee has zero assets".

## Timestamps are UTC in the database

Laravel runs with `timezone = UTC` and the app writes `new Date().toISOString()`, so every
`timestamp without time zone` column holds UTC. PostgREST returns those values with no
offset, and JavaScript would read them as *local* time — eight hours early on a Manila
phone, which pushed evening events onto the wrong date. Always parse stored values with
`parseStoredTimestamp()` / format them with `formatStoredTimestamp()` from `lib/time.ts`.

## The Activity Log never shows an IP address

The web's login middleware stores `User logged in from IP: <addr>`. The mobile Activity Log
scrubs addresses out (`stripNetworkIdentifiers` in `lib/auditService.ts`) and replaces
sign-in / sign-out rows with the plain notices "This user account has logged in." /
"…logged out.". The app also records the mobile session itself (sign-in and sign-out) so an
admin can see mobile activity, not just web activity.

## Forgot password: the app mails the code itself

The app generates the single-use 6-digit code, stores its bcrypt hash in
`password_resets` — the same row the web app writes — and sends the message through an
email API over HTTPS (`lib/resetMailer.ts`). The steps after that (code check, password
policy, the `users` password write, the audit entry) were already done inside the app, so
the whole reset finishes on the phone.

**Why it no longer asks the website to send it.** The deployed NUTrace site has no
`MAIL_*` configuration, so Laravel falls back to its default `log` mailer: the message is
written into `storage/logs/laravel.log`, the site reports success, and nothing leaves the
server. The site still writes the code row, which is why the app used to show "code sent"
while the inbox stayed empty. `scripts/reset-mail-doctor.js` reproduces that exactly (the
POST answers as fast as a plain GET — no SMTP conversation happened — while a fresh code
row appears in the table).

### Configure the sender

| variable | meaning |
| --- | --- |
| `EXPO_PUBLIC_MAIL_API_KEY` | the provider's API key. **Required**; without it the app falls back to asking the website to mail the code. |
| `EXPO_PUBLIC_MAIL_PROVIDER` | `resend` (default) or `brevo`. |
| `EXPO_PUBLIC_MAIL_FROM` | the verified sender address. Defaults to Resend's `onboarding@resend.dev`. |
| `EXPO_PUBLIC_MAIL_FROM_NAME` | display name, default `NU TRACE`. |

Put them in `.env` for Metro runs. **A release build does not read `.env`** (it is
gitignored and never uploaded), so for an APK the same values must also live in
`app.json → extra` — where `EXPO_PUBLIC_SUPABASE_URL` already is — or in EAS environment
variables. Everything prefixed `EXPO_PUBLIC_` is inlined into the JS bundle and can be
extracted from the APK: fine for a capstone, but treat the key as burnable and rotate it
in the provider's dashboard if it leaks; a production app would send through a small
server instead.

Resend's testing sender only delivers to the address that owns the Resend account.
Verify a domain — or use Brevo, which verifies a single sender *address* and needs no
domain — to mail any registered user.

Only Brevo's endpoint allows browser-origin calls (`access-control-allow-origin` comes
back on its preflight). Resend's does not, so a Resend-keyed build can only send from a
**native** build — Expo Go or the APK — not from `expo export --platform web`. That is
harmless for this project (the deliverable is the APK), but do not conclude the mailer is
broken from a browser run: the console shows a CORS refusal there.

With no key configured, `sendResetCode()` falls back to posting the website's
`/forgot-password` form, which only works once that deployment gets real `MAIL_*`
settings.

### Checking it

```bash
node scripts/reset-code-store-check.js  # the row the app writes is readable and verifiable by both apps
node scripts/reset-mail-doctor.js       # what the website does (and does not) send
```

For a real send, put the key in `.env` and run `npx expo start` — Expo Go loads `.env`,
so the phone can be tested without an APK. `scripts/serve-web-build.js <dir> <port>`
serves an `expo export --platform web` build when you want to drive the screens in a
browser.

`.env` in this repo is **tracked by git** (only `.env*.local` is ignored), so a key pasted
there shows up as a diff. Either untrack it (`git rm --cached assetapp/.env` plus a
`.env` line in `.gitignore`), pass the key through the shell
(`EXPO_PUBLIC_MAIL_API_KEY=… npx expo start`), or set it as an EAS environment variable for
cloud builds.

Passwords written by the app are stored as bcrypt digests tagged `$2y$`, the only format
Postgres' `crypt()` (used by the login RPC) can verify — see `lib/passwordHash.ts`.

A new password must also not be built out of the person's own details (name words of
their full name, their email address, their employee number) — the rule the web added in
its latest update, mirrored by `passwordIsBasedOnIdentity()` in
`lib/passwordResetService.ts` and enforced on the register screen.

## Asset photos: how an upload is stored (and why it used to vanish)

Every file the app stores lives in **one Supabase bucket, `assets`**, under a folder:
`photos/` (asset photos), `profile_photos/`, `request_files/`, `assets/qr/`. A folder is
not a bucket — calling `storage.from('photos')` fails with "Bucket not found".

`lib/mediaUpload.ts` is the single upload path (`storeMedia()`), and it is deliberately
paranoid, because a photo that fails to upload is invisible:

1. **Read** the picked file — the picker's own `base64` first (no file access needed),
   then `expo-file-system`, then `fetch(uri)`, then `XMLHttpRequest`. Android hands out
   `content://` URIs that the file-system reader can reject, which is why the pickers now
   request `base64: true` and keep the whole asset (uri + base64 + mimeType + fileName)
   instead of only its URI.
2. **Send** the bytes — the Supabase client first, then a raw Storage REST `fetch`, then
   the same endpoint as a multipart form. Three genuinely different code paths in React
   Native, not three retries of one.
3. **Verify** — the object is downloaded from its public URL. An upload that cannot be
   read back is reported as a failure instead of being written to the database.

The asset code supplies the object name (`photos/AST-042_<ms>.jpg`); every character
outside `[A-Za-z0-9._-]` is collapsed so a code with a space, `/`, `#` or `?` cannot
produce an impossible key. `asset_files` then stores the pair the web app stores:
`file_path` = the object key (`photos/…`), `url` = the absolute public URL.

### What the `assets` bucket's policies actually allow

Proven against the live project by `storage-doctor.js` and `media-upload-check.js --live`:

| Operation | Result |
| --- | --- |
| INSERT (`x-upsert: false`) | allowed for the app's publishable key |
| UPDATE / upsert (`x-upsert: true`) | **denied** — `400 new row violates row-level security policy` |
| SELECT / list | the app's key gets an empty list back (dashboard hint: a bucket the client can list is a data leak) |
| DELETE | denied |

Because an upsert is refused, `storeMedia()` always uploads with `upsert: false` and, on
a name collision, stores the photo under a fresh key instead of trying to replace it.
Nothing in the app may depend on `list()`.

### "Storage check" on the Register Asset screen

The Asset Registry screen has a small **Storage check** link under the photo box. It
uploads a 1×1 test image through the exact pipeline an asset photo uses **from that
phone** and reports which transport worked or the real error. Run it before blaming the
bucket: a laptop proves nothing about a handset.

`node scripts/storage-doctor.js --write` leaves probe objects behind (the app key cannot
delete them). Remove them from the dashboard when they pile up — they are
`photos/_doctor-*`, `photos/_check-*`, `photos/_selftest-*` and the same names in the
other folders.

## Disposal archive & inventory removal (ported from the web update)

The web's newest disposal workflow is now in the app. `app/archived-disposals.tsx`
(reachable from the dashboard's **Disposal Records** card) has two shelves:

- **Disposal** — records still being worked on. An admin can **archive** one; the record
  is never deleted, it moves to the archive and its asset leaves the institution's
  inventory, so it disappears from the Assets list, the registry, the department views
  and the maintenance queue while its history stays readable.
- **Archived** — the archived records, newest first, each showing whether the asset
  actually left the inventory.

Both shelves are read through `lib/disposalService.ts` (`scope: 'active' | 'archived'`).
The inventory rule itself is `lib/inventory.ts` (`inventoryRemovedReady()`,
`excludeRemovedFromInventory()`, `removeAssetFromInventory()`), the mobile twin of the
web's `App\Support\Inventory`.

### The migration, and the embed trap it sets

`assets.inventory_removed_at / inventory_removed_by` **have been applied to the live
database** with `node scripts/db-apply-inventory-migration.js` — the exact shape of the
web's `2026_09_30_010000_add_inventory_removal_to_assets_table` (nullable columns, naive
`timestamp`, same index and foreign-key names, same backfill from already-archived
disposals), so a later `php artisan migrate` on the web finds nothing left to do. Re-run
it any time; it is idempotent (`--dry-run` prints what it would do). Four assets whose
disposals were already archived are marked as removed from the inventory.

**That foreign key breaks naive PostgREST embeds.** `assets` now has *two* foreign keys
to `users` (`user_id`, `inventory_removed_by`), so `assets?select=*,users(...)` fails with
`PGRST201 — more than one relationship was found`, and the Assets list, the asset detail
screen and the maintenance alert queries would all have gone blank. Every `assets → users`
embed therefore names the relationship it means:

```ts
users!assets_user_id_foreign(department_id, employee_numbers("Full_Name"), …)
```

`scripts/db-audit.js` runs these query shapes against the live database, which is how the
break was caught — keep the audit's copies in step with `lib/assetService.ts` when a
select changes. The `audit_logs → users` embeds need no hint (that table has one FK).

If the column is ever missing again (a fresh environment that has not migrated), the app
keeps working: `lib/inventory.ts` probes for it once per run, `withInventoryColumn()`
leaves it out of selects, and nothing is hidden. To apply it by hand instead:

```bash
php artisan migrate     # web repo, or: node scripts/db-apply-inventory-migration.js
```

or, equivalently, in the Supabase SQL editor:

```sql
-- `timestamp` (naive UTC), not `timestamptz`: every other timestamp column in this
-- project is naive-UTC and lib/time.ts reads it that way.
alter table assets add column if not exists inventory_removed_at timestamp;
alter table assets add column if not exists inventory_removed_by bigint;
create index if not exists assets_inventory_removed_at_index on assets (inventory_removed_at);
alter table assets
  add constraint assets_inventory_removed_by_foreign
  foreign key (inventory_removed_by) references users(id) on delete set null;
-- then make the archived disposals consistent with it:
update assets a set inventory_removed_at = coalesce(d.archived_at, (now() at time zone 'utc')),
                     inventory_removed_by = d.archived_by
  from disposals d
 where d."Asset_id" = a.id and d.is_archived and a.inventory_removed_at is null;
```
