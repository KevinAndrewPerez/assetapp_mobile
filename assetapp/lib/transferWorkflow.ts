/**
 * Employee transfers, split into the two steps the office actually performs:
 *
 *   1. `createTransferRequest` files a **Pending** Transfer request for a
 *      sender, a receiver and the selected assets. Nothing moves yet.
 *   2. `approveTransferRequest` is called by the normal request-approval path
 *      (`updateRequestStatus`). It re-checks the live actor, moves the assets,
 *      closes/opens `asset_accountability` rows, writes the audit trail and
 *      tells both employees.
 *
 * The web's `/admin/transfer` screen performs both steps in one transaction
 * because an Admin is standing at the browser. The phone deliberately keeps
 * them apart: the previous `executeEmployeeTransfer` wrote an already-Approved
 * request, which meant any account that reached `/transfer` could reassign
 * assets without a decision. A request is now a request until an Admin decides
 * it.
 *
 * There is no transaction on the Supabase client, so the approval claims the
 * Pending request first (an atomic conditional UPDATE), applies the move, and
 * compensates if a later write fails. A retry therefore cannot move the same
 * assets twice.
 */
import { supabase } from './supabase';
import { requireOfficeActor } from './access';
import { writeAudit } from './auditService';
import { createNotification } from './notificationService';
import { toStoredTimestamp } from './time';
import type { ApprovalReport, AssignmentOutcome } from './requestService';
import { transferAssetRefusal, transferTargetRefusal } from './transferRules';

export type CreateTransferInput = {
  fromUserId: string | number;
  fromName: string;
  toUserId: string | number;
  toName: string;
  assetIds: (string | number)[];
  reason: string;
  notes?: string;
  actorId: string | number | null | undefined;
};

export type TransferRequestResult = {
  requestId: string;
  reference: string;
  assetCount: number;
};

const firstOf = (value: any) => (Array.isArray(value) ? value?.[0] : value);

const nameOf = (row: any): string =>
  String(firstOf(row?.employee_numbers)?.Full_Name ?? row?.email ?? 'Unknown employee');

/** Resolve the two employees' display names from their live rows. */
async function resolveNames(fromUserId: string | number, toUserId: string | number) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, employee_numbers("Full_Name")')
    .in('id', [fromUserId, toUserId] as any[]);
  if (error) throw error;

  const byId = new Map<string, string>();
  (data ?? []).forEach((row: any) => byId.set(String(row.id), nameOf(row)));
  return {
    fromName: byId.get(String(fromUserId)) ?? 'Unknown employee',
    toName: byId.get(String(toUserId)) ?? 'Unknown employee',
  };
}

/**
 * File a Pending transfer request. The selected assets must still belong to the
 * sender, the receiver must be an active account, and the same asset cannot sit
 * in two pending transfers at once.
 */
