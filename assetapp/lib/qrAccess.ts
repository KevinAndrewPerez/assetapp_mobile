/**
 * May this account see the asset behind a sticker?
 *
 * The mobile copy of the web's `QrVerification::permitted`:
 *
 *   - the Asset Management Office (`Admin`) sees every asset;
 *   - a Department Head sees assets whose owner is in their department;
 *   - an Employee sees assets assigned to them;
 *   - a deactivated or missing account sees none.
 *
 * It is deliberately separate from the signature check: a genuine sticker that
 * belongs to somebody else is still genuine, and saying so is not the same as
 * showing its details.
 *
 * Pure rules, no React Native or database imports, so the matrix can be tested
 * in `scripts/qr-rules-check.mjs`.
 */

export type QrViewer = {
  id: string;
  role: string;
  status: string;
  /** The account's current department, from the live `users` row. */
  departmentId: number | null;
};

export type QrAssetOwner = {
  /** `assets.user_id`: the account the asset is assigned to. */
  userId: string | number | null;
  /** The owner's department, resolved through `users.department_id`. */
  departmentId: number | null;
};

export const QR_ACCESS_DETAIL =
  "The sticker is genuine, but this asset is outside your account's access, so its details are not shown.";

const isInactive = (status: unknown): boolean =>
  String(status ?? '').trim().toLowerCase() === 'inactive';

const isOffice = (role: unknown): boolean => String(role ?? '').trim() === 'Admin';

export function viewerMaySee(viewer: QrViewer | null | undefined, asset: QrAssetOwner): boolean {
  if (!viewer) return false;
  if (isInactive(viewer.status)) return false;
  if (isOffice(viewer.role)) return true;

  if (String(viewer.role ?? '').trim() === 'Department Head') {
    return (
      asset.departmentId !== null &&
      viewer.departmentId !== null &&
      Number(asset.departmentId) === Number(viewer.departmentId)
    );
  }

  return (
    asset.userId !== null &&
    asset.userId !== undefined &&
    String(asset.userId) === String(viewer.id)
  );
}
