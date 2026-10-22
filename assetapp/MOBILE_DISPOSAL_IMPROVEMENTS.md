# NU Trace Mobile — Difficult Recommendation: Disposal Management

Mobile-side disposal management that follows the **same** workflow, records and
business rules as the Laravel web application (`NUTrace/`, commit
`e38ac880…` was used as the reference). No separate mobile disposal system, no
second database, and no official-form generation or printing on the phone.

The one architecture correction that everything else depends on: **there is no
Node.js backend in this project.** The React Native app talks directly to
Supabase (PostgREST + Storage) with the publishable key from `.env`; the web
application is Laravel on the same database. "Enforce on the backend" therefore
means the database (RLS/constraints) — see §5.1.

---

## 1. What the web actually does (the rules copied)

| Step | Web implementation | Shared rows |
| --- | --- | --- |
| Request submitted (Disposal) | requester → `requests` (`request_type='Disposal'`, `status='Pending'`, `Note`) | `requests`, optionally `request_items` |
| Office decision | `/admin/requests/{id}/approve` — office only, never your own, Pending only | `requests.status` |
| Approval **authorizes the form** | `DisposalForms::ensureForRequest()` generates **one** form per request, prefilled from the assets | `disposal_forms`, `disposal_form_items` |
| Documentation | supporting files attachable once approved | `disposal_documents` |
| Form completion / validation | `DisposalForms::save()` → `draft` → `ready` when nothing is missing | `disposal_forms` |
| Printing | `recordPrint()` → `printed` (evidence of printing only) | `disposal_forms` |
| Signed copy | `recordSigned()` → `signed` (private disk) | `disposal_forms` |
| **Finalization** | `DisposalForms::finalize()` — the only step that writes `disposals` rows and sets `assets.Lifecycle_Status='Disposal'` | `disposals`, `assets`, `audit_logs` |

Two invariants the whole feature rests on, and which the mobile now mirrors:

1. **Approval, form generation, saving, printing and uploading a signed copy
   never dispose an asset.** Only finalization does.
2. The asset's lifecycle is untouched until then — a request can be approved
   while its asset still reads `Active` or `Pullout`.

## 2. What existed on the phone, and what was wrong

* A **Disposal screen** (`app/disposal.tsx`) that scanned an asset and wrote a
  `disposals` row on the spot, marking the asset `Disposal` — retiring an asset
  with no request, no approval and no form. It could also "complete" or "cancel"
  a disposal from the phone (`updateDisposalStatus`), and archive/remove assets
  from inventory.
* **Approval** (`updateRequestStatus`) ran `applyRequestStatusToDisposals`,
  which created the `disposals` rows and set the lifecycle at approval time —
  the exact inverse of the web's rule.
* A **"Disposal Information"** card edited the `disposals` row's free-text
  fields; the official form's fields (`method_key`, `expected_disposal_date`,
  `office_department`, `remarks`) had no mobile path at all.
* No form stage was visible anywhere on the phone, no rejection reason was
  stored (`admin_remarks` was never written), and a disposal approval carried no
  reason/date for the form.

Read-only probes confirmed the live database already has the web's tables and
data: `disposal_forms` (4 rows, all `draft`), `disposal_form_items`,
`disposal_documents`, and 15 finalized `disposals` rows. There were **no pending
disposal requests**, so nothing in flight was disturbed.

## 3. What changed

### 3.1 Decision rules and the atomic guard — `lib/userService.ts`

* `updateRequestStatus(..., options)` now accepts `approvedReason`,
  `expectedDisposalDate` and `rejectionReason`.
* A decision is one conditional write: `update … where id = ? and
  lower(status) = 'pending'`. Zero rows ⇒ the change is refused with "already
  decided" instead of overwriting another admin's decision. The previous code
  wrote the status first and checked afterwards.
* **Disposal preflight (before any write):** every linked asset must still
  exist, and the request must have a note *or* an approved reason — the web's
  two refusals, with the web's wording.
* **Approval prepares the form first** (`ensureDisposalFormForRequest`), then
  flips the status. If the status write loses the race, the just-created form is
  deleted again. This is the closest the phone can get to the web's
  transaction, which refuses an approval whose form cannot be generated. If the
  form cannot be prepared at all, the approval is refused and nothing changes.
* **Approval no longer writes a `disposals` row and never touches
  `assets.Lifecycle_Status`.** It writes one audit entry per asset (saying the
  asset is *not* disposed of yet), mirroring the web's wording.
* **Rejection** stores the reason in `requests.admin_remarks` /
  `admin_remarks_by` / `admin_remarks_at` — the columns the web writes and
  reads — writes the same `APPROVAL` audit entry the web's reject route writes,
  and includes the reason in the requester's notification.
* `applyRequestStatusToDisposals` (the old bypass) and the whole
  `updateDisposalStatus` / `syncRequestStatusFromDisposals` /
  `fetchDisposalInformation` / `updateDisposalInformation` block were removed
  from `lib/disposalService.ts` so there is no second way to dispose an asset.

