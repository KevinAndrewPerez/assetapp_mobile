# NU Trace Mobile — Moderate Recommendations

> **Partly superseded (18 Oct 2026).** The disposal-information parts of this
document describe an interim design that was replaced when the mobile app was
brought in line with the web's official-disposal-form workflow. Approval no
longer writes a `disposals` row (the web writes one only at finalization), and
the "Disposal Information" card on the request detail screen has been replaced
by the shared **official disposal form** card. See
[MOBILE_DISPOSAL_IMPROVEMENTS.md](MOBILE_DISPOSAL_IMPROVEMENTS.md) for the
current behaviour; §2.4, §2.5 and §5.3 below are kept for history.

Reporting, filtering, approval/workflow, access control, and disposal-information
synchronization for the React Native application. This covers **only the
applicable "Moderate — Reporting, Filtering, and Workflow Improvements" items**.
No CSV import/export, no reporting dashboards or exports, no sticker printing or
Zebra configuration, no asset migration, no bulk registration, and no official
Disposal Form generation or printing were added to the mobile app.

---

## 1. What the system actually looks like

The brief describes a "React Native + Node.js backend" architecture. **There is
no Node.js backend in this project.** The mobile app is Expo/React Native and
talks **directly to Supabase** (PostgREST + Storage) with the publishable key
from `.env`. The web application is Laravel (`NUTrace/`) and uses the same
database. That distinction drives several findings below.

| Concern | Mobile | Web |
| --- | --- | --- |
| API | Supabase client (`lib/supabase.ts`) | Laravel routes + `App\Support\*` |
| Authorization | the publishable key + Supabase RLS | `Access` + route middleware, server-side |
| Requests | `requests`, `request_items` | same rows |
| Disposal records | `disposals` (created on approval) | `disposals` (created at finalization) |
| Supporting documents | `disposal_documents` rows, file in Supabase Storage | `disposal_documents` rows, file on the private local disk |
| Official form | **not implemented** (by design) | `disposal_forms`, `disposal_form_items` |

The mobile app already had working requests, repairs, pull-outs, replacements,
disposal recording, archived disposals, notifications, audit logging and
supporting-document upload. Nothing in this change replaces those; the work
below closes the gaps the moderate recommendations identify.

---

## 2. Confirmed issues and what was done

### 2.1 Month filter only reached six months

`lib/monthFilter.ts` built six "recent month" chips. Any earlier period — last
year's requests, the month a panel asks about — could not be selected, so the
list could not really be filtered "by month and year".

**Fixed:** added `monthKeyFor` / `monthOptionsForYear` and a shared
`components/month-filter.tsx`. It keeps the one-tap recent months and adds a
calendar picker with a year stepper and all twelve months. Future months are
disabled; **All time** and **Clear filter** restore the unfiltered list. Both
Requests screens use it, and the window is still applied **in the Supabase
query** (`created_at`, the request's own submission date — never an approval or
repair date).

The query window is also time-zone correct now: `created_at` is naive UTC, so
`monthQueryBounds()` converts the local month (e.g. October in Manila) to
`2026-09-30T16:00:00`–`2026-10-31T15:59:59`. Filtering on the plain local dates
would have hidden the first eight hours of every month and shown the next
month's first eight hours.

My Requests also gained a **Newest / Oldest** sort (the office queue already had
review-order/newest/oldest).

### 2.2 The request card offered status transitions the web does not allow

`components/requests/request-card.tsx` rendered chips for Pending, Approved,
In Progress, Completed, Rejected and Cancelled on any request. That allowed:

* approving or rejecting an already-decided request (a second tap, another
  device, or a stale list) — duplicate approval actions;
* choosing "In Progress"/"Completed"/"Cancelled", which are **per-asset**
  progress states, not request decisions, writing them into `requests.status`;
* no self-approval check and no role check in the write path.

**Fixed:** the chips are gone. Only `Pending → Approved | Rejected` is offered,
and the card explains the state when there is nothing left to decide
(`lib/requestWorkflow.ts`). The decision is also refused in
`updateRequestStatus()` (the data layer) when:

* the actor is not an active **Admin** (web `Access::canDecideRequests`);
* the actor is the request's submitter (`requests.user_id`) — nobody decides
  their own request;
* `requests.status` is not `Pending`.

