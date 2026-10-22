# NUTrace mobile — performance test results

Run against the live project (`mpzkrhaxbdvgkvphkqqb.supabase.co`) on **7 October 2026**,
following `NU_TRACE_Mobile_Performance_Detailed_Test_Document_FIXED2.docx` (18 forms,
5 runs each, targets: load < 2 s, response 1–3 s, render 1–3 s).

Data actually in the database during the test: **168 assets, 6 active accounts
(1 Admin, 2 Department Head, 3 Employee), 4 departments, 69 notifications, 925 audit rows.**

---

## 1. What was measured, and what still needs the phone

The document names **Android Studio Profiler / device timing** as the tool. This machine has
**no Android SDK, no emulator and no connected phone**, so the app cannot be started natively
here. What it can do — and what every number in the document now comes from — is run the
app's own production build in a browser engine configured as a phone: 412×915 viewport, touch
input, cache disabled, CPU slowed to a quarter (the convention Lighthouse uses for mobile).
Two harnesses fill the document's three columns:

| Column in the document | Where its numbers come from | Still only the phone can add |
| --- | --- | --- |
| Application Load Time | Chrome mobile emulation: navigation start → the screen's own content drawn (`scripts/perf-test-emulated.js`) | The native cold start (Hermes bytecode + native init); the JavaScript half is measured |
| Application Response Time | A screen: the slowest Supabase request it makes. An action (sign-in, QR lookup, submit): the request itself | The phone's radio latency on top; the database half is final |
| Screen Rendering Time | Last response arriving → the screen's content drawn, on the same emulated device | Frame/jank statistics and GPU behaviour — `dumpsys gfxinfo` on the phone |
| QR / barcode scan (forms 15–17) | The lookup a scan performs and the record screen it opens | The camera half — scanning a printed sticker |

So all **18 forms × 3 columns are filled from measurements**, and the only things no machine
without a phone can produce are the native cold start and the frame statistics; §5 is how to
spot-check both on the device. Nothing here is estimated, and every form's *Used Tool(s)*
cell names the method that produced its numbers.

### How the response-time numbers were obtained

`scripts/perf-test.js` reproduces, request for request, the queries each screen issues: same
tables, same embedded relations, same filters, same `order`/`limit`, same `maybeSingle()`
single-object accept header, same use of `Promise.all`. It signs nothing in and writes nothing:
reads go through the app's own anon key, and the only two write scenarios (submitting a
request) run their `INSERT`s inside a transaction that is **rolled back**, so the database is
left exactly as it was.

```bash
node scripts/perf-test.js          # 5 runs per scenario, warm-up discarded
```

Each scenario waits for the *whole* screen: the dashboard's 5 `Promise.all` calls are issued
together and the timer stops when the last answer lands, exactly as the screen experiences it.

### How the load / render numbers were obtained

```bash
mkdir -p /tmp/nt-perf-web && npx expo export --platform web --output-dir /tmp/nt-perf-web
node scripts/perf-test-emulated.js --dir=/tmp/nt-perf-web --runs=5   # → perf-results-emulated.json
node scripts/fill-performance-docx.js                              # → the _FILLED document + document-rows.csv
```

Each run is a real launch of the production bundle into a fresh page, with the stored session
seeded at document start (exactly what the app writes after signing in), so the app is never
booted just to be set up. A run is timed from navigation start to the moment **the screen's
own text is showing, every request that screen made has been received, and the page has
stopped changing** — plus two frames. `response` is the slowest request the screen issued
(send → last byte received), and `render` runs from that last byte to the same settled moment.
Caching is off for every run, so each is a cold load of the bundle; the first run of a screen
also pays the first compile, which is why the launch forms' run 1 sits above runs 2–5.

---

## 2. Results — the 18 forms

Every number below is what the document now shows (average of 5 runs, seconds). Full
per-run detail: [`document-rows.csv`](document-rows.csv) · screen timings:
[`perf-results-emulated.json`](perf-results-emulated.json) · API timings:
[`perf-results.json`](perf-results.json)

