import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { createNotification } from './notificationService';

/**
 * Lifecycle evaluation for asset request approval.
 *
 * Approving a request must NOT blindly override an asset's lifecycle status.
 * Each asset is evaluated on its own status first: only assets that are ready
 * to be issued are assigned, everything else keeps its status and is reported
 * back with the reason (mirrors the NU TRACE Request Management spec).
 */

export type LifecycleAction =
  | 'assign-active'
  | 'needs-evaluation'
  | 'repair-in-progress'
  | 'replacement-in-progress'
  | 'pullout-evaluation'
  | 'disposed';

export type LifecycleEvaluation = {
  action: LifecycleAction;
  assignable: boolean;
  statusLabel: string;
  reason: string;
};

const normalizeStatus = (raw: unknown) =>
  String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, ' ');

/** The seven lifecycle cases from the request-management rules. */
export function evaluateAssetLifecycle(rawStatus: unknown): LifecycleEvaluation {
  const status = normalizeStatus(rawStatus);

  // 1. Acquired / newly registered — can be assigned, becomes Active once issued.
  if (!status || status === 'acquired' || status === 'new' || status === 'newly acquired') {
    return {
      action: 'assign-active',
      assignable: true,
      statusLabel: 'Newly Acquired',
      reason: 'Newly acquired — can be assigned and becomes Active once issued.',
    };
  }

  // 2. Active — accountability transfers, the asset stays Active.
  if (status === 'active') {
    return {
      action: 'assign-active',
      assignable: true,
      statusLabel: 'Active',
      reason: 'Active — accountability will be transferred and the asset stays Active.',
    };
  }

  // 3. Checking — evaluation first, no automatic assignment.
  if (status === 'for checking' || status === 'checking') {
    return {
      action: 'needs-evaluation',
      assignable: false,
      statusLabel: 'For Checking',
      reason: 'Under evaluation (lifespan reached) — the Asset Management Office must evaluate it before it can be assigned.',
    };
  }

  // 4. Repair — cannot be assigned while the repair is ongoing.
  if (status === 'for repair' || status === 'repair') {
    return {
      action: 'repair-in-progress',
      assignable: false,
      statusLabel: 'For Repair',
      reason: 'Repair is still in progress — it can only be assigned after the repair is completed and verified.',
    };
  }

  // 5. Replacement — the old asset must not be reassigned.
  if (status === 'for replacement' || status === 'replacement') {
    return {
      action: 'replacement-in-progress',
      assignable: false,
      statusLabel: 'For Replacement',
      reason: 'A replacement is in progress — the old asset cannot be reassigned.',
    };
  }

  // 6. Pullout — must be evaluated for suitability before re-issuance.
  if (status === 'pullout' || status === 'pulled out') {
    return {
      action: 'pullout-evaluation',
      assignable: false,
      statusLabel: 'Pullout',
      reason: 'Pulled out — it must be evaluated as suitable for reuse before it can be assigned.',
    };
  }

  // 7. Disposed — no longer part of the active inventory.
  if (status === 'disposal' || status === 'disposed') {
    return {
      action: 'disposed',
      assignable: false,
      statusLabel: 'Disposed',
      reason: 'Disposed — this asset is no longer part of the active inventory and cannot be assigned.',
    };
  }

  return {
    action: 'needs-evaluation',
    assignable: false,
    statusLabel: String(rawStatus ?? 'Unknown'),
    reason: `Status "${rawStatus ?? 'Unknown'}" must be reviewed before the asset can be assigned.`,
  };
}

/** Request types that hand an asset over to a user/department (assignment). */
const ASSIGNMENT_REQUEST_TYPES = ['transfer', 'asset request', 'request', 'issuance'];

export function isAssignmentRequest(rawType: unknown): boolean {
  return ASSIGNMENT_REQUEST_TYPES.includes(normalizeStatus(rawType));
}

export type RequestAssetEvaluation = {
  assetId: string | number;
  code: string;
  name: string;
  lifecycleStatus: string;
  custodian: string;
  evaluation: LifecycleEvaluation;
};

