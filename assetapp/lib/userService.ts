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
  assignedTo?: string;
  serialNumber?: string;
  acquisitionDate?: string;
  updatedAt?: string;
  department?: string;
  imageUrl?: string;
  purchasePrice?: string;
  nextMaintenance?: string;
  warrantyMonths?: string;
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
  const status = String(row.Lifecycle_Status ?? row.status ?? 'Unknown');
  const statusColor =
    status === 'Active'
      ? '#10B981'
      : status === 'For Repair'
      ? '#F59E0B'
      : status === 'Disposal'
      ? '#EF4444'
      : '#64748B';
  const statusBg =
    status === 'Active'
      ? '#F0FDF4'
      : status === 'For Repair'
      ? '#FFFBEB'
      : status === 'Disposal'
      ? '#FEF2F2'
      : '#F8FAFC';

  const linkedUser = row.users || (row as any).profiles || null;
  const empNumbers = Array.isArray(linkedUser?.employee_numbers)
    ? linkedUser.employee_numbers[0]
    : linkedUser?.employee_numbers;
  const deptInfo = Array.isArray(linkedUser?.departments)
    ? linkedUser.departments[0]
    : linkedUser?.departments;
  const assignedTo =
    String(empNumbers?.Full_Name || '') ||
    String(linkedUser?.full_name || '') ||
    String(row.custodian || '');

  const acquisitionRaw = row.accusion_date ?? row.acquisition_date ?? '';
  const warrantyRaw = row.warranty_months ?? row.warrantyMonths;
  let nextMaintenance = '';
  if (acquisitionRaw && warrantyRaw) {
    try {
      const d = new Date(String(acquisitionRaw));
      const months = Number(warrantyRaw) || 0;
      if (!Number.isNaN(d.getTime()) && months > 0) {
        d.setMonth(d.getMonth() + months);
        nextMaintenance = d.toISOString();
      }
    } catch {}
  }

  const purchasePriceRaw = row.purchase_Price ?? row.purchasePrice ?? row.purchase_price;
  let purchasePrice = '';
  if (purchasePriceRaw !== null && purchasePriceRaw !== undefined && String(purchasePriceRaw) !== '') {
    const num = Number(purchasePriceRaw);
    if (!Number.isNaN(num)) {
      purchasePrice = '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      purchasePrice = String(purchasePriceRaw);
    }
  }

  const assetFileImage = Array.isArray(row.asset_files)
    ? (row.asset_files[0] as any)?.file_path || (row.asset_files[0] as any)?.url
    : (row.asset_files as any)?.file_path || (row.asset_files as any)?.url;

  let imageUrl = String(row.url ?? row.imageUrl ?? row.image ?? assetFileImage ?? '');
  if (imageUrl && !imageUrl.startsWith('http') && imageUrl.startsWith('photos/')) {
    try {
      const { data } = supabase.storage.from('assets').getPublicUrl(imageUrl);
      if (data?.publicUrl) imageUrl = data.publicUrl;
    } catch {}
  }

  return {
    id: String(row.id ?? ''),
    name: String(row.Asset_name ?? row.name ?? 'Untitled Asset'),
    category: String(row.Category ?? row.category ?? 'Unknown'),
    barcode: String(row.Asset_code ?? row.barcode ?? ''),
    qrCode: String(row.qr_code_path ?? ''),
    status,
    statusColor,
    statusBg,
    location: String(row.asset_location ?? row.location ?? ''),
    custodian: String(row.custodian ?? ''),
    assignedTo,
    serialNumber: String(row.serial_Number ?? row.serial_number ?? ''),
    acquisitionDate: String(acquisitionRaw ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    department: String(deptInfo?.Name ?? row.department ?? ''),
    imageUrl,
    purchasePrice,
    nextMaintenance,
    warrantyMonths: String(warrantyRaw ?? ''),
  };
};