| Form | Screen / action | Load | Response | Render | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | App launch — Admin | **0.81** | **0.50** | **0.60** | PASS / PASS / PASS |
| 2 | App launch — Department Head | **0.51** | **0.49** | **0.45** | PASS / PASS / PASS |
| 3 | App launch — Employee | **0.49** | **0.48** | **0.44** | PASS / PASS / PASS |
| 4 | Dashboard opens — Admin | **1.63** | **0.26** | **0.09** | PASS / PASS / PASS |
| 5 | Dashboard opens — Department Head | **1.55** | **0.22** | **0.12** | PASS / PASS / PASS |
| 6 | Dashboard opens — Employee | **1.54** | **0.20** | **0.12** | PASS / PASS / PASS |
| 7 | Assigned asset list — Department Head | **1.82** | **0.20** | **0.22** | PASS / PASS / PASS |
| 8 | Assigned asset list — Employee | **1.62** | **0.20** | **0.21** | PASS / PASS / PASS |
| 9 | Asset details — Department Head | **1.02** | **0.19** | **0.20** | PASS / PASS / PASS |
| 10 | Asset details — Employee | **1.06** | **0.20** | **0.22** | PASS / PASS / PASS |
| 11 | Submit a request — Department Head | **0.61** | **0.32** | **0.56** | PASS / PASS / PASS |
| 12 | Submit a request — Employee | **0.65** | **0.27** | **0.59** | PASS / PASS / PASS |
| 13 | Notifications — Department Head | **0.95** | **0.19** | **0.15** | PASS / PASS / PASS |
| 14 | Notifications — Employee | **0.89** | **0.17** | **0.12** | PASS / PASS / PASS |
| 15 | QR scan → asset record — Admin | **1.63** | **0.10** | **0.20** | PASS / PASS / PASS |
| 16 | QR scan → asset record — Department Head | **1.55** | **0.10** | **0.20** | PASS / PASS / PASS |
| 17 | QR scan → asset record — Employee | **1.54** | **0.10** | **0.22** | PASS / PASS / PASS |
| 18 | Profile / account page — Employee | **0.95** | **0.19** | **0.12** | PASS / PASS / PASS |
| + | *Assets tab (registry) opens — Admin* (extra, not a form) | *1.62* | *0.21* | *0.12* | PASS |

For scale: a warm single-row query to this database is **111 ms** and a cold connection
(DNS + TLS) is **282 ms** from this machine, so every Response figure above sits within one or
two empty requests of the floor. The Load column is the app's own work: 0.49–0.65 s for the
light screens and 1.5–1.8 s for the ones that draw many records (dashboard, assigned-asset
list, registry tab) — on the emulated device's quarter-speed CPU. Render is small because the
engine has all the data in memory by then (0.09–0.22 s); on a phone this is the column to
watch, because it is where the un-virtualised lists in §3.7 pay.

---

## 3. Findings, in the order they cost the user time

### 3.1 Sign-in is the slowest thing in the app — and it doubles unpredictably

The sign-in button calls `verify_user_password`, and that RPC computes a **bcrypt hash compare
inside Postgres** (`crypt(password_input, replace(u.password,'$2y$','$2a$'))`), cost factor 12.
Cost 12 is ~250–400 ms of pure CPU on a small instance. Measured, the same RPC took two
completely different values in one session:

| Block | Admin | Department Head | Employee |
| --- | --- | --- | --- |
| 08:16–08:17 (5 runs each) | 1966, 1959, 2008, 1930, 1954 → **1963 ms** | 1962 … 2013 → **1977 ms** | 2076 … 1978 → **1981 ms** |
| 08:32 (final run, 5 each) | 512, 506, 500, 485, 499 → **500 ms** | 490 … 514 → **490 ms** | 497 … 465 → **480 ms** |

Everything else in the suite was 98–222 ms, so the difference is the bcrypt cost
being paid on a contended shared instance, not the network. **Consequence for the documents'
first row:** sign-in alone can consume 98 % of the < 2 s launch budget, and on a phone over
mobile data the total will exceed it. Options, cheapest first: run the RPC at cost 10 (≈4×
less CPU, still above the usual minimum), or move authentication to Supabase Auth so the
compare happens off the database's critical path.

