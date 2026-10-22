/**
 * The order the Asset Management Office reviews requests in — one rule, shared
 * by the screens that list requests and by the bell that points at them.
 *
 * This is the mobile twin of the web app's `/admin/requests` query in the
 * NUTrace repo (`routes/web.php`):
 *
 *     // Pending requests stay on top — they are the only rows that carry the
 *     // Approve / Reject actions — oldest waiting first, so the request that
 *     // has been sitting in the queue longest is the first row. Decided
 *     // requests follow, newest first.
 *     ->orderByRaw('CASE WHEN LOWER(requests.status) = ? THEN 0 ELSE 1 END ASC', ['pending'])
 *     ->orderByRaw('CASE WHEN LOWER(requests.status) = ? THEN requests.created_at END ASC', ['pending'])
 *     ->orderByRaw('CASE WHEN LOWER(requests.status) = ? THEN requests.id END ASC', ['pending'])
 *     ->orderByDesc('requests.created_at')
 *     ->orderByDesc('requests.id')
 *
 * `tests/Feature/RequestPagesTest.php` pins that down for every role's list
 * ("pending rows read oldest-waiting-first; decided rows read newest-first"),
 * so a list fetched newest-first has to be re-ordered with this comparator
 * before it is rendered.
 */

/** The few fields the rule needs — any request- or notification-shaped row. */
export type ReviewOrderRow = {
  /** Status of the request the row is about. */
  status?: string | null;
  /** When that request was submitted — how long it has been waiting. */
  requestedAt?: string | null;
  /** When the row itself was recorded; the fallback date for decided rows. */
  updatedAt?: string | null;
  id?: string | number | null;
};

/** True for the queue's "pending" (matches the web's LOWER(status) check). */
export const isPendingStatus = (status?: string | null): boolean =>
  String(status ?? '').trim().toLowerCase() === 'pending';

const timeOf = (value?: string | null): number => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const idOf = (value?: string | number | null): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Pending rows first — longest wait on top (oldest `requestedAt`, then lowest
 * id) — and everything already decided after them, newest first.
 */
export function compareReviewOrder(a: ReviewOrderRow, b: ReviewOrderRow): number {
  const aPending = isPendingStatus(a.status);
  const bPending = isPendingStatus(b.status);
  if (aPending !== bPending) return aPending ? -1 : 1;

  if (aPending) {
    const waited = timeOf(a.requestedAt) - timeOf(b.requestedAt);
    if (waited !== 0) return waited;
    const ids = idOf(a.id) - idOf(b.id);
    if (ids !== 0) return ids;
  }

  const newest = timeOf(b.updatedAt) - timeOf(a.updatedAt);
  if (newest !== 0) return newest;
  return idOf(b.id) - idOf(a.id);
}

/** `compareReviewOrder` as a sort helper. The input array is not mutated. */
export function sortByReviewOrder<T>(rows: T[], toRow: (row: T) => ReviewOrderRow): T[] {
  return [...rows].sort((a, b) => compareReviewOrder(toRow(a), toRow(b)));
}