const normalizeUserRequest = (row: any): UserRequest => {
  const status = String(row.status ?? row.request_status ?? 'Pending');
  const statusColor = status === 'Pending' ? '#F59E0B' : status === 'Approved' ? '#10B981' : '#EF4444';
  const statusBg = status === 'Pending' ? '#FFFBEB' : status === 'Approved' ? '#F0FDF4' : '#FEF2F2';
  const asset = row.assets ?? row.asset ?? null;
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const empNumbers = Array.isArray(user?.employee_numbers) ? user?.employee_numbers[0] : user?.employee_numbers;

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
    submittedBy: String(empNumbers?.Full_Name ?? 'Unknown User'),
    department: String(user?.department_id ?? row.department ?? ''),
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
  let data: any = null;
  let error: any = null;

  try {
    const res = await supabase
      .from('users')
      .select(`id, email, full_name, department_id, role, status, unit_heads_number, profile_photo, created_at, updated_at, employee_numbers("Full_Name", "Department_id", "Employee_number"), departments:department_id("Name")`)
      .eq('id', userId)
      .single();
    data = res.data;
    error = res.error;
  } catch (e) {
    error = e;
  }

  if (error || !data) {
    try {
      const fallback = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      if (fallback.error) {
        console.error('Failed to fetch live user:', fallback.error.message);
        throw fallback.error;
      }
      return fallback.data as StoredUser;
    } catch (e2: any) {
      console.error('Failed to fetch live user:', e2?.message);
      throw e2;
    }
  }
  return data as StoredUser;
}

export async function enrichUserWithEmployeeData(user: StoredUser): Promise<StoredUser> {
  const userId = String(user.id ?? '');
  if (!userId) return user;

  try {
    let data: any = null;
    let err: any = null;

    try {
      const res = await supabase
        .from('users')
        .select(`*, employee_numbers("Full_Name", "Department_id", "Employee_number"), departments:department_id("Name")`)
        .eq('id', userId)
        .single();
      data = res.data;
      err = res.error;
    } catch (e) {
      err = e;
    }

    if (err || !data) {
      try {
        const fallback = await supabase
          .from('users')
          .select('*, employee_numbers("Full_Name", "Department_id")')
          .eq('id', userId)
          .single();
        if (!fallback.error && fallback.data) {
          data = fallback.data;
        } else {
          const basic = await supabase.from('users').select('*').eq('id', userId).single();
          if (!basic.error && basic.data) data = basic.data;
        }
      } catch {
        /* ignore */
      }
    }

    if (!data) return user;

    const empNumbers = Array.isArray((data as any).employee_numbers)
      ? (data as any).employee_numbers[0]
      : (data as any).employee_numbers;

    const dept = Array.isArray((data as any).departments)
      ? (data as any).departments[0]
      : (data as any).departments;

    const empDeptId = empNumbers?.Department_id;
    let deptName = dept?.Name || user.department || '';
    if (!deptName && empDeptId) {
      try {
        const { data: deptData } = await supabase
          .from('departments')
          .select('Name')
          .eq('id', empDeptId)
          .maybeSingle();
        deptName = (deptData as any)?.Name || '';
      } catch { /* ignore */ }
    }
    if (!deptName && (data as any).department_id) {
      try {
        const { data: deptData } = await supabase
          .from('departments')
          .select('Name')
          .eq('id', (data as any).department_id)
          .maybeSingle();
        deptName = deptName || (deptData as any)?.Name || '';
      } catch { /* ignore */ }
    }

    return {
      ...user,
      ...data,
      employee_numbers: empNumbers || (user as any).employee_numbers,
      department: deptName || user.department,
      departmentName: deptName,
    } as StoredUser;
  } catch (err) {
    console.warn('Failed to enrich user (continuing with stored user):', err);
    return user;
  }
}

