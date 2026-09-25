/**
 * Employee relocation / asset transfer service.
 *
 * Scenario it serves: *Juan Dela Cruz is relocated and Maria Santos takes over
 * his position.* Instead of moving every laptop, monitor and chair by hand, the
 * admin picks Juan, reviews his assigned assets, picks Maria and confirms.
 *
 * The assets themselves never change — no new record, no new asset code, no new
 * QR sticker. Only the accountable employee changes, and the move is preserved
 * as history:
 *
 *   requests            one row      (request_type = Transfer, status = Approved,
 *                                    user_id = from, assign_to_user_id = to,
 *                                    asset_id = NULL — the assets live in
 *                                    request_items because a transfer is bulk)
 *   request_items       one row per asset
 *   assets.user_id      from → to    (code / QR / history untouched)
 *   asset_accountability  old row Is_Current = 0, new row Is_Current = 1 with
 *                                    Assign_date / transfer_reason / request_id
 *   audit_logs          TRANSFER rows (one summary + one per asset)
 *   notifications       both employees are told
 *
 * No new tables are needed: the pieces already exist in the schema.
 */
import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { createNotification } from './notificationService';
import { toStoredTimestamp } from './time';

/** The three states the Transfer list shows, in plain language. */
export type TransferStatus = 'CURRENT' | 'REASSIGNED' | 'TRANSFER_PENDING';

export const TRANSFER_STATUS_META: Record<
  TransferStatus,
  { label: string; emoji: string; detail: string; tone: { bg: string; fg: string } }
> = {
  CURRENT: {
    label: 'CURRENT',
    emoji: '🟢',
    detail: 'This employee currently holds the assets assigned to them.',
    tone: { bg: '#ECFDF5', fg: '#047857' },
  },
  REASSIGNED: {
    label: 'REASSIGNED',
    emoji: '🔄',
    detail: 'This employee\u2019s assets were already transferred to somebody else.',
    tone: { bg: '#EFF6FF', fg: '#1D4ED8' },
  },
  TRANSFER_PENDING: {
    label: 'TRANSFER PENDING',
    emoji: '⚠️',
    detail: 'A transfer for this employee was filed but has not been completed yet.',
    tone: { bg: '#FFFBEB', fg: '#B45309' },
  },
};

/** The reasons stored in `asset_accountability.transfer_reason`. */
export const TRANSFER_REASONS = [
  'Employee Relocation',
  'Position Reassignment',
  'Employee Replacement',
  'Department Transfer',
  'Other',
] as const;

export type TransferReason = (typeof TRANSFER_REASONS)[number];

export type TransferEmployee = {
  id: string;
  name: string;
  email: string;
  employeeNumber: string;
  role: string;
  department: string;
  departmentId: string | number | null;
  /** Assets currently assigned to the employee (`assets.user_id`). */
  assetCount: number;
  status: TransferStatus;
  /** Who their assets went to, when that already happened. */
  lastTransferTo?: string | null;
  lastTransferAt?: string | null;
};

export type TransferAsset = {
  id: string;
  code: string;
  name: string;
  category: string;
  status: string;
  location: string;
};

export type TransferRecord = {
  id: string;
  reference: string;
  fromName: string;
  toName: string;
  reason: string;
  notes: string;
  assetCount: number;
  status: string;
  createdAt: string;
  transferredBy: string;
  assetIds: string[];
};

type UserRow = {
  id: string | number;
  email?: string | null;
  role?: string | null;
  employee_numbers?:
    | {
        Full_Name?: string | null;
        Employee_number?: string | null;
        departments?: { Name?: string | null } | null;
      }
    | null;
};

const firstOf = (value: any) => (Array.isArray(value) ? value?.[0] : value);

const toUserName = (row: UserRow | null | undefined): string => {
  if (!row) return 'Unknown employee';
  const employee = firstOf(row.employee_numbers);
  return String(employee?.Full_Name ?? row.email ?? 'Unknown employee');
};

const toEmployeeNumber = (row: UserRow | null | undefined): string =>
  String(firstOf(row?.employee_numbers)?.Employee_number ?? '');

const toDepartment = (row: UserRow | null | undefined): string =>
  String(firstOf(firstOf(row?.employee_numbers)?.departments)?.Name ?? '');

const USER_SELECT =
  'id, email, role, status, department_id, employee_numbers_id, employee_numbers("Full_Name", "Employee_number", "Department_id", departments("Name"))';

