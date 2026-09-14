import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { notifyAdmins } from './notificationService';
import { resolveActingUserLabel } from './actorService';
import { NOTE_SEP } from './noteUtils';
import { StoredUser, updateRequestStatus } from './userService';

export type PulloutDecision = 'approved' | 'rejected' | 'cancelled';

/** What the office can do with a pulled-out asset (mirrors the web's Resolve Pullout). */
export type PulloutResolveAction = 'assign' | 'repair';

export type PulloutItem = {
  itemId: string | number;
  assetId: string | number;
  code: string;
  name: string;
  lifecycleStatus: string;
  custodian: string;
};

export type PulloutRecord = {
  pulloutId: string | number;
  requestId: string | number | null;
  status: string;
  description: string;
  notes: string;
  pulloutDate: string | null;
  destination: string | null;
  expectedReturnDate: string | null;
  approvedBy: string | null;
  requestedBy: string;
  createdAt: string | null;
  items: PulloutItem[];
};

/** Statuses that still "hold" an asset, mirroring the web's active-pullout rule. */
const ACTIVE_PULLOUT_STATUSES = ['pending', 'approved'];

const nowIso = () => new Date().toISOString();
const todayIso = () => nowIso().slice(0, 10);

const asNumericIds = (values: (string | number)[]): number[] => {
  const out: number[] = [];
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
};

const firstOf = (value: any): any => (Array.isArray(value) ? value?.[0] : value);

const resolveName = (user: any): string =>
  String(firstOf(user?.employee_numbers)?.Full_Name ?? user?.full_name ?? '');

const normalizeStatus = (raw: any, requestStatus?: any): string => {
  const value = String(raw ?? requestStatus ?? '').trim().toLowerCase();
  if (!value) return 'pending';
  if (value.includes('approv')) return 'approved';
  if (value.includes('reject')) return 'rejected';
  if (value.includes('cancel')) return 'cancelled';
  if (value.includes('complete')) return 'completed';
  if (value.includes('pend')) return 'pending';
  return value;
};

/**
 * Submit a pullout request for one asset (single) or many (bulk).
 *
 * The request goes to the Asset Management Office as `Pending`; the assets are
 * grouped under ONE pullout transaction (`pullouts` header + one
 * `pullout_items` row per asset) so bulk processing stays convenient while each
 * asset keeps its own identity, status and history.
 */
export async function submitPulloutRequest(options: {
  user: StoredUser;
  assetIds: (string | number)[];
  reason: string;
  destination?: string | null;
  expectedReturnDate?: string | null;
}): Promise<{ requestId: string | number; pulloutId: string | number | null; assetCount: number }> {
  const { user } = options;
  const reason = String(options.reason ?? '').trim();
  const assetIds = asNumericIds(options.assetIds);
  if (assetIds.length === 0) {
    throw new Error('Select at least one asset to pull out.');
  }

  const userId = user?.id ?? null;
  if (!userId) throw new Error('Current user is missing ID');

  const now = nowIso();
  const dateOnly = todayIso();

  // 1. The request itself — reviewed by the Asset Management Office.
  const { data: request, error: requestErr } = await supabase
    .from('requests')
    .insert([
      {
        user_id: userId,
        asset_id: assetIds[0],
        request_type: 'Pullout',
        Note: reason || 'Pullout request',
        status: 'Pending',
        created_at: now,
        updated_at: now,
      },
    ])
    .select('id')
    .single();
  if (requestErr) throw requestErr;
  const requestId = (request as any)?.id;
  if (requestId == null) throw new Error('Failed to create the pullout request.');

  // 2. Link every asset to the request individually.
  const { error: requestItemsErr } = await supabase.from('request_items').insert(
    assetIds.map((assetId) => ({
      request_id: requestId,
      asset_id: assetId,
      created_at: now,
      updated_at: now,
    })),
  );
  if (requestItemsErr) throw requestItemsErr;

  // 3. One pullout transaction grouping all the assets.
  const { data: header, error: headerErr } = await supabase
    .from('pullouts')
    .insert([
      {
        request_id: requestId,
        asset_id: assetIds[0],
        Approve_by: null,
        Description: reason || 'Pullout request',
        notes: reason || null,
        pullout_date: dateOnly,
        destination: options.destination ?? null,
        expected_return_date: options.expectedReturnDate ?? null,
        status: 'pending',
        created_at: now,
        updated_at: now,
      },
    ])
    .select('id')
    .single();
  if (headerErr) throw headerErr;
  const pulloutId = (header as any)?.id ?? null;

  // 4. ...but a separate item row per asset, so histories never merge.
  if (pulloutId != null) {
    const { error: itemsErr } = await supabase.from('pullout_items').insert(
      assetIds.map((assetId) => ({
        pullout_id: pulloutId,
        asset_id: assetId,
        created_at: now,
        updated_at: now,
      })),
    );
    if (itemsErr) throw itemsErr;
  }

  // 5. Audit every asset that was submitted.
  for (const assetId of assetIds) {
    await writeAudit({
      actorId: userId,
      assetId,
      requestId,
      actionType: 'PULLOUT',
      description: `Pullout request submitted (${assetIds.length > 1 ? 'bulk' : 'single'})`,
      notes: reason || 'Pullout request submitted',
    });
  }

  // 6. Tell the Asset Management Office — the decision itself is taken on the
  // Requests screen, which is the only place that approves a request.
  await notifyAdmins({
    title: `New Pullout Request — REQ-${requestId}`,
    message: `${String(user.full_name ?? user.email ?? 'A user')} requested the pullout of ${
      assetIds.length
    } asset${assetIds.length > 1 ? 's' : ''}. Reason: ${reason || 'not specified'}`,
    type: 'PULLOUT',
    referenceId: requestId,
    referenceType: 'request',
  });

  return { requestId, pulloutId, assetCount: assetIds.length };
}

