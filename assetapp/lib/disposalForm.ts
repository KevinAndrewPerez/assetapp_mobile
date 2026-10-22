/**
 * The official NU Lipa Disposal Form, as the phone sees it.
 *
 * This is the mobile counterpart of the web's `App\Support\DisposalForms`, and
 * deliberately so: both applications read and write the *same*
 * `disposal_forms` / `disposal_form_items` rows. Nothing here is a second
 * disposal record.
 *
 * Division of labour (the web's rule, copied rather than reinvented):
 *
 *   - Approving a disposal request authorizes preparation of the form. It does
 *     not dispose of anything, and it does not write a `disposals` row.
 *   - The form is generated with the request (one row per request, unique
 *     `request_id`) and prefilled from what is already recorded.
 *   - The web completes the official form, validates it, prints it, files the
 *     signed copy and performs the one explicit finalization that retires the
 *     assets.
 *   - The phone may display the stage and save the shared fields (office,
 *     expected date, method, remarks). It never prints, signs, finalizes or
 *     changes a lifecycle status.
 *
 * Stages, exactly the keys the web stores:
 *
 *   draft      Awaiting preparation
 *   ready      Ready to print
 *   printed    Printed — awaiting signed form
 *   signed     Signed form received
 *   finalized  Disposal finalized — the assets are now Disposed
 */
import { supabase } from './supabase';
import { writeAudit } from './auditService';
import { fetchActorProfile, officeRefusal } from './access';
import { toStoredTimestamp } from './time';

import {
  conditionCodeFor,
  isKnownStage,
  methodCode,
  methodLabel,
  methodOf,
  normalizeDisposalReason,
  normalizeStage,
  reasonCodeFor,
  stageHint,
  stageLabel,
  type DisposalFormStage,
} from './disposalRules';

// The stage names, method legend and reason codes are pure rules shared with
// the test harness; this module owns the database side.
export * from './disposalRules';

export type DisposalFormRecord = {
  id: string;
  requestId: string;
  stage: DisposalFormStage;
  stageLabel: string;
  stageHint: string;
  isFinalized: boolean;
  /** Fields the phone may change while the disposal is still in progress. */
  canEdit: boolean;
  officeDepartment: string;
  expectedDisposalDate: string;
  methodKey: string;
  methodText: string;
  remarks: string;
  approvedReason: string;
  preparedAt: string | null;
  readyAt: string | null;
  printedAt: string | null;
  printCount: number;
  signedReceivedAt: string | null;
  signedFileName: string | null;
  finalizedAt: string | null;
  actualDisposalDate: string;
  updatedAt: string | null;
};

const FORM_SELECT =
  'id, request_id, status, office_department, expected_disposal_date, method_key, method_code, remarks, approved_reason, prepared_at, ready_at, printed_at, print_count, signed_received_at, signed_file_name, finalized_at, actual_disposal_date, updated_at';

const isoDay = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const mapForm = (row: any): DisposalFormRecord => {
  const rawStage = String(row?.status ?? '').trim().toLowerCase();
  const known = isKnownStage(rawStage);
  const stage = normalizeStage(rawStage);
  const text = (value: unknown) => (value == null ? '' : String(value));

  return {
    id: text(row?.id),
    requestId: text(row?.request_id),
    stage,
    // An unrecognised stage is shown as such instead of being filed under
    // "awaiting preparation", and the phone will not edit a form it cannot name.
    stageLabel: known ? stageLabel(stage) : `Unknown stage (${rawStage || 'empty'})`,
    stageHint: known
      ? stageHint(stage)
      : 'This form is at a stage this app does not know. Check it on the web application.',
    isFinalized: stage === 'finalized',
    canEdit: known && stage !== 'finalized',
    officeDepartment: text(row?.office_department),
    expectedDisposalDate: text(row?.expected_disposal_date).slice(0, 10),
    methodKey: text(row?.method_key),
    methodText: methodLabel(row?.method_key),
    remarks: text(row?.remarks),
    approvedReason: text(row?.approved_reason),
    preparedAt: row?.prepared_at ? String(row.prepared_at) : null,
    readyAt: row?.ready_at ? String(row.ready_at) : null,
    printedAt: row?.printed_at ? String(row.printed_at) : null,
    printCount: Number(row?.print_count ?? 0) || 0,
    signedReceivedAt: row?.signed_received_at ? String(row.signed_received_at) : null,
    signedFileName: row?.signed_file_name ? String(row.signed_file_name) : null,
    finalizedAt: row?.finalized_at ? String(row.finalized_at) : null,
    actualDisposalDate: text(row?.actual_disposal_date).slice(0, 10),
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
  };
};