### 3.2 The official form — `lib/disposalForm.ts` + `lib/disposalRules.ts`

* `lib/disposalRules.ts` — pure parity with the web's `DisposalForms::label`,
  `hint`, `DisposalCodes::METHOD_CODES`, `reasonCodeFor`, `conditionCodeFor` and
  `DisposalReason::derive`/`normalize`. Tested in
  `scripts/disposal-rules-check.mjs` (34 assertions).
* `lib/disposalForm.ts` — reads/writes `disposal_forms`:
  * `fetchDisposalForm` / `fetchDisposalForms` — the stage, labels, hints and
    fields, exactly the columns the web stores.
  * `ensureDisposalFormForRequest` — the phone's `ensureForRequest()`:
    idempotent (returns the existing form), generates the row plus one
    `disposal_form_items` line per asset (tag, description, serial, acquisition
    date, location, custodian, condition/reason codes), and never invents a code
    the form does not print (`Lost`/`Damage` leave the reason code blank, as the
    web does).
  * `saveDisposalForm` — office-only, approved-disposal-only, refuses a
    finalized form, validates the method key/date/lengths, writes the shared
    fields (`office_department`, `expected_disposal_date`, `method_key`,
    `method_code`, `remarks`) and **never** changes the stage: readiness is the
    web's validation, not a phone decision.
  * Concurrency: `updated_at` is the token. The update is filtered by it, so a
    change made on the web or another phone raises `StaleDisposalFormError`
    ("reload first") instead of being overwritten. (`updated_at` strings were
    confirmed to match exactly one row and a wrong token zero, read-only.)
  * Audits are best-effort: a failed audit entry never turns a successful save
    into an error, and success is only reported after reading the row back.

### 3.3 Screens

* **`app/disposal.tsx` rewritten** as the office console: a **Requests** tab
  (status, requester, assets, the official form's stage, a "form not generated"
  warning for approved requests, counts by stage, filters and search) and a
  **Records** tab (the finalized `disposals` rows, read-only, linking to the
  asset). The scanner, the direct disposal write, the complete/cancel actions
  and the archive/remove-from-inventory actions are gone. Non-office accounts
  get an "Office only" state; the screen links to Archived Disposals.
* **`app/request-detail.tsx`** — the "Disposal Information" card is replaced by
  an **Official Disposal Form** card: current stage with the web's label/hint,
  prepared/printed/signed/finalized facts, a recorded-disposal count, and — for
  the office while the form is still editable — office/department, expected date,
  method chips and remarks with the same conflict handling. Sold-item details are
  explicitly left to the web. Rejected requests now show the office's reason, an
  **Approval History** section lists the request's latest audit entries (the same
  rows the web's activity log shows), and each linked asset shows its current
  lifecycle status so an approved-but-not-finalized disposal cannot look
  disposed.
* **`app/(tabs)/requests.tsx`** — approving a disposal opens a decision sheet
  asking for the reason (prefilled with the reason derived from the note, as the
  web does) and an optional expected date of disposal; rejecting any request asks
  for the optional reason the requester will see. One decision at a time, with
  busy state, and the list refreshes in place.
* **`app/submit-request.tsx`** — the picked-asset card now shows location,
  acquisition date and custodian alongside the identifier, description, serial
  and status, for the asset-information requirement.
* **`app/(tabs)/index.tsx`** — the dashboard tile now reads "Disposal
  Management · Requests, forms & records".

### 3.4 Documents

`lib/disposalDocumentService.ts` keeps the web's gates (disposal request only,
approved only, PDF/JPG/PNG/WEBP ≤ 5 MB) and the corrected lock: a finalized form
(later stages) or a legacy Completed/Cancelled/archived record — never merely "a
row exists". New approvals write no record, so the lock no longer blocks the
normal flow. Attachments are linked to the form (`form_id`) once it exists.

### 3.5 Notifications

