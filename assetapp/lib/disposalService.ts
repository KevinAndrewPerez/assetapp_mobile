import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { createNotification, notifyAdmins } from './notificationService';
import { readNote, upsertNotes } from './noteUtils';

/**
 * Disposal Management (NU TRACE mobile spec).
 *
 * A disposal is never automatic: an asset must be evaluated by the Asset
 * Management Office first. The transaction is tracked through
 *   Pending → Approved → Completed   (or Pending → Cancelled)
 * and the asset is flagged `Disposal` so it can never be assigned again — but
 * the asset row itself is never deleted, so its history survives. Cancelling a
 * disposal restores the asset's *previous* lifecycle status (a pulled-out asset
 * goes back to Pullout, not Active).
 *
 * The `disposals` table has no status/method columns, so that workflow data is
 * stored in `notes` in the same `Key: value | Key: value` format the web app
 * renders as plain text.
 */

export type DisposalStatus = 'Pending' | 'Approved' | 'Completed' | 'Cancelled';

export const DISPOSAL_STATUSES: DisposalStatus[] = ['Pending', 'Approved', 'Completed', 'Cancelled'];

/** Values the web/live database already uses for `disposal_reason`. */
export const DISPOSAL_REASON_CATEGORIES = [
  'Beyond Repair',
  'Replace',
  'Obsolete',
  'Lost',
  'Damage',
  'End of Lifespan',
] as const;
export type DisposalReasonCategory = (typeof DISPOSAL_REASON_CATEGORIES)[number];

export const DISPOSAL_METHODS = [
  'Scrapped',
  'Sold',
  'Donated',
  'Returned to Supplier',
  'Transferred',
  'Destroyed',
  'Other',
] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

/** Where the disposal came from (spec §2). */
export type DisposalOrigin = 'Checking' | 'Repair' | 'Replacement' | 'Pullout' | 'Active' | 'Manual';

