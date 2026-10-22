import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

/**
 * Who may do what — the mobile counterpart of the web's `App\Support\Access`.
 *
 * The rules are copied from the web, not invented here:
 *
 *   - the Asset Management Office is the **Administrator** role. The web's
 *     `Access::ASSET_OFFICE_ROLES` is `['Admin']`; `Facilities` was retired and
 *     `AssetOfficer` is a legacy value that no longer carries office authority.
 *     Rows holding it keep their history but are ordinary accounts now.
 *   - deciding a request (approve/reject) is the office's job only. A
 *     Department Head sees their department's records; they are not a second
 *     approval stage.
 *   - nobody decides their own request, compared against `requests.user_id` —
 *     the submitter stored in the database — never against anything the client
 *     sends about who it is.
 *
 * IMPORTANT — where enforcement really lives. This app talks to Supabase
 * directly (there is no Node/Laravel API in the request path), so everything in
 * this module is a *client-side* check that makes the UI honest and keeps
 * buttons from lying. It is **not** the security boundary: only Supabase Row
 * Level Security policies can stop a crafted request with the anon key. See
 * MOBILE_MODERATE_IMPROVEMENTS.md for the policies the office must apply.
 */

export type AccountRole = 'Admin' | 'AssetOfficer' | 'Department Head' | 'Employee';

/** Roles the account screens may assign (web `Access::ROLES`). */
export const ASSIGNABLE_ROLES = ['Admin', 'Employee', 'Department Head'] as const;

/** Accounts that run the registry and decide requests. */
export const OFFICE_ROLES: readonly string[] = ['Admin'];

export const normalizeRole = (raw: unknown): string => String(raw ?? '').trim();

/** The Asset Management Office. */
export const isOfficeRole = (role: unknown): boolean => OFFICE_ROLES.includes(normalizeRole(role));

/** May this account approve or reject requests? */
export const canDecideRequests = (role: unknown): boolean => isOfficeRole(role);

/** May this account save the shared official disposal form's fields? */
export const canEditDisposalForm = (role: unknown): boolean => isOfficeRole(role);

/** May this account attach/remove supporting disposal documents? */
export const canManageDisposalDocuments = (role: unknown): boolean => isOfficeRole(role);

/** Account/employee management is narrower than the office: Administrators. */
export const canManageAccounts = (role: unknown): boolean => normalizeRole(role) === 'Admin';

/** Is a deactivated account kept out of every action? */
export const isInactiveStatus = (status: unknown): boolean =>
  normalizeRole(status).toLowerCase() === 'inactive';

/**
 * The web's sign-in refusal for a deactivated account (`EnforceActiveAccount`).
 * Used by the login screen and the session guard, so a deactivation made on the
 * web ends a mobile session with the same words the web uses.
 */
export const ACCOUNT_DEACTIVATED_MESSAGE =
  'This account has been deactivated. Please contact the Asset Management Office.';

/** The account row is gone; nothing can be authorized for it. */
export const ACCOUNT_REMOVED_MESSAGE =
  'This account no longer exists. Please contact the Asset Management Office.';

export const ADMIN_AREA_MESSAGE =
  'This area belongs to the Asset Management Office. Your account does not have access to it.';

/**
 * Standalone routes that belong to the Asset Management Office. The tab group
 * is guarded separately in `app/_layout.tsx`; these screens used to be
 * reachable by deep link even when the tabs were not, so their names live here
 * where the guard and the screens can share them.
 */
export const OFFICE_ONLY_ROUTES: readonly string[] = [
  'asset-registry',
  'transfer',
  'disposal',
  'archived-disposals',
  'activity-log',
  'maintenance',
  'lifespan',
  'reports',
  'accounts',
  'age-review',
  'repair',
  'replacement',
  'pullout',
];

export const isOfficeOnlyRoute = (segment: unknown): boolean =>
  OFFICE_ONLY_ROUTES.includes(String(segment ?? ''));
export const DECIDE_MESSAGE = 'Only the Asset Management Office can approve or reject a request.';
export const SELF_APPROVAL_MESSAGE =
  'You cannot approve or reject your own request. It has to be decided by the Asset Management Office.';