/** Every user that can hold assets, with their assignment count and status. */
export async function fetchTransferEmployees(): Promise<TransferEmployee[]> {
  const [usersRes, assetsRes, transfersRes] = await Promise.all([
    supabase.from('users').select(USER_SELECT).order('id', { ascending: true }),
    supabase.from('assets').select('id, user_id'),
    supabase
      .from('requests')
      .select('id, user_id, assign_to_user_id, status, request_type, created_at')
      .ilike('request_type', '%transfer%')
      .order('created_at', { ascending: false }),
  ]);

  if (usersRes.error) throw usersRes.error;
  if (assetsRes.error) throw assetsRes.error;
  if (transfersRes.error) throw transfersRes.error;

  const users = (usersRes.data ?? []) as UserRow[];
  const nameById = new Map<string, string>();
  users.forEach((user) => nameById.set(String(user.id), toUserName(user)));

  // Current assignment counts come straight from `assets.user_id`.
  const assetCounts = new Map<string, number>();
  (assetsRes.data ?? []).forEach((row: any) => {
    const key = String(row?.user_id ?? '');
    if (!key) return;
    assetCounts.set(key, (assetCounts.get(key) ?? 0) + 1);
  });

  const pendingByUser = new Map<string, any>();
  const completedByUser = new Map<string, any>();
  (transfersRes.data ?? []).forEach((row: any) => {
    const key = String(row?.user_id ?? '');
    if (!key) return;
    const status = String(row?.status ?? '').toLowerCase();
    if (status === 'pending') {
      if (!pendingByUser.has(key)) pendingByUser.set(key, row);
      return;
    }
    if (status === 'approved' || status === 'completed') {
      // "Reassigned" is decided by transfer history — never by "has zero assets",
      // which would also be true for a brand-new employee.
      if (!completedByUser.has(key)) completedByUser.set(key, row);
    }
  });

  return users
    .map((user) => {
      const key = String(user.id);
      const assetCount = assetCounts.get(key) ?? 0;
      const pending = pendingByUser.get(key);
      const completed = completedByUser.get(key);
      let status: TransferStatus = 'CURRENT';
      if (pending) status = 'TRANSFER_PENDING';
      else if (assetCount === 0 && completed) status = 'REASSIGNED';

      return {
        id: key,
        name: toUserName(user),
        email: String(user.email ?? ''),
        employeeNumber: toEmployeeNumber(user),
        role: String(user.role ?? 'Employee'),
        department: toDepartment(user),
        departmentId: (user as any).department_id ?? null,
        assetCount,
        status,
        lastTransferTo: completed
          ? nameById.get(String(completed.assign_to_user_id ?? '')) ?? null
          : null,
        lastTransferAt: completed ? String(completed.created_at ?? '') : null,
      };
    })
    .sort((a, b) => {
      if (b.assetCount !== a.assetCount) return b.assetCount - a.assetCount;
      return a.name.localeCompare(b.name);
    });
}

/** The assets currently assigned to one employee (`assets.user_id`). */
export async function fetchEmployeeAssignedAssets(
  userId: string | number,
): Promise<TransferAsset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, Category, Lifecycle_Status, asset_location')
    .eq('user_id', userId as any)
    .order('Asset_name', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    code: String(row.Asset_code ?? ''),
    name: String(row.Asset_name ?? 'Asset'),
    category: String(row.Category ?? ''),
    status: String(row.Lifecycle_Status ?? ''),
    location: String(row.asset_location ?? ''),
  }));
}

/**
 * Completed + in-flight transfers, newest first — the Transfer History list and
 * its detail sheet read this.
 */
export async function fetchTransferHistory(): Promise<TransferRecord[]> {
  const { data, error } = await supabase
    .from('requests')
    .select('id, user_id, assign_to_user_id, request_type, status, Note, created_at, admin_remarks, admin_remarks_by')
    .ilike('request_type', '%transfer%')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.user_id, row.assign_to_user_id, row.admin_remarks_by])
        .filter((id) => id !== null && id !== undefined)
        .map((id) => String(id)),
    ),
  );

  const [usersRes, itemsRes] = await Promise.all([
    supabase.from('users').select(USER_SELECT).in('id', userIds),
    supabase
      .from('request_items')
      .select('request_id, asset_id')
      .in('request_id', rows.map((row) => row.id)),
  ]);
  if (usersRes.error) throw usersRes.error;
  if (itemsRes.error) throw itemsRes.error;

  const nameById = new Map<string, string>();
  ((usersRes.data ?? []) as UserRow[]).forEach((user) =>
    nameById.set(String(user.id), toUserName(user)),
  );

  const itemsByRequest = new Map<string, string[]>();
  (itemsRes.data ?? []).forEach((item: any) => {
    const key = String(item?.request_id ?? '');
    if (!key) return;
    itemsByRequest.set(key, [...(itemsByRequest.get(key) ?? []), String(item.asset_id)]);
  });

  return rows.map((row) => ({
    id: String(row.id),
    reference: `TR-${String(row.id).padStart(3, '0')}`,
    fromName: nameById.get(String(row.user_id)) ?? 'Unknown employee',
    toName: nameById.get(String(row.assign_to_user_id)) ?? 'Not yet assigned',
    reason: String(row.Note ?? 'Transfer'),
    notes: String(row.admin_remarks ?? ''),
    assetCount: (itemsByRequest.get(String(row.id)) ?? []).length,
    status: String(row.status ?? 'Approved'),
    createdAt: String(row.created_at ?? ''),
    transferredBy: nameById.get(String(row.admin_remarks_by ?? '')) ?? 'Asset Management Office',
    assetIds: itemsByRequest.get(String(row.id)) ?? [],
  }));
}

