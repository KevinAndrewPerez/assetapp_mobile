import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { createNotification, notifyAdmins } from './notificationService';
import { NOTE_SEP, readNote, upsertNotes } from './noteUtils';
import { repairCameFromPullout } from './pulloutService';

/**
 * Repair Management (NU TRACE mobile spec).
 *
 * Lifecycle:  Active ──Repair Request──▶ REPAIR
 *   ├── Repairable        → Completed → ACTIVE
 *   ├── Beyond Repair     → REPLACEMENT or DISPOSAL
 *   ├── For Replacement   → REPLACEMENT
 *   ├── For Disposal      → DISPOSED
 *   └── Cancelled         → ACTIVE
 *
 * The mobile app is the requester's reporting/tracking interface; the Asset
 * Management Office controls evaluation, lifecycle transition and disposition.
 * Every write below lands in the same tables the Laravel web app reads
 * (`requests`, `request_items`, `repairs`, `audit_logs`, `notifications`), so
 * both clients stay in sync.
 */

export type RepairStatus = 'Pending' | 'In Progress' | 'Completed' | 'Cancelled';
export type RepairResult = 'Repairable' | 'Beyond Repair' | 'For Replacement';
export type RepairPriority = 'Low' | 'Medium' | 'High';

export const REPAIR_STATUSES: RepairStatus[] = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
export const REPAIR_RESULTS: RepairResult[] = ['Repairable', 'Beyond Repair', 'For Replacement'];
export const REPAIR_PRIORITIES: RepairPriority[] = ['Low', 'Medium', 'High'];

/** Extra information the admin records while evaluating/handling a repair. */
export type RepairAdminFields = {
  inspectionFindings?: string;
  repairDescription?: string;
  technician?: string;
  repairCost?: number | string;
  partsReplaced?: string;
  expectedCompletion?: string;
  adminRemarks?: string;
  repairResult?: RepairResult | null;
  cancellationReason?: string;
};

export type RepairRecord = {
  repairId: string;
  requestId: string;
  requestRef: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  category?: string;
  condition?: string;
  serialNumber?: string;
  location?: string;
  purchasePrice?: string;
  warrantyMonths?: string;
  lifecycleStatus?: string;
  /** Asset owner (accountability) — notification target. */
  assetUserId?: string | number | null;
  requesterName: string;
  requesterId?: string | number | null;
  department: string;
  requestStatus?: string;
  issue: string;
  reportedDate: string;
  approvedBy: string;
  status: RepairStatus;
  result: RepairResult | null;
  priority: RepairPriority;
  repairCost: number | null;
  notes: string;
  // Parsed admin fields (kept in `notes` so the web shows them too).
  technician: string;
  expectedCompletion: string;
  partsReplaced: string;
  inspectionFindings: string;
  adminRemarks: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BlockedAsset = {
  assetId: string | number;
  name: string;
  code: string;
  status: string;
  reason: string;
};

export type SubmitRepairInput = {
  user: { id: string | number; full_name?: string | null; email?: string | null };
  assetIds: (string | number)[];
  /** Short problem/issue title. */
  problem: string;
  /** Detailed description of the damage. */
  description?: string;
  priority?: RepairPriority;
  /** yyyy-mm-dd; defaults to today. */
  reportedDate?: string;
  photo?: {
    file_name?: string | null;
    file_path?: string | null;
    file_size?: number | null;
    mime_type?: string | null;
    url?: string | null;
  } | null;
  remarks?: string;
  /** When set, assets not assigned to this user are rejected. */
  restrictOwnerId?: string | number | null;
};

export type SubmitRepairResult = {
  requestId: string;
  requestRef: string;
  repairIds: string[];
  submitted: number;
  blocked: BlockedAsset[];
};

// ─────────────────────────────── notes helpers ───────────────────────────────
// The `repairs` table has no technician/parts/priority columns, so structured
// admin information is appended to `notes` in a human-readable, pipe-separated
// form (see lib/noteUtils.ts). The web app renders `notes` verbatim, so it
// stays readable there. Re-exported for callers that import them from here.

export { NOTE_SEP, readNote, upsertNotes };

export const normalizeRepairStatus = (raw: unknown): RepairStatus => {
  const status = String(raw ?? '').trim().toLowerCase();
  if (!status) return 'Pending';
  if (status.includes('cancel') || status.includes('reject')) return 'Cancelled';
  if (status.includes('complete') || status.includes('done')) return 'Completed';
  if (status.includes('progress') || status.includes('approve') || status.includes('working')) {
    return 'In Progress';
  }
  return 'Pending';
};

const normalizeRepairResult = (raw: unknown): RepairResult | null => {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('beyond')) return 'Beyond Repair';
  if (value.includes('replacement') || value.includes('replace')) return 'For Replacement';
  if (value.includes('repairable') || value.includes('repaired')) return 'Repairable';
  return null;
};

