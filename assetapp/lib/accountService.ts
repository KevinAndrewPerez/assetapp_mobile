/**
 * Account administration from the phone: who may sign in, in what role, and in
 * which department.
 *
 * This is the mobile half of the web's `App\Support\AccountAdmin`, and the same
 * rules apply here because they are rules about the institution, not about a
 * screen:
 *
 *   - a role is granted by the office, never inferred from a promotion or a
 *     department transfer;
 *   - deactivating is a lock, not a deletion - rows, requests and history stay;
 *   - the last active Administrator cannot be demoted or deactivated, because
 *     that would leave nobody able to administer NU Trace at all;
 *   - every change is written to the shared audit trail with the actor's name.
 *
 * Accounts are read in pages with server-side filters so a university-sized
 * account list never has to be downloaded whole. Employee details live in
 * `employee_numbers` and departments in `departments`, so they are resolved in
 * a second step instead of relying on a joined-filter, which PostgREST only
 * supports within one table.
 */
import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { requireAdminActor } from './access';

/** The roles the web's `Access::ROLES` recognises. */
export const ACCOUNT_ROLES = ['Admin', 'Department Head', 'Employee'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_PAGE_SIZE = 20;

export type AccountRow = {
  id: string;
  email: string;
  role: string;
  status: 'Active' | 'Inactive';
  departmentId: number | null;
  departmentName: string;
  employeeNumber: string;
  fullName: string;
  /** `employee_numbers.status`: a masterlist fact, shown but never auto-enforced. */
  employeeStatus: string;
};

export type AccountFilters = {
  q: string;
  role: string;
  status: string;
  department: number | null;
};

export const DEFAULT_ACCOUNT_FILTERS: AccountFilters = { q: '', role: '', status: '', department: null };

export type AccountPage = { rows: AccountRow[]; hasMore: boolean };

export type AccountActor = { id: string | number | null; label: string };

export type AccountMutation = { ok: boolean; message: string };

/** A row's status as one of the two the system uses. */
export const normalizedStatus = (status: unknown): 'Active' | 'Inactive' =>
  String(status ?? '').trim().toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

const normalize = (value: unknown): string => String(value ?? '').trim();

/**
 * Resolve the employee and department details for a page of account rows.
 *
 * Deliberately two small `IN (...)` lookups rather than a single embed: the
 * account list already knows the ids it needs, and this keeps the page query
 * filterable and paginated on `users` alone.
 */
async function decorate(rows: any[]): Promise<AccountRow[]> {
  const employeeIds = Array.from(
    new Set(rows.map((row) => row?.employee_numbers_id).filter((id) => id !== null && id !== undefined)),
  );
  const departmentIds = Array.from(
    new Set(rows.map((row) => row?.department_id).filter((id) => id !== null && id !== undefined)),
  );

  const employees = new Map<string, any>();
  if (employeeIds.length > 0) {
    const { data } = await supabase
      .from('employee_numbers')
      .select('id, Employee_number, Full_Name, status')
      .in('id', employeeIds as any[]);
    (data ?? []).forEach((employee: any) => employees.set(String(employee.id), employee));
  }

  const departments = new Map<string, string>();
  if (departmentIds.length > 0) {
    const { data } = await supabase.from('departments').select('id, Name').in('id', departmentIds as any[]);
    (data ?? []).forEach((department: any) => departments.set(String(department.id), String(department.Name ?? '')));
  }

  return rows.map((row) => {
    const employee = employees.get(String(row?.employee_numbers_id ?? ''));
    return {
      id: String(row?.id ?? ''),
      email: normalize(row?.email),
      role: normalize(row?.role),
      status: normalizedStatus(row?.status),
      departmentId: row?.department_id ?? null,
      departmentName: departments.get(String(row?.department_id ?? '')) ?? '',
      employeeNumber: normalize(employee?.Employee_number),
      fullName: normalize(employee?.Full_Name),
      employeeStatus: normalize(employee?.status) || 'Active',
    } satisfies AccountRow;
  });
}

/**
 * One page of accounts, active first then by email - the office's own order.
 *
 * The search box matches the email on `users` and the name / employee number
 * on the masterlist: employee matches are resolved first, then folded into the
 * page query as an id list, so the result set is still filtered and paginated
 * by the database rather than in the app.
 */
export async function fetchAccountPage(
  filters: AccountFilters = DEFAULT_ACCOUNT_FILTERS,
  page = 0,
): Promise<AccountPage> {
  const from = page * ACCOUNT_PAGE_SIZE;
  const to = from + ACCOUNT_PAGE_SIZE; // one extra row tells us whether more exist

  let query = supabase
    .from('users')
    .select('id, email, role, status, department_id, employee_numbers_id')
    .order('status', { ascending: true })
    .order('email', { ascending: true })
    .range(from, to);

  if (filters.role) query = query.eq('role', filters.role);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.department !== null) query = query.eq('department_id', filters.department);

  const search = filters.q.trim();
  if (search) {
    const escaped = search.replace(/[%,()]/g, ' ').trim();
    let or = `email.ilike.%${escaped}%`;

    const { data: matches } = await supabase
      .from('employee_numbers')
      .select('id')
      .or(`Full_Name.ilike.%${escaped}%,Employee_number.ilike.%${escaped}%`)
      .limit(50);

    const ids = (matches ?? []).map((row: any) => row.id).filter((id) => id !== null && id !== undefined);
    if (ids.length > 0) or += `,employee_numbers_id.in.(${ids.join(',')})`;

    query = query.or(or);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > ACCOUNT_PAGE_SIZE;

  return { rows: await decorate(rows.slice(0, ACCOUNT_PAGE_SIZE)), hasMore };
}

/** Total accounts, and how many are inactive, for the summary line. */
export async function fetchAccountCounts(): Promise<{ total: number; inactive: number }> {
  const [total, inactive] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'Inactive'),
  ]);

  return { total: total.count ?? 0, inactive: inactive.count ?? 0 };
}

