import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { createNotification } from './notificationService';
import { submitRepairRequest } from './repairService';
import { initiateDisposal } from './disposalService';

/**
 * Maintenance & Lifespan management (NU TRACE mobile spec).
 *
 * Two *separate* triggers:
 *   • Maintenance due  → a reminder only. The asset stays Active; maintenance
 *     being due never means the asset is broken.
 *   • Lifespan expired → the asset moves to **For Checking** for evaluation. It
 *     is never disposed automatically, and assets already in Pullout / Repair /
 *     Replacement / Disposal are only flagged for evaluation, never overridden.
 *
 * Dates are derived from the asset record:
 *   expiration_date       = accusion_date + lifespan_months (calculated at registration)
 *   next_maintenance_date = last maintenance (or registration) + maintenance_interval
 *
 * There is no maintenance table in this database, so each completed maintenance
 * is recorded as an `audit_logs` entry (the asset history the web shows) while
 * `assets.last_maintenance_date` / `next_maintenance_date` carry the schedule.
 */

export type MaintenanceItem = {
  id: string | number;
  /** Accountable user — notification target. */
  userId?: string | number | null;
  code: string;
  name: string;
  category?: string;
  status: string;
  location?: string;
  custodian?: string;
  lastMaintenanceDate?: string | null;
  nextMaintenanceDate?: string | null;
  maintenanceInterval?: number | null;
  /** Positive = due in the future, 0 = due today, negative = overdue. */
  daysUntilNext: number;
  overdue: boolean;
  expirationDate?: string | null;
  lifespanMonths?: number | null;
  daysUntilExpiration: number | null;
};

export type EvaluationItem = MaintenanceItem & {
  repairCounts?: number | null;
  /** True when the lifecycle status was left untouched (Pullout etc.). */
  advisoryOnly: boolean;
};

export type MaintenanceRecordResult = {
  nextMaintenanceDate: string | null;
  status: string;
  repairCreated: boolean;
  repairRequestRef?: string;
};

// ───────────────────────────── date helpers ──────────────────────────────────

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Add whole months to a YYYY-MM-DD string, clamped to the target month's last day. */
export const addMonthsToDate = (dateStr: string, months: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetMonth = m - 1 + months;
  const lastDay = new Date(y, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  return new Date(y, targetMonth, day).toISOString().slice(0, 10);
};

/** Days from today to `dateStr` (negative when the date has passed). */
export const daysUntil = (dateStr?: string | null): number | null => {
  if (!dateStr) return null;
  const target = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target)) return null;
  const start = Date.parse(`${todayIso()}T00:00:00`);
  return Math.round((target - start) / 86400000);
};

/** The date the maintenance should next happen, or null when no interval is set. */
export const computeNextMaintenanceDate = (
  baselineDate: string | null | undefined,
  intervalMonths: number | null | undefined,
): string | null => {
  const interval = Number(intervalMonths ?? 0);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  const baseline = String(baselineDate ?? '').slice(0, 10) || todayIso();
  return addMonthsToDate(baseline, interval);
};

/** The date the asset expires, or null when lifespan/acquisition is missing. */
export const computeExpirationDate = (
  acquisitionDate: string | null | undefined,
  lifespanMonths: number | null | undefined,
): string | null => {
  const lifespan = Number(lifespanMonths ?? 0);
  if (!Number.isFinite(lifespan) || lifespan <= 0) return null;
  const baseline = String(acquisitionDate ?? '').slice(0, 10);
  if (!baseline) return null;
  return addMonthsToDate(baseline, lifespan);
};