export async function fetchUserAssets(user: StoredUser): Promise<UserAsset[]> {
  const userId = String(user.id ?? '');
  if (!userId) return [];

  let { data, error } = await supabase
    .from('assets')
    .select(`
      *,
      users ( employee_numbers("Full_Name"), departments("Name") ),
      asset_files ( file_path, url )
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Join-select failed, falling back to basic select:', error.message);
    const fallback = await supabase
      .from('assets')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (fallback.error) {
      console.error('Failed to fetch user assets:', fallback.error.message);
      throw fallback.error;
    }
    data = fallback.data;
  }

  return (data ?? []).map(normalizeUserAsset);
}

export async function fetchUserPendingRequestsCount(user: StoredUser): Promise<number> {
  const userId = String(user.id ?? '');
  if (!userId) return 0;

  const { count, error } = await supabase
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'Pending');

  if (error) {
    console.error('Failed to count pending requests:', error.message);
    return 0;
  }

  return count ?? 0;
}

export async function fetchUserRequests(user: StoredUser): Promise<UserRequest[]> {
  const userId = String(user.id ?? '');
  const { data, error } = await supabase
    .from('requests')
    .select('id, request_type, status, Note, created_at, profiles:user_id(full_name, department_id), assets(Asset_code, Asset_name)').select('id, request_type, status, Note, created_at, users:user_id(department_id, employee_numbers(Full_Name)), assets(Asset_code, Asset_name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch user requests:', error.message);
    throw error;
  }

  return (data ?? []).map(normalizeUserRequest);
}

export type DepartmentOption = {
  id: string | number;
  Name: string;
};

export async function fetchDepartments(): Promise<DepartmentOption[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, Name')
    .eq('status', 'Active')
    .order('Name', { ascending: true });

  if (error) {
    console.error('Failed to fetch departments:', error.message);
    throw error;
  }

  return (data ?? []) as DepartmentOption[];
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

  const trimmedAssetId = String(assetId ?? '').trim();
  if (trimmedAssetId) {
    const numericOnly = /^\d+$/.test(trimmedAssetId);
    if (!numericOnly) {
      const { data: assetRow, error: assetErr } = await supabase
        .from('assets')
        .select('id')
        .eq('Asset_code', trimmedAssetId)
        .maybeSingle();

      if (assetErr) {
        console.error('Failed to resolve asset code to id:', assetErr.message);
        throw assetErr;
      }

      if (!assetRow?.id) {
        throw new Error('Invalid asset code: no matching asset found.');
      }

      payload.asset_id = assetRow.id;
    } else {
      payload.asset_id = trimmedAssetId;
    }
  }

  const { data, error } = await supabase.from('requests').insert([payload]).select().single();
  if (error) {
    console.error('Failed to submit request:', error.message);
    throw error;
  }
  return data;
}

export async function registerUser(payload: {
  fullName: string;
  email: string;
  departmentId: number | string;
  unitHeadsNumber: string;
  password: string;
  role?: string;
}) {
  const { data, error } = await supabase.from('users').insert([{
    full_name: payload.fullName,
    email: payload.email,
    department_id: payload.departmentId,
    unit_heads_number: payload.unitHeadsNumber,
    password: payload.password, // In a real app, this should be hashed on the server side
    role: payload.role ?? 'Employee',
    status: 'Active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }]).select().single();

  if (error) {
    console.error('Failed to register user:', error.message);
    throw error;
  }
  return data;
}

export async function searchUsers(query: string) {
  if (!query || query.length < 2) return [];
  
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, departments(Name)')
    .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
    .limit(10);

  if (error) {
    console.error('Failed to search users:', error.message);
    throw error;
  }
  
  return (data ?? []).map((u: any) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    departmentName: (u.departments as any)?.Name || 'No Department'
  }));
}

export async function updateRequestStatus(
  requestId: string,
  status: 'Pending' | 'In Progress' | 'Completed' | 'Cancelled' | 'Approved' | 'Rejected',
  adminId: string | number
) {
  const { data: request, error: fetchError } = await supabase
    .from('requests')
    .select('*, assets(Asset_code, Asset_name)')
    .eq('id', requestId)
    .single();

  if (fetchError) throw fetchError;

  const { error: updateError } = await supabase
    .from('requests')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (updateError) throw updateError;

  if (request.request_type === 'Repair' && request.asset_id) {
    if (status === 'Completed') {
      await supabase
        .from('assets')
        .update({ Lifecycle_Status: 'Active' })
        .eq('id', request.asset_id);
    }

    if (status !== 'Pending' && status !== 'Cancelled') {
      await supabase.from('repairs').insert([{
        asset_id: request.asset_id,
        title: `${request.request_type} Updated`,
        description: request.Note,
        performed_by: adminId,
        status,
        request_id: requestId,
        created_at: new Date().toISOString(),
      }]);
    }
  }

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
      logTable = 'disposals';
      logType = 'disposal';
    } else if (request.request_type === 'Disposal') {
      newAssetStatus = 'Disposed';
      logTable = 'disposals';
      logType = 'disposal';
    } else if (request.request_type === 'Replacement') {
      newAssetStatus = 'Replacement';
      logTable = 'replacements';
      logType = 'replacement';
    }

    await supabase
      .from('assets')
      .update({ Lifecycle_Status: newAssetStatus })
      .eq('id', request.asset_id);

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
