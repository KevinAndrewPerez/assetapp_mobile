import { supabase } from './supabase';

export type AssetSummary = {
  id: string;
  assetId: string;
  title: string;
  status: string;
  serialNumber?: string;
  location?: string;
  department?: string;
  custodian?: string;
  acquisitionDate?: string;
  category?: string;
  updatedAt?: string;
};

export type LifecycleEvent = {
  id: string;
  eventType: 'audit' | 'repair' | 'replacement' | 'disposal';
  title: string;
  description: string;
  timestamp: string;
  assetId: string;
  department?: string;
  performedBy?: string;
  reason?: string;
  status?: string;
  requestId?: string;
  note?: string;
  assetName?: string;
  barcode?: string;
  date?: string;
  icon?: string;
  iconColor?: string;
  raw: any;
};

const normalizeTimestamp = (value: unknown) => {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const normalizeAssetRecord = (record: any): AssetSummary => ({
  id: String(record.id ?? record.asset_id ?? record.assetId ?? ''),
  assetId:
    String(record.asset_id ?? record.assetId ?? record.barcode ?? record.asset_code ?? '') ||
    'Unknown Asset ID',
  title: String(record.name ?? record.title ?? record.asset_name ?? 'Untitled Asset'),
  status: String(record.status ?? record.current_status ?? record.asset_status ?? 'Unknown'),
  serialNumber: String(record.serial_number ?? record.serialNumber ?? record.sn ?? ''),
  location: String(record.location ?? record.asset_location ?? ''),
  department: String(record.department ?? record.department_name ?? ''),
  custodian: String(record.custodian ?? record.unit_head ?? record.assigned_to ?? ''),
  acquisitionDate: String(record.acquisition_date ?? record.date_acquired ?? ''),
  category: String(record.category ?? record.asset_category ?? ''),
  updatedAt: String(record.updated_at ?? record.last_updated ?? ''),
});

const normalizeLifecycleRow = (row: any, eventType: LifecycleEvent['eventType']): LifecycleEvent => ({
  id: String(row.id ?? `${eventType}-${row.asset_id ?? row.assetId ?? ''}-${row.created_at ?? row.timestamp ?? row.date ?? ''}`),
  eventType,
  title:
    eventType === 'audit'
      ? String(row.action ?? row.title ?? 'Audit event')
      : eventType === 'repair'
      ? String(row.title ?? 'Repair event')
      : eventType === 'replacement'
      ? String(row.title ?? 'Replacement event')
      : String(row.title ?? 'Disposal event'),
  description:
    String(
      row.description ??
        row.note ??
        row.reason ??
        row.details ??
        row.status ??
        row.type ??
        '',
    ),
  timestamp: normalizeTimestamp(row.created_at ?? row.timestamp ?? row.date ?? row.logged_at ?? row.event_date ?? ''),
  assetId: String(row.asset_id ?? row.assetId ?? ''),
  department: String(row.department ?? row.department_name ?? ''),
  performedBy: String(row.performed_by ?? row.user ?? row.requested_by ?? ''),
  reason: String(row.reason ?? row.note ?? ''),
  status: String(row.status ?? row.current_status ?? ''),
  requestId: String(row.request_id ?? row.requestId ?? ''),
  note: String(row.note ?? row.description ?? ''),
  assetName: String(row.asset_name ?? row.name ?? row.title ?? row.assetId ?? ''),
  barcode: String(row.asset_id ?? row.assetId ?? ''),
  date: normalizeTimestamp(row.date ?? row.event_date ?? row.timestamp ?? row.created_at ?? ''),
  icon: String(row.icon ?? (eventType === 'audit' ? 'plus-circle' : eventType === 'repair' ? 'wrench' : eventType === 'replacement' ? 'swap-horizontal' : 'delete-circle')),
  iconColor: String(row.icon_color ?? row.iconColor ?? (eventType === 'audit' ? '#3B82F6' : eventType === 'repair' ? '#F59E0B' : eventType === 'replacement' ? '#8B5CF6' : '#EF4444')),
  raw: row,
});

async function insertRecord(table: string, payload: any) {
  const { data, error } = await supabase.from(table).insert([payload]).select().single();
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchAssets(): Promise<AssetSummary[]> {
  const { data, error } = await supabase.from('assets').select('*').order('updated_at', { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []).map(normalizeAssetRecord);
}

export async function fetchAssetLifecycle(assetId: string): Promise<LifecycleEvent[]> {
  const [auditRes, repairRes, replacementRes, disposalRes] = await Promise.all([
    supabase.from('audit_logs').select('*').eq('asset_id', assetId),
    supabase.from('repairs').select('*').eq('asset_id', assetId),
    supabase.from('replacements').select('*').eq('asset_id', assetId),
    supabase.from('disposals').select('*').eq('asset_id', assetId),
  ]);

  const errors = [auditRes.error, repairRes.error, replacementRes.error, disposalRes.error].filter(Boolean);
  if (errors.length > 0) {
    throw errors[0];
  }

  const events = [
    ...(auditRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'audit')),
    ...(repairRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'repair')),
    ...(replacementRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'replacement')),
    ...(disposalRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'disposal')),
  ];

  return events.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return aTime - bTime;
  });
}

export async function fetchActivityTimeline(): Promise<LifecycleEvent[]> {
  const [auditRes, repairRes, replacementRes, disposalRes] = await Promise.all([
    supabase.from('audit_logs').select('*'),
    supabase.from('repairs').select('*'),
    supabase.from('replacements').select('*'),
    supabase.from('disposals').select('*'),
  ]);

  const errors = [auditRes.error, repairRes.error, replacementRes.error, disposalRes.error].filter(Boolean);
  if (errors.length > 0) {
    throw errors[0];
  }

  const events = [
    ...(auditRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'audit')),
    ...(repairRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'repair')),
    ...(replacementRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'replacement')),
    ...(disposalRes.data ?? []).map((row) => normalizeLifecycleRow(row, 'disposal')),
  ];

  return events.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return bTime - aTime;
  });
}

export async function registerAsset(payload: {
  assetId: string;
  title: string;
  category?: string;
  condition?: string;
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  department?: string;
  custodian?: string;
  location?: string;
  acquisitionDate?: string;
  purchasePrice?: number;
  warrantyMonths?: number;
  supplier?: string;
  notes?: string;
  status?: string;
}) {
  return insertRecord('assets', {
    asset_id: payload.assetId,
    name: payload.title,
    category: payload.category,
    condition: payload.condition,
    serial_number: payload.serialNumber,
    model: payload.model,
    manufacturer: payload.manufacturer,
    department: payload.department,
    custodian: payload.custodian,
    location: payload.location,
    acquisition_date: payload.acquisitionDate,
    purchase_price: payload.purchasePrice,
    warranty_months: payload.warrantyMonths,
    supplier: payload.supplier,
    notes: payload.notes,
    status: payload.status ?? 'Acquired',
  });
}

export async function insertAuditLog(payload: Record<string, any>) {
  return insertRecord('audit_logs', payload);
}

export async function insertRepairEvent(payload: Record<string, any>) {
  return insertRecord('repairs', payload);
}

export async function insertReplacementEvent(payload: Record<string, any>) {
  return insertRecord('replacements', payload);
}

export async function insertDisposalEvent(payload: Record<string, any>) {
  return insertRecord('disposals', payload);
}
