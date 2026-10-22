# UI layout fixes (Transfer filters, request cards)

Two visual defects were reported from a device: the Transfer screen's department
filters rendered as full-height ovals, and request cards printed a bare number
after the submitter ("Submitted by: Kevin Andrew • 4"). Both are fixed, and the
same layout pattern was audited across the app.

## 1. Department chips became tall ovals

`app/transfer.tsx` put the department chips in a `ScrollView horizontal` inside
the screen's vertical `ScrollView`.

A React Native `ScrollView` carries `flexGrow: 1` in its base style. Inside the
screen's `content` container (`flexGrow: 1`), the horizontal scroller therefore
took all the leftover viewport height, and its content container — a row with the
default cross-axis alignment (`stretch`) — stretched every chip to that height.
The `borderRadius: 999` then turned each chip into a pill as tall as the screen.

The fix is the standard guard for a chip strip:

* `flexGrow: 0` on the scroller, so it is only as tall as its content;
* `alignItems: 'center'` on the content container, so a chip can never be
  stretched vertically.

```ts
filterScroll: { flexGrow: 0 },
filterRow: { alignItems: 'center', paddingVertical: 6, gap: 8, paddingRight: 12 },
```

The chip's now-redundant `marginRight: 8` was removed; the row's `gap` already
spaces them, so the old double gap disappeared with it.

## 2. Same pattern elsewhere

Every horizontal `ScrollView` in `app/` and `components/` was checked for the same
construct. All 17 now carry one of the two guards:

| Screen | Row |
| --- | --- |
| `app/transfer.tsx` | department filters |
| `app/accounts.tsx` | role, status and department filter rows (3) |
| `app/reports.tsx` | report, period, status and request-type chips (4) |
| `app/activity-log.tsx` | activity tags |
| `app/assets-list.tsx` | lifecycle tags, category filters |
| `app/asset-registry.tsx` | category cards |
| `app/repair.tsx` | status filters |
| `app/replacement.tsx` | status filters |
| `app/(tabs)/index.tsx` | overview stat cards |
| `app/(user-tabs)/index.tsx` | lifecycle status row |
| `components/month-filter.tsx` | month chips (already guarded) |

`scripts/ui-scroll-audit.js` performs the check read-only and exits non-zero if a
new horizontal scroller is added without a guard:

```bash
node scripts/ui-scroll-audit.js
# blank line
# 17 horizontal scroll view(s) checked; 0 without a stretch guard.
```

## 3. "Submitted by: Name • 4"

`app/(tabs)/requests.tsx` built the card's department from
`user.department_id`, a bigint. The card simply appended it after the submitter,
so department 4 rendered as "• 4".

The query now embeds the name through the existing foreign key —
`departments:department_id (Name)` — and the row maps
`String(departmentRelation?.Name ?? '').trim()`. Cards show
"Submitted by: Kevin Andrew • Demo Department", and requests whose submitter has
no department omit the separator entirely instead of leaving "• " behind
(`components/requests/request-card.tsx`). The expanded card's Department row shows
"—" in that case.

The same numeric fallback in `lib/userService.ts` (`normalizeUserRequest`, used by
the employee request list, and the request-detail mapper) was replaced with the
embedded department name; `fetchUserRequests` now selects
`departments:department_id(Name)` too. No user-facing text can print a department
id any more.

## 4. Transfer summary line

The line under the filters said "1 employee • 178 assigned assets": the employee
count came from the filtered list, the asset count from all employees. It now
sums `visibleEmployees`, so both numbers describe the same set.

## 5. Verification

* `npx tsc --noEmit` — **pass** (0 errors).
* `npx eslint` on every file touched above — **0 errors**, 4 pre-existing
  warnings.
* `node scripts/ui-scroll-audit.js` — 17 scrollers, 0 without a guard.
* `npx expo export --platform android` — **pass** (7.1 MB Hermes bundle).
* Live read-only Supabase query with the new embed: the full requests select
  resolves and returns `Kevin Andrew → Demo Department`, `Joseph Aramil → IT
  Department`, etc. This is the value the cards now print.

**Not performed:** a device or emulator run, so the fixes have not been seen
rendered on hardware; and `expo export --platform web` fails during static
rendering at `AsyncStorage.getItem` (the web target is not used by this app).

The grey gear bubble visible in both screenshots is the Expo development-client
menu button, not part of the screens; it does not appear in a release build.