The role and account status are read **from the `users` row**, not from the
cached AsyncStorage object, so a demoted/deactivated account loses the
authority immediately. The screen also blocks double taps with an in-flight set
and a per-card busy state, and refreshes the queue in place after a decision.

### 2.3 The office queue had no screen-level role gate

`app/(tabs)/requests.tsx` is reachable by deep link for any signed-in account.
**Fixed:** the screen now reads the live role and shows an "Office only" state
(with a way back to the user dashboard) for non-office accounts, and does not
query the queue for them. This is UI honesty, not the security boundary — see
§5.1.

### 2.4 Disposal information could not be saved from the mobile app

The only mobile write was the initial disposal record; after that, reason,
method, date and remarks could only be changed on the web. That failed the
requirement that authorized mobile users can update disposal information the
web later retrieves.

**Fixed (interim — replaced, see the note above):** a new **Disposal
Information** card on the request detail screen (office users, Disposal
requests, approved only), backed by `fetchDisposalInformation()` /
`updateDisposalInformation()` in `lib/disposalService.ts`. Those functions have
since been removed; the card now edits the shared official form instead:

* saves the shared `disposals` row the website reads (`Description`,
  `disposal_reason`, `disposal_date`, and `notes` keys `Reason Category`,
  `Disposal Method`, `Remarks`);
* shows the latest saved values whenever the screen opens or regains focus, and
  only reports success after the database confirms the write (it reads the row
  back);
* validates reason category, method, date (valid, not in the future), and text
  lengths **before** writing;
* records an audit entry (`DISPOSAL`) with the actor;
* **never** changes `assets.Lifecycle_Status`, never creates a disposal, and
  never touches the official form — saving information cannot dispose anything;
* is locked once the record is Completed/Cancelled, archived, or its official
  form is finalized, with the reason shown instead of the editor.

### 2.5 Supporting documents were always locked after approval

`documentLockReason()` treated *any* `disposals` row for the request as "already
recorded". On the web that is true (its row is written at finalization), but the
interim mobile design wrote the row at approval — so the attach button could
never add a document to a mobile-approved disposal, and removing one was always
refused. (Since 18 Oct 2026 approval writes no record at all, so the lock still
only means Completed/Cancelled/archived or a finalized form.)

**Fixed:** the lock now reflects the record's state — locked when it is
Completed/Cancelled, archived, or the official form is finalized; still open
while it is Pending/Approved. Upload/remove also verify the actor is an active
office account from the database, and the existing PDF/JPG/PNG/WEBP + 5 MB
validation still runs in the picker and again in the service.

Two honest limits remain on this path: the app uploads straight to Supabase, so
there is **no server-side MIME/size validator** of its own (a Storage bucket
policy or a signed-upload function is needed for the server half of that
requirement), and the uploader (`lib/mediaUpload.ts`) reports completion rather
than byte progress, so the UI shows saving/attaching state instead of a
percentage.

### 2.6 No conflict detection on disposal updates

A second device (or the web) could overwrite newer information silently.

**Fixed:** the editor sends the `updated_at` it loaded as an optimistic-
concurrency token; the update is `... WHERE Disposal_ID = ? AND updated_at = ?`.
If no row matches, a `StaleDisposalError` is raised and the user is told to
reload — nothing is overwritten. The timestamp token was verified against the
live database (see §4).

---

## 3. Permissions enforced

| Action | Who | Where it is refused |
| --- | --- | --- |
| Open the office request queue | active **Admin** | `app/(tabs)/requests.tsx` |
| Approve / reject a request | active Admin, not the submitter, only while Pending | screen + `updateRequestStatus()` |
| Edit disposal information | active Admin, approved Disposal request, unlocked record | service + screen |
| Attach / remove supporting documents | active Admin, approved request, unlocked record | service + screen |
| Approve / reject own request | nobody | data layer |

`lib/access.ts` is the single policy module (`Admin` is the office, per
`Access::ASSET_OFFICE_ROLES` on the web). `AssetOfficer`/`Facilities` are legacy
values: rows may exist, but they carry no office authority. Department Heads and
Employees never see the office queue and cannot reach the office actions.

**Not changed:** account activation/deactivation, role assignment, department
scoping of employees' own lists, registration, and the existing asset/repair/
pull-out/replacement workflows.

> Later change: registration and account-status enforcement were aligned with
the web's Employee Management module — see `MOBILE_REGISTRATION_ALIGNMENT.md`.
> This note covers only the request/disposal work above.