/**
 * Every pullout transaction with its assets. Legacy rows that predate
 * `pullout_items` fall back to their single `asset_id`.
 */
export async function fetchPulloutRecords(): Promise<PulloutRecord[]> {
  const { data, error } = await supabase
    .from('pullouts')
    .select(
      `
      id, request_id, asset_id, status, Description, notes, pullout_date,
      destination, expected_return_date, Approve_by, created_at,
      pullout_items(id, asset_id),
      requests(id, status, request_type, Note, users:user_id(employee_numbers("Full_Name")))
    `,
    )
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows: any[] = data ?? [];

  // Collect every referenced asset id (items + legacy header asset_id).
  const wanted: number[] = [];
  const want = (raw: any) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && !wanted.includes(n)) wanted.push(n);
  };
  rows.forEach((row) => {
    (Array.isArray(row.pullout_items) ? row.pullout_items : []).forEach((it: any) => want(it?.asset_id));
    want(row.asset_id);
  });

  const assetsById = new Map<string, any>();
  if (wanted.length > 0) {
    const { data: assets, error: assetErr } = await supabase
      .from('assets')
      .select('id, Asset_code, Asset_name, Lifecycle_Status, users:user_id(employee_numbers("Full_Name"))')
      .in('id', wanted);
    if (assetErr) throw assetErr;
    (assets ?? []).forEach((a: any) => {
      if (a?.id != null) assetsById.set(String(a.id), a);
    });
  }

  const toItem = (assetId: any, itemId: any): PulloutItem | null => {
    const asset = assetsById.get(String(assetId));
    if (!asset) {
      return assetId == null
        ? null
        : { itemId: itemId ?? assetId, assetId, code: '', name: `Asset #${assetId}`, lifecycleStatus: '', custodian: '' };
    }
    return {
      itemId: itemId ?? asset.id,
      assetId: asset.id,
      code: String(asset.Asset_code ?? ''),
      name: String(asset.Asset_name ?? 'Unknown Asset'),
      lifecycleStatus: String(asset.Lifecycle_Status ?? ''),
      custodian: resolveName(asset.users) || 'Unassigned',
    };
  };

  return rows.map((row) => {
    const rawItems = Array.isArray(row.pullout_items) ? row.pullout_items : [];
    let items = rawItems
      .map((it: any) => toItem(it?.asset_id, it?.id))
      .filter((it: PulloutItem | null): it is PulloutItem => it !== null);

    // Legacy transaction with no item rows.
    if (items.length === 0 && row.asset_id != null) {
      const legacy = toItem(row.asset_id, row.id);
      items = legacy ? [legacy] : [];
    }

    const request = firstOf(row.requests);

    return {
      pulloutId: row.id,
      requestId: row.request_id ?? request?.id ?? null,
      status: normalizeStatus(row.status, request?.status),
      description: String(row.Description ?? request?.Note ?? ''),
      notes: String(row.notes ?? ''),
      pulloutDate: row.pullout_date ?? null,
      destination: row.destination ?? null,
      expectedReturnDate: row.expected_return_date ?? null,
      approvedBy: row.Approve_by ?? null,
      requestedBy: resolveName(request?.users) || String(row.Approve_by ?? '') || 'Unknown',
      createdAt: row.created_at ?? null,
      items,
    };
  });
}