export function maintenanceStatusLabel(days: number | null): string {
  if (days === null) return 'No schedule';
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

export function lifespanStatusLabel(days: number | null): string {
  if (days === null) return 'No lifespan set';
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export function maintenanceActionMessage(status: MaintenanceItem): string {
  if (status.overdue) {
    return 'Maintenance is overdue. The asset stays in its current lifecycle status — schedule the upkeep.';
  }
  if (status.daysUntilNext === 0) {
    return 'Maintenance is due today. Completing it will reschedule the next maintenance date.';
  }
  return 'Maintenance is scheduled. The asset remains usable until a problem is actually found.';
}

const unwrapUser = (user: any): string => {
  const employee = Array.isArray(user?.employee_numbers) ? user.employee_numbers[0] : user?.employee_numbers;
  return String(employee?.Full_Name ?? user?.full_name ?? '');
};

const ASSET_SELECT =
  'id, user_id, Asset_code, Asset_name, Category, Lifecycle_Status, asset_location, users:user_id(employee_numbers("Full_Name")), last_maintenance_date, next_maintenance_date, maintenance_interval, expiration_date, lifespan_months, accusion_date, repair_counts';

const toItem = (row: any): MaintenanceItem => {
  const daysToNext = daysUntil(row.next_maintenance_date);
  return {
    id: row.id,
    userId: row.user_id ?? null,
    code: String(row.Asset_code ?? ''),
    name: String(row.Asset_name ?? 'Asset'),
    category: row.Category ?? undefined,
    status: String(row.Lifecycle_Status ?? ''),
    location: row.asset_location ?? undefined,
    custodian: unwrapUser(row.users) || undefined,
    lastMaintenanceDate: row.last_maintenance_date ?? null,
    nextMaintenanceDate: row.next_maintenance_date ?? null,
    maintenanceInterval: row.maintenance_interval ?? null,
    daysUntilNext: daysToNext ?? 0,
    overdue: daysToNext !== null && daysToNext < 0,
    expirationDate: row.expiration_date ?? null,
    lifespanMonths: row.lifespan_months ?? null,
    daysUntilExpiration: daysUntil(row.expiration_date),
  };
};

// ───────────────────────────────── reads ─────────────────────────────────────

/**
 * The maintenance schedule. `onlyDue` returns just the reminders (today or
 * earlier); otherwise every scheduled asset with its "due in N days" state.
 */
export async function fetchMaintenanceSchedule(options?: {
  onlyDue?: boolean;
  withinDays?: number;
}): Promise<MaintenanceItem[]> {
  const today = todayIso();
  let query = supabase
    .from('assets')
    .select(ASSET_SELECT)
    .not('next_maintenance_date', 'is', null)
    .order('next_maintenance_date', { ascending: true });

  if (options?.onlyDue) {
    query = query.lte('next_maintenance_date', today);
  }

  const { data, error } = await query;
  if (error) throw error;

  const items = ((data ?? []) as any[]).map(toItem);
  if (options?.withinDays != null) {
    return items.filter((item) => item.daysUntilNext <= options.withinDays!);
  }
  return items;
}

// ───────────────────────────── lifespan monitoring ───────────────────────────

/**
 * Asset evaluation monitor — web parity with `/admin/api/assets/check-and-transition`
 * and the auto-transition the web's asset-detail route performs on open.
 *
 * An **Active** asset moves to `For Checking` when its lifespan has expired or
 * its scheduled maintenance is overdue; the transition is audited and the
 * accountable user is told. Pullout assets keep their status and are only
 * surfaced for an "extend lifespan / dispose" decision, and every other
 * lifecycle state is left exactly as it is. Disposal is never triggered here.
 */
export async function runAssetEvaluationCheck(options?: {
  actorId?: string | number | null;
  /** Only evaluate this asset (the asset-detail view passes one). */
  assetId?: string | number | null;
}): Promise<EvaluationItem[]> {
  const today = todayIso();
  let query = supabase
    .from('assets')
    .select(ASSET_SELECT)
    .eq('Lifecycle_Status', 'Active')
    .or(`expiration_date.lte.${today},next_maintenance_date.lte.${today}`);

  if (options?.assetId !== undefined && options?.assetId !== null && String(options.assetId) !== '') {
    query = query.eq('id', options.assetId as any);
  }

  const { data, error } = await query;
  if (error) throw error;

  const moved: EvaluationItem[] = [];
  const now = new Date().toISOString();

  for (const row of ((data ?? []) as any[])) {
    const item = toItem(row);
    const lifespanExpired = !!item.expirationDate && String(item.expirationDate).slice(0, 10) <= today;
    const reason = lifespanExpired
      ? `Asset lifespan expired on ${String(item.expirationDate).slice(0, 10)}. Automatically transitioned to "For Checking" for evaluation.`
      : `Asset maintenance is overdue (due date: ${item.nextMaintenanceDate}). Automatically transitioned to "For Checking" for evaluation.`;

    const { error: updateError } = await supabase
      .from('assets')
      .update({ Lifecycle_Status: 'For Checking', updated_at: now })
      .eq('id', item.id as any);
    if (updateError) {
      console.warn('Failed to move asset to For Checking:', updateError.message);
      continue;
    }

    await writeAudit({
      actorId: options?.actorId,
      assetId: item.id,
      actionType: 'UPDATE',
      description: lifespanExpired
        ? 'Automatic status change: Asset lifespan expired'
        : 'Automatic status change: Maintenance overdue',
      notes: reason,
    });

    await createNotification({
      userId: item.userId ?? null,
      title: lifespanExpired ? 'Asset Lifespan Expired' : 'Maintenance Overdue',
      message: `${item.name} ${item.code} is now For Checking: ${reason}`,
      type: 'LIFESPAN',
      referenceId: item.id,
      referenceType: 'asset',
    }).catch(() => undefined);

    moved.push({
      ...item,
      status: 'For Checking',
      advisoryOnly: false,
      repairCounts: row.repair_counts ?? null,
    });
  }

  return moved;
}

// ─────────────────────────── performing maintenance ──────────────────────────

export type RecordMaintenanceOptions = {
  assetId: string | number;
  actorId?: string | number | null;
  actorLabel?: string;
  /** Defaults to today. */
  performedDate?: string;
  maintenanceType?: string;
  findings?: string;
  performed?: string;
  technician?: string;
  cost?: number | string;
  remarks?: string;
  /** When the upkeep found a problem, a Repair request is opened (spec §5). */
  problemFound?: boolean;
  problemDescription?: string;
};

/**
 * Record a completed maintenance activity. Reschedules the next maintenance from
 * the configured interval and — crucially — leaves the lifecycle status alone:
 * maintenance being due/completed never makes an asset "For Repair".
 */
export async function recordMaintenance(options: RecordMaintenanceOptions): Promise<MaintenanceRecordResult> {
  const { assetId } = options;
  const nowIso = new Date().toISOString();
  const performedDate = String(options.performedDate ?? '').slice(0, 10) || todayIso();

  const { data: asset, error: fetchError } = await supabase
    .from('assets')
    .select('id, Asset_code, Asset_name, Lifecycle_Status, maintenance_interval, next_maintenance_date, last_maintenance_date, users:user_id(id, employee_numbers("Full_Name"))')
    .eq('id', assetId as any)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!asset) throw new Error('Asset not found');

  const nextDate = computeNextMaintenanceDate(performedDate, (asset as any).maintenance_interval);
  const currentStatus = String((asset as any).Lifecycle_Status ?? 'Active');
  // Web parity (`/admin/api/assets/{id}/maintenance-complete`): a completed
  // maintenance keeps the asset **in review** instead of silently marking it
  // Active — the office returns it to Active explicitly after verification.
  // Any other lifecycle status is left untouched.
  const newStatus = currentStatus === 'Active' ? 'For Checking' : currentStatus;

  const { error: updateError } = await supabase
    .from('assets')
    .update({
      last_maintenance_date: performedDate,
      next_maintenance_date: nextDate,
      Lifecycle_Status: newStatus,
      updated_at: nowIso,
    })
    .eq('id', assetId as any);
  if (updateError) throw updateError;

  const assetLabel = `${(asset as any).Asset_name ?? 'Asset'} ${(asset as any).Asset_code ?? ''}`.trim();
  const details = [
    options.maintenanceType ? `Type: ${options.maintenanceType}` : '',
    options.findings ? `Findings: ${options.findings}` : '',
    options.performed ? `Performed: ${options.performed}` : '',
    options.technician ? `Technician: ${options.technician}` : '',
    options.cost !== undefined && options.cost !== null && String(options.cost).trim() !== ''
      ? `Cost: ${options.cost}`
      : '',
    options.remarks ? `Remarks: ${options.remarks}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  await writeAudit({
    actorId: options.actorId,
    assetId,
    actionType: 'MAINTENANCE',
    description: `Asset preventive maintenance performed and completed. Lifecycle status set to ${newStatus}${
      nextDate ? `. Next maintenance scheduled for ${nextDate}` : '. No maintenance interval configured.'
    }`,
    notes: `Maintenance completed on ${performedDate}${details ? `. ${details}` : ''}`,
  });

  const owner = Array.isArray((asset as any).users) ? (asset as any).users[0] : (asset as any).users;
  if (owner?.id != null) {
    await createNotification({
      userId: owner.id,
      title: 'Maintenance Completed',
      message: `${assetLabel} completed its scheduled maintenance${
        nextDate ? `. Next maintenance: ${nextDate}` : ''
      }.`,
      type: 'MAINTENANCE',
      referenceId: assetId,
      referenceType: 'asset',
    });
  }

  let repairCreated = false;
  let repairRequestRef: string | undefined;

  if (options.problemFound) {
    // Maintenance found a problem → the normal Repair process takes over
    // (Active → Repair → Repaired/Active or Beyond Repair → Replacement/Disposal).
    try {
      if (!options.actorId) throw new Error('A signed-in user is required to open a repair request.');
      const result = await submitRepairRequest({
        user: {
          id: options.actorId,
          full_name: options.actorLabel ?? 'Asset Management Office',
        },
        assetIds: [assetId],
        problem: options.problemDescription?.trim() || `Problem found during maintenance of ${assetLabel}`,
        description: options.findings?.trim(),
        priority: 'Medium',
        reportedDate: performedDate,
        remarks: `Created from maintenance on ${performedDate}`,
      });
      repairCreated = true;
      repairRequestRef = result.requestRef;
    } catch (err) {
      console.warn('Maintenance problem could not open a repair request:', err);
    }
  }

  return {
    nextMaintenanceDate: nextDate,
    status: newStatus,
    repairCreated,
    repairRequestRef,
  };
}

// ───────────────────── evaluating an expired (Checking) asset ────────────────

/**
 * The evaluation actions of the web's `/admin/api/assets/{id}/evaluate`.
 *
 * A `For Checking` (or still-`Active`) asset gets the four normal decisions; a
 * **Pullout** asset can only have its lifespan extended or be disposed of, and
 * never goes back to Active.
 */
export type EvaluationAction =
  | 'return_active'
  | 'send_repair'
  | 'recommend_replacement'
  | 'proceed_disposal'
  | 'extend_lifespan_pullout';

const PULLOUT_ONLY_ACTIONS: EvaluationAction[] = ['extend_lifespan_pullout', 'proceed_disposal'];

export type EvaluationResult = {
  status: string;
  expirationDate?: string | null;
  disposalIds?: string[];
};

/**
 * Record one lifespan-evaluation decision for a single asset, mirroring the
 * web admin's evaluate endpoint (same validation, same lifecycle transitions,
 * same audit wording, same repair/replacement/disposal records).
 */
export async function runAssetEvaluation(options: {
  assetId: string | number;
  action: EvaluationAction;
  notes?: string;
  /** `return_active` (optional) and `extend_lifespan_pullout` (required). */
  extensionMonths?: number;
  actorId?: string | number | null;
  actorLabel?: string;
}): Promise<EvaluationResult> {
  const { assetId, action } = options;
  const notes = String(options.notes ?? '').trim();
  const months = Math.max(0, Number(options.extensionMonths ?? 0) || 0);
  const now = new Date().toISOString();

  const { data: asset, error } = await supabase
    .from('assets')
    .select('id, Assets_id:id, Asset_code, Asset_name, Lifecycle_Status, expiration_date, lifespan_months, repair_counts')
    .eq('id', assetId as any)
    .maybeSingle();
  if (error) throw error;
  if (!asset) throw new Error('Asset not found');

  const row = asset as any;
  const status = String(row.Lifecycle_Status ?? '');
  const statusKey = status.trim().toLowerCase();
  const actorLabel = String(options.actorLabel ?? 'Admin');

  if (statusKey === 'pullout') {
    if (!PULLOUT_ONLY_ACTIONS.includes(action)) {
      throw new Error('Invalid action for a pulled-out asset. Only extending its lifespan or disposal is allowed.');
    }
  } else if (statusKey !== 'for checking' && statusKey !== 'active') {
    throw new Error(`Asset is not in "For Checking" status (current: ${status || 'Unknown'}).`);
  }

  if (action === 'return_active') {
    const update: Record<string, any> = { Lifecycle_Status: 'Active', updated_at: now };
    if (months > 0 && row.expiration_date) {
      update.expiration_date = addMonthsToDate(String(row.expiration_date).slice(0, 10), months);
    }

    const { error: updateError } = await supabase.from('assets').update(update).eq('id', assetId as any);
    if (updateError) throw updateError;

    await writeAudit({
      actorId: options.actorId,
      assetId,
      actionType: 'UPDATE',
      description: 'Asset returned to Active status after lifespan evaluation',
      notes:
        `Lifespan Evaluation Decision: RETURN TO ACTIVE${
          months > 0 ? ` (Extended by ${months} months)` : ''
        }\nEvaluation Notes: ${notes || 'Asset condition satisfactory'}`,
    });

    return { status: 'Active', expirationDate: (update.expiration_date as string) ?? row.expiration_date ?? null };
  }

  if (action === 'send_repair') {
    const { error: updateError } = await supabase
      .from('assets')
      .update({ Lifecycle_Status: 'For Repair', updated_at: now })
      .eq('id', assetId as any);
    if (updateError) throw updateError;

    // Same rows the repair screens read: one pending repair, no request yet.
    const { error: repairError } = await supabase.from('repairs').insert([
      {
        Assets_id: Number(assetId),
        Request_id: null,
        Repair_Description: notes || 'Maintenance required',
        Repair_Date: now,
        Approve_by: actorLabel,
        status: 'Pending',
        notes: 'Repair initiated from lifespan evaluation',
        created_at: now,
        updated_at: now,
      },
    ]);
    if (repairError) console.warn('Repair row insert failed:', repairError.message);

    const counted = Number(row.repair_counts ?? 0) || 0;
    await supabase
      .from('assets')
      .update({ repair_counts: counted + 1, updated_at: now })
      .eq('id', assetId as any);

    await writeAudit({
      actorId: options.actorId,
      assetId,
      actionType: 'REPAIR',
      description: 'Asset sent for repair after lifespan evaluation',
      notes: `Lifespan Evaluation Decision: SEND FOR REPAIR\nIssues: ${notes || 'Maintenance required'}`,
    });

    return { status: 'For Repair' };
  }

  if (action === 'recommend_replacement') {
    const { error: updateError } = await supabase
      .from('assets')
      .update({ Lifecycle_Status: 'For Replacement', updated_at: now })
      .eq('id', assetId as any);
    if (updateError) throw updateError;

    const { error: replacementError } = await supabase.from('replacements').insert([
      {
        old_assets_id: Number(assetId),
        new_assets_id: null,
        Replacement_Date: now,
        reason: notes || 'Beyond economical repair',
        replacement_reason: 'Obsolete',
        Approve_by: actorLabel,
        status: 'Pending',
        notes: 'Replacement initiated from lifespan evaluation',
        created_at: now,
        updated_at: now,
      },
    ]);
    if (replacementError) console.warn('Replacement row insert failed:', replacementError.message);

    await writeAudit({
      actorId: options.actorId,
      assetId,
      actionType: 'REPLACEMENT',
      description: 'Asset recommended for replacement after lifespan evaluation',
      notes: `Lifespan Evaluation Decision: RECOMMEND REPLACEMENT\nReason: ${notes || 'Beyond economical repair'}`,
    });

    return { status: 'For Replacement' };
  }

  if (action === 'extend_lifespan_pullout') {
    if (statusKey !== 'pullout') {
      throw new Error('The lifespan of a pulled-out asset can only be extended while it is in Pullout status.');
    }
    if (months < 1) {
      throw new Error('Enter at least 1 month to extend the lifespan by.');
    }

    const base = String(row.expiration_date ?? '').slice(0, 10) || todayIso();
    const newExpiration = addMonthsToDate(base, months);

    // The lifecycle status is deliberately untouched: the asset was pulled out,
    // so extending its lifespan cannot put it back to Active.
    const { error: updateError } = await supabase
      .from('assets')
      .update({ expiration_date: newExpiration, updated_at: now })
      .eq('id', assetId as any);
    if (updateError) throw updateError;

    await writeAudit({
      actorId: options.actorId,
      assetId,
      actionType: 'UPDATE',
      description: 'Lifespan extended while in Pullout status',
      notes: `Extended by ${months} months. New expiration: ${newExpiration}\n${notes || 'Lifespan extended while in pullout'}`,
    });

    return { status: 'Pullout', expirationDate: newExpiration };
  }

  // proceed_disposal — recorded through the disposal service so the transaction
  // carries its review status, previous lifecycle status, audit trail and the
  // accountable user's notification. The asset is never deleted.
  const { disposalIds } = await initiateDisposal({
    assetIds: [assetId],
    reason: notes || 'End of lifespan',
    reasonCategory: 'End of Lifespan',
    method: 'Scrapped',
    origin: statusKey === 'pullout' ? 'Pullout' : 'Checking',
    initialStatus: 'Approved',
    actorId: options.actorId,
    actorLabel,
    notes: notes || 'Disposed after lifespan evaluation',
  });

  return { status: 'Disposal', disposalIds };
}

/**
 * Extend an asset's lifespan directly (web parity: `/admin/api/assets/{id}/extend-lifespan`).
 *
 * Works for any asset that has an expiration date and is not disposed of. The
 * extension is counted from the later of (current expiration, today) so repeated
 * extensions after expiry accumulate from today. A `For Checking` asset whose new
 * expiration date is in the future is restored to **Active**.
 */
export async function extendAssetLifespan(options: {
  assetId: string | number;
  months: number;
  notes?: string;
  actorId?: string | number | null;
}): Promise<{ expirationDate: string; status: string; statusRestored: boolean }> {
  const months = Number(options.months ?? 0);
  if (!Number.isFinite(months) || months < 1 || months > 120) {
    throw new Error('Enter a lifespan extension between 1 and 120 months.');
  }

  const now = new Date().toISOString();
  const { data: asset, error } = await supabase
    .from('assets')
    .select('id, Asset_name, Asset_code, Lifecycle_Status, expiration_date')
    .eq('id', options.assetId as any)
    .maybeSingle();
  if (error) throw error;
  if (!asset) throw new Error('Asset not found');

  const row = asset as any;
  const currentStatus = String(row.Lifecycle_Status ?? 'Active');
  if (currentStatus.trim().toLowerCase() === 'disposal' || currentStatus.trim().toLowerCase() === 'disposed') {
    throw new Error('Disposed assets cannot have their lifespan extended.');
  }

  const today = todayIso();
  const currentExpiry = String(row.expiration_date ?? '').slice(0, 10);
  const base = currentExpiry && currentExpiry > today ? currentExpiry : today;
  const newExpiration = addMonthsToDate(base, months);
  const newStatus = currentStatus === 'For Checking' ? 'Active' : currentStatus;

  const { error: updateError } = await supabase
    .from('assets')
    .update({ expiration_date: newExpiration, Lifecycle_Status: newStatus, updated_at: now })
    .eq('id', options.assetId as any);
  if (updateError) throw updateError;

  await writeAudit({
    actorId: options.actorId,
    assetId: options.assetId,
    actionType: 'UPDATE',
    description: `Asset lifespan extended by ${months} months`,
    notes: `New expiration date: ${newExpiration}${
      newStatus !== currentStatus ? `. Status restored to ${newStatus}.` : ` (status kept at ${newStatus})`
    }${options.notes ? `\nNotes: ${String(options.notes).trim()}` : ''}`,
  });

  return { expirationDate: newExpiration, status: newStatus, statusRestored: newStatus !== currentStatus };
}
