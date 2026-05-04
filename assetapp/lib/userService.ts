import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type StoredUser = {
  id?: number | string;
  email?: string;
  full_name?: string;
  role?: string;
  status?: string;
  department?: string;
  unit_heads_number?: string;
  profile_photo?: string;
  [key: string]: any;
};

export type UserAsset = {
  id: string;
  name: string;
  category: string;
  barcode: string;
  qrCode?: string;
  status: string;
  statusColor: string;
  statusBg: string;
  location?: string;
  custodian?: string;
};

export type UserRequest = {
  id: string;
  title: string;
  requestType: string;
  status: string;
  statusColor: string;
  statusBg: string;
  reason: string;
  dateSubmitted: string;
  barcode: string;
  assetId: string;
  submittedBy: string;
  department: string;
};

const normalizeUserAsset = (row: any): UserAsset => {
  const status = String(row.status ?? row.current_status ?? 'Unknown');
  const statusColor =
    status === 'Active'
      ? '#10B981'
      : status === 'For Repair'
      ? '#F59E0B'
      : status === 'Disposed'
      ? '#EF4444'
      : '#64748B';
  const statusBg =
    status === 'Active'
      ? '#F0FDF4'
      : status === 'For Repair'
      ? '#FFFBEB'
      : status === 'Disposed'
      ? '#FEF2F2'
      : '#F8FAFC';

  return {
    id: String(row.id ?? row.asset_id ?? row.Asset_code ?? row.assetCode ?? ''),
    name: String(row.name ?? row.asset_name ?? row.Asset_name ?? 'Untitled Asset'),
    category: String(row.category ?? row.asset_category ?? 'Unknown'),
    barcode: String(row.asset_id ?? row.Asset_code ?? row.barcode ?? ''),
    qrCode: String(row.qr_code_path ?? row.qrCodePath ?? ''),
    status,
    statusColor,
    statusBg,
    location: String(row.location ?? row.asset_location ?? ''),
    custodian: String(row.unit_head ?? row.custodian ?? row.assigned_to ?? ''),
  };
};

const normalizeUserRequest = (row: any): UserRequest => {
  const status = String(row.status ?? row.request_status ?? 'Pending');
  const statusColor = status === 'Pending' ? '#F59E0B' : status === 'Approved' ? '#10B981' : '#EF4444';
  const statusBg = status === 'Pending' ? '#FFFBEB' : status === 'Approved' ? '#F0FDF4' : '#FEF2F2';
  const asset = row.assets ?? row.asset ?? null;
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

  return {
    id: String(row.id ?? ''),
    title: String(asset?.Asset_name ?? asset?.name ?? row.title ?? 'Asset Request'),
    requestType: String(row.request_type ?? row.type ?? 'Request'),
    status,
    statusColor,
    statusBg,
    reason: String(row.Note ?? row.note ?? row.reason ?? ''),
    dateSubmitted: new Date(String(row.created_at ?? row.createdAt ?? row.date ?? '')).toLocaleDateString(),
    barcode: String(asset?.Asset_code ?? asset?.asset_code ?? row.asset_id ?? ''),
    assetId: String(asset?.Asset_code ?? asset?.asset_code ?? row.asset_id ?? ''),
    submittedBy: String(profile?.full_name ?? profile?.name ?? 'You'),
    department: String(profile?.department_id ?? row.department ?? ''),
  };
};

export async function getStoredUser(): Promise<StoredUser | null> {
  const raw = await AsyncStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function fetchLiveUser(userId: number | string): Promise<StoredUser | null> {
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
  if (error) {
    console.error('Failed to fetch live user:', error.message);
    throw error;
  }
  return data as StoredUser;
}

export async function fetchUserAssets(user: StoredUser): Promise<UserAsset[]> {
  const department = String(user.department ?? '');
  const query = supabase.from('assets').select('*').order('updated_at', { ascending: false });

  if (department) {
    query.eq('department', department);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch user assets:', error.message);
    throw error;
  }

  return (data ?? []).map(normalizeUserAsset);
}

export async function fetchUserRequests(user: StoredUser): Promise<UserRequest[]> {
  const userId = String(user.id ?? '');
  const { data, error } = await supabase
    .from('requests')
    .select('id, request_type, status, Note, created_at, profiles:user_id(full_name, department_id), assets(Asset_code, Asset_name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch user requests:', error.message);
    throw error;
  }

  return (data ?? []).map(normalizeUserRequest);
}

export async function submitUserRequest(user: StoredUser, requestType: string, assetId: string, note: string) {
  const userId = user.id ?? null;
  if (!userId) {
    throw new Error('Current user is missing ID');
  }
  const payload: Record<string, any> = {
    user_id: userId,
    request_type: requestType,
    Note: note,
    status: 'Pending',
  };

  if (assetId) {
    payload.asset_id = assetId;
  }

  const { data, error } = await supabase.from('requests').insert([payload]).select().single();
  if (error) {
    console.error('Failed to submit request:', error.message);
    throw error;
  }
  return data;
}

export async function updateRequestStatus(requestId: string, status: 'Approved' | 'Rejected', adminId: string | number) {
  const { data: request, error: fetchError } = await supabase
    .from('requests')
    .select('*, assets(Asset_code, Asset_name)')
    .eq('id', requestId)
    .single();

  if (fetchError) throw fetchError;

  const { error: updateError } = await supabase
    .from('requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', requestId);

  if (updateError) throw updateError;

  // If approved, update asset status and log the activity
  if (status === 'Approved' && request.asset_id) {
    let newAssetStatus = 'Active';
    let logTable = 'audit_logs';
    let logType = 'audit';

    if (request.request_type === 'Repair') {
      newAssetStatus = 'For Repair';
      logTable = 'repairs';
      logType = 'repair';
    } else if (request.request_type === 'Pullout') {
      newAssetStatus = 'Pulled Out';
      logTable = 'disposals'; // Using disposals for pullouts as per assetService.ts
      logType = 'disposal';
    } else if (request.request_type === 'Replacement') {
      newAssetStatus = 'Replacement';
      logTable = 'replacements';
      logType = 'replacement';
    }

    // Update asset status
    await supabase
      .from('assets')
      .update({ Lifecycle_Status: newAssetStatus })
      .eq('Asset_code', request.asset_id);

    // Add log entry
    await supabase.from(logTable).insert([{
      asset_id: request.asset_id,
      title: `${request.request_type} Approved`,
      description: request.Note,
      performed_by: adminId,
      status: newAssetStatus,
      request_id: requestId,
      created_at: new Date().toISOString()
    }]);
  }

  return true;
}