export type ExecuteTransferInput = {
  fromUserId: string | number;
  fromName: string;
  toUserId: string | number;
  toName: string;
  assetIds: (string | number)[];
  reason: TransferReason | string;
  notes?: string;
  actorId?: string | number | null;
  actorName?: string | null;
};

/**
 * Perform the transfer.
 *
 * Order matters: the request header is created first so `request_items` and the
 * accountability rows can point at it, and the asset rows are only repointed
 * after the transaction exists (so a partial failure still leaves a trace).
 */
export async function executeEmployeeTransfer(input: ExecuteTransferInput): Promise<{
  requestId: string;
  reference: string;
  assetCount: number;
}> {
  const assetIds = Array.from(
    new Set(input.assetIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))),
  );
  if (assetIds.length === 0) throw new Error('Select at least one asset to transfer.');
  if (String(input.fromUserId) === String(input.toUserId)) {
    throw new Error('Choose a different receiving employee.');
  }

  const now = toStoredTimestamp();
  const reason = String(input.reason || 'Employee Relocation').trim();
  const notes = String(input.notes ?? '').trim();

  // 1. The transfer transaction.
  const { data: requestRow, error: requestError } = await supabase
    .from('requests')
    .insert([
      {
        user_id: input.fromUserId,
        asset_id: null,
        request_type: 'Transfer',
        status: 'Approved',
        Note: reason,
        assign_to_user_id: input.toUserId,
        admin_remarks: notes || `Transferred by ${input.actorName ?? 'Asset Management Office'}`,
        admin_remarks_by: input.actorId ?? null,
        admin_remarks_at: now,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('id')
    .single();
  if (requestError) throw requestError;

  const requestId = String((requestRow as any)?.id ?? '');
  const reference = `TR-${requestId.padStart(3, '0')}`;

  // 2. One request_items row per asset (a transfer is bulk, so `requests.asset_id`
  //    stays NULL and the assets live here).
  const { error: itemsError } = await supabase.from('request_items').insert(
    assetIds.map((assetId) => ({
      request_id: requestId,
      asset_id: assetId,
      created_at: now,
      updated_at: now,
    })),
  );
  if (itemsError) throw itemsError;

  // 3. Repoint the assets. Nothing else about them changes.
  const { data: movedAssets, error: assetError } = await supabase
    .from('assets')
    .update({ user_id: input.toUserId, updated_at: now })
    .in('id', assetIds)
    .select('id, Asset_code, Asset_name');
  if (assetError) throw assetError;

  // 4. Accountability history: close the old rows, open the new ones.
  const { error: closeError } = await supabase
    .from('asset_accountability')
    .update({
      Is_Current: 0,
      notes: `Closed by the transfer recorded in request #${requestId}.`,
      updated_at: now,
    })
    .in('asset_id', assetIds)
    .eq('Is_Current', 1);
  if (closeError) console.warn('Could not close the previous accountability rows:', closeError.message);

  const { error: accountabilityError } = await supabase.from('asset_accountability').insert(
    assetIds.map((assetId) => ({
      asset_id: assetId,
      user_id: input.toUserId,
      request_id: Number(requestId),
      Assign_date: now,
      Is_Current: 1,
      transfer_reason: reason,
      created_at: now,
      updated_at: now,
    })),
  );
  if (accountabilityError) {
    console.warn('Accountability rows could not be written:', accountabilityError.message);
  }

  // 5. Audit trail — one headline row plus one row per asset, matching the shape
  //    the web admin already produces (`Transfer 37: CODE — name reassigned to X`).
  const moved = (movedAssets ?? []) as any[];
  await writeAudit({
    actorId: input.actorId ?? null,
    requestId,
    actionType: 'TRANSFER',
    description: `${assetIds.length} asset${assetIds.length > 1 ? 's' : ''} transferred from ${input.fromName} to ${input.toName} due to ${reason.toLowerCase()}.`,
    notes: notes || `Employee relocation / position reassignment (${reason}).`,
  });

  for (const asset of moved) {
    const code = String(asset.Asset_code ?? '');
    const name = String(asset.Asset_name ?? 'Asset');
    await writeAudit({
      actorId: input.actorId ?? null,
      assetId: asset.id,
      requestId,
      actionType: 'TRANSFER',
      description: `Transfer ${requestId}: ${code} — ${name} reassigned to ${input.toName}`,
      notes: `Transferred ${code} from ${input.fromName} to ${input.toName} (${reason})`,
    });
  }

  // 6. Tell both employees.
  await createNotification({
    userId: input.toUserId,
    title: 'Assets Assigned',
    message: `${assetIds.length} asset${assetIds.length > 1 ? 's have' : ' has'} been transferred to your account following an employee relocation. Transferred by: ${input.actorName ?? 'Asset Management Office'}.`,
    type: 'TRANSFER',
    referenceId: requestId,
    referenceType: 'request',
  });
  await createNotification({
    userId: input.fromUserId,
    title: 'Asset Transfer Completed',
    message: `Your previously assigned asset${assetIds.length > 1 ? 's have' : ' has'} been transferred to ${input.toName} (${reason}).`,
    type: 'TRANSFER',
    referenceId: requestId,
    referenceType: 'request',
  });

  return { requestId, reference, assetCount: assetIds.length };
}
