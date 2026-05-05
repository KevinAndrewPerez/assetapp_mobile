import { supabase } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

export type AssetSummary = {
  id: string;
  assetId: string;
  title: string;
  status: string;
  serialNumber?: string;
  location?: string;
  department?: string;
  departmentId?: string | number;
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

const normalizeAssetRecord = (record: any): AssetSummary => {
  const user = record.users || {};
  const department = user.departments || {};
  const deptName = department.Name || record.department || 'General';
  const deptId = department.id || user.department_id || '';
  
  return {
    id: String(record.id ?? ''),
    assetId: String(record.Asset_code ?? record.asset_id ?? record.barcode ?? ''),
    title: String(record.Asset_name ?? record.name ?? record.title ?? 'Untitled Asset'),
    status: String(record.Lifecycle_Status ?? record.status ?? 'Unknown'),
    serialNumber: String(record.serial_Number ?? record.serial_number ?? ''),
    location: String(record.asset_location ?? record.location ?? ''),
    department: String(deptName),
    departmentId: String(deptId),
    custodian: String(record.custodian ?? user.full_name ?? ''),
    acquisitionDate: String(record.accusion_date ?? record.acquisition_date ?? ''),
    category: String(record.Category ?? record.category ?? ''),
    updatedAt: String(record.updated_at ?? ''),
  };
};

const normalizeLifecycleRow = (row: any, eventType: LifecycleEvent['eventType'], index?: number): LifecycleEvent => {
  const asset = row.assets || row.old_assets || {};
  const user = row.users || {};
  const request = row.requests || {};
  const assetName = asset.Asset_name || row.asset_name || row.name || '';
  const assetCode = asset.Asset_code || row.asset_id || '';
  const userName = user.full_name || row.performed_by || row.Approve_by || 'Admin';

  let title = '';
  if (eventType === 'audit') {
    if (request.id) {
      title = `${row.notes || 'Action'} request (${request.request_type}) by ${userName}`;
    } else if (assetCode) {
      title = `${row.notes || 'Activity'} for ${assetCode} - ${assetName}`;
    } else {
      title = row.notes || 'System activity';
    }
  } else if (eventType === 'repair') {
    title = `Repair activity for ${assetCode}`;
  } else if (eventType === 'replacement') {
    title = `Replacement activity for ${assetCode}`;
  } else if (eventType === 'disposal') {
    title = `Disposal activity for ${assetCode}`;
  }

  return {
    id: String(row.id ?? `${eventType}-${row.asset_id ?? ''}-${row.created_at ?? ''}-${index ?? 0}`),
    eventType,
    title,
    description:
      String(
        row.description ??
          row.Note ??
          row.notes ??
          row.reason ??
          row.Repair_Description ??
          '',
      ),
    timestamp: normalizeTimestamp(row.created_at ?? row.updated_at ?? row.Repair_Date ?? row.disposal_date ?? row.pullout_date ?? ''),
    assetId: assetCode,
    department: String(row.department ?? asset.department ?? ''),
    performedBy: userName,
    reason: String(row.reason ?? row.Note ?? row.notes ?? ''),
    status: String(row.status ?? ''),
    requestId: String(row.request_id ?? ''),
    note: String(row.Note ?? row.notes ?? row.description ?? ''),
    assetName: assetName,
    barcode: assetCode,
    date: normalizeTimestamp(row.created_at ?? row.updated_at ?? ''),
    icon: String(row.icon ?? (eventType === 'audit' ? 'plus-circle' : eventType === 'repair' ? 'wrench' : eventType === 'replacement' ? 'swap-horizontal' : 'delete-circle')),
    iconColor: String(row.icon_color ?? (eventType === 'audit' ? '#3B82F6' : eventType === 'repair' ? '#F59E0B' : eventType === 'replacement' ? '#8B5CF6' : '#EF4444')),
    raw: row,
  };
};

async function insertRecord(table: string, payload: any) {
  const { data, error } = await supabase.from(table).insert([payload]).select().single();
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchAssets(): Promise<AssetSummary[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*, users(full_name, departments(Name))')
    .order('updated_at', { ascending: false });
    
  if (error) {
    throw error;
  }
  return (data ?? []).map(normalizeAssetRecord);
}

export async function fetchAssetsWithDepartments(): Promise<{ assets: AssetSummary[], departments: any[] }> {
  const [assetsRes, deptsRes] = await Promise.all([
    supabase.from('assets').select('*, users(full_name, departments(Name))'),
    supabase.from('departments').select('*').eq('status', 'Active')
  ]);

  if (assetsRes.error) throw assetsRes.error;
  if (deptsRes.error) throw deptsRes.error;

  return {
    assets: (assetsRes.data ?? []).map(normalizeAssetRecord),
    departments: deptsRes.data ?? []
  };
}

export async function updateDepartmentHead(departmentId: string | number, headName: string, headEmail: string) {
  // Since we don't have a direct "head" column in the departments table, 
  // we'll assume there's a convention or we use the users table to find the 'Department Head' role for this dept.
  // For now, based on the UI request, we'll try to find or update the user with the role 'Department Head' for this dept.
  
  const { data: headUser, error: findError } = await supabase
    .from('users')
    .select('id')
    .eq('department_id', departmentId)
    .eq('role', 'Department Head')
    .single();

  if (findError && findError.code !== 'PGRST116') throw findError;

  if (headUser) {
    const { error: updateError } = await supabase
      .from('users')
      .update({ full_name: headName, email: headEmail })
      .eq('id', headUser.id);
    if (updateError) throw updateError;
  } else {
    // Create one if it doesn't exist
    const { error: insertError } = await supabase
      .from('users')
      .insert([{
        full_name: headName,
        email: headEmail,
        department_id: departmentId,
        role: 'Department Head',
        unit_heads_number: 'N/A',
        password: 'password123', // Default
        status: 'Active'
      }]);
    if (insertError) throw insertError;
  }
  return true;
}

export async function fetchAssetLifecycle(assetId: string): Promise<LifecycleEvent[]> {
  const [auditRes, repairRes, replacementRes, disposalRes] = await Promise.all([
    supabase.from('audit_logs').select('*, assets(Asset_name, Asset_code), users(full_name, role), requests(id, request_type)').eq('asset_id', assetId),
    supabase.from('repairs').select('*, assets(Asset_name, Asset_code), requests(id, request_type)').eq('asset_id', assetId),
    supabase.from('replacements').select('*, old_assets:old_asset_id(Asset_name, Asset_code), requests(id, request_type)').eq('old_asset_id', assetId),
    supabase.from('disposals').select('*, assets(Asset_name, Asset_code), requests(id, request_type)').eq('asset_id', assetId),
  ]);

  const errors = [auditRes.error, repairRes.error, replacementRes.error, disposalRes.error].filter(Boolean);
  if (errors.length > 0) {
    throw errors[0];
  }

  const events = [
    ...(auditRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'audit', idx)),
    ...(repairRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'repair', idx)),
    ...(replacementRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'replacement', idx)),
    ...(disposalRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'disposal', idx)),
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
    supabase.from('audit_logs').select('*, assets(Asset_name, Asset_code), users(full_name, role), requests(id, request_type)'),
    supabase.from('repairs').select('*, assets(Asset_name, Asset_code), requests(id, request_type)'),
    supabase.from('replacements').select('*, old_assets:old_asset_id(Asset_name, Asset_code), requests(id, request_type)'),
    supabase.from('disposals').select('*, assets(Asset_name, Asset_code), requests(id, request_type)'),
  ]);

  const errors = [auditRes.error, repairRes.error, replacementRes.error, disposalRes.error].filter(Boolean);
  if (errors.length > 0) {
    throw errors[0];
  }

  const events = [
    ...(auditRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'audit', idx)),
    ...(repairRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'repair', idx)),
    ...(replacementRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'replacement', idx)),
    ...(disposalRes.data ?? []).map((row: any, idx: number) => normalizeLifecycleRow(row, 'disposal', idx)),
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
  userId: number | string;
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
  imageUrl?: string;
}) {
  // 1. Insert the asset record
  const asset = await insertRecord('assets', {
    user_id: payload.userId,
    Asset_code: payload.assetId,
    Asset_name: payload.title,
    Category: payload.category,
    Condition: payload.condition,
    Lifecycle_Status: payload.status ?? 'Acquired',
    accusion_date: payload.acquisitionDate,
    purchase_Price: payload.purchasePrice,
    warranty_months: payload.warrantyMonths,
    supplier: payload.supplier,
    model: payload.model,
    manufacture: payload.manufacturer,
    serial_Number: payload.serialNumber,
    asset_location: payload.location,
    url: payload.imageUrl,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // 2. Automatically create an audit log for the new registration
  try {
    await insertAuditLog({
      user_id: payload.userId,
      asset_id: asset.id,
      notes: `Registered new asset: ${payload.title} (${payload.assetId})`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (logError) {
    console.warn('Asset registered but audit log creation failed:', logError);
    // We don't throw here to ensure the user knows the registration itself succeeded
  }

  return asset;
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

export async function uploadAssetPhoto(assetId: string, uri: string) {
  try {
    const cleanedUri = uri.split('?')[0]?.split('#')[0] ?? uri;
    const rawExt = cleanedUri.includes('.') ? cleanedUri.split('.').pop() : '';
    const fileExt = String(rawExt || 'jpg').toLowerCase();
    const fileName = `${assetId}_${Date.now()}.${fileExt}`;
    const filePath = `photos/${fileName}`;

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const arrayBuffer = decode(base64);

    const contentType =
      fileExt === 'png'
        ? 'image/png'
        : fileExt === 'webp'
        ? 'image/webp'
        : fileExt === 'heic'
        ? 'image/heic'
        : fileExt === 'heif'
        ? 'image/heif'
        : 'image/jpeg';

    const { error } = await supabase.storage.from('assets').upload(filePath, arrayBuffer, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });

    if (error) {
      if (error.message.includes('Bucket not found')) {
        throw new Error('Supabase Storage bucket "assets" not found. Please create it in your Supabase dashboard.');
      }
      if (
        error.message.toLowerCase().includes('row-level security') ||
        error.message.toLowerCase().includes('violates row-level security')
      ) {
        throw new Error(
          'Supabase Storage upload blocked by Row Level Security (RLS). Add an INSERT policy for storage.objects on bucket "assets" (or disable RLS for storage.objects) so the client can upload files.',
        );
      }
      throw error;
    }

    const { data } = supabase.storage.from('assets').getPublicUrl(filePath);

    return data.publicUrl;
  } catch (error) {
    console.error('Error uploading photo:', error);
    throw error;
  }
}
