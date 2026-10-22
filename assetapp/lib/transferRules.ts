/**
 * Pure transfer rules, shared by request creation and approval.
 *
 * The web keeps the same two guards in `App\Support\AssetTransfer::create()`:
 * the receiving employee must be an active account, and every asset must still
 * be in the sender's custody. Keeping them here means the Pending-request path
 * and the approval path cannot disagree, and the matrix can be tested without a
 * database in `scripts/transfer-rules-check.mjs`.
 */

/** Lifecycle states in which the asset is no longer in the employee's custody. */
export const TRANSFER_NOT_CUSTODY = ['disposal', 'disposed', 'pullout', 'pulled out'];

export type TransferAssetLike = {
  id?: string | number;
  Asset_code?: string | null;
  Asset_name?: string | null;
  user_id?: string | number | null;
  Lifecycle_Status?: string | null;
};

/** A readable label for an error message. */
export const transferAssetLabel = (asset: TransferAssetLike): string =>
  `${asset.Asset_name ?? 'Asset'}${asset.Asset_code ? ` (${asset.Asset_code})` : ''}`;

/**
 * Why this asset cannot travel with the sender, or null when it can.
 */
export function transferAssetRefusal(
  asset: TransferAssetLike,
  fromUserId: string | number,
  fromName = 'the sending employee',
): string | null {
  const label = transferAssetLabel(asset);

  if (asset.user_id === null || asset.user_id === undefined || String(asset.user_id) !== String(fromUserId)) {
    return `${label} is no longer assigned to ${fromName}. Reload and try again.`;
  }

  if (TRANSFER_NOT_CUSTODY.includes(String(asset.Lifecycle_Status ?? '').trim().toLowerCase())) {
    return `${label} has left the employee's custody and cannot be transferred.`;
  }

  return null;
}

/** Why this sender/receiver pair cannot be used, or null when it can. */
export function transferTargetRefusal(input: {
  fromUserId: string | number;
  toUserId: string | number;
  targetStatus?: string | null;
}): string | null {
  if (String(input.fromUserId) === String(input.toUserId)) {
    return 'Choose a different receiving employee.';
  }

  if (String(input.targetStatus ?? '').trim().toLowerCase() === 'inactive') {
    return 'The receiving employee has a deactivated account, so assets cannot be assigned to them.';
  }

  return null;
}