export const normalizeRepairPriority = (raw: unknown): RepairPriority => {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value.startsWith('h') || value.includes('urgent')) return 'High';
  if (value.startsWith('l')) return 'Low';
  return 'Medium';
};

const todayIso = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────── read side ───────────────────────────────────

/**
 * Load repair records with their asset, requester and parent-request info.
 * Assembled with plain queries (no FK embeds) so it works regardless of which
 * constraints exist on the live database.
 */
export async function fetchRepairRecords(options?: {
  status?: RepairStatus | 'All';
  requestId?: string | number | null;
  assetId?: string | number | null;
}): Promise<RepairRecord[]> {
  let query = supabase.from('repairs').select('*').order('created_at', { ascending: false });
  if (options?.status && options.status !== 'All') query = query.eq('status', options.status);
  if (options?.requestId != null) query = query.eq('Request_id', options.requestId as any);
  if (options?.assetId != null) query = query.eq('Assets_id', options.assetId as any);

  const { data: repairRows, error } = await query;
  if (error) throw error;

  const rows = (Array.isArray(repairRows) ? repairRows : []) as any[];
  if (rows.length === 0) return [];

  const uniq = (values: any[]) => {
    const out: number[] = [];
    for (const raw of values) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
  };

  const assetIds = uniq(rows.map((r) => r.Assets_id));
  const requestIds = uniq(rows.map((r) => r.Request_id));

  const [assetsRes, requestsRes] = await Promise.all([
    assetIds.length
      ? supabase
          .from('assets')
          .select(
            'id, Asset_code, Asset_name, Category, Condition, serial_Number, asset_location, purchase_Price, warranty_months, Lifecycle_Status, user_id',
          )
          .in('id', assetIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    requestIds.length
      ? supabase.from('requests').select('id, user_id, Note, status, created_at').in('id', requestIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);

  const assetsById = new Map<string, any>(
    ((assetsRes.data ?? []) as any[]).map((a) => [String(a.id), a]),
  );
  const requestsById = new Map<string, any>(
    ((requestsRes.data ?? []) as any[]).map((r) => [String(r.id), r]),
  );

  const requesterIds = uniq(
    ((requestsRes.data ?? []) as any[]).map((r) => r.user_id),
  );
  const usersById = new Map<string, any>();
  if (requesterIds.length) {
    const { data: userRows } = await supabase
      .from('users')
      .select(
        'id, email, role, department_id, employee_numbers (Full_Name), departments:department_id (Name)',
      )
      .in('id', requesterIds as any);
    for (const u of (userRows ?? []) as any[]) usersById.set(String(u.id), u);
  }

  return rows.map((row: any) => {
    const asset = assetsById.get(String(row.Assets_id)) ?? {};
    const request = requestsById.get(String(row.Request_id)) ?? {};
    const requester = usersById.get(String(request.user_id)) ?? {};
    const employee = Array.isArray(requester.employee_numbers)
      ? requester.employee_numbers[0]
      : requester.employee_numbers;
    const department = Array.isArray(requester.departments)
      ? requester.departments[0]
      : requester.departments;

    const notes = String(row.notes ?? '');
    const cost = row.Repair_Cost === null || row.Repair_Cost === undefined ? null : Number(row.Repair_Cost);

    return {
      repairId: String(row.Repair_id ?? ''),
      requestId: String(row.Request_id ?? ''),
      requestRef: `REP-${String(row.Request_id ?? '')}`,
      assetId: String(row.Assets_id ?? ''),
      assetCode: String(asset.Asset_code ?? 'N/A'),
      assetName: String(asset.Asset_name ?? 'Unknown Asset'),
      category: asset.Category ? String(asset.Category) : undefined,
      condition: asset.Condition ? String(asset.Condition) : undefined,
      serialNumber: asset.serial_Number ? String(asset.serial_Number) : undefined,
      location: asset.asset_location ? String(asset.asset_location) : undefined,
      purchasePrice:
        asset.purchase_Price === null || asset.purchase_Price === undefined
          ? undefined
          : `₱${Number(asset.purchase_Price).toLocaleString('en-PH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
      warrantyMonths: asset.warranty_months != null ? String(asset.warranty_months) : undefined,
      lifecycleStatus: asset.Lifecycle_Status ? String(asset.Lifecycle_Status) : undefined,
      assetUserId: asset.user_id ?? null,
      requesterName: String(employee?.Full_Name ?? requester.email ?? 'Unknown'),
      requesterId: request.user_id ?? null,
      department: String(department?.Name ?? requester.department_id ?? 'N/A'),
      requestStatus: request.status ? String(request.status) : undefined,
      issue: String(row.Repair_Description ?? ''),
      reportedDate: String(row.Repair_Date ?? row.created_at ?? ''),
      approvedBy: String(row.Approve_by ?? ''),
      status: normalizeRepairStatus(row.status),
      result: normalizeRepairResult(row.Repair_result),
      priority: normalizeRepairPriority(readNote(notes, 'Priority')),
      repairCost: Number.isFinite(cost as number) ? (cost as number) : null,
      notes,
      technician: readNote(notes, 'Technician'),
      expectedCompletion: readNote(notes, 'Expected Completion'),
      partsReplaced: readNote(notes, 'Parts Replaced'),
      inspectionFindings: readNote(notes, 'Inspection Findings'),
      adminRemarks: readNote(notes, 'Admin Remarks'),
      createdAt: row.created_at ? String(row.created_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    };
  });
}

/** A one-line status message a user understands (spec section 5/6/7). */
export function repairStatusMessage(status: RepairStatus, result?: RepairResult | null): string {
  switch (status) {
    case 'Pending':
      return 'Your repair request has been submitted and is waiting for evaluation.';
    case 'In Progress':
      return 'Your asset is currently being evaluated/repaired.';
    case 'Completed':
      if (result === 'Beyond Repair') {
        return 'The asset could not be repaired and is proceeding to replacement or disposal.';
      }
      if (result === 'For Replacement') {
        return 'Repair finished — the asset is proceeding through replacement.';
      }
      return 'Repair finished. The asset is Active and can be returned to your department.';
    case 'Cancelled':
      return 'The repair request was cancelled and the asset is Active again.';
    default:
      return '';
  }
}

// ───────────────────────────── validation ────────────────────────────────────

/**
 * Spec §1/§7: a repair request must not be filed for an asset that is already
 * disposed, and one open repair per asset is enough.
 */
export async function validateAssetsForRepair(assetIds: (string | number)[]): Promise<{
  ok: Array<{ id: string; name: string; code: string; status: string; userId: string | number | null }>;
  blocked: BlockedAsset[];
}> {
  const ok: Array<{ id: string; name: string; code: string; status: string; userId: string | number | null }> = [];
  const blocked: BlockedAsset[] = [];
  if (assetIds.length === 0) return { ok, blocked };

  const { data: assetRows, error } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, Lifecycle_Status, user_id')
    .in('id', assetIds as any);
  if (error) throw error;

  const assetsById = new Map<string, any>(((assetRows ?? []) as any[]).map((a) => [String(a.id), a]));

  // Assets already inside an open repair request.
  const openRepairAssetIds = new Set<string>();
  const { data: openRepairs } = await supabase
    .from('repairs')
    .select('Assets_id, status')
    .in('Assets_id', assetIds as any);
  for (const row of ((openRepairs ?? []) as any[])) {
    const status = normalizeRepairStatus(row.status);
    if (status === 'Pending' || status === 'In Progress') openRepairAssetIds.add(String(row.Assets_id));
  }

  for (const raw of assetIds) {
    const asset = assetsById.get(String(raw));
    if (!asset) {
      blocked.push({
        assetId: raw,
        name: 'Unknown asset',
        code: String(raw),
        status: '',
        reason: 'No matching asset record was found.',
      });
      continue;
    }

    const label = { assetId: asset.id, name: String(asset.Asset_name ?? 'Asset'), code: String(asset.Asset_code ?? '') };
    const status = String(asset.Lifecycle_Status ?? '').trim();
    const statusKey = status.toLowerCase();

    if (statusKey === 'disposal' || statusKey === 'disposed') {
      blocked.push({ ...label, status, reason: 'The asset is disposed — it can no longer be repaired or assigned.' });
      continue;
    }
    if (openRepairAssetIds.has(String(asset.id))) {
      blocked.push({
        ...label,
        status,
        reason: 'This asset already has a repair request that is still Pending or In Progress.',
      });
      continue;
    }

    ok.push({
      id: String(asset.id),
      name: label.name,
      code: label.code,
      status: status || 'Acquired',
      userId: asset.user_id ?? null,
    });
  }

  return { ok, blocked };
}

// ───────────────────────────── submission ────────────────────────────────────

/**
 * Submit a repair request (single or bulk). One `requests` row + one
 * `request_items` row per asset + one `repairs` row per asset, so every asset
 * keeps its own record and history even in a bulk submission (spec §2, §Bulk).
 */
export async function submitRepairRequest(input: SubmitRepairInput): Promise<SubmitRepairResult> {
  const userId = input.user?.id;
  if (!userId) throw new Error('Current user is missing ID');

  const problem = String(input.problem ?? '').trim();
  if (!problem) throw new Error('Please describe the problem/issue before submitting.');

  const assetIds = Array.from(new Set((input.assetIds ?? []).map((id) => String(id)).filter(Boolean)));
  if (assetIds.length === 0) throw new Error('Please select at least one asset.');

  const { ok, blocked } = await validateAssetsForRepair(assetIds);

  const wrongOwner = input.restrictOwnerId === undefined || input.restrictOwnerId === null
    ? []
    : ok.filter((asset) => asset.userId !== null && String(asset.userId) !== String(input.restrictOwnerId));

  const unauthorized: BlockedAsset[] = wrongOwner.map((asset) => ({
    assetId: asset.id,
    name: asset.name,
    code: asset.code,
    status: asset.status,
    reason: 'This asset is not assigned to you.',
  }));

  for (const asset of wrongOwner) {
    const idx = ok.findIndex((a) => a.id === asset.id);
    if (idx >= 0) ok.splice(idx, 1);
  }

  const allBlocked = [...blocked, ...unauthorized];

  if (ok.length === 0) {
    const reasonText = allBlocked.map((b) => `• ${b.name} (${b.code}): ${b.reason}`).join('\n');
    throw new Error(`No asset can be submitted for repair.\n${reasonText}`);
  }

  const now = new Date().toISOString();
  const requesterLabel = String(input.user.full_name ?? input.user.email ?? 'User');
  const priority: RepairPriority = input.priority ?? 'Medium';
  const description = String(input.description ?? '').trim();
  const remarks = String(input.remarks ?? '').trim();

  const reportedRaw = String(input.reportedDate ?? '').trim();
  const reportedIso = reportedRaw
    ? (Number.isNaN(Date.parse(reportedRaw)) ? now : new Date(reportedRaw).toISOString())
    : now;

  const { data: requestRow, error: requestError } = await supabase
    .from('requests')
    .insert([
      {
        user_id: userId,
        asset_id: Number(ok[0].id),
        request_type: 'Repair',
        status: 'Pending',
        Note: problem,
        file_name: input.photo?.file_name ?? null,
        file_path: input.photo?.file_path ?? null,
        file_size: input.photo?.file_size ?? null,
        mime_type: input.photo?.mime_type ?? null,
        url: input.photo?.url ?? null,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('id')
    .single();
  if (requestError) throw requestError;

  const requestId = String((requestRow as any)?.id ?? '');
  const requestRef = `REP-${requestId}`;

  const { error: itemsError } = await supabase.from('request_items').insert(
    ok.map((asset) => ({
      request_id: requestId,
      asset_id: Number(asset.id),
      created_at: now,
      updated_at: now,
    })),
  );
  if (itemsError) throw itemsError;

  const repairRows = ok.map((asset) => ({
    Assets_id: Number(asset.id),
    Request_id: requestId,
    Repair_Description: description || problem,
    Repair_Date: reportedIso,
    Approve_by: requesterLabel,
    Repair_Cost: 0,
    status: 'Pending',
    Repair_result: null,
    notes: upsertNotes('', {
      Priority: priority,
      Remarks: remarks,
      'Reported Problem': problem,
    }),
    created_at: now,
    updated_at: now,
  }));

  const { data: insertedRepairs, error: repairError } = await supabase
    .from('repairs')
    .insert(repairRows)
    .select('Repair_id');
  if (repairError) throw repairError;

  // The asset is flagged immediately so it can't be handed out while the
  // request is being evaluated (spec §5) — same as the web create endpoint.
  const { error: assetError } = await supabase
    .from('assets')
    .update({ Lifecycle_Status: 'For Repair', updated_at: now })
    .in('id', ok.map((a) => Number(a.id)));
  if (assetError) console.warn('Failed to flag assets for repair:', assetError.message);

  for (const asset of ok) {
    await writeAudit({
      actorId: userId,
      assetId: asset.id,
      requestId,
      actionType: 'CREATE',
      description: `Repair request ${requestRef} submitted for ${asset.name} ${asset.code}`.trim(),
      notes: `${problem}${description && description !== problem ? ` — ${description}` : ''}`,
    });
  }

  await createNotification({
    userId,
    title: 'Repair Request Submitted',
    message: `Your repair request ${requestRef} for ${ok.length > 1 ? `${ok.length} assets` : `${ok[0].name} (${ok[0].code})`} has been submitted and is waiting for evaluation by the Asset Management Office.`,
    type: 'REPAIR',
    referenceId: requestId,
    referenceType: 'request',
  });

  await notifyAdmins({
    title: `New Repair Request ${requestRef}`,
    message: `${requesterLabel} reported ${problem} for ${ok.length} asset(s). Priority: ${priority}.`,
    type: 'REPAIR',
    referenceId: requestId,
    referenceType: 'request',
  });

  const repairIds = ((insertedRepairs ?? []) as any[])
    .map((r) => String(r?.Repair_id ?? ''))
    .filter(Boolean);

  return { requestId, requestRef, repairIds, submitted: ok.length, blocked: allBlocked };
}

// ───────────────────────── admin status workflow ─────────────────────────────

const mapRequestStatusToRepairStatus = (
  status: 'Pending' | 'Approved' | 'In Progress' | 'Completed' | 'Cancelled' | 'Rejected',
): RepairStatus => {
  switch (status) {
    case 'Completed':
      return 'Completed';
    case 'Cancelled':
    case 'Rejected':
      return 'Cancelled';
    case 'Approved':
    case 'In Progress':
      return 'In Progress';
    default:
      return 'Pending';
  }
};

/**
 * Apply an admin decision to one repair record: updates the repair row, moves
 * the asset through its lifecycle, syncs the parent request, writes the audit
 * trail and notifies the asset owner (spec §4–§11).
 */
export async function updateRepairStatus(options: {
  repairId: string | number;
  status: RepairStatus;
  actorId?: string | number | null;
  actorLabel?: string;
  fields?: RepairAdminFields;
}): Promise<{ status: RepairStatus; assetStatus: string | null }> {
  const { repairId, status, actorId } = options;
  const fields = options.fields ?? {};
  const now = new Date().toISOString();

  const { data: repair, error: fetchError } = await supabase
    .from('repairs')
    .select('Repair_id, Assets_id, Request_id, status, Repair_result, Repair_Cost, notes')
    .eq('Repair_id', repairId as any)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!repair) throw new Error('Repair record not found');

  const assetId = (repair as any).Assets_id;
  const requestId = (repair as any).Request_id;
  const previousNotes = String((repair as any).notes ?? '');

  const { data: asset } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, Lifecycle_Status, user_id')
    .eq('id', assetId as any)
    .maybeSingle();

  const assetLabel = `${asset?.Asset_name ?? 'Asset'} ${asset?.Asset_code ?? ''}`.trim();
  const currentAssetStatus = String(asset?.Lifecycle_Status ?? '');
  const currentAssetKey = currentAssetStatus.trim().toLowerCase();

  const actorLabel = String(options.actorLabel ?? 'Admin');

  let notes = previousNotes;
  if (fields.inspectionFindings) notes = upsertNotes(notes, { 'Inspection Findings': fields.inspectionFindings });
  if (fields.repairDescription) notes = upsertNotes(notes, { 'Repair Description': fields.repairDescription });
  if (fields.technician) notes = upsertNotes(notes, { Technician: fields.technician });
  if (fields.partsReplaced) notes = upsertNotes(notes, { 'Parts Replaced': fields.partsReplaced });
  if (fields.expectedCompletion) notes = upsertNotes(notes, { 'Expected Completion': fields.expectedCompletion });
  if (fields.adminRemarks) notes = upsertNotes(notes, { 'Admin Remarks': fields.adminRemarks });
  if (status === 'Cancelled') {
    notes = upsertNotes(notes, {
      Cancelled: String(fields.cancellationReason ?? fields.adminRemarks ?? '').trim() || 'Cancelled by Asset Management Office',
    });
  }

  const result: RepairResult | null =
    status === 'Completed'
      ? (fields.repairResult ?? normalizeRepairResult((repair as any).Repair_result) ?? 'Repairable')
      : normalizeRepairResult((repair as any).Repair_result);

  const costRaw = fields.repairCost;
  const costNumber =
    costRaw === undefined || costRaw === null || String(costRaw).trim() === ''
      ? Number((repair as any).Repair_Cost ?? 0)
      : Number(String(costRaw).replace(/[^0-9.\-]/g, '')) || 0;

  const update: Record<string, any> = {
    status,
    notes,
    Approve_by: actorLabel,
    Repair_Cost: Number.isFinite(costNumber) ? costNumber : 0,
    Repair_result: result,
    updated_at: now,
  };

  const { error: updateError } = await supabase
    .from('repairs')
    .update(update)
    .eq('Repair_id', repairId as any);
  if (updateError) throw updateError;

  // ── Asset lifecycle transition ──────────────────────────────────────────
  let assetStatus: string | null = null;
  const disposed = currentAssetKey === 'disposal' || currentAssetKey === 'disposed';
  // An asset that entered repair straight from a pullout goes back to Pullout
  // when the repair closes — it was never released from storage, so it must
  // not surface as Active (spec: pullout stays pullout until it is assigned).
  const fromPullout = repairCameFromPullout((repair as any).notes);

  if (!disposed) {
    if (status === 'Completed') {
      if (result === 'Repairable' || result === null) {
        assetStatus = fromPullout ? 'Pullout' : 'Active';
      } else {
        // Beyond Repair / For Replacement → the replacement process, not Active.
        assetStatus = 'For Replacement';
      }
    } else if (status === 'Cancelled') {
      // Cancelled → Active again, but never resurrect an asset that already
      // moved on to replacement or disposal — and a pullout asset stays pulled
      // out rather than being silently released.
      assetStatus =
        currentAssetKey === 'for replacement' || currentAssetKey === 'replacement'
          ? 'For Replacement'
          : fromPullout
            ? 'Pullout'
            : 'Active';
    } else {
      assetStatus = 'For Repair';
    }

    if (assetStatus) {
      const { error: assetError } = await supabase
        .from('assets')
        .update({ Lifecycle_Status: assetStatus, updated_at: now })
        .eq('id', assetId as any);
      if (assetError) throw assetError;
    }
  }

  await writeAudit({
    actorId,
    assetId,
    requestId,
    actionType: 'REPAIR',
    description: `Repair status updated to ${status} for ${assetLabel}`,
    notes: fields.adminRemarks || notes || `Repair status: ${status}`,
  });

  // Notify the requester (spec §13).
  const ownerId = (asset?.user_id ?? null) as string | number | null;
  const notifyId = await resolveRequesterId(requestId, ownerId);
  const base = `${assetLabel}`.trim();
  if (notifyId != null) {
    if (status === 'Completed' && fromPullout) {
      await createNotification({
        userId: notifyId,
        title: 'Repair Completed',
        message:
          result === 'Repairable' || result === null
            ? `Your ${base} has completed its repair and is back in the pullout storage. Assign it to a user from the Pullout page to release it.`
            : `Your ${base} could not be repaired (${result}) and has been sent to the replacement process.`,
        type: 'REPAIR',
        referenceId: repairId,
        referenceType: 'repair',
      });
    } else if (status === 'In Progress') {
      await createNotification({
        userId: notifyId,
        title: 'Repair In Progress',
        message: `Your repair request for ${base} is now being evaluated/repaired by the Asset Management Office.`,
        type: 'REPAIR',
        referenceId: repairId,
        referenceType: 'repair',
      });
    } else if (status === 'Completed') {
      await createNotification({
        userId: notifyId,
        title: 'Repair Completed',
        message:
          result === 'Repairable' || result === null
            ? `Your ${base} has completed its repair and is ready for pickup.`
            : `Your ${base} could not be repaired (${result}) and has been sent to the replacement process.`,
        type: 'REPAIR',
        referenceId: repairId,
        referenceType: 'repair',
      });
    } else if (status === 'Cancelled') {
      const reason = String(fields.cancellationReason ?? '').trim();
      await createNotification({
        userId: notifyId,
        title: 'Repair Cancelled',
        message: `The repair for your ${base} has been cancelled.${reason ? ` Reason: ${reason}.` : ''} The asset is now ${fromPullout ? 'back in pullout storage' : 'Active again'}.`,
        type: 'REPAIR',
        referenceId: repairId,
        referenceType: 'repair',
      });
    }
  }

  await syncRequestStatusFromRepairs(requestId);

  return { status, assetStatus };
}

async function resolveRequesterId(
  requestId: string | number | null,
  fallback: string | number | null,
): Promise<string | number | null> {
  if (requestId == null) return fallback;
  try {
    const { data } = await supabase.from('requests').select('user_id').eq('id', requestId as any).maybeSingle();
    if (data?.user_id != null) return data.user_id;
  } catch {
    /* fall through */
  }
  return fallback;
}

/**
 * Derive the parent request status from its per-asset repair rows, so the
 * Requests screen and the web's request list never disagree with the repairs.
 */
export async function syncRequestStatusFromRepairs(
  requestId: string | number | null,
): Promise<string | null> {
  if (requestId == null) return null;

  const { data } = await supabase.from('repairs').select('status').eq('Request_id', requestId as any);
  const statuses = ((data ?? []) as any[]).map((r) => normalizeRepairStatus(r.status));
  if (statuses.length === 0) return null;

  let derived = 'Pending';
  const completed = statuses.filter((s) => s === 'Completed').length;
  const cancelled = statuses.filter((s) => s === 'Cancelled').length;
  const inProgress = statuses.filter((s) => s === 'In Progress').length;

  if (completed + cancelled === statuses.length && completed > 0) derived = 'Completed';
  else if (cancelled === statuses.length) derived = 'Cancelled';
  else if (completed > 0 || inProgress > 0) derived = 'Approved';
  else derived = 'Pending';
  // NB: "In Progress" is deliberately never written to `requests` — the table's
  // check constraint only allows Pending/Approved/Rejected, and writing it used
  // to fail with `requests_status_check` (the ERROR seen in the repair screen).

  const { error } = await supabase
    .from('requests')
    .update({ status: derived, updated_at: new Date().toISOString() })
    .eq('id', requestId as any);
  if (error) throw error;
  return derived;
}

/**
 * Apply an admin decision taken on the Requests screen (request-level) to every
 * per-asset repair row of that request. Creates missing repair rows first so a
 * request submitted by the web still gets its repair records.
 */
export async function applyRequestStatusToRepairs(options: {
  requestId: string;
  status: 'Pending' | 'Approved' | 'In Progress' | 'Completed' | 'Cancelled' | 'Rejected';
  actorId?: string | number | null;
  actorLabel?: string;
  notes?: string;
}): Promise<RepairStatus | null> {
  const { requestId, status, actorId, actorLabel, notes } = options;

  const { data: request } = await supabase
    .from('requests')
    .select('id, asset_id, Note, user_id')
    .eq('id', requestId)
    .maybeSingle();

  let repairRows: any[] = [];
  const { data: existing } = await supabase
    .from('repairs')
    .select('Repair_id, Assets_id, status')
    .eq('Request_id', requestId);
  repairRows = (existing ?? []) as any[];

  if (repairRows.length === 0) {
    // Resolve the linked assets from `request_items` / the request itself.
    const assetIds: number[] = [];
    const push = (raw: any) => {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && !assetIds.includes(n)) assetIds.push(n);
    };
    push((request as any)?.asset_id);
    const { data: items } = await supabase.from('request_items').select('asset_id').eq('request_id', requestId);
    for (const item of ((items ?? []) as any[])) push(item.asset_id);

    if (assetIds.length === 0) return null;

    const now = new Date().toISOString();
    const { data: inserted } = await supabase
      .from('repairs')
      .insert(
        assetIds.map((assetId) => ({
          Assets_id: assetId,
          Request_id: requestId,
          Repair_Description: String((request as any)?.Note ?? 'Repair request'),
          Repair_Date: now,
          Approve_by: String(actorLabel ?? 'Admin'),
          Repair_Cost: 0,
          status: 'Pending',
          Repair_result: null,
          notes: String(notes ?? ''),
          created_at: now,
          updated_at: now,
        })),
      )
      .select('Repair_id, Assets_id, status');
    repairRows = (inserted ?? []) as any[];
  }

  const mapped = mapRequestStatusToRepairStatus(status);
  for (const row of repairRows) {
    await updateRepairStatus({
      repairId: row.Repair_id,
      status: mapped,
      actorId,
      actorLabel,
      fields: {
        adminRemarks: notes,
        cancellationReason: mapped === 'Cancelled' ? notes : undefined,
      },
    });
  }

  // updateRepairStatus already syncs the request, but a request with repairs
  // created here needs the requested status applied explicitly.
  await syncRequestStatusFromRepairs(requestId);
  return mapped;
}

/**
 * Spec §9/§10: send a repair to Replacement. Mirrors the web's
 * `/admin/replacements/create` so both clients write the same rows.
 */
export async function sendRepairToReplacement(options: {
  repairId: string | number;
  actorId?: string | number | null;
  actorLabel?: string;
  reason: string;
  replacementReason?: string;
}): Promise<{ replacementId: string | null }> {
  const reason = String(options.reason ?? '').trim();
  if (!reason) throw new Error('A reason is required so the user knows why the asset is being replaced.');

  const now = new Date().toISOString();
  const { data: repair, error } = await supabase
    .from('repairs')
    .select('Repair_id, Assets_id, Request_id, status, notes')
    .eq('Repair_id', options.repairId as any)
    .maybeSingle();
  if (error) throw error;
  if (!repair) throw new Error('Repair record not found');

  const assetId = (repair as any).Assets_id;
  const requestId = (repair as any).Request_id;

  const { data: asset } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, user_id')
    .eq('id', assetId as any)
    .maybeSingle();

  const actorLabel = String(options.actorLabel ?? 'Admin');

  const { data: inserted, error: insertError } = await supabase
    .from('replacements')
    .insert([
      {
        Request_id: requestId,
        old_assets_id: assetId,
        new_assets_id: assetId, // placeholder until the new asset is linked
        Approve_by: actorLabel,
        reason,
        replacement_reason: options.replacementReason ?? 'Beyond Repair',
        notes: `Created from repair request. Reason: ${reason}`,
        Replacement_Date: now,
        status: 'Approved',
        created_at: now,
        updated_at: now,
      },
    ])
    .select('Replacement_id')
    .single();
  if (insertError) throw insertError;

  await supabase
    .from('assets')
    .update({ Lifecycle_Status: 'For Replacement', updated_at: now })
    .eq('id', assetId as any);

  // The web marks the repair Cancelled; keep a completed repair completed so the
  // asset's repair history stays accurate, but always append the decision.
  const repairStatus = normalizeRepairStatus((repair as any).status);
  const notes = upsertNotes((repair as any).notes, { 'Sent to Replacement': reason });
  await supabase
    .from('repairs')
    .update({
      notes,
      ...(repairStatus === 'Completed' ? {} : { status: 'Cancelled' }),
      updated_at: now,
    })
    .eq('Repair_id', options.repairId as any);

  await writeAudit({
    actorId: options.actorId,
    assetId,
    requestId,
    actionType: 'REPLACEMENT',
    description: `Repair converted to replacement for ${asset?.Asset_name ?? 'Asset'} ${asset?.Asset_code ?? ''}`.trim(),
    notes: `Reason: ${reason}`,
  });

  const ownerId = await resolveRequesterId(requestId, (asset?.user_id ?? null) as any);
  if (ownerId != null) {
    await createNotification({
      userId: ownerId,
      title: 'Repair Converted to Replacement',
      message: `Your repair request for ${asset?.Asset_name ?? 'Asset'} (${asset?.Asset_code ?? ''}) cannot be repaired and has been sent for replacement. Reason: ${reason}. You will be notified again when a new asset is ready for pickup.`,
      type: 'REPLACEMENT',
      referenceId: (inserted as any)?.Replacement_id ?? options.repairId,
      referenceType: 'replacement',
    });
  }

  await syncRequestStatusFromRepairs(requestId);
  return { replacementId: String((inserted as any)?.Replacement_id ?? '') || null };
}

/**
 * Spec §9: send a repair to Disposal — mirrors the web's
 * `/admin/disposals/create`.
 */
export async function sendRepairToDisposal(options: {
  repairId: string | number;
  actorId?: string | number | null;
  actorLabel?: string;
  reason: string;
  disposalReason?: string;
}): Promise<{ disposalId: string | null }> {
  const reason = String(options.reason ?? '').trim();
  if (!reason) throw new Error('A reason is required so the user knows why the asset is being disposed.');

  const now = new Date().toISOString();
  const { data: repair, error } = await supabase
    .from('repairs')
    .select('Repair_id, Assets_id, Request_id, status, notes')
    .eq('Repair_id', options.repairId as any)
    .maybeSingle();
  if (error) throw error;
  if (!repair) throw new Error('Repair record not found');

  const assetId = (repair as any).Assets_id;
  const requestId = (repair as any).Request_id;

  const { data: asset } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, user_id, Lifecycle_Status')
    .eq('id', assetId as any)
    .maybeSingle();

  const currentStatus = String(asset?.Lifecycle_Status ?? '').toLowerCase();
  if (currentStatus === 'disposal' || currentStatus === 'disposed') {
    throw new Error('This asset is already disposed.');
  }

  const actorLabel = String(options.actorLabel ?? 'Admin');

  const { data: inserted, error: insertError } = await supabase
    .from('disposals')
    .insert([
      {
        Request_id: requestId,
        Asset_id: assetId,
        Approve_by: actorLabel,
        Description: reason,
        disposal_reason: options.disposalReason ?? 'Beyond Repair',
        disposal_date: now.slice(0, 10),
        notes: `Created from repair request. Reason: ${reason}`,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('Disposal_ID')
    .single();
  if (insertError) throw insertError;

  await supabase
    .from('assets')
    .update({ Lifecycle_Status: 'Disposal', updated_at: now })
    .eq('id', assetId as any);

  const repairStatus = normalizeRepairStatus((repair as any).status);
  const notes = upsertNotes((repair as any).notes, { 'Sent to Disposal': reason });
  await supabase
    .from('repairs')
    .update({
      notes,
      ...(repairStatus === 'Completed' ? {} : { status: 'Cancelled' }),
      updated_at: now,
    })
    .eq('Repair_id', options.repairId as any);

  await writeAudit({
    actorId: options.actorId,
    assetId,
    requestId,
    actionType: 'DISPOSAL',
    description: `Repair converted to disposal for ${asset?.Asset_name ?? 'Asset'} ${asset?.Asset_code ?? ''}`.trim(),
    notes: `Reason: ${reason}`,
  });

  const ownerId = await resolveRequesterId(requestId, (asset?.user_id ?? null) as any);
  if (ownerId != null) {
    await createNotification({
      userId: ownerId,
      title: 'Repair Converted to Disposal',
      message: `Your repair request for ${asset?.Asset_name ?? 'Asset'} (${asset?.Asset_code ?? ''}) could not be repaired and has been processed for disposal. Reason: ${reason}.`,
      type: 'DISPOSAL',
      referenceId: (inserted as any)?.Disposal_ID ?? options.repairId,
      referenceType: 'disposal',
    });
  }

  await syncRequestStatusFromRepairs(requestId);
  return { disposalId: String((inserted as any)?.Disposal_ID ?? '') || null };
}

/** Repair history for one asset, oldest → newest (spec §14). */
export async function fetchAssetRepairHistory(assetId: string | number): Promise<RepairRecord[]> {
  const records = await fetchRepairRecords({ assetId });
  return records
    .slice()
    .sort((a, b) => Date.parse(a.reportedDate || a.createdAt || '') - Date.parse(b.reportedDate || b.createdAt || ''));
}

export const repairDateLabel = (raw: string | undefined | null): string => {
  if (!raw) return '—';
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? String(raw) : new Date(parsed).toLocaleDateString();
};

export const repairToday = todayIso;