/** One account with its employee / department details. */
export async function fetchAccount(id: string | number): Promise<AccountRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, role, status, department_id, employee_numbers_id')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return (await decorate([data]))[0] ?? null;
}

/** The name to show for an account: the employee's, or the email as a fallback. */
export const accountDisplayName = (account: AccountRow): string =>
  account.fullName || account.email || `Account #${account.id}`;

/**
 * Is this the only active Administrator account left?
 *
 * Counted from the database, so it is the real remaining number and not
 * something the screen believes.
 */
export async function isLastActiveAdmin(account: AccountRow): Promise<boolean> {
  if (account.role !== 'Admin' || account.status !== 'Active') return false;

  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'Admin')
    .eq('status', 'Active')
    .neq('id', account.id);

  if (error) throw error;
  return (count ?? 0) === 0;
}

/**
 * How many pending requests are waiting with no active office account able to
 * decide them. Reported after a change, never acted on automatically.
 */
async function pendingWithoutReviewer(): Promise<number> {
  const { count: deciders } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'Admin')
    .eq('status', 'Active');

  if ((deciders ?? 0) > 0) return 0;

  const { count } = await supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'Pending');
  return count ?? 0;
}

/** Write the office's change to the shared audit trail, as the web does. */
const audit = (actor: AccountActor, description: string, notes: string): Promise<void> =>
  writeAudit({ actorId: actor.id, actionType: 'UPDATE', description, notes });

/**
 * Change one account's role. Refuses the last active Administrator.
 */
export async function changeAccountRole(
  accountId: string | number,
  role: string,
  actor: AccountActor,
): Promise<AccountMutation> {
  // The screen hides these controls for non-Admins; this is what stops a call
  // from anywhere else. The actor is read live, not taken from the screen.
  await requireAdminActor(actor.id);

  if (!(ACCOUNT_ROLES as readonly string[]).includes(role)) {
    return { ok: false, message: 'That is not a role NU Trace recognises.' };
  }

  const account = await fetchAccount(accountId);
  if (!account) return { ok: false, message: 'That account no longer exists.' };
  if (account.role === role) return { ok: true, message: `${accountDisplayName(account)} is already ${role}.` };

  if (role !== 'Admin' && (await isLastActiveAdmin(account))) {
    return {
      ok: false,
      message:
        'This is the last active Administrator account, so its role cannot be changed. Give another account the Administrator role first.',
    };
  }

  const { error } = await supabase
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) throw error;

  await audit(
    actor,
    `Changed role for ${accountDisplayName(account)} from ${account.role} to ${role}.`,
    `Account #${account.id} role changed to ${role}`,
  );

  return { ok: true, message: `${accountDisplayName(account)} is now ${role}.` };
}

/**
 * Move an account to another department. Its authority does not change with it.
 */
export async function changeAccountDepartment(
  accountId: string | number,
  departmentId: number,
  actor: AccountActor,
): Promise<AccountMutation> {
  await requireAdminActor(actor.id);

  const account = await fetchAccount(accountId);
  if (!account) return { ok: false, message: 'That account no longer exists.' };

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id, Name')
    .eq('id', departmentId)
    .maybeSingle();
  if (departmentError) throw departmentError;
  if (!department) return { ok: false, message: 'That department is not in the department list.' };

  if (Number(account.departmentId) === Number(departmentId)) {
    return { ok: true, message: `${accountDisplayName(account)} is already in ${department.Name}.` };
  }

  const { error } = await supabase
    .from('users')
    .update({ department_id: departmentId, updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) throw error;

  await audit(
    actor,
    `Moved ${accountDisplayName(account)} from ${account.departmentName || 'no department'} to ${department.Name}.`,
    `Account #${account.id} department changed to ${department.Name}`,
  );

  return {
    ok: true,
    message: `${accountDisplayName(account)} moved to ${department.Name}.`,
  };
}

/**
 * Activate or deactivate an account. Deactivating is a lock, not a deletion;
 * the last active Administrator cannot be switched off.
 */
export async function changeAccountStatus(
  accountId: string | number,
  status: 'Active' | 'Inactive',
  actor: AccountActor,
): Promise<AccountMutation> {
  await requireAdminActor(actor.id);

  const account = await fetchAccount(accountId);
  if (!account) return { ok: false, message: 'That account no longer exists.' };
  if (account.status === status) return { ok: true, message: `${accountDisplayName(account)} is already ${status}.` };

  if (status === 'Inactive' && (await isLastActiveAdmin(account))) {
    return {
      ok: false,
      message:
        'This is the last active Administrator account. Deactivating it would leave NU Trace with nobody able to administer it.',
    };
  }

  const { error } = await supabase
    .from('users')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) throw error;

  await audit(
    actor,
    `${status === 'Inactive' ? 'Deactivated' : 'Reactivated'} the account for ${accountDisplayName(account)}.`,
    `Account #${account.id} status changed to ${status}`,
  );

  let message =
    status === 'Inactive'
      ? `${accountDisplayName(account)} can no longer sign in. Their records and requests are untouched, and the account can be reactivated at any time.`
      : `${accountDisplayName(account)} can sign in again.`;

  // A change of who may decide requests is exactly the moment the office needs
  // to know whether anything is now waiting with nobody eligible.
  const orphaned = await pendingWithoutReviewer();
  if (orphaned > 0) {
    message += ` Note: ${orphaned} pending request(s) now have no active Asset Management Office account that can decide them.`;
  }

  return { ok: true, message };
}
