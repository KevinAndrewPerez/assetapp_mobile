/**
 * User-facing lifecycle visibility.
 *
 * The Asset Management Office works with every lifecycle state, but a requester
 * only ever sees — and may only file a request for — the assets still in their
 * care:
 *
 *   Active | For Repair | For Replacement | For Checking
 *
 * `Disposal` (the asset is gone) and `Pullout` (it is with the AMO) are office
 * states, so they are hidden from every user-side screen (dashboard, My Assets,
 * Report Repair scan/picker).
 *
 * Values match `assets.Lifecycle_Status` exactly as the database stores them.
 */

export const USER_VISIBLE_LIFECYCLE_STATUSES = [
  'Active',
  'For Repair',
  'For Replacement',
  'For Checking',
] as const;

export type UserVisibleLifecycleStatus = (typeof USER_VISIBLE_LIFECYCLE_STATUSES)[number];

export const normalizeLifecycleStatus = (raw: unknown): string => String(raw ?? '').trim();

/** The canonical visible status for a raw value, or null when it is hidden. */
export const matchUserVisibleStatus = (raw: unknown): UserVisibleLifecycleStatus | null => {
  const key = normalizeLifecycleStatus(raw).toLowerCase();
  if (!key) return null;
  return USER_VISIBLE_LIFECYCLE_STATUSES.find((status) => status.toLowerCase() === key) ?? null;
};

/** True when a requester is allowed to see this asset's lifecycle state. */
export const isVisibleToUser = (raw: unknown): boolean => matchUserVisibleStatus(raw) !== null;

/** Why a scanned/picked asset cannot be requested — shown to the requester. */
export const hiddenLifecycleReason = (raw: unknown): string => {
  const key = normalizeLifecycleStatus(raw).toLowerCase();
  if (key === 'disposal' || key === 'disposed') {
    return 'This asset has already been disposed and is no longer in your care.';
  }
  if (key === 'pullout' || key === 'pulled out' || key === 'pull-out') {
    return 'This asset has been pulled out and is currently with the Asset Management Office.';
  }
  return 'This asset is not available for a request right now.';
};

/** Shown when a scanned asset belongs to somebody else (or to nobody). */
export const NOT_YOUR_ASSET_MESSAGE = "This asset isn't yours to make a request.";

/**
 * Only an Active asset may be put into a request. Anything already moving
 * through another process (repair, replacement, pullout, disposal, checking)
 * has to finish that process first — otherwise two workflows would fight over
 * the same asset.
 */
export const isRequestableAsset = (raw: unknown): boolean =>
  normalizeLifecycleStatus(raw).toLowerCase() === 'active';

/** Why an asset cannot be added to a request — shown to the requester. */
export const notRequestableReason = (raw: unknown): string => {
  const status = normalizeLifecycleStatus(raw);
  if (!status) return 'Only assets with an Active status can be added to a request.';
  return `Only assets with an Active status can be added to a request — this one is currently "${status}".`;
};

/**
 * Preventive maintenance may only be marked complete while the asset is still
 * serviceable and in someone's hands:
 *
 *   Active | For Checking | For Repair | For Replacement | Pullout
 *
 * `Disposal` is final — the asset is gone, so completing upkeep on it would
 * invent a maintenance event for an asset that no longer exists. `Acquired`
 * (never issued yet) and unknown states are refused for the same reason.
 */
export const MAINTENANCE_ELIGIBLE_STATUSES = [
  'Active',
  'For Checking',
  'For Repair',
  'For Replacement',
  'Pullout',
] as const;

/** True when maintenance completion is allowed for this lifecycle status. */
export const canCompleteMaintenanceStatus = (raw: unknown): boolean => {
  const key = normalizeLifecycleStatus(raw).toLowerCase();
  if (!key) return false;
  return MAINTENANCE_ELIGIBLE_STATUSES.some((status) => status.toLowerCase() === key);
};

/** Why maintenance completion is unavailable — shown instead of the button. */
export const maintenanceBlockedReason = (raw: unknown): string => {
  const status = normalizeLifecycleStatus(raw);
  if (status.toLowerCase() === 'disposal' || status.toLowerCase() === 'disposed') {
    return 'This asset has been disposed of, so its maintenance schedule is closed and cannot be completed.';
  }
  if (status.toLowerCase() === 'acquired') {
    return 'This asset has not been issued yet. Mark maintenance complete once it is Active.';
  }
  return `Maintenance can only be completed while the asset is Active, For Checking, For Repair, For Replacement or in Pullout${
    status ? ` — this one is "${status}"` : ''
  }.`;
};

/** The lifecycle status a request type moves the asset to once it is approved. */
export const REQUEST_TYPE_TARGET_STATUS: Record<string, string> = {
  Repair: 'For Repair',
  Disposal: 'Disposal',
  Replacement: 'For Replacement',
  Pullout: 'Pullout',
  // A transfer only moves accountability — the asset stays Active.
  Transfer: 'Active',
};

/** Shared look for a request type — used by Submit Request, My Requests and the request detail. */
export type RequestTypeMeta = {
  label: string;
  icon: string;
  tone: { bg: string; fg: string };
};

export const REQUEST_TYPE_META: Record<string, RequestTypeMeta> = {
  Repair: { label: 'Repair', icon: 'wrench-outline', tone: { bg: '#FEF6E4', fg: '#92400E' } },
  Disposal: { label: 'Disposal', icon: 'delete-outline', tone: { bg: '#FEF2F2', fg: '#B91C1C' } },
  Transfer: { label: 'Transfer', icon: 'swap-horizontal', tone: { bg: '#EFF6FF', fg: '#1D4ED8' } },
  Replacement: { label: 'Replacement', icon: 'autorenew', tone: { bg: '#F5F3FF', fg: '#6D28D9' } },
  Pullout: { label: 'Pullout', icon: 'package-down', tone: { bg: '#E0F2FE', fg: '#0369A1' } },
};

export const requestTypeMeta = (raw: unknown): RequestTypeMeta =>
  REQUEST_TYPE_META[normalizeLifecycleStatus(raw)] ?? {
    label: normalizeLifecycleStatus(raw) || 'Request',
    icon: 'file-document-outline',
    tone: { bg: '#F1F5F9', fg: '#334155' },
  };

/** What happens to the asset when the office approves this kind of request. */
export const REQUEST_TYPE_OUTCOME: Record<string, string> = {
  Repair:
    'The asset is flagged "For Repair" and returns to Active only after the repair is completed and verified.',
  Disposal:
    'Once approved, the asset is marked "Disposal" and can no longer be assigned — its record stays in NU TRACE for history.',
  Transfer:
    'Once approved, accountability moves to the custodian you chose and the asset stays Active.',
  Replacement:
    'Once approved, the asset is marked "For Replacement" while the replacement unit is processed.',
  Pullout:
    'Once approved, the asset is marked "Pullout" and stays with the Asset Management Office until it is returned.',
};

