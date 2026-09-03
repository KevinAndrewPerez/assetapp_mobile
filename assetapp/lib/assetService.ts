import { supabase } from './supabase';
import bcrypt from 'bcryptjs';
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
  imageUrl?: string;
};

/** Resolve an `asset_files` row to a public Supabase storage URL. */
const resolveFileUrl = (files: any): string => {
  const first = Array.isArray(files) ? files[0] : files;
  if (!first) return '';
  const raw = String(first?.url ?? first?.file_path ?? '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  // `/storage/assets/...` and `assets/...` both map to the assets bucket key.
  const clean = raw
    .replace(/^\/+/, '')
    .replace(/^storage\/v1\/object\/public\//, '')
    .replace(/^storage\/assets\//, '')
    .replace(/^assets\//, '');
  if (!clean) return '';
  const { data } = supabase.storage.from('assets').getPublicUrl(clean);
  return data?.publicUrl || '';
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

const normalizeLifecycleStatus = (value: unknown) => {
  const status = String(value ?? '').trim();
  const normalized = status.toLowerCase().replace(/[-_]/g, ' ');

  if (normalized === 'pullout' || normalized === 'pulled out') return 'Pulled Out';
  if (normalized === 'disposal' || normalized === 'disposed') return 'Disposed';
  if (normalized === 'repair') return 'For Repair';
  return status || 'Unknown';
};

// PostgREST embedded relations may come back as an object (to-one) or as an
// array; normalize both shapes.
const firstOf = (value: any): any => (Array.isArray(value) ? value?.[0] : value);

const resolveUserName = (user: any): string =>
  String(firstOf(user?.employee_numbers)?.Full_Name ?? user?.full_name ?? '');

const normalizeAssetRecord = (record: any): AssetSummary => {
  const user = firstOf(record.users) || {};
  const department = firstOf(user.departments) || {};
  const deptName = department.Name || record.department || 'General';
  const deptId = department.id || user.department_id || record.department_id || '';
  
  return {
    id: String(record.id ?? ''),
    assetId: String(record.Asset_code ?? record.asset_id ?? record.barcode ?? ''),
    title: String(record.Asset_name ?? record.name ?? record.title ?? 'Untitled Asset'),
    status: normalizeLifecycleStatus(record.Lifecycle_Status ?? record.status),
    serialNumber: String(record.serial_Number ?? record.serial_number ?? ''),
    location: String(record.asset_location ?? record.location ?? ''),
    department: String(deptName),
    departmentId: String(deptId),
    custodian: String(record.custodian ?? resolveUserName(user) ?? ''),
    acquisitionDate: String(record.accusion_date ?? record.acquisition_date ?? ''),
    category: String(record.Category ?? record.category ?? ''),
    updatedAt: String(record.updated_at ?? ''),
    imageUrl: resolveFileUrl(record.asset_files),
  };
};

const normalizeLifecycleRow = (row: any, eventType: LifecycleEvent['eventType'], index?: number): LifecycleEvent => {
  const asset = firstOf(row.assets) || firstOf(row.old_assets) || {};
  const user = firstOf(row.users) || {};
  const request = firstOf(row.requests) || {};
  const assetName = asset.Asset_name || row.asset_name || row.name || '';
  // `repairs` uses Assets_id, other log tables use asset_id.
  const assetCode = asset.Asset_code || row.Assets_id || row.asset_id || '';
  const userName = resolveUserName(user) || row.performed_by || row.Approve_by || 'Admin';

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
    // Primary keys differ per table (Repair_id, Replacement_id, Disposal_ID, id).
    id: String(row.id ?? row.Repair_id ?? row.Replacement_id ?? row.Disposal_ID ?? `${eventType}-${row.Assets_id ?? row.asset_id ?? ''}-${row.created_at ?? ''}-${index ?? 0}`),
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
    .select('*, users(department_id, employee_numbers("Full_Name"), departments(id, "Name")), asset_files("Asset_file_ID", file_name, file_path, url, mime_type)')
    .order('updated_at', { ascending: false });
    
  if (error) {
    throw error;
  }
  return (data ?? []).map(normalizeAssetRecord);
}

export async function fetchAssetsWithDepartments(): Promise<{ assets: AssetSummary[], departments: any[] }> {
  const [assetsRes, deptsRes] = await Promise.all([
    supabase.from('assets').select('*, users(department_id, employee_numbers("Full_Name"), departments(id, "Name")), asset_files("Asset_file_ID", file_name, file_path, url, mime_type)'),
    supabase.from('departments').select('*').eq('status', 'Active')
  ]);

  if (assetsRes.error) throw assetsRes.error;
  if (deptsRes.error) throw deptsRes.error;

  return {
    assets: (assetsRes.data ?? []).map(normalizeAssetRecord),
    departments: deptsRes.data ?? []
  };
}

export async function updateDepartmentHead(
  departmentId: string | number,
  options: { userId?: string | number; headName?: string; headEmail?: string },
) {
  const now = new Date().toISOString();
  const { userId, headName, headEmail } = options;

  // Find the current Department Head of this department, if any.
  const { data: currentHead, error: findError } = await supabase
    .from('users')
    .select('id')
    .eq('department_id', departmentId)
    .eq('role', 'Department Head')
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;

  // Preferred path: pick an existing user from this department.
  if (userId != null && String(userId).trim() !== '') {
    if (currentHead?.id != null && String(currentHead.id) !== String(userId)) {
      // Demote the previous head so the department keeps a single head.
      const { error: demoteError } = await supabase
        .from('users')
        .update({ role: 'Employee', updated_at: now })
        .eq('id', currentHead.id);
      if (demoteError) throw demoteError;
    }

    const { error: promoteError } = await supabase
      .from('users')
      .update({ role: 'Department Head', updated_at: now })
      .eq('id', userId);
    if (promoteError) throw promoteError;
    return true;
  }

  // Fallback (no user picked): update the existing head's name/email, or create
  // a Department Head user from scratch.
  if (currentHead?.id != null) {
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({ email: headEmail, updated_at: now })
      .eq('id', currentHead.id);
    if (userUpdateError) throw userUpdateError;

    if (headName) {
      const { data: headUser } = await supabase
        .from('users')
        .select('employee_numbers_id')
        .eq('id', currentHead.id)
        .single();
      if (headUser?.employee_numbers_id != null) {
        const { error: empUpdateError } = await supabase
          .from('employee_numbers')
          .update({ Full_Name: headName, updated_at: now })
          .eq('id', headUser.employee_numbers_id);
        if (empUpdateError) throw empUpdateError;
      }
    }
    return true;
  }

  // No Department Head user exists yet: create the employee record, then link
  // a users row to it.
  const { data: emp, error: empError } = await supabase
    .from('employee_numbers')
    .insert([{
      Department_id: departmentId,
      Full_Name: headName || 'Department Head',
      Employee_number: 'N/A',
      status: 'Active',
      created_at: now,
      updated_at: now,
    }])
    .select('id')
    .single();
  if (empError) throw empError;

  const passwordHash = await bcrypt.hash('password123', 12);
  const { error: insertError } = await supabase
    .from('users')
    .insert([{
      department_id: departmentId,
      employee_numbers_id: (emp as any)?.id ?? null,
      email: headEmail,
      password: passwordHash, // Default password; user should log in and change it
      role: 'Department Head',
      status: 'Active',
      created_at: now,
      updated_at: now,
    }]);
  if (insertError) throw insertError;
  return true;
}

export async function fetchAssetLifecycle(assetId: string): Promise<LifecycleEvent[]> {
  const [auditRes, repairRes, replacementRes, disposalRes] = await Promise.all([
    supabase.from('audit_logs').select('*, assets(Asset_name, Asset_code), users(role, employee_numbers("Full_Name")), requests(id, request_type)').eq('asset_id', assetId),
    supabase.from('repairs').select('*, assets(Asset_name, Asset_code), requests(id, request_type)').eq('Assets_id', assetId),
    supabase.from('replacements').select('*, old_assets:old_assets_id(Asset_name, Asset_code), requests(id, request_type)').eq('old_assets_id', assetId),
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

export async function fetchActivityTimeline(limit = 100): Promise<LifecycleEvent[]> {
  const [auditRes, repairRes, replacementRes, disposalRes] = await Promise.all([
    supabase.from('audit_logs').select('*, assets("Asset_name", "Asset_code"), users(role, employee_numbers("Full_Name")), requests(id, request_type)').order('created_at', { ascending: false }).limit(limit),
    supabase.from('repairs').select('*, assets("Asset_name", "Asset_code"), requests(id, request_type)').order('created_at', { ascending: false }).limit(limit),
    supabase.from('replacements').select('*, old_assets:old_assets_id(Asset_name, Asset_code), requests(id, request_type)').order('created_at', { ascending: false }).limit(limit),
    supabase.from('disposals').select('*, assets(Asset_name, Asset_code), requests(id, request_type)').order('created_at', { ascending: false }).limit(limit),
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
  lifespanMonths?: number;
  maintenanceInterval?: number;
  expirationDate?: string;
  nextMaintenanceDate?: string;
  supplier?: string;
  notes?: string;
  status?: string;
  imageUrl?: string;
}) {
  const now = new Date().toISOString();

  // 1. Insert the asset record. Note: the `assets` table has NO `url` column;
  //    photos are stored on `asset_files`, which reads already look them up on.
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
    lifespan_months: payload.lifespanMonths ?? null,
    maintenance_interval: payload.maintenanceInterval ?? null,
    expiration_date: payload.expirationDate ?? null,
    next_maintenance_date: payload.nextMaintenanceDate ?? null,
    supplier: payload.supplier,
    model: payload.model,
    manufacture: payload.manufacturer,
    serial_Number: payload.serialNumber,
    asset_location: payload.location,
    created_at: now,
    updated_at: now,
  });

  // 2. Persist the photo reference on `asset_files` (Asset_file_ID / Asset_id /
  //    file_name / file_path / file_size / mime_type / uploaded_at / url).
  if (payload.imageUrl) {
    try {
      const imageUrl = payload.imageUrl;
      const fileName = imageUrl.split('/').pop()?.split('?')[0] || 'asset-photo';
      const mimeType = /\.png($|\?)/i.test(imageUrl)
        ? 'image/png'
        : /\.webp($|\?)/i.test(imageUrl)
        ? 'image/webp'
        : /heic/i.test(imageUrl)
        ? 'image/heic'
        : 'image/jpeg';
      await insertRecord('asset_files', {
        Asset_id: asset.id,
        file_name: fileName,
        file_path: imageUrl,
        file_size: 0,
        mime_type: mimeType,
        uploaded_at: now,
        url: imageUrl,
        created_at: now,
        updated_at: now,
      });
    } catch (fileError) {
      console.warn('Asset registered but photo record failed:', fileError);
    }
  }

  // 3. Automatically create an audit log for the new registration
  try {
    await insertAuditLog({
      user_id: payload.userId,
      asset_id: asset.id,
      notes: `Registered new asset: ${payload.title} (${payload.assetId})`,
      action_type: 'CREATE',
      action_description: `New asset registered with code ${payload.assetId}`,
      created_at: now,
      updated_at: now,
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

export type MaintenanceAlert = {
  id: string | number;
  assetId: string;
  name: string;
  category?: string;
  status?: string;
  nextMaintenanceDate?: string | null;
  lastMaintenanceDate?: string | null;
  maintenanceInterval?: number | null;
  location?: string | null;
  custodian?: string;
  daysOverdue: number;
};

const unwrapCustodian = (user: any): string => {
  const emp = Array.isArray(user?.employee_numbers)
    ? user?.employee_numbers[0]
    : user?.employee_numbers;
  return String(emp?.Full_Name ?? user?.full_name ?? '');
};

/**
 * Assets whose next_maintenance_date is today or in the past (maintenance alerts),
 * mirroring the web's maintenance-alerts endpoint.
 */
export async function fetchMaintenanceAlerts(): Promise<MaintenanceAlert[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('assets')
    .select(
      'id, Asset_code, Asset_name, Category, Lifecycle_Status, next_maintenance_date, last_maintenance_date, maintenance_interval, asset_location, user_id, users(employee_numbers("Full_Name"))',
    )
    .not('next_maintenance_date', 'is', null)
    .lte('next_maintenance_date', today)
    .order('next_maintenance_date', { ascending: true });

  if (error) throw error;

  const todayMs = new Date(today).getTime();
  return (data ?? []).map((row: any) => ({
    id: row.id,
    assetId: String(row.Asset_code ?? ''),
    name: String(row.Asset_name ?? 'Asset'),
    category: row.Category ?? undefined,
    status: row.Lifecycle_Status ?? undefined,
    nextMaintenanceDate: row.next_maintenance_date ?? null,
    lastMaintenanceDate: row.last_maintenance_date ?? null,
    maintenanceInterval: row.maintenance_interval ?? null,
    location: row.asset_location ?? null,
    custodian: unwrapCustodian(row.users) || undefined,
    daysOverdue: row.next_maintenance_date
      ? Math.max(0, Math.floor((todayMs - new Date(row.next_maintenance_date).getTime()) / 86400000))
      : 0,
  }));
}

/** Add whole months to a YYYY-MM-DD date string, clamped to the target month's last day. */
const addMonthsToDate = (dateStr: string, months: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetMonth = m - 1 + months;
  const lastDay = new Date(y, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const date = new Date(y, targetMonth, day);
  return date.toISOString().slice(0, 10);
};

/**
 * Mark an asset's maintenance as complete (web parity): records last_maintenance_date,
 * reschedules next_maintenance_date by maintenance_interval months, moves an Active asset
 * to "For Checking", and logs the event in audit_logs.
 */
export async function completeMaintenance(options: {
  assetId: string | number;
  actorId?: string | number | null;
  notes?: string;
}): Promise<{ nextMaintenanceDate: string | null; status: string }> {
  const { assetId, actorId, notes } = options;
  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = nowIso.slice(0, 10);

  const { data: asset, error: fetchError } = await supabase
    .from('assets')
    .select('Asset_code, Asset_name, Lifecycle_Status, maintenance_interval, next_maintenance_date')
    .eq('id', assetId as any)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!asset || !asset.next_maintenance_date) {
    throw new Error('Asset has no maintenance schedule');
  }

  const interval = Number(asset.maintenance_interval ?? 0);
  const nextDate = interval > 0 ? addMonthsToDate(todayStr, interval) : null;
  const currentStatus = String(asset.Lifecycle_Status ?? 'Active');
  const newStatus = currentStatus === 'Active' ? 'For Checking' : currentStatus;

  const { error: updateError } = await supabase
    .from('assets')
    .update({
      last_maintenance_date: todayStr,
      next_maintenance_date: nextDate,
      Lifecycle_Status: newStatus,
      updated_at: nowIso,
    })
    .eq('id', assetId as any);
  if (updateError) throw updateError;

  const assetLabel = `${asset.Asset_name ?? 'Asset'} ${asset.Asset_code ?? ''}`.trim();
  const description =
    `Preventive maintenance for ${assetLabel} completed. Lifecycle status set to ${newStatus}.` +
    (nextDate ? ` Next maintenance scheduled for ${nextDate}.` : '');

  const { error: auditError } = await supabase.from('audit_logs').insert([{
    user_id: actorId ?? null,
    asset_id: assetId,
    notes: notes || `Maintenance completed on ${todayStr}`,
    action_type: 'UPDATE',
    action_description: description,
    created_at: nowIso,
    updated_at: nowIso,
  }]);
  if (auditError) throw auditError;

  return { nextMaintenanceDate: nextDate, status: newStatus };
}

export type ReplacementRecord = {
  replacementId: string;
  requestId: string;
  oldAsset: { id: string | number; code: string; name: string };
  newAsset: { id: string | number; code: string; name: string } | null;
  requestedBy: string;
  reason: string;
  status: 'Approved' | 'Received';
  createdAt: string;
};

/**
 * One record per `replacements` row (one old asset + its linked new asset),
 * skipping requests that are still Pending. A replacement whose new_assets_id
 * equals the old asset id is a placeholder (no real replacement linked yet).
 */
export async function fetchReplacementRecords(): Promise<ReplacementRecord[]> {
  const { data: requests, error: reqErr } = await supabase
    .from('requests')
    .select(`
      id, status, Note, created_at, asset_id,
      users:user_id (employee_numbers (Full_Name))
    `)
    .ilike('request_type', '%replacement%')
    .not('status', 'eq', 'Pending')
    .order('created_at', { ascending: false });
  if (reqErr) throw reqErr;

  const requestRows = (requests as any[] || []);
  const requestIds = requestRows.map((r: any) => String(r.id)).filter(Boolean);

  let replacementRows: any[] = [];
  if (requestIds.length > 0) {
    const { data, error } = await supabase
      .from('replacements')
      .select('Replacement_id, Request_id, old_assets_id, new_assets_id, status, reason, notes, Replacement_Date, created_at')
      .in('Request_id', requestIds)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Failed to fetch replacement rows:', error.message);
    } else {
      replacementRows = data || [];
    }
  }

  // Collect every referenced asset id (old + new) to resolve names/codes.
  const wantedIds: number[] = [];
  const want = (raw: any) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && !wantedIds.includes(n)) wantedIds.push(n);
  };
  requestRows.forEach((r: any) => want(r.asset_id));
  replacementRows.forEach((r: any) => {
    want(r.old_assets_id);
    want(r.new_assets_id);
  });

  let assetRows: any[] = [];
  if (wantedIds.length > 0) {
    const { data, error } = await supabase
      .from('assets')
      .select('id, Asset_code, Asset_name')
      .in('id', wantedIds);
    if (error) {
      console.error('Failed to fetch replacement assets:', error.message);
    } else {
      assetRows = data || [];
    }
  }

  const assetsById = new Map<string, { id: string | number; code: string; name: string }>();
  assetRows.forEach((a: any) => {
    if (a.id != null) {
      assetsById.set(String(a.id), {
        id: a.id,
        code: String(a.Asset_code ?? ''),
        name: String(a.Asset_name ?? 'Unknown Asset'),
      });
    }
  });

  const requestedByMap = new Map<string, string>();
  requestRows.forEach((r: any) => {
    requestedByMap.set(String(r.id), String(r.users?.employee_numbers?.Full_Name ?? 'Unknown'));
  });
  const records: ReplacementRecord[] = [];
  replacementRows.forEach((row: any) => {
    const old = assetsById.get(String(row.old_assets_id ?? '')) ?? {
      id: row.old_assets_id ?? '',
      code: String(row.old_assets_id ?? 'N/A'),
      name: 'No asset linked',
    };
    const same =
      row.new_assets_id != null &&
      row.old_assets_id != null &&
      String(row.new_assets_id) === String(row.old_assets_id);
    const next = !same ? assetsById.get(String(row.new_assets_id ?? '')) ?? null : null;
    records.push({
      replacementId: String(row.Replacement_id ?? ''),
      requestId: String(row.Request_id ?? ''),
      oldAsset: old,
      newAsset: next,
      requestedBy: requestedByMap.get(String(row.Request_id ?? '')) ?? 'Unknown',
      reason: String(row.reason ?? row.notes ?? 'Approved replacement request'),
      status: String(row.status ?? 'Approved') === 'Received' ? 'Received' : 'Approved',
      createdAt: new Date(row.created_at ?? row.Replacement_Date ?? '').toLocaleDateString(),
    });
  });

  // Fallback: approved/received requests with a direct asset but no rows yet.
  requestRows.forEach((r: any) => {
    const hasRow = replacementRows.some((x) => String(x.Request_id) === String(r.id));
    if (hasRow || r.asset_id == null) return;
    const old = assetsById.get(String(r.asset_id));
    if (!old) return;
    records.push({
      replacementId: `req-${r.id}`,
      requestId: String(r.id),
      oldAsset: old,
      newAsset: null,
      requestedBy: requestedByMap.get(String(r.id)) ?? 'Unknown',
      reason: String(r.Note ?? 'Approved replacement request'),
      status: String(r.status ?? 'Approved') === 'Received' ? 'Received' : 'Approved',
      createdAt: new Date(r.created_at ?? '').toLocaleDateString(),
    });
  });

  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Link an existing (scanned) asset as the replacement for an old asset.
 */
export async function linkReplacementAsset(
  replacementId: string | number,
  newAssetId: string | number,
  actorId?: string | number | null,
) {
  const now = new Date().toISOString();

  const { data: replacement, error: fetchErr } = await supabase
    .from('replacements')
    .select('Replacement_id, old_assets_id, new_assets_id, Request_id')
    .eq('Replacement_id', replacementId as any)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!replacement) throw new Error('Replacement record not found');
  if (String(replacement.old_assets_id) === String(newAssetId)) {
    throw new Error('The scanned asset is the same asset being replaced. Scan a different asset.');
  }

  const { data: newAsset } = await supabase
    .from('assets')
    .select('Asset_code, Asset_name')
    .eq('id', newAssetId as any)
    .maybeSingle();
  if (!newAsset) throw new Error('No asset found for the scanned code.');

  const { error: updErr } = await supabase
    .from('replacements')
    .update({ new_assets_id: newAssetId, updated_at: now })
    .eq('Replacement_id', replacementId as any);
  if (updErr) throw updErr;

  const label = `${newAsset.Asset_name ?? 'Asset'} ${newAsset.Asset_code ?? ''}`.trim();
  const { error: auditErr } = await supabase.from('audit_logs').insert([{
    user_id: actorId ?? null,
    asset_id: replacement.old_assets_id,
    request_id: replacement.Request_id ?? null,
    notes: `Replacement #${replacementId} linked to new asset ${label}`,
    action_type: 'REPLACEMENT',
    action_description: `Linked ${label} as the replacement for the old asset`,
    created_at: now,
    updated_at: now,
  }]);
  if (auditErr) throw auditErr;

  return newAsset;
}

/**
 * Mark a single replacement as Received: the new asset becomes Active and the
 * old asset moves to Pullout (mirrors the web's flow: "New asset Active; old
 * asset Pullout"). Requires a real new asset to be linked first.
 */
export async function markReplacementReceived(
  replacementId: string | number,
  actorId?: string | number | null,
) {
  const now = new Date().toISOString();

  const { data: replacement, error: fetchErr } = await supabase
    .from('replacements')
    .select('Replacement_id, old_assets_id, new_assets_id, Request_id, status')
    .eq('Replacement_id', replacementId as any)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!replacement) throw new Error('Replacement record not found');

  const newId = replacement.new_assets_id;
  if (newId == null || String(newId) === String(replacement.old_assets_id)) {
    throw new Error('Link a new asset to this replacement before marking it received.');
  }

  const { error: updErr } = await supabase
    .from('replacements')
    .update({ status: 'Received', updated_at: now })
    .eq('Replacement_id', replacementId as any);
  if (updErr) throw updErr;

  const { error: newErr } = await supabase
    .from('assets')
    .update({ Lifecycle_Status: 'Active', updated_at: now })
    .eq('id', newId as any);
  if (newErr) throw newErr;

  const { error: oldErr } = await supabase
    .from('assets')
    .update({ Lifecycle_Status: 'Pullout', updated_at: now })
    .eq('id', replacement.old_assets_id as any);
  if (oldErr) throw oldErr;

  const { error: auditErr } = await supabase.from('audit_logs').insert([{
    user_id: actorId ?? null,
    asset_id: replacement.old_assets_id,
    request_id: replacement.Request_id ?? null,
    notes: `Replacement #${replacementId} marked Received`,
    action_type: 'REPLACEMENT',
    action_description: 'New asset Active; old asset Pullout',
    created_at: now,
    updated_at: now,
  }]);
  if (auditErr) throw auditErr;

  return true;
}