/** Assets already inside a pending/approved pullout — these cannot be re-selected. */
export async function fetchBlockedPulloutAssetIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('pullout_items')
    .select('asset_id, pullouts(status)');
  if (error) {
    console.warn('Could not load active pullout items:', error.message);
    return new Set();
  }

  const blocked = new Set<string>();
  (data ?? []).forEach((row: any) => {
    const status = normalizeStatus(firstOf(row.pullouts)?.status);
    if (ACTIVE_PULLOUT_STATUSES.includes(status) && row.asset_id != null) {
      blocked.add(String(row.asset_id));
    }
  });
  return blocked;
}

/** Count of assets currently in the Pullout lifecycle (web parity). */
export async function fetchPulledOutAssetCount(): Promise<number> {
  const { count, error } = await supabase
    .from('assets')
    .select('id', { count: 'exact', head: true })
    .eq('Lifecycle_Status', 'Pullout');
  if (error) throw error;
  return count ?? 0;
}

/**
 * Admin decision on a pullout transaction. Requests-backed transactions reuse
 * the shared request pipeline (asset → Pullout, transaction sync, audit log);
 * legacy rows with no request are updated directly.
 */
export async function decidePullout(options: {
  record: Pick<PulloutRecord, 'pulloutId' | 'requestId' | 'items'>;
  decision: PulloutDecision;
  actorId?: string | number | null;
}): Promise<void> {
  const { record, decision, actorId } = options;
  const now = nowIso();

  if (record.requestId != null) {
    const statusMap: Record<PulloutDecision, 'Approved' | 'Rejected' | 'Cancelled'> = {
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
    };
    await updateRequestStatus(String(record.requestId), statusMap[decision], actorId ?? 'Admin');
    return;
  }

  const { error } = await supabase
    .from('pullouts')
    .update({ status: decision, updated_at: now })
    .eq('id', record.pulloutId as any);
  if (error) throw error;

  const assetIds = record.items
    .map((item) => Number(item.assetId))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (decision === 'approved' && assetIds.length > 0) {
    const { error: assetErr } = await supabase
      .from('assets')
      .update({ Lifecycle_Status: 'Pullout', updated_at: now })
      .in('id', assetIds);
    if (assetErr) throw assetErr;
  }

  for (const assetId of assetIds) {
    await writeAudit({
      actorId,
      assetId,
      requestId: record.requestId ?? null,
      actionType: 'PULLOUT',
      description: `Pullout ${decision}`,
    });
  }
}

// ───────────────────────────── resolve pullout ─────────────────────────────

export type ResolvePulloutResult = {
  /** Assets actually processed (selection ∩ assets still in the pullout). */
  processedCount: number;
  /** Assets that were left in the pullout (unchecked or already gone). */
  remainingCount: number;
  /** Whether the whole transaction is now closed. */
  completed: boolean;
  /** Human-readable summary, matching the web's response copy. */
  message: string;
  /** The owner label, for the assign confirmation. */
  ownerLabel?: string;
};

const appendPulloutNote = (existing: string | null | undefined, segment: string): string => {
  const text = segment.trim();
  if (!text) return String(existing ?? '');
  return [...String(existing ?? '').split(NOTE_SEP).map((s) => s.trim()).filter(Boolean), text].join(NOTE_SEP);
};

