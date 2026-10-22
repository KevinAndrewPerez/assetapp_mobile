# Access control, administration, reports and reset hardening (mobile)

This note covers the last batch of work: who can open which screen, who may
change accounts and department heads, how request/asset detail pages decide what
a viewer may see, the reports view, and the password-reset build hardening. It
records only what was actually checked; the on-device and write-path gaps are
listed at the end.

## 1. Where authority comes from

The web's `App\Support\Access` is the reference:

| Concept | Mobile rule (`lib/access.ts`) |
| --- | --- |
| Asset Management Office | role exactly `Admin`; `Facilities` is retired, `AssetOfficer` is legacy and has no office authority |
| Decide a request | active `Admin`, never the submitter |
| Account / department-head administration | active `Admin` |
| Deactivated account | no actions and no session |
| Department Head | reads their own department only; is not a second approval stage |

Every privileged service call re-reads the caller's `users` row
(`fetchActorProfile`), so a role or status changed on the web takes effect on the
phone immediately. The cached `user` JSON written at sign-in is never the source
of authority for an action.

## 2. Route guards

`app/_layout.tsx` now guards more than the tab groups:

* signed out → only `login`, `register` and `forgot-password` are reachable;
* a live account check runs **once per app launch**. A deleted account is
  signed out; an account whose status is `Inactive` is signed out with
  `?reason=deactivated`, which the login screen explains using the web's
  wording;
* a non-office account that deep-links into the `(tabs)` office group is sent to
  `(user-tabs)`;
* the same redirect applies to the standalone office screens, which are not
  inside either tab group:

  `asset-registry`, `transfer`, `disposal`, `archived-disposals`,
  `activity-log`, `maintenance`, `lifespan`, `reports`, `accounts`,
  `age-review`, `repair`, `replacement`, `pullout`.

## 3. Detail pages

Two detail routes could previously open any record by id or code.

**Asset detail** (`lib/assetService.ts → fetchAssetDetail`). Before the record is
returned, `viewerMaySee` (`lib/qrAccess.ts`) applies the same matrix as the signed
QR check: Admin sees every asset, a Department Head sees assets whose custodian
is in their department, an Employee sees only the asset assigned to them, and a
missing or inactive account sees none. An asset outside that scope is refused
with the QR screen's wording ("the sticker is genuine, but this asset is outside
your account's access"). The refusal happens *after* the signature check, so a
genuine sticker is never called fake.

**Request detail** (`lib/userService.ts → fetchRequestDetail`). Visible to the
office, the submitter, the employee a transfer is assigned to, and a Department
Head for requests whose submitter is in their department. Everyone else gets
"This request is outside your account's access, so its details are not shown."
The check compares against `requests.user_id` / `assign_to_user_id` in the row,
not against client-supplied identity.

## 4. Accounts and department heads

`app/accounts.tsx` lists every account with its live role, status, department,
employee number and whether an employee record is linked. The "Manage Accounts"
entry is only rendered for an Admin (`app/(tabs)/profile.tsx`), the route is
office-only, and each mutation in `lib/accountService.ts` calls
`requireAdminActor(actor.id)` before writing:

* role changes accept only `Admin`, `Employee`, `Department Head`;
* department moves require an existing `departments` row;
* activate/deactivate toggles `users.status`;
* the **last active Administrator** cannot be demoted or deactivated, so the
  office cannot lock itself out;
* each change writes an `audit_logs` row, and a change that leaves pending
  requests without an active reviewer reports that count instead of hiding it.

Department-head assignment (`app/(tabs)/assets.tsx → saveDeptHead`) goes through
`updateDepartmentHead`, now guarded by `requireAdminActor` and passed the signed-in
account's id. It demotes the previous head before promoting the chosen member, so
a department keeps one head, and the web sees the same two `users` rows.

## 5. Reports

`app/reports.tsx` is a new office screen (inventory, acquisitions, repairs,
transfers, disposals, requests). Period filters are chosen on the phone's
calendar. Date columns (`accusion_date`, `disposal_date`) are compared as plain
dates; timestamp columns (`Repair_Date`, `created_at`) are converted to the
naive-UTC query bounds the database stores (`lib/time.ts →
localDateStartStored / localDateEndStored`), because comparing a local midnight
directly against naive UTC loses the first and last hours of the period on a
UTC+8 phone. `fetchReportPage` calls `requireOfficeSession(...)` before any table
read, so the screen guard is not the only gate: an Employee session calling the
function directly is refused. Rows are paged server-side with `count: 'exact'`.

## 6. Password reset