export async function createTransferRequest(input: CreateTransferInput): Promise<TransferRequestResult> {
  await requireOfficeActor(
    input.actorId,
    'Only the Asset Management Office can start an employee transfer.',
  );

  const assetIds = Array.from(
    new Set(input.assetIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (assetIds.length === 0) throw new Error('Select at least one asset to transfer.');

  const { data: receiver, error: receiverError } = await supabase
    .from('users')
    .select('id, status')
    .eq('id', input.toUserId as any)
    .maybeSingle();
  if (receiverError) throw receiverError;
  if (!receiver) throw new Error('The receiving employee no longer exists.');

  const targetRefusal = transferTargetRefusal({
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    targetStatus: (receiver as any).status,
  });
  if (targetRefusal) throw new Error(targetRefusal);

  const { data: assetRows, error: assetError } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, user_id, Lifecycle_Status, created_at')
    .in('id', assetIds as any[]);
  if (assetError) throw assetError;

  const assets = (assetRows ?? []) as any[];
  if (assets.length !== assetIds.length) {
    throw new Error('One or more of the selected assets no longer exist. Reload and try again.');
  }

  for (const asset of assets) {
    const refusal = transferAssetRefusal(asset, input.fromUserId, input.fromName);
    if (refusal) throw new Error(refusal);
  }

  // A second confirmation must not create a second pending transfer for the
  // same asset. This is a read before the insert, so the approval step still
  // re-validates ownership; it only prevents the obvious duplicate request.
  try {
    const { data: pending } = await supabase
      .from('requests')
      .select('id, request_items(asset_id)')
      .ilike('request_type', '%transfer%')
      .eq('status', 'Pending');
    const pendingIds = new Set<string>();
    (pending ?? []).forEach((row: any) => {
      (row.request_items ?? []).forEach((item: any) => pendingIds.add(String(item.asset_id)));
    });
    const alreadyPending = assets.filter((asset) => pendingIds.has(String(asset.id)));
    if (alreadyPending.length > 0) {
      throw new Error(
        `These assets are already in a pending transfer: ${alreadyPending
          .map((asset) => asset.Asset_code || `#${asset.id}`)
          .join(', ')}. Decide that request first.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && /already in a pending transfer/.test(error.message)) throw error;
    console.warn('Could not check for duplicate pending transfers:', error);
  }

  const now = toStoredTimestamp();
  const reason = String(input.reason || 'Employee Relocation').trim();
  const notes = String(input.notes ?? '').trim();

  const { data: requestRow, error: requestError } = await supabase
    .from('requests')
    .insert([
      {
        user_id: input.fromUserId,
        asset_id: null,
        request_type: 'Transfer',
        // A request is a request: the approval path is the only thing that may
        // move an asset.
        status: 'Pending',
        Note: reason,
        assign_to_user_id: input.toUserId,
        admin_remarks: notes || null,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('id')
    .single();
  if (requestError) throw requestError;

  const requestId = String((requestRow as any)?.id ?? '');
  if (!requestId) throw new Error('The transfer request could not be created.');

  const { error: itemsError } = await supabase.from('request_items').insert(
    assetIds.map((assetId) => ({
      request_id: requestId,
      asset_id: assetId,
      created_at: now,
      updated_at: now,
    })),
  );
  if (itemsError) {
    // Keep the request from being approved with no assets attached.
    const { error: undoError } = await supabase.from('requests').delete().eq('id', requestId as any);
    if (undoError) console.warn('Could not roll back the empty transfer request:', undoError.message);
    throw itemsError;
  }

  await writeAudit({
    actorId: input.actorId ?? null,
    requestId,
    actionType: 'TRANSFER',
    description: `Transfer request #${requestId} filed: ${assetIds.length} asset${
      assetIds.length > 1 ? 's' : ''
    } from ${input.fromName} to ${input.toName}.`,
    notes: `Awaiting Asset Management Office approval. Reason: ${reason}${notes ? `. Notes: ${notes}` : ''}`,
  });

  return {
    requestId,
    reference: `TR-${requestId.padStart(3, '0')}`,
    assetCount: assetIds.length,
  };
}

type AssetRow = {
  id: string | number;
  Asset_code: string | null;
  Asset_name: string | null;
  user_id: string | number | null;
  Lifecycle_Status: string | null;
  created_at: string | null;
};

/**
 * Apply an already-authorized Transfer request.
 *
 * Called from `updateRequestStatus` after that function has read the live actor
 * and confirmed the request is Pending and not the actor's own. The conditional
 * claim below makes a retry harmless even if two decisions race.
 */
export async function approveTransferRequest(options: {
  requestId: string | number;
  actorId: string | number | null | undefined;
  notes?: string;
}): Promise<ApprovalReport> {
  const requestId = String(options.requestId ?? '');
  if (!requestId) throw new Error('Missing request id');

  await requireOfficeActor(
    options.actorId,
    'Only the Asset Management Office can approve a transfer.',
  );

  const { data: request, error: requestError } = await supabase
    .from('requests')
    .select('id, user_id, assign_to_user_id, request_type, status, Note, admin_remarks')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request) throw new Error('This transfer request no longer exists.');

  const type = String((request as any).request_type ?? '').trim().toLowerCase();
  if (type !== 'transfer') throw new Error('This request is not a transfer.');
  if (String((request as any).status ?? '').trim().toLowerCase() !== 'pending') {
    throw new Error('Only a pending transfer can be approved. Reload to see its current status.');
  }

  const fromUserId = (request as any).user_id;
  const toUserId = (request as any).assign_to_user_id;
  if (toUserId == null) throw new Error('This transfer request has no receiving employee.');

  const targetRefusal = transferTargetRefusal({
    fromUserId,
    toUserId,
  });
  if (targetRefusal) throw new Error(targetRefusal);

  const { data: itemRows, error: itemsError } = await supabase
    .from('request_items')
    .select('asset_id')
    .eq('request_id', requestId);
  if (itemsError) throw itemsError;

  const assetIds = Array.from(
    new Set(
      (itemRows ?? [])
        .map((row: any) => Number(row?.asset_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  if (assetIds.length === 0) {
    throw new Error('This transfer request has no assets attached, so there is nothing to move.');
  }

  const { data: assetRows, error: assetError } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, user_id, Lifecycle_Status, created_at')
    .in('id', assetIds as any[]);
  if (assetError) throw assetError;

  const assets = (assetRows ?? []) as AssetRow[];
  if (assets.length !== assetIds.length) {
    throw new Error('One or more of the transfer assets no longer exist. The request was not approved.');
  }

  const names = await resolveNames(fromUserId, toUserId);
  for (const asset of assets) {
    const refusal = transferAssetRefusal(asset, fromUserId, names.fromName);
    if (refusal) {
      throw new Error(`${refusal} The transfer cannot be applied; reload and file a new request.`);
    }
  }

  const now = toStoredTimestamp();
  const reason = String((request as any).Note ?? 'Employee Relocation').trim() || 'Employee Relocation';
  const notes = String(options.notes ?? (request as any).admin_remarks ?? '').trim();

  // Claim the Pending request first. If another decision won the race this
  // matches no row, and no asset is touched.
  const { data: claimed, error: claimError } = await supabase
    .from('requests')
    .update({
      status: 'Approved',
      admin_remarks_by: options.actorId ?? null,
      admin_remarks_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    .ilike('status', 'pending')
    .select('id');
  if (claimError) throw claimError;
  if ((claimed ?? []).length === 0) {
    throw new Error(
      'This transfer was already decided by another administrator. Reload to see the current status.',
    );
  }

  const closedIds: (string | number)[] = [];
  const createdOldIds: (string | number)[] = [];
  const createdNewIds: (string | number)[] = [];

  try {
    // 1. Close each asset's current accountability row, opening one for the
    //    previous custodian first when the install predates accountability.
    for (const asset of assets) {
      const { data: currentRows, error: currentError } = await supabase
        .from('asset_accountability')
        .select('id')
        .eq('asset_id', asset.id as any)
        .eq('Is_Current', 1);
      if (currentError) throw currentError;

      const currentIds = (currentRows ?? []).map((row: any) => row.id);
      if (currentIds.length > 0) {
        const { error: closeError } = await supabase
          .from('asset_accountability')
          .update({
            Is_Current: 0,
            notes: `Closed by the transfer recorded in request #${requestId}.`,
            updated_at: now,
          })
          .in('id', currentIds as any[]);
        if (closeError) throw closeError;
        closedIds.push(...currentIds);
      } else if (fromUserId != null) {
        const { data: oldRow, error: oldError } = await supabase
          .from('asset_accountability')
          .insert([
            {
              asset_id: asset.id,
              user_id: fromUserId,
              request_id: Number(requestId),
              Assign_date: asset.created_at ?? now,
              Is_Current: 0,
              transfer_reason: reason.slice(0, 100),
              notes: `Closed by the transfer recorded in request #${requestId}.`,
              created_at: now,
              updated_at: now,
            },
          ])
          .select('id')
          .single();
        if (oldError) throw oldError;
        if ((oldRow as any)?.id != null) createdOldIds.push((oldRow as any).id);
      }
    }

    // 2. Move the assets. Codes, QR stickers and acquisition data are untouched.
    for (const asset of assets) {
      const { error: moveError } = await supabase
        .from('assets')
        .update({ user_id: toUserId, Lifecycle_Status: 'Active', updated_at: now })
        .eq('id', asset.id as any);
      if (moveError) throw moveError;
    }

    // 3. Open the new accountability rows.
    const { data: newRows, error: newError } = await supabase
      .from('asset_accountability')
      .insert(
        assets.map((asset) => ({
          asset_id: asset.id,
          user_id: toUserId,
          request_id: Number(requestId),
          Assign_date: now,
          Is_Current: 1,
          transfer_reason: reason.slice(0, 100),
          notes: notes || null,
          created_at: now,
          updated_at: now,
        })),
      )
      .select('id');
    if (newError) throw newError;
    (newRows ?? []).forEach((row: any) => createdNewIds.push(row.id));

    // 4. Audit trail, matching the shape the web writes.
    await writeAudit({
      actorId: options.actorId ?? null,
      requestId,
      actionType: 'TRANSFER',
      description: `${assets.length} asset${assets.length > 1 ? 's' : ''} transferred from ${
        names.fromName
      } to ${names.toName} due to ${reason.toLowerCase()}.`,
      notes: notes || `Approved transfer request #${requestId} (${reason}).`,
    });

    for (const asset of assets) {
      await writeAudit({
        actorId: options.actorId ?? null,
        assetId: asset.id,
        requestId,
        actionType: 'TRANSFER',
        description: `Transfer ${requestId}: ${asset.Asset_code ?? ''} — ${
          asset.Asset_name ?? 'Asset'
        } reassigned to ${names.toName}`,
        notes: `Transferred ${asset.Asset_code ?? ''} from ${names.fromName} to ${names.toName} (${reason})`,
      });
    }

    // 5. Both sides of the relocation hear about it, with the web's wording.
    await createNotification({
      userId: toUserId,
      title: 'Assets Transferred To You',
      message: `${assets.length} asset${assets.length === 1 ? ' is' : 's are'} now assigned to you from ${
        names.fromName
      }.`,
      type: 'TRANSFER',
      referenceId: requestId,
      referenceType: 'request',
    });
    await createNotification({
      userId: fromUserId,
      title: 'Assets Transferred Out',
      message: `${assets.length} asset${assets.length === 1 ? ' was' : 's were'} reassigned to ${
        names.toName
      }.`,
      type: 'TRANSFER',
      referenceId: requestId,
      referenceType: 'request',
    });
  } catch (error) {
    // Compensate as far as the client can: put every asset back with its
    // previous custodian and status, remove the accountability rows this
    // approval created, reopen the closed ones, and return the request to
    // Pending so it can be retried.
    console.warn('Transfer approval failed; compensating:', error);

    for (const asset of assets) {
      const { error: restoreError } = await supabase
        .from('assets')
        .update({
          user_id: fromUserId,
          Lifecycle_Status: asset.Lifecycle_Status,
          updated_at: now,
        })
        .eq('id', asset.id as any);
      if (restoreError) console.warn('Could not restore asset', asset.id, restoreError.message);
    }

    if (createdNewIds.length > 0) {
      const { error: undoNew } = await supabase
        .from('asset_accountability')
        .delete()
        .in('id', createdNewIds as any[]);
      if (undoNew) console.warn('Could not remove new accountability rows:', undoNew.message);
    }
    if (createdOldIds.length > 0) {
      const { error: undoOld } = await supabase
        .from('asset_accountability')
        .delete()
        .in('id', createdOldIds as any[]);
      if (undoOld) console.warn('Could not remove placeholder accountability rows:', undoOld.message);
    }
    if (closedIds.length > 0) {
      const { error: reopen } = await supabase
        .from('asset_accountability')
        .update({ Is_Current: 1, updated_at: now })
        .in('id', closedIds as any[]);
      if (reopen) console.warn('Could not reopen accountability rows:', reopen.message);
    }

    const { error: revertError } = await supabase
      .from('requests')
      .update({ status: 'Pending', updated_at: now })
      .eq('id', requestId);
    if (revertError) console.warn('Could not return the transfer request to Pending:', revertError.message);

    throw error;
  }

  const outcomes: AssignmentOutcome[] = assets.map((asset) => ({
    assetId: asset.id,
    code: String(asset.Asset_code ?? ''),
    name: String(asset.Asset_name ?? 'Unknown Asset'),
    fromStatus: String(asset.Lifecycle_Status ?? ''),
    toStatus: 'Active',
    assigned: true,
    reason: `Transferred to ${names.toName}.`,
    previousCustodian: names.fromName,
  }));

  return {
    requestId,
    requestType: 'Transfer',
    assignedCount: assets.length,
    blockedCount: 0,
    outcomes,
  };
}