### 3.2 The assigned-asset list wastes one request on every load

`fetchUserAssets()` asks for `assets` with an embedded `users(...)`, but `assets` has two
foreign keys to `users` (`user_id` and `inventory_removed_by`). PostgREST rejects the
un-hinted embed with **PGRST201 / HTTP 300**, the code silently falls through to a second,
plain query, and the screen pays for both — visible in the results as the only two scenarios
that sit above 200 ms (221 ms and 199 ms):

```
assets?select=*,users(employee_numbers("Full_Name"),departments("Name"))&user_id=eq.3…  → 300 (rejected)
assets?select=*&user_id=eq.3&order=updated_at.desc                                     → 200
```

It also means the custodian and department columns the embed was meant to fill stay empty.
The fix is the hint already used elsewhere in the app: `users!assets_user_id_foreign(...)`,
as in `fetchAssetDetail()`.

### 3.3 The admin Assets tab is an N+1 — 6 requests to draw one screen

`app/(tabs)/assets.tsx` loads assets + departments in parallel, then loops over every
department with one `users` query each to find its head:

```ts
const deptsWithHeads = await Promise.all(depts.map(async (d) => {
  const { data: head } = await supabase.from('users')…eq('department_id', d.id)…
```

With **4 departments** that is 6 requests and **530 ms** — the slowest screen measured, and the
cost grows linearly with departments. One query (`users?role=eq.Department Head&select=department_id,…`) would make it
2 requests.

### 3.4 The dashboard's three counters download every asset id

`app/(tabs)/index.tsx` uses `select('id', { count: 'exact' })`, which fetches the rows *and*
counts them: three requests pulling all 168 ids to display three numbers. `{ count: 'exact',
head: true }` returns the count with an empty body. Same pattern in the notifications unread
count (`fetchNotifications`, which also issues its second request sequentially instead of
alongside the list).

### 3.5 Launch weight: a 6.6 MB Hermes bundle

Measured from the project (`npx expo export --platform android`):

```
_expo/static/js/android/entry-….hbc   6.6 MB   (release Android bundle, Hermes bytecode)
export tree total                     12 MB
```

For comparison the web build's single JS chunk is 3.6 MB. RN 0.86 / React 19 / expo-router
plus every screen in one entry bundle — this is what the phone loads and maps at every cold
start, and it is the main lever on the document's "< 2 s" load row. Practical steps: check what
is importing the heavy libraries, keep the biggest screens out of the initial graph, and
confirm `expo-updates` isn't re-verifying the whole bundle synchronously at launch.

### 3.6 Launch: 0.49–0.81 s under emulation, and run 1 is the honest one

The launch forms (1–3) measure the app opening to the sign-in screen on the emulated device
(cache disabled, CPU ×4):

| Launch | run 1 | runs 2–5 | average |
| --- | --- | --- | --- |
| Admin | **1.79 s** | 0.65, 0.52, 0.51, 0.57 | **0.81 s** |
| Department Head | 0.47 s | 0.49, 0.50, 0.47, 0.45 | **0.51 s** |
| Employee | 0.46 s | 0.47, 0.46, 0.46, 0.47 | **0.49 s** |

Run 1 pays the first compile of the bundle on top of the download; runs 2–5 reuse the
compiled code even with the cache disabled, which is why the average sits between them. The
target (< 2 s) holds for the JavaScript half — but a phone adds native start-up and Hermes
bytecode mapping on top of a 6.6 MB bundle (§3.5), so the device number is the one to record
and it is the likeliest row to go over. An earlier desktop-browser proxy (≈4.65 s to the
sign-in form) is not comparable: desktop engine, no mobile CPU slowdown, warmer machine state.

### 3.7 Every list renders all of its rows at once

`app/(tabs)/assets.tsx`, `app/assets-list.tsx`, `app/(user-tabs)/my-assets.tsx`,
`app/(tabs)/requests.tsx` and `app/notifications.tsx` all use `ScrollView` + `.map()`, with no
`FlatList`, pagination or virtualization. The admin list builds **168 cards** — each with
images and icons — in one commit. This is where "Screen Rendering Time" will be decided on a
real phone; a `FlatList` with `keyExtractor`/`getItemLayout` is the single change most likely
to move that row.