/** Has `2026_10_17_000000_create_disposal_forms_tables` run on this database? */
export async function disposalFormsReady(): Promise<boolean> {
  try {
    const { error } = await supabase.from('disposal_forms').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** The form of one request, or null when the web has not generated it. */
export async function fetchDisposalForm(requestId: string | number): Promise<DisposalFormRecord | null> {
  const { data, error } = await supabase
    .from('disposal_forms')
    .select(FORM_SELECT)
    .eq('request_id', requestId as any)
    .maybeSingle();

  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message)) return null;
    throw error;
  }

  return data ? mapForm(data) : null;
}

/** Forms for several requests at once, keyed by request id (console list). */
export async function fetchDisposalForms(
  requestIds: (string | number)[],
): Promise<Map<string, DisposalFormRecord>> {
  const byRequest = new Map<string, DisposalFormRecord>();
  const ids = Array.from(new Set(requestIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return byRequest;

  const { data, error } = await supabase.from('disposal_forms').select(FORM_SELECT).in('request_id', ids);
  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message)) return byRequest;
    throw error;
  }

  (data ?? []).forEach((row: any) => {
    const form = mapForm(row);
    byRequest.set(form.requestId, form);
  });
  return byRequest;
}

/** How many finalized `disposals` rows exist for this request. */
export async function recordedDisposalCount(requestId: string | number): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('disposals')
      .select('Disposal_ID', { count: 'exact', head: true })
      .eq('Request_id', requestId as any);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** The assets a request covers: `request_items` first, then the legacy column. */
async function assetIdsOfRequest(request: any): Promise<number[]> {
  const ids: number[] = [];

  const { data: items } = await supabase
    .from('request_items')
    .select('asset_id')
    .eq('request_id', request?.id as any);
  (items ?? []).forEach((row: any) => {
    const n = Number(row?.asset_id);
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
  });

  if (ids.length === 0) {
    const n = Number(request?.asset_id);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  }

  return ids;
}

/** The office the form is made out to: the requester's department. */
async function officeForRequest(requesterId: string | number | null | undefined): Promise<string | null> {
  if (requesterId === null || requesterId === undefined || requesterId === '') return null;
  try {
    const { data: user } = await supabase
      .from('users')
      .select('department_id')
      .eq('id', requesterId as any)
      .maybeSingle();
    const departmentId = (user as any)?.department_id;
    if (departmentId === null || departmentId === undefined) return null;

    const { data: department } = await supabase
      .from('departments')
      .select('Name')
      .eq('id', departmentId as any)
      .maybeSingle();
    return String((department as any)?.Name ?? '').trim() || null;
  } catch {
    return null;
  }
}

export type EnsureFormResult = {
  formId: string | null;
  created: boolean;
  /** Set when the form could not be generated — the approval must not claim it exists. */
  error: string | null;
};

/**
 * Generate (or return) the form for an approved disposal request — the phone's
 * half of the web's `DisposalForms::ensureForRequest()`.
 *
 * Idempotent: an existing form is returned, so a retried approval can never
 * create a second one. Items are prefilled from the assets (tag, description,
 * serial, acquisition date, location, custodian) and left in `draft`; the web
 * completes the official fields, validates and prints.
 */