`notifyDisposalApproval` writes exactly what the web's approve route writes:
the requester gets **"Disposal Request Approved"** ("…the Asset Management
Office is preparing the official disposal form"), and the *other* active office
accounts get **"Disposal Approved — Official Form to Prepare"**. Type
`DISPOSAL`, `reference_id` = request id, `reference_type` = `disposal`. A title
check per recipient makes a retried tap idempotent, and the approver is never
notified about their own action.

## 4. Acceptance-criteria map

| # | Criterion | Where |
| --- | --- | --- |
| 1 | Authorized users can submit disposal requests | existing `submit-request` (asset info extended) |
| 2 | Statuses follow the existing workflow | `updateRequestStatus` + atomic Pending guard |
| 3 | Unauthorized users cannot act | `lib/access.ts` checks in every service + "Office only" screens (see §5.1) |
| 4 | Mobile-saved information is retrievable on the web | `disposal_forms` fields the web's form page reads |
| 5 | No false "saved" | writes read the row back; audit failures never mask success; service refusals propagate to the alert |
| 6 | Documents attach/retrieve | `disposalDocumentService` (existing, lock corrected) |
| 7 | No silent overwrite | `updated_at` token on the form; `StaleDisposalFormError` requires a reload |
| 8 | Notifications, no duplicates | `notifyDisposalApproval` (web titles + title check) |
| 9 | Three-year threshold not enforced | no age rule was added anywhere; age review stays in `age-review` |
| 10 | No bypass of finalization | approval writes no record; direct complete/cancel removed; only the web finalizes |
| 11 | Statuses accurate across clients | form stage read from `disposal_forms`; asset lifecycle shown per asset |
| 12 | Audit/history intact | audit entries added (approval, form save, documents); no record deleted |
| 13 | Web form/printing keep working | only shared rows are written; no web file changed |
| 14 | Other workflows unaffected | repair/pullout/transfer paths untouched except the shared decision guard |

## 5. Verification

* `npx tsc --noEmit` — exit 0.
* `npx eslint` on every changed file — **0 errors**; 3 pre-existing warnings
  (`Array<T>` in `disposalService`, unused catch binding in `userService`). The
  one error reported for `app/(tabs)/index.tsx` (`react-hooks/set-state-in-effect`
  at line 67) is **pre-existing**: that effect is byte-identical at `HEAD`; this
  change only edited the tile's title/subtitle.
* `npx expo export --platform android` — exit 0.
* `node scripts/disposal-rules-check.mjs` — 34 assertions on stages, methods,
  reason derivation, reason/condition codes (including "Lost/Damage have no form
  row" and the two `T` methods). The harness caught one real defect while it was
  being written: an unknown form stage was being labelled "Awaiting
  preparation" instead of being reported as unknown.
* Read-only database probes (`scripts/disposal-form-probe.js`,
  `disposal-request-probe.js`, `disposal-screen-probe.js`): the new console
  select, the form select and the request-detail select all resolve; the
  `updated_at` token matches exactly one row and a wrong token zero; every
  disposal request and form on the live database still reads as it did.

**Not verified (no device / no writes made):** the on-device rendering and a real
approval → form creation → save cycle. Verifying that end-to-end needs a pending
disposal request, which would mean writing test rows into the live database; the
database had none, and no test rows were inserted. The insert payloads were
validated against the real column shapes instead. `npx expo export` proves the
screens bundle, not that they behave.

## 6. Dependencies and limitations

1. **RLS is still the real security boundary.** Everything in `lib/access.ts`
   and the services is a client-side check: the publishable key in the app
   bundle can currently read `users`, `requests`, `disposals` and the disposal
   tables, so a crafted request is not stopped by the UI. The office must apply
   row-level security (or move these writes behind a server function) for the
   rules to be enforcement rather than presentation.
2. **Legacy records from the old mobile path.** Requests 44, 46 and 50 already
   have `disposals` rows created by the previous approval flow (5, 2 and 1 rows).
   The web's `Disposals::createFromRequest` is idempotent — finalizing those
   forms will not create duplicates — but until they are finalized the phone
   shows them as open legacy records. Do not delete them by hand; let the
   disposal be finalized on the web.
3. **The phone cannot prepare, print, sign or finalize.** Those remain web-only
   (as the brief requires); the phone reports the stage and, for the office,
   saves the shared fields. A form that is still `draft` because item condition
   codes are missing must be completed on the web.
4. **Mobile-uploaded documents are not readable through the web's private-disk
   route** (`/admin/disposal/documents/{id}` reads Laravel's `local` disk; the
   phone stores objects in the Supabase bucket). The web page's own signed-copy
   upload is unaffected.
5. **The repair "beyond repair → Open Disposal" button** now opens this console
   rather than a record-disposal form; the follow-up there is to file a disposal
   request for the asset, which the console then tracks. Not changed here to keep
   the scope on disposal management.
6. **Approval is not one transaction** (the phone has no transaction API), so it
   is ordered to fail safely: form first, status second, unused form removed if
   the status write loses the race. A crash between the two steps leaves a draft
   form whose request is still Pending; the web lists it under "awaiting
   preparation" and the request can be approved normally.

## 7. Files

**Added:** `lib/disposalForm.ts`, `lib/disposalRules.ts`,
`scripts/disposal-rules-check.mjs`, `scripts/disposal-form-probe.js`,
`scripts/disposal-request-probe.js`, `scripts/disposal-screen-probe.js`, this
document.

**Changed:** `app/disposal.tsx` (rewritten), `app/request-detail.tsx`,
`app/(tabs)/requests.tsx`, `app/submit-request.tsx`, `app/(tabs)/index.tsx`,
`lib/userService.ts`, `lib/notificationService.ts`, `lib/disposalService.ts`,
`lib/disposalDocumentService.ts`, `lib/access.ts`,
`MOBILE_MODERATE_IMPROVEMENTS.md` (superseded note).