The mobile bundle no longer reads any mail-provider key.
`lib/resetMailer.ts` was deleted; `EXPO_PUBLIC_MAIL_API_KEY`,
`EXPO_PUBLIC_MAIL_PROVIDER`, `EXPO_PUBLIC_MAIL_FROM` and
`EXPO_PUBLIC_MAIL_FROM_NAME` are not referenced anywhere. `sendResetCode()` posts
the address to the NUTrace website, which owns the `MAIL_*` configuration, writes
the bcrypt-hashed code into the shared `password_resets` table and sends the
message. The phone verifies the code, applies the web's password policy, writes
the new `users` password and records the audit entry.

`BUILD_APP.md` now documents the server-side `MAIL_*` settings instead of a
bundle key, and the forgot-password notice reads "If email delivery is
configured for NU TRACE…" because a site still on Laravel's `log` mailer writes
the code row without sending anything.

## 7. Verification performed

* `npx tsc --noEmit` — **pass** (0 errors).
* `npx eslint` on the 62 changed/new TypeScript files — **0 errors**, 6
  warnings (unused catch/import/style warnings). Pre-existing errors from the
  newer `react-hooks` rules remain in untouched files (`(tabs)/_layout.tsx`,
  `(user-tabs)/_layout.tsx`, `my-assets.tsx`, `explore.tsx`, `maintenance.tsx`,
  `use-color-scheme.web.ts`); they were not introduced or changed here.
* `npx expo export --platform android` — **pass**, Hermes bundle 7.1 MB.
* The exported bundle was searched for `RESEND_API_KEY`,
  `EXPO_PUBLIC_MAIL_API_KEY`, `mailProvider` and `api.resend.com` — **0
  occurrences**.
* Pure-function harnesses, all passing:
  `qr-rules-check.mjs` (viewer matrix), `repair-actions-check.mjs`,
  `transfer-rules-check.mjs`, `request-workflow-check.mjs` (office-only
  decisions, no self-approval, no double decisions),
  `disposal-rules-check.mjs`, `registration-rules-check.mjs`,
  `error-message-check.mjs`, `paged-list-check.mjs`,
  `assets-list-payload-check.js`,
  `time-bounds-check.mjs` — report period bounds round-trip to the local
  midnight/end-of-day under `TZ=Asia/Manila`, `TZ=America/New_York`, `TZ=UTC` and
  the machine's own zone.
* Live, read-only Supabase probes:
  * `disposals.is_archived / archived_at / archived_by`,
    `assets.inventory_removed_at / inventory_removed_by`,
    `requests.admin_remarks` all readable;
  * `disposal_documents`, `disposal_form`, `disposal_forms` and
    `password_resets` exist (4 form rows, 4 reset rows at the time of the
    probe);
  * `disposal-request-probe.js` and `disposal-screen-probe.js` resolve the
    disposal screen's select shape and the form token check
    (exact token → 1 row, wrong token → 0).
* Archive path probed with a throwaway `disposals` row: readiness probe, first
  archive (1 row matched), second archive (0 rows → "already archived"), archived
  flag read-back, and the probe row deleted afterwards — **6/6 pass**.

**Not performed:** every write that needs a real account (role/status/department
changes, department-head promotion, disposal document upload, successful archive
of a real record) and any on-device rendering. Those paths require a test admin
account and a device/emulator. No production rows were modified except the
archive probe row, which was created and removed by the script.

## 8. Database evidence still needed

Read access to the data is available, but the dashboard's policy and bucket
configuration is not. To close the remaining questions, screenshots of:

1. **Authentication → Policies** — the RLS state for `users`, `assets`,
   `requests`, `disposals`, `disposal_documents` and `repair_evaluations`. The
   app uses the anon key, so client-side guards are only honest UI unless
   policies exist.
2. **Table Editor → `disposal_documents`** — the column list (the mobile uploader
   writes file name, path, size, mime type and uploader), and whether rows appear
   after a mobile upload.
3. **Storage → the disposal-documents bucket** — bucket name and its policies
   (insert for authenticated/anon, select for the web download path). Mobile
   uploads and web downloads use the same object path.
4. **Table Editor → `password_resets`** — column list, to confirm the website
   writes exactly the columns the phone reads.
5. **Web admin → one finalized disposal record** — so the mobile form's field
   values can be compared with what the web stored.

## 9. Files

`app/_layout.tsx`, `app/accounts.tsx`, `app/reports.tsx`, `app/age-review.tsx`,
`app/asset-details.tsx`, `app/request-detail.tsx`, `app/(tabs)/assets.tsx`,
`app/(tabs)/profile.tsx`, `lib/access.ts`, `lib/accountService.ts`,
`lib/reportService.ts`, `lib/assetService.ts`, `lib/userService.ts`,
`lib/passwordResetService.ts`, `BUILD_APP.md`.