export async function ensureDisposalFormForRequest(options: {
  requestId: string | number;
  actorId: string | number | null | undefined;
  approvedReason?: string | null;
  expectedDisposalDate?: string | null;
}): Promise<EnsureFormResult> {
  const requestId = Number(options.requestId);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return { formId: null, created: false, error: 'That request is not valid.' };
  }

  try {
    const existing = await fetchDisposalForm(requestId);
    if (existing) return { formId: existing.id, created: false, error: null };
  } catch (error) {
    return {
      formId: null,
      created: false,
      error: `The official disposal form could not be read: ${(error as Error).message}`,
    };
  }

  if (!(await disposalFormsReady())) {
    return {
      formId: null,
      created: false,
      error:
        'The disposal-form tables have not been created on this database, so the official form cannot be prepared. Nothing was approved.',
    };
  }

  try {
    const { data: request, error: requestError } = await supabase
      .from('requests')
      .select('id, request_type, status, Note, user_id, asset_id')
      .eq('id', requestId as any)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) return { formId: null, created: false, error: 'That request no longer exists.' };

    const assetIds = await assetIdsOfRequest(request);
    if (assetIds.length === 0) {
      return {
        formId: null,
        created: false,
        error: 'This request has no assets, so there is nothing for the official form to list.',
      };
    }

    const reason = normalizeDisposalReason(options.approvedReason, (request as any).Note);
    const office = await officeForRequest((request as any).user_id);

    const { data: assets } = await supabase
      .from('assets')
      .select(
        'id, Asset_code, Asset_name, serial_Number, accusion_date, asset_location, Condition, user_id, users:user_id(email, employee_numbers(Full_Name))',
      )
      .in('id', assetIds);

    if (!assets || assets.length === 0) {
      return {
        formId: null,
        created: false,
        error: 'The assets of this request no longer exist, so the disposal form cannot be prepared.',
      };
    }

    const now = toStoredTimestamp();
    const expectedDate = String(options.expectedDisposalDate ?? '').trim();

    const { data: inserted, error: insertError } = await supabase
      .from('disposal_forms')
      .insert([
        {
          request_id: requestId,
          status: 'draft',
          office_department: office,
          expected_disposal_date: /^\d{4}-\d{2}-\d{2}$/.test(expectedDate) ? expectedDate : null,
          approved_reason: reason,
          prepared_by: options.actorId ?? null,
          prepared_at: now,
          created_at: now,
          updated_at: now,
        },
      ])
      .select('id')
      .single();

    if (insertError) {
      // A racing insert is not a failure: read the winner's row.
      if (insertError.code === '23505') {
        const winner = await fetchDisposalForm(requestId);
        if (winner) return { formId: winner.id, created: false, error: null };
      }
      throw insertError;
    }

    const formId = String((inserted as any)?.id ?? '');
    const items = (assets as any[])
      .slice()
      .filter((asset) => asset?.id != null)
      .map((asset) => {
        const owner = Array.isArray(asset.users) ? asset.users[0] : asset.users;
        const employee = Array.isArray(owner?.employee_numbers)
          ? owner.employee_numbers[0]
          : owner?.employee_numbers;
        return {
          form_id: Number(formId),
          asset_id: Number(asset.id),
          tag_no: String(asset.Asset_code ?? '') || null,
          quantity: 1,
          description: String(asset.Asset_name ?? '') || null,
          serial_number: String(asset.serial_Number ?? '') || null,
          date_acquired: asset.accusion_date ? String(asset.accusion_date).slice(0, 10) : null,
          location: String(asset.asset_location ?? '') || null,
          custodian: String(employee?.Full_Name ?? owner?.email ?? '') || null,
          condition_code: conditionCodeFor(asset.Condition),
          reason_code: reasonCodeFor(reason),
          created_at: now,
          updated_at: now,
        };
      });

    if (items.length > 0) {
      const { error: itemsError } = await supabase.from('disposal_form_items').insert(items);
      if (itemsError) {
        // A form with no lines cannot be printed; remove it so the request is
        // not left looking prepared. The request itself is untouched here.
        await supabase.from('disposal_forms').delete().eq('id', formId as any);
        throw itemsError;
      }
    }

    return { formId, created: true, error: null };
  } catch (error) {
    console.error('Preparing the official disposal form failed:', error);
    return {
      formId: null,
      created: false,
      error:
        'The official disposal form could not be prepared, so the approval was not recorded. The web application lists this request under “awaiting preparation” if it was already approved.',
    };
  }
}

/** Remove a form this app has just generated, when the approval itself failed. */
export async function discardDisposalForm(formId: string | number | null | undefined): Promise<void> {
  if (formId === null || formId === undefined || formId === '') return;
  try {
    await supabase.from('disposal_forms').delete().eq('id', formId as any);
  } catch (error) {
    console.warn('Could not discard the unused disposal form:', error);
  }
}

export class StaleDisposalFormError extends Error {
  constructor() {
    super(
      'The official disposal form was changed by someone else (the web application or another phone) after you opened it. Reload to see the latest values before saving again.',
    );
    this.name = 'StaleDisposalFormError';
  }
}