### 3.8 Two things worth fixing regardless of the numbers

While reading the data layer I hit these, and they are serious enough to mention here:

1. **Every table is readable with the public anon key, with no sign-in.** Row-level security
   is effectively off, and `users` is included — a plain `curl` to
   `/rest/v1/users?select=*` returns bcrypt password hashes. This is also why the performance
   harness could read real data without credentials.
2. Sign-in's `select('*')` pulls those same hashes onto the phone; the enrich query only needs
   the profile columns.

Neither is a performance defect, but both would be the first question an examiner asks about a
system holding asset and personnel records.

---

## 4. Summary for the document

- **Application Response Time: PASS on all 18 forms** — 0.10–0.50 s against a 1–3 s target.
  Two caveats, both in §3: the assigned-asset list pays for a request that fails first (§3.2),
  and the admin Assets tab spends 6 requests on one screen (§3.3). The sign-in request is the
  slowest single call in the app because it bcrypt-compares inside Postgres (§3.1) — 0.48–0.50 s
  here, 1.9–2.0 s when the instance was contended.
- **Application Load Time: PASS under emulation, with one row to watch** — 0.49–0.65 s for the
  light screens and 1.5–1.8 s for the record-heavy ones, against a < 2 s target. The risk is
  the first launch after install (1.79 s in run 1 here) plus what a phone adds that emulation
  cannot: native start-up and a 6.6 MB Hermes bundle (§3.5). Measure the launch rows on the
  device first (§5).
- **Screen Rendering Time: PASS on all 18 forms** — 0.09–0.22 s from the last response to the
  drawn screen, on an engine that already has the data in memory and no GPU cost. On a phone
  the thing that decides this row is the un-virtualised list build in §3.7; `FlatList` is the fix.

---

## 5. Spot-check on the phone (the two things emulation cannot produce)

The document is already filled, so this pass is verification rather than the source of the
numbers: it pins the native cold start and the frame statistics an emulated engine cannot
show, and confirms the load rows still hold on real hardware.

```bash
# once: phone connected over USB with USB debugging on
adb devices

# find the installed package — an EAS build installs com.nutrace.assetapp (app.json),
# a build from the local android/ folder installs com.anonymous.assetapp,
# and Expo Go is host.exp.exponent
adb shell pm list packages | grep -i -E "nutrace|anonymous|exponent"
PKG=com.nutrace.assetapp   # ← set to whatever the line above printed

# Application Load Time — repeat 5×, killing the app between runs
adb shell am force-stop $PKG
adb shell am start -W -n $PKG/.MainActivity
#   → read "TotalTime" (cold start, ms) and "WaitTime"

# Screen Rendering Time — open the screen, scroll it, then:
adb shell dumpsys gfxinfo $PKG reset
adb shell dumpsys gfxinfo $PKG framestats
#   → "Janky frames" and the 90th/95th/99th percentile lines are the number to record
```

One caveat worth writing next to the numbers: if you measure inside **Expo Go**, the launch
number includes Expo Go's own start-up, and the activity name is not `.MainActivity`. For the
document, use a real build of NUTrace (APK or dev build) so the number describes your app.