export type AssignmentOutcome = {
  assetId: string | number;
  code: string;
  name: string;
  fromStatus: string;
  toStatus: string;
  assigned: boolean;
  reason: string;
  previousCustodian: string;
};

export type ApprovalReport = {
  requestId: string;
  requestType: string;
  assignedCount: number;
  blockedCount: number;
  outcomes: AssignmentOutcome[];
};

const firstOf = (value: any): any => (Array.isArray(value) ? value?.[0] : value);

const resolveName = (user: any): string =>
  String(firstOf(user?.employee_numbers)?.Full_Name ?? user?.full_name ?? '');

const ASSET_SELECT = 'id, Asset_code, Asset_name, Lifecycle_Status, users:user_id(employee_numbers("Full_Name"))';

/**
 * Collect every asset linked to a request. Requests store the first asset on
 * `requests.asset_id`, the rest through `request_items`, and repair requests
 * also duplicate the link on `repairs`.
 */
async function resolveRequestAssetIds(request: any, requestId: string): Promise<number[]> {
  const ids: number[] = [];
  const push = (raw: any) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  };

  push(request?.asset_id);

  const { data: items } = await supabase
    .from('request_items')
    .select('asset_id')
    .eq('request_id', requestId);
  (items ?? []).forEach((row: any) => push(row?.asset_id));

  const { data: repairs } = await supabase
    .from('repairs')
    .select('Assets_id')
    .eq('Request_id', requestId);
  (repairs ?? []).forEach((row: any) => push(row?.Assets_id));

  return ids;
}

/**
 * Per-asset lifecycle evaluation for a request — used to preview, before
 * approval, which assets can actually be issued.
 */
export async function fetchRequestAssetEvaluations(
  requestId: string | number,
): Promise<RequestAssetEvaluation[]> {
  const requestIdText = String(requestId ?? '');
  if (!requestIdText) return [];

  const { data: request, error } = await supabase
    .from('requests')
    .select('id, asset_id, request_type')
    .eq('id', requestIdText)
    .maybeSingle();
  if (error) throw error;
  if (!request) return [];

  const ids = await resolveRequestAssetIds(request, requestIdText);
  if (ids.length === 0) return [];

  const { data: assets, error: assetErr } = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .in('id', ids);
  if (assetErr) throw assetErr;

  return (assets ?? []).map((asset: any) => ({
    assetId: asset.id,
    code: String(asset.Asset_code ?? ''),
    name: String(asset.Asset_name ?? 'Unknown Asset'),
    lifecycleStatus: String(asset.Lifecycle_Status ?? ''),
    custodian: resolveName(asset.users) || 'Unassigned',
    evaluation: evaluateAssetLifecycle(asset.Lifecycle_Status),
  }));
}

/**
 * Approve a request and process every linked asset individually:
 * suitable assets are assigned (Active + accountability recorded), the rest
 * keep their lifecycle status and are reported back with the reason.
 */