export type DisposalFormValues = {
  officeDepartment: string;
  expectedDisposalDate: string;
  methodKey: string;
  remarks: string;
};

/**
 * Save the shared fields of one form.
 *
 * The form must belong to an approved disposal request, the actor must be the
 * Asset Management Office, and the row must still be the one that was loaded
 * (`updated_at` token) — a change made on the web or another phone raises
 * `StaleDisposalFormError` instead of being overwritten. The stage is never
 * changed here: readiness is the web's validation, not a phone decision.
 */
export async function saveDisposalForm(options: {
  requestId: string | number;
  actorId: string | number | null | undefined;
  values: DisposalFormValues;
  /** `updatedAt` of the form when it was loaded. */
  expectedUpdatedAt: string | null;
}): Promise<DisposalFormRecord> {
  const actor = await fetchActorProfile(options.actorId);
  const refusal = officeRefusal(actor, 'Only the Asset Management Office can edit the official disposal form.');
  if (refusal) throw new Error(refusal);

  const office = String(options.values.officeDepartment ?? '').trim();
  if (office.length > 150) throw new Error('The office/department cannot exceed 150 characters.');

  const date = String(options.values.expectedDisposalDate ?? '').trim();
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
    throw new Error('Enter a valid expected date of disposal.');
  }

  const methodKey = String(options.values.methodKey ?? '').trim();
  if (methodKey && !methodOf(methodKey)) throw new Error('Choose one of the listed methods of disposal.');

  const remarks = String(options.values.remarks ?? '').trim();
  if (remarks.length > 2000) throw new Error('The remarks cannot exceed 2000 characters.');

  const { data: request, error: requestError } = await supabase
    .from('requests')
    .select('id, request_type, status')
    .eq('id', options.requestId as any)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request) throw new Error('That disposal request no longer exists.');
  if (String((request as any).request_type ?? '').trim().toLowerCase() !== 'disposal') {
    throw new Error('The official disposal form can only be saved on a disposal request.');
  }
  if (String((request as any).status ?? '').trim().toLowerCase() !== 'approved') {
    throw new Error(
      `The form can be edited once the request is approved. This request is ${(request as any).status}.`,
    );
  }

  const form = await fetchDisposalForm(options.requestId);
  if (!form) {
    throw new Error(
      'The official form has not been generated for this request yet. Open the Disposal page on the web application to prepare it.',
    );
  }
  if (form.isFinalized) {
    throw new Error('This disposal has been finalized. The form is part of the record and can no longer be changed.');
  }

  const currentToken = form.updatedAt ?? null;
  if ((options.expectedUpdatedAt ?? null) !== currentToken) throw new StaleDisposalFormError();

  const now = toStoredTimestamp();
  let update = supabase
    .from('disposal_forms')
    .update({
      office_department: office || null,
      expected_disposal_date: date || null,
      method_key: methodKey || null,
      method_code: methodKey ? methodCode(methodKey) : null,
      remarks: remarks || null,
      updated_at: now,
    })
    .eq('id', form.id as any);

  update = currentToken ? update.eq('updated_at', currentToken) : update.is('updated_at', null);

  const { data: written, error: writeError } = await update.select('id');
  if (writeError) throw writeError;
  if (!written || written.length === 0) throw new StaleDisposalFormError();

  try {
    await writeAudit({
      actorId: options.actorId ?? null,
      requestId: options.requestId as any,
      actionType: 'DISPOSAL',
      description: `Official disposal form updated for request #${options.requestId}`,
      notes:
        `Request #${options.requestId}: office ${office || '—'}, expected date ${date || '—'}, ` +
        `method ${methodKey || '—'}, remarks ${remarks ? 'recorded' : '—'}. Saved from the mobile app by ${actor?.label ?? 'the office'}. ` +
        'The official form, printing and finalization stay in the web application.',
    });
  } catch (auditError) {
    console.warn('Disposal form saved, but the audit entry failed:', auditError);
  }

  const saved = await fetchDisposalForm(options.requestId);
  if (!saved) throw new Error('The form could not be read back after saving.');
  return saved;
}

/** Today's date as `yyyy-mm-dd` (local, never UTC-shifted). */
export const todayIsoDay = (): string => isoDay(new Date());