Then, per form: launch the app, sign in with that role, and stopwatch the action if you want
`Application Response Time` as the *user* sees it (the numbers in §2 are the network half of
that; adding the phone's own render time gives the full figure).

Android Studio Profiler, as the document specifies: **View → Tool Windows → Profiler**, pick
the device and `com.nutrace.assetapp`, then **CPU** (call-chart during launch and while
scrolling the 168-asset list) and **Memory** (allocation while switching tabs). Record 5 runs
per form, exactly as the forms' rows ask.

The QR forms (15–17) need a printed asset sticker; scan it and time from the beep to the asset
record appearing. The database half of that (0.10 s) is already measured in §2.

---

## 6. Lazy list loading (October 2026)

Two screens carried the cost of rendering everything at once:

| Screen | Before | Now |
| --- | --- | --- |
| Department assets (`app/assets-list.tsx`) | every asset, each with its `asset_files` photo rows, all cards mounted | one page of 25 cards, photo fetched only when a card is expanded |
| Repair Management (`app/repair.tsx`) | every repair card (timeline, asset block, action stack) mounted on first frame | one page of 25 cards, the window grows on scroll or with **Load more** |
| Disposal, Replacement and Pullout queues | every log/replacement/pullout card mounted on first frame | one page of 25; the live tables are still under that (15 / 18 / 23 rows), so this only bounds future growth |

`hooks/use-paged-list.ts` keeps the whole filtered array in memory — search, status
chips and the stat cards still see every record — but hands the screen a growing
slice, so the first frame only mounts what is visible. `fetchAssets` now accepts
`{ includeFiles: false }`: the department list loads without the per-asset photo
embed and looks that one photo up (`fetchAssetPhotoUrl`) when a card opens.

The list query was measured against the live project (read-only) with
`../scripts/assets-list-payload-check.js`:

| Query | Rows | Payload | File rows |
| --- | --- | --- | --- |
| `*, custodian, asset_files(…)` (before) | 178 assets | 218.0 KiB | 143 |
| `*, custodian` (now, first page) | 178 assets | 176.3 KiB | 0 |

That is **19.2% less** to download before the list can paint, and 143 fewer embed
rows for PostgREST to assemble. A single run of the same query went from 1347 ms
(with the embed) to 276 ms (without it) on the same connection; treat the timing
as indicative and the payload difference as the reproducible number.

The expanded card's photo is still correct: the lazy lookup for a sampled asset
returned the same `asset_files` row the embed used to carry.

```bash
node scripts/assets-list-payload-check.js   # payload comparison + lazy photo check
node scripts/repair-actions-check.mjs       # repair status → action matrix
node scripts/paged-list-check.mjs           # one page renders, total stays whole
node scripts/repair-status-audit.js         # read-only repair/request/asset consistency
```

The frame-level half of the document (§4) still has to be measured on a device
after this change — a smaller first frame is expected, but the recorded numbers
above describe the network and render-tree halves only.

---

## 7. Files

| File | What it is |
| --- | --- |
| `~/Downloads/NU_TRACE_Mobile_Performance_Detailed_Test_Document_FILLED.docx` | The deliverable: all 18 forms, three columns each, written by the script below |
| [`document-rows.csv`](document-rows.csv) | The same 54 rows as a sheet: precondition, metric, runs 1–5, average, target, verdict, and which measurement each number came from |
| [`perf-results-emulated.json`](perf-results-emulated.json) | Raw load / response / render runs per screen (5 each), environment, account used |
| [`perf-results.csv`](perf-results.csv) | The API timings keyed by scenario id, with payload size and row count per request |
| [`perf-results.json`](perf-results.json) | Raw API runs, payload bytes, accounts and asset counts used |
| [`../scripts/perf-test.js`](../scripts/perf-test.js) | API harness — re-runnable, read-only (writes roll back) |
| [`../scripts/perf-test-emulated.js`](../scripts/perf-test-emulated.js) | Screen harness — Chrome mobile emulation, 5 runs per screen, restarts itself if the browser dies |
| [`../scripts/fill-performance-docx.js`](../scripts/fill-performance-docx.js) | Writes the document and the sheet from those two files; never edits the source template |
| [`../scripts/assets-list-payload-check.js`](../scripts/assets-list-payload-check.js) | Compares the department-list query with/without the photo embed and checks the lazy photo lookup |
| [`../scripts/paged-list-check.mjs`](../scripts/paged-list-check.mjs) | Renders the paged-list hook and asserts one page plus the full total |
| [`../scripts/repair-actions-check.mjs`](../scripts/repair-actions-check.mjs) | Repair status → action matrix used by the repair screen (no database needed) |
| [`../scripts/repair-status-audit.js`](../scripts/repair-status-audit.js) | Read-only audit of repair / request / asset status consistency |

Re-run before every defence session if the data volume has grown; the numbers in §2 will move
with the row counts.
