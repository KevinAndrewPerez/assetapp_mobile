/**
 * The `requests` table only accepts **Pending / Approved / Rejected** — its
 * `requests_status_check` constraint rejects anything else, so writing a
 * derived or user-selected "Completed" / "Cancelled" / "In Progress" fails with
 * SQLSTATE 23514 (`new row for relation "requests" violates check constraint`).
 *
 * Real progress lives on the per-asset rows (repairs / disposals /
 * replacements), which is where the web and the mobile app read it from. Any
 * status on its way into `requests.status` therefore has to be clamped first.
 */
export type StoredRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export const STORED_REQUEST_STATUSES: StoredRequestStatus[] = ['Pending', 'Approved', 'Rejected'];

/**
 * Map any status the app works with onto one the column can store:
 * pending → Pending, approved/in progress/completed/received → Approved,
 * rejected/cancelled → Rejected.
 */
export function clampRequestStatus(raw: unknown): StoredRequestStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'Pending';
  if (value.includes('reject') || value.includes('cancel')) return 'Rejected';
  if (
    value.includes('approv') ||
    value.includes('progress') ||
    value.includes('complet') ||
    value.includes('done') ||
    value.includes('receiv')
  ) {
    return 'Approved';
  }
  return 'Pending';
}