---

## 4. Verification performed

* `npx tsc --noEmit` — **pass** (0 errors).
* `npx eslint` on every changed file — **0 errors** (4 pre-existing warnings in
  unrelated code: an unused `todayIso`, two `Array<T>` style warnings, one
  unused catch binding).
* `npx expo export --platform android` — **pass** (7.1 MB Hermes bundle).
* Pure-function harness (`node --experimental-strip-types`) for
  `monthBounds`/`withinMonth`/`monthOptionsForYear`/`recentMonthOptions` and the
  approval rules (`allowedDecisions`, `decisionRefusal`): leap February, month
  boundaries, future-month flags, role/self/inactive/non-pending refusals —
  **all assertions passed**.
* Time-zone window check on this machine (UTC+8): `monthQueryBounds('2026-10')`
  → `2026-09-30T16:00:00` … `2026-10-31T15:59:59`, the correct naive-UTC
  equivalent of the local month.
* Read-only probes against the live Supabase database:
  * the new select shape (`disposals` + `assets`) resolves;
  * `WHERE updated_at = <loaded value>` returns exactly one row, and a wrong
    token returns zero — the conflict filter behaves as designed;
  * `disposal_documents`, `disposal_forms`, `requests.admin_remarks` exist;
  * current data: 7 users (1 Admin, 2 Department Heads, 4 Employees), 11 linked
    disposal rows, 0 supporting documents.
* **No writes were made to the database during verification.**

**Not performed:** running the app on a device/emulator (no device attached in
this session), so the visual layout of the new picker/editor and the end-to-end
successful-save path have not been exercised on hardware.

---

## 5. Dependencies on the web application / Supabase

### 5.1 Supabase RLS is the real authorization boundary

The publishable key in the app bundle can read `users`, `requests`, `disposals`,
etc. directly today (verified read-only). Client checks cannot prevent a crafted
request with that key. To satisfy "the API must independently verify the
authenticated user" the project needs, in Supabase:

* RLS enabled on `requests`, `request_items`, `assets`, `disposals`,
  `disposal_documents`, `disposal_forms`, `audit_logs`, `users` (or column-level
  policies that hide sensitive fields);
* policies that allow employees to read only their own rows, Department Heads
  their department, and Admin the office set;
* approve/reject and disposal updates moved behind a server-side function/RPC
  (or the Laravel API) so the role, submitter and state transition are checked
  where the client cannot alter them;
* a transaction-safe approve path (the web uses `DB::transaction`; the mobile
  writes the request status and the per-asset rows in separate calls, so a
  mid-way network failure can leave a partially processed request — the app now
  reports the failure instead of claiming success).

This is a deployment/security task, deliberately **not** applied here because it
changes the shared database and must be reviewed against the existing policies.

### 5.2 Mobile-uploaded documents cannot be downloaded from the web yet

The web stores documents on its **private local disk** and serves them through
`/admin/disposal/documents/{id}`. The phone cannot write that disk, so mobile
uploads go to the existing public Supabase Storage bucket and their row's
`file_path` is a Storage key. The web lists the row but its download route
cannot read the object.

Needed on the web: either a shared upload endpoint the phone can call, or a
download route that recognises Storage paths and streams them through
Supabase (keeping them behind the office authorization check). Until then,
documents attached from the phone are readable **in the mobile app only**.

Also note: objects in the current bucket are publicly readable by URL (the
Storage policies deny delete and list to the publishable key, but not object
reads). Object keys are random, so a document is not discoverable, but this is
not the same as the web's private disk. A **private bucket plus a signed or
proxied download** is required before mobile-uploaded supporting documents can
honestly be called private; that is a Supabase policy/storage change, not
something the client can enforce.

### 5.3 Web-approved requests may have no `disposals` row

The current web approves a disposal by creating the **official form**; the
`disposals` row is written at finalization. A request approved on the web
therefore has no row for the mobile editor to write to (the card says so
instead of inventing one). Requests approved from the mobile app do get the row
and are fully editable. Unifying this is a web workflow decision, not something
the phone should work around by finalizing a disposal early.

### 5.4 Not in scope, as instructed

Official Disposal Form generation/printing, signed-form upload, finalization,
QR/sticker printing, CSV, dashboards and reports stay in the web application.