export async function approveRequestWithEvaluation(options: {
  requestId: string | number;
  actorId?: string | number | null;
  /** Defaults to the request's assignee, then the requester. */
  assignToUserId?: string | number | null;
  notes?: string;
}): Promise<ApprovalReport> {
  const requestIdText = String(options.requestId ?? '');
  if (!requestIdText) throw new Error('Missing request id');
  const now = new Date().toISOString();
  const note = String(options.notes ?? '').trim();

  const { data: request, error } = await supabase
    .from('requests')
    .select('id, user_id, asset_id, request_type, assign_to_user_id')
    .eq('id', requestIdText)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw new Error('Request not found');

  const targetUserId =
    options.assignToUserId ?? (request as any).assign_to_user_id ?? (request as any).user_id ?? null;

  let targetName = '';
  if (targetUserId != null) {
    const { data: target } = await supabase
      .from('users')
      .select('employee_numbers("Full_Name")')
      .eq('id', targetUserId as any)
      .maybeSingle();
    targetName = resolveName(target);
  }

  const ids = await resolveRequestAssetIds(request, requestIdText);
  const outcomes: AssignmentOutcome[] = [];

  if (ids.length > 0) {
    const { data: assets, error: assetErr } = await supabase
      .from('assets')
      .select(ASSET_SELECT)
      .in('id', ids);
    if (assetErr) throw assetErr;

    for (const raw of assets ?? []) {
      const asset = raw as any;
      const evaluation = evaluateAssetLifecycle(asset.Lifecycle_Status);
      const previousCustodian = resolveName(asset.users) || 'Unassigned';
      const fromStatus = String(asset.Lifecycle_Status ?? '') || 'Newly Acquired';

      const outcome: AssignmentOutcome = {
        assetId: asset.id,
        code: String(asset.Asset_code ?? ''),
        name: String(asset.Asset_name ?? 'Unknown Asset'),
        fromStatus,
        toStatus: fromStatus,
        assigned: false,
        reason: evaluation.reason,
        previousCustodian,
      };

      if (evaluation.assignable) {
        // 1 & 2 — issue the asset: Active + accountability recorded.
        const { error: assignErr } = await supabase
          .from('assets')
          .update({ Lifecycle_Status: 'Active', user_id: targetUserId, updated_at: now })
          .eq('id', asset.id);
        if (assignErr) throw assignErr;

        outcome.assigned = true;
        outcome.toStatus = 'Active';

        await writeAudit({
          actorId: options.actorId,
          assetId: asset.id,
          requestId: requestIdText,
          actionType: 'UPDATE',
          description:
            `${outcome.name} (${outcome.code || 'no code'}) assigned to ${targetName || 'the requester'} — status Active`,
          // Preserve the previous accountability in the history/audit trail.
          notes: `Request #${requestIdText} approved. Previous custodian: ${previousCustodian}. Previous status: ${fromStatus}.${note ? ` Notes: ${note}` : ''}`,
        });
      } else {
        // 3–7 — the lifecycle process must run first; the asset is untouched.
        await writeAudit({
          actorId: options.actorId,
          assetId: asset.id,
          requestId: requestIdText,
          actionType: 'UPDATE',
          description: `${outcome.name} (${outcome.code || 'no code'}) not assigned — ${evaluation.statusLabel} requires its own process`,
          notes: `Request #${requestIdText} approved but the asset kept its ${evaluation.statusLabel} status. ${evaluation.reason}`,
        });
      }

      outcomes.push(outcome);
    }
  }

  const assignedCount = outcomes.filter((o) => o.assigned).length;
  const blockedCount = outcomes.length - assignedCount;

  const { error: statusErr } = await supabase
    .from('requests')
    .update({ status: 'Approved', updated_at: now })
    .eq('id', requestIdText);
  if (statusErr) throw statusErr;

  await writeAudit({
    actorId: options.actorId,
    requestId: requestIdText,
    assetId: null,
    actionType: 'UPDATE',
    description: `Request #${requestIdText} approved — ${assignedCount} assigned, ${blockedCount} awaiting their lifecycle process`,
    notes: note || 'Request approved',
  });

  // The requester is told about the decision (web parity: "Request Approved").
  if ((request as any).user_id != null) {
    await createNotification({
      userId: (request as any).user_id,
      title: 'Request Approved',
      message:
        `Your ${String((request as any).request_type ?? 'request')} request has been approved. ` +
        `${assignedCount} asset(s) issued${blockedCount > 0 ? `, ${blockedCount} awaiting their own process` : ''}.`,
      type: 'REQUEST',
      referenceId: requestIdText,
      referenceType: 'request',
    });
  }

  return {
    requestId: requestIdText,
    requestType: String((request as any).request_type ?? ''),
    assignedCount,
    blockedCount,
    outcomes,
  };
}

/** Human-readable summary of an approval, for alerts and banners. */
export function summarizeApproval(report: ApprovalReport): string {
  if (report.outcomes.length === 0) {
    return 'The request was approved, but no asset is linked to it.';
  }
  const lines = report.outcomes.map(
    (o) =>
      `${o.assigned ? '✓' : '•'} ${o.name}${o.code ? ` (${o.code})` : ''} — ${
        o.assigned ? 'Assigned, now Active' : o.reason
      }`,
  );
  return `${report.assignedCount} assigned • ${report.blockedCount} kept their lifecycle status\n\n${lines.join('\n')}`;
}