/**
 * Resolve a pullout transaction the same way the web's
 * `POST /admin/pullout/{id}/resolve` does:
 *
 * • `assign` — the asset is handed to a new owner (new user_id + location) and
 *   returns to **Active**; its row is removed from the pullout.
 * • `repair` — the asset moves to **For Repair** and gets an approved Repair
 *   request + repair record; its row is removed from the pullout.
 *
 * When every item has been processed the transaction itself is marked
 * `completed`; otherwise it stays open with a partial-progress note.
 */
export async function resolvePullout(options: {
  pulloutId: string | number;
  action: PulloutResolveAction;
  /** Only the checked assets are processed; empty = all of them. */
  assetIds?: (string | number)[];
  assignToUserId?: string | number | null;
  newLocation?: string;
  repairNotes?: string;
  notes?: string;
  actorId?: string | number | null;
}): Promise<ResolvePulloutResult> {
  const { action, pulloutId } = options;
  const now = nowIso();
  const notes = String(options.notes ?? '').trim();

  const { data: pullout, error: pulloutErr } = await supabase
    .from('pullouts')
    .select('id, asset_id, status, notes')
    .eq('id', pulloutId as any)
    .maybeSingle();
  if (pulloutErr) throw pulloutErr;
  if (!pullout) throw new Error('Pullout not found');

  const { data: itemRows, error: itemsErr } = await supabase
    .from('pullout_items')
    .select('asset_id')
    .eq('pullout_id', pulloutId as any);
  if (itemsErr) throw itemsErr;

  const allAssetIds = (itemRows ?? []).map((r: any) => Number(r.asset_id)).filter((n: number) => Number.isFinite(n) && n > 0);
  const legacyIds = allAssetIds.length > 0 ? allAssetIds : [Number((pullout as any).asset_id)].filter((n) => Number.isFinite(n) && n > 0);
  if (legacyIds.length === 0) throw new Error('No assets are linked to this pullout.');

  const wanted = (options.assetIds ?? []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  const assetIds = wanted.length > 0 ? legacyIds.filter((id) => wanted.includes(id)) : legacyIds;
  if (assetIds.length === 0) throw new Error('None of the selected assets are still part of this pullout.');

  let ownerLabel = '';

  if (action === 'assign') {
    const userId = options.assignToUserId;
    if (userId == null || String(userId).trim() === '') throw new Error('Choose the new owner before saving.');
    const newLocation = String(options.newLocation ?? '').trim();
    if (!newLocation) throw new Error('A new location is required when assigning the asset.');

    const { data: owner } = await supabase
      .from('users')
      .select('id, email, employee_numbers (Full_Name)')
      .eq('id', userId as any)
      .maybeSingle();
    const employee = Array.isArray((owner as any)?.employee_numbers)
      ? (owner as any).employee_numbers[0]
      : (owner as any)?.employee_numbers;
    ownerLabel = String(employee?.Full_Name ?? (owner as any)?.email ?? `User #${userId}`);

    const { error: assetErr } = await supabase
      .from('assets')
      .update({ user_id: userId, Lifecycle_Status: 'Active', asset_location: newLocation, updated_at: now })
      .in('id', assetIds as any[]);
    if (assetErr) throw assetErr;

    for (const assetId of assetIds) {
      await writeAudit({
        actorId: options.actorId ?? null,
        assetId,
        requestId: (pullout as any).request_id ?? null,
        actionType: 'TRANSFER',
        description: `Pullout #${pulloutId} resolved: assigned to ${ownerLabel}`,
        notes: `Assigned from pullout to ${ownerLabel} at ${newLocation}`,
      });
    }

    const { error: delErr } = await supabase
      .from('pullout_items')
      .delete()
      .eq('pullout_id', pulloutId as any)
      .in('asset_id', assetIds as any[]);
    if (delErr) throw delErr;
  }

  if (action === 'repair') {
    const actor = await resolveActingUserLabel();
    const repairNotes = String(options.repairNotes ?? '').trim();

    for (const assetId of assetIds) {
      const { error: assetErr } = await supabase
        .from('assets')
        .update({ Lifecycle_Status: 'For Repair', updated_at: now })
        .eq('id', assetId as any);
      if (assetErr) throw assetErr;

      // The requests table only allows Pending/Approved/Rejected, so the
      // repair's parent request is written as Approved (the office has already
      // decided) and progress lives on the repair row itself.
      const { data: request, error: requestErr } = await supabase
        .from('requests')
        .insert([
          {
            user_id: options.actorId ?? actor.id ?? null,
            asset_id: assetId,
            request_type: 'Repair',
            status: 'Approved',
            Note: repairNotes || `Sent from pullout #${pulloutId}`,
            created_at: now,
            updated_at: now,
          },
        ])
        .select('id')
        .single();
      if (requestErr) throw requestErr;
      const requestId = (request as any)?.id ?? null;

      const { error: repairErr } = await supabase.from('repairs').insert([
        {
          Assets_id: assetId,
          Request_id: requestId,
          Repair_Description: repairNotes || 'Repair from pullout',
          Repair_Date: now,
          Approve_by: actor.label,
          Repair_Cost: 0,
          status: 'Pending',
          Repair_result: null,
          // The "From pullout #N" marker matters later: when this repair is
          // completed or cancelled the asset returns to Pullout, not Active
          // (see repairCameFromPullout in repairService).
          notes: `From pullout #${pulloutId}`,
          created_at: now,
          updated_at: now,
        },
      ]);
      if (repairErr) throw repairErr;

      await writeAudit({
        actorId: options.actorId ?? actor.id ?? null,
        assetId,
        requestId,
        actionType: 'REPAIR',
        description: 'Asset sent to repair via pullout resolve',
        notes: `Sent to repair from pullout #${pulloutId}`,
      });
    }

    const { error: delErr } = await supabase
      .from('pullout_items')
      .delete()
      .eq('pullout_id', pulloutId as any)
      .in('asset_id', assetIds as any[]);
    if (delErr) throw delErr;
  }

  // Close the transaction when nothing is left; otherwise log the progress.
  const { count: remaining } = await supabase
    .from('pullout_items')
    .select('asset_id', { count: 'exact', head: true })
    .eq('pullout_id', pulloutId as any);
  const remainingCount = remaining ?? 0;
  const completed = remainingCount === 0;

  const statusPatch: Record<string, unknown> = completed
    ? { status: 'completed' }
    : action === 'repair' && String((pullout as any).status ?? '').toLowerCase() === 'pending'
      ? { status: 'approved' } // web parity: partial repair bumps a pending pullout to approved
      : {}; // partial assign leaves the status as the web does

  const noteSegment =
    action === 'assign'
      ? completed
        ? `Assigned to ${ownerLabel}`
        : `Partially assigned (${assetIds.length} asset(s))`
      : completed
        ? 'All assets sent to repair'
        : `Partially sent to repair (${assetIds.length} asset(s))`;

  const { error: updateErr } = await supabase
    .from('pullouts')
    .update({
      ...statusPatch,
      notes: appendPulloutNote(appendPulloutNote((pullout as any).notes, noteSegment), notes),
      updated_at: now,
    })
    .eq('id', pulloutId as any);
  if (updateErr) throw updateErr;

  const processedLabel = `${assetIds.length} asset${assetIds.length > 1 ? 's' : ''}`;
  const message =
    action === 'assign'
      ? `${processedLabel} assigned to ${ownerLabel} and released from pullout.`
      : `${processedLabel} sent to repair.`;

  return {
    processedCount: assetIds.length,
    remainingCount,
    completed,
    message: notes ? `${message} ${notes}` : message,
    ownerLabel: ownerLabel || undefined,
  };
}

/**
 * Whether assets that entered repair from a pullout must go back to Pullout
 * (never Active) when their repair closes. Keyed by the repair row's note.
 */
export const CAME_FROM_PULLOUT_NOTE = 'From pullout #';

export const repairCameFromPullout = (repairNotes: string | null | undefined): boolean =>
  String(repairNotes ?? '').includes(CAME_FROM_PULLOUT_NOTE);
