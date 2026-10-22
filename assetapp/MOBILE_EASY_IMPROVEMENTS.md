# NU Trace Mobile — Easy improvements (repair, QR, reliability, performance)

Scope: the **Easy** slice of the roadmap, applied to this React Native app only. Sticker
printing, CSV import/export, report exports, asset migration, and a new QR signing scheme were
deliberately **not** touched. No API response shape or database schema changed; the web app and
the Supabase/PostgREST endpoints it shares keep working unchanged.

## 1. Repair management — root causes fixed

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Buttons offered actions the status did not allow (e.g. a Completed repair still showing "Update Details"; a Pending repair on an already-disposed asset still offering "Start Repair") | Each flag was computed inline in the card, separately from the status pill | One rule set, `lib/repairActions.ts`, drives every button; the asset lifecycle is part of the rule. `scripts/repair-actions-check.mjs` asserts the matrix |
| A fast double tap could post the same status change twice | `if (saving)` guard was missing; the footer button only disables after the next render | Handler-level guard in `confirmAction` |
| A failed audit / notification / request-summary write made a **saved** repair report "Action failed", inviting a retry that duplicates the decision | Side effects ran inside the same throwing path as the repair update | Repair + asset writes still throw; audit, notification and request-summary writes are best-effort and logged (`lib/repairService.ts`) |
| Raw database errors reached the user | `error.message` was shown directly | `lib/errorMessage.ts` maps offline / timeout / expired session / server errors and hides schema detail |
| Status changes on the Requests screen used two near-identical handlers, neither guarded | Duplicated code | A single `applyStatus` with a per-request in-flight guard; the list refreshes in place (no full-screen spinner) |

Repair status values were not changed: `Pending → In Progress → Completed`, or `Cancelled`, with
the asset returning to `Active` / `Pullout` and moving to Replacement/Disposal as before.

## 2. QR scanning

- Camera permission denial now explains itself and offers **Open Settings** when the OS will no
  longer show the prompt; a plain retry message otherwise.
- A failed scan keeps the scanner open with **Scan again** instead of silently closing it
  (submit-request scanner used to close on every outcome, including failures).
- Camera mount failures (no camera, camera busy) show a dedicated message.
- Scanning pauses while a lookup runs or a verdict is displayed, and the header scanner guards
  with a ref instead of state — one sticker can no longer start several lookups.
- A **blocked** verdict (invalid signature, unknown key, revoked sticker, malformed payload) never
  offers "View asset anyway"; only a non-blocking warning such as an unsigned legacy sticker does.
- A failed audit write no longer replaces the authenticity warning with a generic network error.
- The QR payload format and signing/verification rules are unchanged.

> Later change: signed-sticker verification, access scoping and the public
> keyring were completed on top of this work — see `MOBILE_QR_SECURITY.md`.

## 3. Reliability and UI states

- Requests (office and "my requests") and Asset details now distinguish **load failure** from an
  empty list / missing asset, and offer **Try again**.
- Submission, repair, request-status and asset-evaluation failures show one actionable sentence.
- Cancel is disabled while a request submission is in flight, so a saved request cannot lose its
  confirmation.
- Empty states, success alerts and loading indicators are kept; no fields or workflows removed.

## 4. Performance (measured)

| Change | Evidence |
| --- | --- |
| Asset list no longer downloads every asset's photo rows; a card loads its photo when opened | 218.0 KiB → 176.3 KiB (−19.2%), 143 fewer embed rows (`scripts/assets-list-payload-check.js`) |
| Department assets, Repair Management and Requests mount 25 cards and grow on scroll | `scripts/paged-list-check.mjs` renders one page of 60; 38 live requests → 25 then 13 |
| The append-only Disposal, Replacement and Pullout queues use the same window | At the time of writing the live tables hold 15 disposals, 18 replacements and 23 pullouts, all below one page — so this is a bound on future growth (first frame stays at 25 cards) rather than a visible win today |
| Requests link lookups run in parallel instead of one after another | 199 ms → 140 ms average, 3 → 2 round trips, identical rows (`scripts/requests-fetch-bench.js`) |
| Pull-to-refresh and post-update reloads no longer replace the list with a full-screen spinner | — |

No aggressive caching was added: every screen still reads current statuses from the database.

## 5. Verification

```bash
npx tsc --noEmit                                  # clean
npx eslint <touched files>                        # clean except pre-existing react-hooks rule
npx expo start --port 8095 && curl .../index.bundle?platform=android&dev=true   # HTTP 200, full graph
node scripts/repair-actions-check.mjs             # status → action matrix
node scripts/paged-list-check.mjs                 # one page + full total
node scripts/error-message-check.mjs              # user-safe messages
node scripts/assets-list-payload-check.js         # payload + lazy photo
node scripts/requests-fetch-bench.js              # sequential vs parallel lookups
node scripts/repair-status-audit.js               # read-only repair/request/asset consistency
```

Not run: device-level frame profiling (needs the APK and Android Studio Profiler) and a scripted
UI session against the live database (no test account credentials were used).

## 6. Open issues

1. **Row-level security is off on `assets`, `repairs`, `requests`, `users` and
   `repair_evaluations` (0 policies).** The app talks to Supabase with the publishable anon key,
   so role restrictions in the interface are not enforced by the database. Enabling RLS needs a
   policy design (the app uses its own `users` table and hashed passwords, not Supabase Auth) and
   is a separate, larger change — it is reported here rather than attempted, because enabling RLS
   without policies would break every mobile query.
2. Historical rows: two assets remain `For Repair` with no open repair, and four old completed
   repairs have no `repair_evaluations` row. These predate the current flow and were left
   untouched (no production data was modified).
3. `requests.status` still stores only Pending/Approved/Rejected by constraint, so a fully
   completed repair request reads `Approved` in the request table; per-asset repair rows carry the
   real progress. Kept as-is to stay compatible with the web app.