export type DisposalRecord = {
  disposalId: string;
  requestId: string | null;
  requestRef: string | null;
  assetId: string | null;
  assetCode: string;
  assetName: string;
  category?: string;
  condition?: string;
  serialNumber?: string;
  location?: string;
  purchasePrice?: string;
  lifecycleStatus?: string;
  department: string;
  requesterName: string;
  approvedBy: string;
  /** Short human reason (the free text entered by the admin/requester). */
  reason: string;
  reasonCategory: string;
  method: string;
  status: DisposalStatus;
  origin: string;
  previousLifecycleStatus: string;
  previousCustodian: string;
  disposalDate: string;
  remarks: string;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BlockedDisposalAsset = {
  assetId: string | number;
  name: string;
  code: string;
  status: string;
  reason: string;
};

export type DisposalAdminFields = {
  method?: string;
  disposalDate?: string;
  reasonCategory?: string;
  reason?: string;
  remarks?: string;
  cancellationReason?: string;
};

// ─────────────────────────────── helpers ─────────────────────────────────────

export const normalizeDisposalStatus = (raw: unknown): DisposalStatus => {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'Completed'; // legacy rows (web-created) are already done
  if (value.includes('cancel') || value.includes('reject')) return 'Cancelled';
  if (value.includes('complete') || value.includes('dispos')) return 'Completed';
  if (value.includes('approv')) return 'Approved';
  return 'Pending';
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function disposalStatusMessage(status: DisposalStatus): string {
  switch (status) {
    case 'Pending':
      return 'The asset is currently undergoing disposal evaluation/approval.';
    case 'Approved':
      return 'Disposal approved — the asset is authorized for disposal and can no longer be assigned.';
    case 'Completed':
      return 'Disposal completed. The asset is Disposed and kept in the system for history and auditing.';
    case 'Cancelled':
      return 'Disposal cancelled. The record is retained and the asset returned to its previous lifecycle status.';
    default:
      return '';
  }
}

// ─────────────────────────────── read side ───────────────────────────────────

export async function fetchDisposalRecords(options?: {
  status?: DisposalStatus | 'All';
  assetId?: string | number | null;
  requestId?: string | number | null;
}): Promise<DisposalRecord[]> {
  let query = supabase
    .from('disposals')
    .select('*')
    .order('disposal_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (options?.assetId != null) query = query.eq('Asset_id', options.assetId as any);
  if (options?.requestId != null) query = query.eq('Request_id', options.requestId as any);

  const { data: disposalRows, error } = await query;
  if (error) throw error;

  const rows = (Array.isArray(disposalRows) ? disposalRows : []) as any[];
  if (rows.length === 0) return [];

  const uniq = (values: any[]) => {
    const out: number[] = [];
    for (const raw of values) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
  };

  const assetIds = uniq(rows.map((r) => r.Asset_id));
  const requestIds = uniq(rows.map((r) => r.Request_id));

  const [assetsRes, requestsRes] = await Promise.all([
    assetIds.length
      ? supabase
          .from('assets')
          .select(
            'id, Asset_code, Asset_name, Category, Condition, serial_Number, asset_location, purchase_Price, Lifecycle_Status, user_id',
          )
          .in('id', assetIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
    requestIds.length
      ? supabase.from('requests').select('id, user_id, request_type, status, Note').in('id', requestIds)
      : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);

  const assetsById = new Map<string, any>(((assetsRes.data ?? []) as any[]).map((a) => [String(a.id), a]));
  const requestsById = new Map<string, any>(((requestsRes.data ?? []) as any[]).map((r) => [String(r.id), r]));

  const userIds = uniq([
    ...((requestsRes.data ?? []) as any[]).map((r) => r.user_id),
    ...((assetsRes.data ?? []) as any[]).map((a) => a.user_id),
  ]);

  const usersById = new Map<string, any>();
  if (userIds.length) {
    const { data: userRows } = await supabase
      .from('users')
      .select(
        'id, email, role, department_id, employee_numbers (Full_Name), departments:department_id (Name)',
      )
      .in('id', userIds as any);
    for (const user of (userRows ?? []) as any[]) usersById.set(String(user.id), user);
  }

  const nameOf = (user: any): string => {
    const employee = Array.isArray(user?.employee_numbers) ? user.employee_numbers[0] : user?.employee_numbers;
    return String(employee?.Full_Name ?? user?.email ?? '');
  };
  const deptOf = (user: any): string => {
    const department = Array.isArray(user?.departments) ? user.departments[0] : user?.departments;
    return String(department?.Name ?? user?.department_id ?? '');
  };

  const records = rows.map((row: any) => {
    const asset = assetsById.get(String(row.Asset_id)) ?? {};
    const request = requestsById.get(String(row.Request_id)) ?? {};
    const requester = usersById.get(String(request.user_id));
    const owner = usersById.get(String(asset.user_id));

    const notes = String(row.notes ?? '');
    const storedStatus = readNote(notes, 'Status');
    const reasonCategory = readNote(notes, 'Reason Category') || String(row.disposal_reason ?? '');

    return {
      disposalId: String(row.Disposal_ID ?? ''),
      requestId: row.Request_id === null || row.Request_id === undefined ? null : String(row.Request_id),
      requestRef: row.Request_id === null || row.Request_id === undefined ? null : `REQ-${String(row.Request_id)}`,
      assetId: row.Asset_id === null || row.Asset_id === undefined ? null : String(row.Asset_id),
      assetCode: String(asset.Asset_code ?? 'N/A'),
      assetName: String(asset.Asset_name ?? row.Description ?? 'Unknown Asset'),
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
      lifecycleStatus: asset.Lifecycle_Status ? String(asset.Lifecycle_Status) : undefined,
      department: deptOf(requester) || deptOf(owner) || 'N/A',
      requesterName: nameOf(requester) || nameOf(owner) || 'Unknown',
      approvedBy: String(row.Approve_by ?? ''),
      reason: String(row.Description ?? ''),
      reasonCategory,
      method: readNote(notes, 'Disposal Method'),
      status: normalizeDisposalStatus(storedStatus),
      origin: readNote(notes, 'Origin'),
      previousLifecycleStatus: readNote(notes, 'Previous Status'),
      previousCustodian: readNote(notes, 'Previous Custodian') || nameOf(owner),
      disposalDate: String(row.disposal_date ?? ''),
      remarks: readNote(notes, 'Remarks'),
      notes,
      createdAt: row.created_at ? String(row.created_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    } as DisposalRecord;
  });

  if (options?.status && options.status !== 'All') {
    return records.filter((record) => record.status === options.status);
  }
  return records;
}

// ───────────────────────────── validation ────────────────────────────────────

/**
 * Spec §1/§7/§8: an asset already disposed can't be disposed again, and one
 * open disposal per asset is enough.
 */
export async function validateAssetsForDisposal(assetIds: (string | number)[]): Promise<{
  ok: Array<{ id: string; name: string; code: string; status: string; userId: string | number | null }>;
  blocked: BlockedDisposalAsset[];
}> {
  const ok: Array<{ id: string; name: string; code: string; status: string; userId: string | number | null }> = [];
  const blocked: BlockedDisposalAsset[] = [];
  if (assetIds.length === 0) return { ok, blocked };

  const { data: assetRows, error } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, Lifecycle_Status, user_id')
    .in('id', assetIds as any);
  if (error) throw error;

  const assetsById = new Map<string, any>(((assetRows ?? []) as any[]).map((a) => [String(a.id), a]));

  const openDisposalAssetIds = new Set<string>();
  const { data: openRows } = await supabase
    .from('disposals')
    .select('Asset_id, notes')
    .in('Asset_id', assetIds as any);
  for (const row of ((openRows ?? []) as any[])) {
    const status = normalizeDisposalStatus(readNote(row.notes, 'Status'));
    if (status === 'Pending' || status === 'Approved') openDisposalAssetIds.add(String(row.Asset_id));
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

    const label = {
      assetId: asset.id,
      name: String(asset.Asset_name ?? 'Asset'),
      code: String(asset.Asset_code ?? ''),
    };
    const status = String(asset.Lifecycle_Status ?? '').trim();
    const statusKey = status.toLowerCase();

    if (statusKey === 'disposal' || statusKey === 'disposed') {
      blocked.push({ ...label, status, reason: 'This asset is already disposed.' });
      continue;
    }
    if (openDisposalAssetIds.has(String(asset.id))) {
      blocked.push({
        ...label,
        status,
        reason: 'This asset already has a disposal record that is still Pending or Approved.',
      });
      continue;
    }

    ok.push({
      id: String(asset.id),
      name: label.name,
      code: label.code,
      status: status || 'Active',
      userId: asset.user_id ?? null,
    });
  }

  return { ok, blocked };
}

// ───────────────────────────── initiation ────────────────────────────────────

async function custodianLabel(userId: string | number | null): Promise<string> {
  if (userId === null || userId === undefined || userId === '') return 'Unassigned';
  try {
    const { data } = await supabase
      .from('users')
      .select('email, employee_numbers (Full_Name)')
      .eq('id', userId as any)
      .maybeSingle();
    const employee = Array.isArray((data as any)?.employee_numbers)
      ? (data as any).employee_numbers[0]
      : (data as any)?.employee_numbers;
    return String(employee?.Full_Name ?? (data as any)?.email ?? 'Unassigned');
  } catch {
    return 'Unassigned';
  }
}

/**
 * Create the disposal record(s) and flag the asset(s). The asset stays in the
 * database (spec: NU TRACE never deletes a disposed asset) but can no longer be
 * assigned. Creating the record is the "Asset Management Office decided to
 * evaluate this asset for disposal" step — approval/completion follow.
 */
export async function initiateDisposal(options: {
  assetIds: (string | number)[];
  reason: string;
  reasonCategory?: string;
  method?: string;
  notes?: string;
  requestId?: string | number | null;
  origin?: DisposalOrigin;
  actorId?: string | number | null;
  actorLabel?: string;
  /** Defaults to Pending — approval flows can create the row already approved. */
  initialStatus?: DisposalStatus;
}): Promise<{ disposalIds: string[]; initiated: number; blocked: BlockedDisposalAsset[] }> {
  const reason = String(options.reason ?? '').trim();
  const category = String(options.reasonCategory ?? 'Beyond Repair').trim() || 'Beyond Repair';
  const method = String(options.method ?? 'Scrapped').trim();
  const origin = options.origin ?? 'Manual';
  const status = options.initialStatus ?? 'Pending';
  const actorLabel = String(options.actorLabel ?? 'Admin');
  const now = new Date().toISOString();

  const { ok, blocked } = await validateAssetsForDisposal(options.assetIds);
  if (ok.length === 0) {
    const reasonText = blocked.map((b) => `• ${b.name} (${b.code}): ${b.reason}`).join('\n');
    throw new Error(`No asset can be recorded for disposal.\n${reasonText}`);
  }

  const created: string[] = [];

  for (const asset of ok) {
    const custodian = await custodianLabel(asset.userId);
    const notes = upsertNotes('', {
      Status: status,
      Origin: origin,
      'Reason Category': category,
      'Disposal Method': method,
      'Previous Status': asset.status,
      'Previous Custodian': custodian,
      Remarks: String(options.notes ?? '').trim(),
    });

    const { data: inserted, error } = await supabase
      .from('disposals')
      .insert([
        {
          Asset_id: Number(asset.id),
          Request_id: options.requestId ?? null,
          Approve_by: actorLabel,
          Description: reason || `${category} — disposal`,
          disposal_reason: category,
          disposal_date: now.slice(0, 10),
          notes,
          created_at: now,
          updated_at: now,
        },
      ])
      .select('Disposal_ID')
      .single();
    if (error) throw error;
    created.push(String((inserted as any)?.Disposal_ID ?? ''));

    const { error: assetError } = await supabase
      .from('assets')
      .update({ Lifecycle_Status: 'Disposal', updated_at: now })
      .eq('id', asset.id as any);
    if (assetError) throw assetError;

    await writeAudit({
      actorId: options.actorId,
      assetId: asset.id,
      requestId: options.requestId ?? null,
      actionType: 'DISPOSAL',
      description: `Disposal ${status.toLowerCase()} for ${asset.name} ${asset.code}`.trim(),
      notes: `${origin} → disposal. Reason (${category}): ${reason || 'not specified'}. Previous status: ${asset.status}.`,
    });

    const label = `${asset.name} (${asset.code})`;
    if (asset.userId != null) {
      await createNotification({
        userId: asset.userId,
        title: status === 'Approved' ? 'Disposal Approved' : 'Disposal Initiated',
        message:
          status === 'Approved'
            ? `The disposal of ${label} has been approved. It can no longer be assigned, but its record stays in NU TRACE for history.`
            : `${label} has been recorded for disposal evaluation. Reason: ${reason || category}.`,
        type: 'DISPOSAL',
        referenceId: (inserted as any)?.Disposal_ID ?? null,
        referenceType: 'disposal',
      });
    }
  }

  await notifyAdmins({
    title: `Disposal ${status} — ${ok.length} asset(s)`,
    message: `${actorLabel} recorded ${ok.length} asset(s) for disposal (${category}).`,
    type: 'DISPOSAL',
    referenceId: created[0] ?? null,
    referenceType: 'disposal',
  });

  return { disposalIds: created, initiated: ok.length, blocked };
}

// ───────────────────────── review / approve / complete / cancel ──────────────

/**
 * Move a disposal transaction through its review workflow, updating the asset
 * lifecycle, the audit trail and the affected user's notifications.
 */
export async function updateDisposalStatus(options: {
  disposalId: string | number;
  status: DisposalStatus;
  actorId?: string | number | null;
  actorLabel?: string;
  fields?: DisposalAdminFields;
}): Promise<{ status: DisposalStatus; assetStatus: string | null }> {
  const { disposalId, status, actorId } = options;
  const fields = options.fields ?? {};
  const actorLabel = String(options.actorLabel ?? 'Admin');
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const { data: disposal, error } = await supabase
    .from('disposals')
    .select('Disposal_ID, Asset_id, Request_id, notes, Description, disposal_reason, disposal_date')
    .eq('Disposal_ID', disposalId as any)
    .maybeSingle();
  if (error) throw error;
  if (!disposal) throw new Error('Disposal record not found');

  const assetId = (disposal as any).Asset_id as number | null;
  const requestId = (disposal as any).Request_id as number | null;
  const previousNotes = String((disposal as any).notes ?? '');
  const previousStatus = readNote(previousNotes, 'Previous Status');

  const { data: asset } = assetId
    ? await supabase
        .from('assets')
        .select('id, Asset_code, Asset_name, Lifecycle_Status, user_id')
        .eq('id', assetId as any)
        .maybeSingle()
    : { data: null as any };

  const assetLabel = `${asset?.Asset_name ?? 'Asset'} ${asset?.Asset_code ?? ''}`.trim();

  let notes = upsertNotes(previousNotes, { Status: status });

  if (status === 'Approved') {
    notes = upsertNotes(notes, { 'Approved On': today });
  } else if (status === 'Completed') {
    if (fields.method) notes = upsertNotes(notes, { 'Disposal Method': fields.method });
    notes = upsertNotes(notes, { 'Completed On': today });
  } else if (status === 'Cancelled') {
    notes = upsertNotes(notes, {
      Cancelled: String(fields.cancellationReason ?? '').trim() || 'Cancelled by Asset Management Office',
    });
  }

  if (fields.remarks) notes = upsertNotes(notes, { Remarks: fields.remarks });
  if (fields.reasonCategory) notes = upsertNotes(notes, { 'Reason Category': fields.reasonCategory });

  const update: Record<string, any> = {
    notes,
    Approve_by: actorLabel,
    updated_at: now,
  };
  if (fields.reason) update.Description = fields.reason;
  if (fields.reasonCategory) update.disposal_reason = fields.reasonCategory;
  if (status === 'Completed') update.disposal_date = fields.disposalDate || today;
  else if (fields.disposalDate) update.disposal_date = fields.disposalDate;

  const { error: updateError } = await supabase
    .from('disposals')
    .update(update)
    .eq('Disposal_ID', disposalId as any);
  if (updateError) throw updateError;

  // ── Asset lifecycle ─────────────────────────────────────────────────────
  let assetStatus: string | null = null;
  if (assetId) {
    if (status === 'Approved' || status === 'Completed') {
      assetStatus = 'Disposal';
    } else if (status === 'Cancelled') {
      // Restore the status the asset had before disposal. A pulled-out asset
      // stays Pullout (spec §9) because that *was* its previous status.
      const restore = previousStatus.trim();
      assetStatus = restore && restore.toLowerCase() !== 'disposal' ? restore : 'Active';
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
    actionType: 'DISPOSAL',
    description: `Disposal ${status.toLowerCase()} for ${assetLabel || `record #${disposalId}`}`,
    notes:
      status === 'Cancelled'
        ? `Reason: ${String(fields.cancellationReason ?? 'not specified')}. Restored to ${assetStatus ?? 'previous status'}.`
        : `${String(fields.remarks ?? '').trim() || `Status: ${status}`}`,
  });

  const notifyId = (asset?.user_id ?? null) as string | number | null;
  if (notifyId != null) {
    if (status === 'Approved') {
      await createNotification({
        userId: notifyId,
        title: 'Disposal Approved',
        message: `The disposal of ${assetLabel || 'your asset'} has been approved.`,
        type: 'DISPOSAL',
        referenceId: disposalId,
        referenceType: 'disposal',
      });
    } else if (status === 'Completed') {
      await createNotification({
        userId: notifyId,
        title: 'Disposal Completed',
        message: `${assetLabel || 'Your asset'} has been disposed and is no longer under your active accountability. Its record remains in NU TRACE for history.`,
        type: 'DISPOSAL',
        referenceId: disposalId,
        referenceType: 'disposal',
      });
    } else if (status === 'Cancelled') {
      const reasonText = String(fields.cancellationReason ?? '').trim();
      await createNotification({
        userId: notifyId,
        title: 'Disposal Cancelled',
        message: `The disposal of ${assetLabel || 'your asset'} was cancelled.${reasonText ? ` Reason: ${reasonText}.` : ''} The asset returned to ${assetStatus ?? 'its previous status'}.`,
        type: 'DISPOSAL',
        referenceId: disposalId,
        referenceType: 'disposal',
      });
    }
  }

  if (requestId) await syncRequestStatusFromDisposals(requestId);

  return { status, assetStatus };
}

/**
 * Derive the parent request status from its disposal rows so the Requests
 * screen and the web never disagree with the disposal transactions.
 */
export async function syncRequestStatusFromDisposals(
  requestId: string | number | null,
): Promise<string | null> {
  if (requestId == null) return null;

  const { data } = await supabase
    .from('disposals')
    .select('notes')
    .eq('Request_id', requestId as any);
  const statuses = ((data ?? []) as any[]).map((row) =>
    normalizeDisposalStatus(readNote(row.notes, 'Status')),
  );
  if (statuses.length === 0) return null;

  const completed = statuses.filter((s) => s === 'Completed').length;
  const cancelled = statuses.filter((s) => s === 'Cancelled').length;
  const approved = statuses.filter((s) => s === 'Approved').length;

  let derived = 'Pending';
  if (completed + cancelled === statuses.length && completed > 0) derived = 'Completed';
  else if (cancelled === statuses.length) derived = 'Cancelled';
  else if (completed > 0 || approved > 0) derived = 'Approved';

  const { error } = await supabase
    .from('requests')
    .update({ status: derived, updated_at: new Date().toISOString() })
    .eq('id', requestId as any);
  if (error) throw error;
  return derived;
}

/**
 * Apply an admin decision taken on the Requests screen to the request's disposal
 * transactions (creating them when the request came from the web).
 */
export async function applyRequestStatusToDisposals(options: {
  requestId: string;
  status: 'Pending' | 'Approved' | 'In Progress' | 'Completed' | 'Cancelled' | 'Rejected';
  actorId?: string | number | null;
  actorLabel?: string;
  notes?: string;
}): Promise<DisposalStatus | null> {
  const { requestId, status, actorId, actorLabel, notes } = options;

  const { data: request } = await supabase
    .from('requests')
    .select('id, asset_id, Note, user_id, request_type')
    .eq('id', requestId)
    .maybeSingle();

  const { data: existingRows } = await supabase
    .from('disposals')
    .select('Disposal_ID, Asset_id, notes')
    .eq('Request_id', requestId);
  let rows = (existingRows ?? []) as any[];

  const mapped: DisposalStatus =
    status === 'Completed'
      ? 'Completed'
      : status === 'Cancelled' || status === 'Rejected'
        ? 'Cancelled'
        : status === 'Approved' || status === 'In Progress'
          ? 'Approved'
          : 'Pending';

  if (rows.length === 0) {
    if (mapped === 'Pending') return null;

    const assetIds: number[] = [];
    const push = (raw: any) => {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && !assetIds.includes(n)) assetIds.push(n);
    };
    push((request as any)?.asset_id);
    const { data: items } = await supabase
      .from('request_items')
      .select('asset_id')
      .eq('request_id', requestId);
    for (const item of ((items ?? []) as any[])) push(item.asset_id);
    if (assetIds.length === 0) return null;

    await initiateDisposal({
      assetIds,
      reason: String((request as any)?.Note ?? 'Approved disposal request'),
      requestId,
      origin: 'Manual',
      actorId,
      actorLabel,
      notes,
      reasonCategory: 'Obsolete',
      method: 'Scrapped',
      initialStatus: mapped,
    });

    await syncRequestStatusFromDisposals(requestId);
    return mapped;
  }

  for (const row of rows) {
    await updateDisposalStatus({
      disposalId: row.Disposal_ID,
      status: mapped,
      actorId,
      actorLabel,
      fields: {
        remarks: notes,
        cancellationReason: mapped === 'Cancelled' ? notes : undefined,
      },
    });
  }

  await syncRequestStatusFromDisposals(requestId);
  return mapped;
}

/** Disposal history for one asset, oldest → newest. */
export async function fetchAssetDisposalHistory(assetId: string | number): Promise<DisposalRecord[]> {
  const records = await fetchDisposalRecords({ assetId });
  return records
    .slice()
    .sort((a, b) => Date.parse(a.disposalDate || a.createdAt || '') - Date.parse(b.disposalDate || b.createdAt || ''));
}
