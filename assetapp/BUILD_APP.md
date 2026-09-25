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
node scripts/db-transfer-check.js # read-only: Transfer list/statuses/history + the duplicate-code lookup
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

## Forgot password needs the website to be reachable

The app's Forgot Password screen mirrors the web flow, but the **email is sent by the
NUTrace website** (it holds the mail credentials): the app posts the address to
`/forgot-password`, the site writes a single-use 6-digit code into `password_resets` and
mails it, and the app verifies that code and saves the new password itself. So the app
needs the deployed site's URL — `EXPO_PUBLIC_WEB_URL` in `.env`, or the
`EXPO_PUBLIC_WEB_URL` value in `app.json → extra` for release builds (both already point
at the Railway deployment). If the site is down or its SMTP is not configured, no email
arrives and the screen offers a button that opens the site in the phone's browser.

Passwords written by the app are stored as bcrypt digests tagged `$2y$`, the only format
Postgres' `crypt()` (used by the login RPC) can verify — see `lib/passwordHash.ts`.