/** A live account row, read from the database rather than from AsyncStorage. */
export type ActorProfile = {
  id: string;
  role: string;
  status: string;
  label: string;
  /** The account's current department, for department-scoped reads (QR scans). */
  departmentId: number | null;
};

/**
 * Read the signed-in account's live role and status.
 *
 * The stored `user` JSON was written at sign-in; an account that was demoted or
 * deactivated since then must not keep its old authority, so every privileged
 * action asks the database instead. Returns null when the row is gone.
 */
export async function fetchActorProfile(
  actorId: string | number | null | undefined,
): Promise<ActorProfile | null> {
  if (actorId === null || actorId === undefined || actorId === '') return null;

  // `users.id` is bigint. Anything else (for example the legacy `'Admin'`
  // placeholder some callers used) cannot name an account, and asking Postgres
  // to compare it would fail with a cast error instead of a clear refusal.
  const numericId = typeof actorId === 'number' ? actorId : Number(String(actorId).trim());
  if (!Number.isFinite(numericId) || numericId <= 0) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id, email, role, status, department_id, employee_numbers("Full_Name")')
    .eq('id', numericId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const employee = Array.isArray((data as any).employee_numbers)
    ? (data as any).employee_numbers[0]
    : (data as any).employee_numbers;

  const departmentId = Number((data as any).department_id);

  return {
    id: String((data as any).id ?? ''),
    role: normalizeRole((data as any).role),
    status: normalizeRole((data as any).status) || 'Active',
    label: String(employee?.Full_Name ?? (data as any).email ?? 'Administrator'),
    departmentId: Number.isFinite(departmentId) ? departmentId : null,
  };
}

/**
 * Refuse an action unless the account is an active member of the office.
 * Returns the message to show, or null when the action is allowed.
 */
export function officeRefusal(profile: ActorProfile | null, message = DECIDE_MESSAGE): string | null {
  if (!profile) return 'Your account could not be verified. Please sign in again.';
  if (isInactiveStatus(profile.status)) {
    return 'This account is inactive and can no longer perform this action.';
  }
  if (!isOfficeRole(profile.role)) return message;
  return null;
}

/**
 * Read the signed-in account's live profile from AsyncStorage + the database.
 *
 * Services use this when their caller has no actor id to pass down. It is the
 * same live read `fetchActorProfile` performs, just with the session lookup
 * included.
 */
export async function currentActorProfile(): Promise<ActorProfile | null> {
  try {
    const raw = await AsyncStorage.getItem('user');
    if (!raw) return null;
    const stored = JSON.parse(raw) as { id?: string | number; user_id?: string | number };
    return await fetchActorProfile(stored?.id ?? stored?.user_id ?? null);
  } catch (error) {
    console.warn('Could not resolve the signed-in account:', error);
    return null;
  }
}

/** Throw unless the account is an active member of the office. */
export async function requireOfficeActor(
  actorId: string | number | null | undefined,
  message = ADMIN_AREA_MESSAGE,
): Promise<ActorProfile> {
  const profile = await fetchActorProfile(actorId);
  const refusal = officeRefusal(profile, message);
  if (refusal) throw new Error(refusal);
  return profile as ActorProfile;
}

/** Throw unless the signed-in account is an active member of the office. */
export async function requireOfficeSession(message = ADMIN_AREA_MESSAGE): Promise<ActorProfile> {
  const profile = await currentActorProfile();
  const refusal = officeRefusal(profile, message);
  if (refusal) throw new Error(refusal);
  return profile as ActorProfile;
}

/** Throw unless the account is an active Administrator. */
export async function requireAdminActor(
  actorId: string | number | null | undefined,
  message = 'Only an Administrator can change accounts or departments.',
): Promise<ActorProfile> {
  const profile = await fetchActorProfile(actorId);
  if (!profile) throw new Error('Your account could not be verified. Please sign in again.');
  if (isInactiveStatus(profile.status)) {
    throw new Error('This account is inactive and can no longer perform this action.');
  }
  if (!canManageAccounts(profile.role)) throw new Error(message);
  return profile;
}
