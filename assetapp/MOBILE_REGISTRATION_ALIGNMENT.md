# Employee registration: mobile ↔ web alignment

Scope: the mobile registration, sign-in and account-status path, aligned with the
web's Employee Management module (`/admin/employees` — masterlist + Accounts tab)
on `NUTrace` `origin/main`. No employee-masterlist module, CSV import/export or
employee table was added to the phone.

## 1. What already existed

- `app/register.tsx` is a self-service form: employee number → the name and
  department are read from `employee_numbers`, never typed by the applicant.
- `lib/userService.ts` (`registerUser`) writes straight to the shared Supabase
  `users` table — the same table the Laravel app uses. There is **no Node.js
  backend in the request path**; the brief's "Node.js API" is the Laravel web
  app plus PostgREST. The web code is Postgres/Supabase too (its masterlist
  queries use Postgres-only `ilike`, and `SyncMediaToSupabase` targets the same
  storage), so there is one database, not a mobile copy.
- `app/login.tsx` verifies the password through the shared
  `verify_user_password` RPC and stores the session in AsyncStorage.
- `app/accounts.tsx` (pre-existing, not created by this change) mirrors the
  web's Accounts tab rules (role, department, status, last-admin guard).
- The web's masterlist (`employee_numbers`) is the authority for eligibility.

## 2. Confirmed gaps and fixes

| # | Gap found | Fix |
|---|---|---|
| 1 | A deactivated (`users.status = 'Inactive'`) account could still sign in on the phone. The web refuses it in `POST /login` and signs live sessions out. | `login.tsx` now refuses after the password check with the web's message (`ACCOUNT_DEACTIVATED_MESSAGE`). `_layout.tsx` re-reads the live account once per launch, ends the session and returns to sign-in with that explanation. |
| 2 | The legacy `AssetOfficer` role was routed to the admin tabs, got office notifications, and could archive disposal records. The web's `Access::ASSET_OFFICE_ROLES` is `['Admin']`. | Routing (`login.tsx`, `_layout.tsx`), `lib/notificationService.ts` and `archived-disposals.tsx` now use `isOfficeRole` from `lib/access.ts` (Admin only). |
| 3 | Email format was checked only in the screen; a different caller could insert any string. | `validateRegistrationEmail` in `lib/registrationRules.ts` is enforced inside `registerUser` as well. |
| 4 | The duplicate-email lookup used the address as an `ilike` **pattern**, so `_` (legal in an email) matched any character. | `escapeLikePattern` escapes `\`, `%` and `_`; the lookup is a true case-insensitive equality test. |
| 5 | Inactive employee records and official-email mismatches were mobile-only rules (the older local web checkout lacked them). | Verified against `NUTrace` `origin/main`, whose `POST /register` applies exactly the same two rules, so the phone and the web now agree. |
| 6 | A failing insert could surface raw PostgREST text on the form. | `friendlyErrorMessage` maps network/session/server failures and hides internal details. |
| 7 | Registration role logic could drift from the web. | `roleForNewAccount`: first account ever → `Admin` bootstrap, everyone else → `Employee`. Department Head is granted only by the office on the Accounts tab, matching `origin/main`. |

### The rules shared by both apps (`lib/registrationRules.ts`)

1. Employee number must exist in `employee_numbers` (case/space tolerant).
2. Its `status` must be empty or `Active`; `Inactive` is refused.
3. If the record has an official `Email`, the address entered must match it
   (case-insensitive). No recorded address imposes nothing.
4. The employee number must not already own an account.
5. The email must be well-formed, ≤ 100 chars (input limit) and unused.
6. Role: first account ever `Admin`, otherwise `Employee`.

## 3. Shared database, verified live

`node scripts/registration-alignment-probe.js` (read-only) against the live
database the app uses:

```
ok   employee masterlist select (incl. official Email) resolves — 7 row(s)
ok   employee rows join their department — 7/7
     employee statuses: {"Active":7}
     official-email gate: inactive - no address on file
ok   case/space-insensitive employee lookup resolves exactly one record
ok   accounts table select resolves — 7 row(s)
ok   no employee number owns two accounts — 0 duplicate(s)
ok   no email owns two accounts — 0 duplicate(s)
     roles: {"Admin":1,"Department Head":2,"Employee":4}
     account statuses: {"Active":7}
ok   every account role is one the brief permits
ok   every account is linked to an employee master record — 7/7
```

## 4. Acceptance criteria

| Criterion | Status |
|---|---|
| 1. Eligible employee can register with a masterlist number | Rules verified in `registration-rules-check.mjs`; live lookup verified; **not executed end-to-end** (would write a real account). |
| 2. Unknown / ineligible number rejected | Verified (rules + live lookup). |
| 3. Inactive record cannot register | Verified in rules; no inactive row exists in the live data. |
| 4. Duplicate accounts prevented | Pre-check + `users.email` unique index; no duplicates live. Concurrent-race gap noted below. |
| 5. Adding a master record does not create an account | Verified in `origin/main` `EmployeeDirectory::store` (message says so explicitly) and no mobile code creates one. |
| 6. New accounts get no privileged role | `roleForNewAccount` + `registration-rules-check.mjs`. |
| 7. Existing approval / verification flows intact | Neither app implements email verification or manual account approval — registration is immediately `Active`; nothing was added or removed. |
| 8. Web deactivation and role changes enforced in mobile | Login refusal + launch guard + live role read; privileged actions re-read the account (`lib/access.ts`). |
| 9. Department restrictions effective | Department comes from the masterlist; the office area is Admin-only; department-scoped data reads are unchanged. |
| 10. Registration failures give usable feedback | Field errors, inline mismatch/inactive messages, `friendlyErrorMessage` for network/server failures. |
| 11. Existing login, scanning, repair, transfer, request, disposal work | `npx tsc --noEmit` and `npx expo export --platform android` pass; no shared function signatures changed except additive fields. |

## 5. Checks run

```
npx tsc --noEmit                                  exit 0
npx eslint <changed files>                        0 errors (2 pre-existing warnings)
node scripts/registration-rules-check.mjs         37/37 assertions pass
node scripts/registration-alignment-probe.js      all live read-only checks pass
npx expo export --platform android                exit 0 (dist removed afterwards)
```

Not run: an on-device registration and a real deactivation → sign-in cycle. Both
would change live records; the rules and queries were verified instead without
writing rows.

## 6. Remaining limitations

- **RLS is the real boundary.** The phone writes to `users` through PostgREST
  with the publishable key. The role and eligibility checks in the app are
  honest UI, not enforcement: a crafted request could insert any `role`. The
  Supabase policies must reject non-`Employee` inserts (and role/department
  changes from non-Admin tokens). This is the same limitation recorded in
  `MOBILE_MODERATE_IMPROVEMENTS.md`.
- **No unique index on `users.employee_numbers_id`.** The web migration never
  created one, so two truly simultaneous registrations with the same employee
  number could both pass the pre-check. Apply once in the Supabase SQL editor:

  ```sql
  create unique index if not exists users_employee_numbers_id_key
    on public.users (employee_numbers_id);

  -- optional, but it makes the app's case-insensitive email rule authoritative
  create unique index if not exists users_email_lower_key
    on public.users (lower(email));
  ```

  Both are safe on the current data (the probe found no duplicates).
- The web's own employee add/import paths are outside this change; the local
  `NUTrace` checkout is behind `origin/main`, so comparisons were made against
  `origin/main`.
- Department Head mobile screens show the employee area, not a department-wide
  approval queue; that is existing behaviour, unchanged here.
