import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, SUPABASE_URL } from './supabase';

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
  userId: string;
  name: string;
  category: string;
  barcode: string;
  qrCode?: string;
  qrCodeUrl?: string;
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

const KNOWN_STORAGE_BUCKETS = ['assets', 'qr_codes', 'photos', 'public', 'asset_files'];
const PUBLIC_PREFIX = '/storage/v1/object/public/';

const resolveStorageUrl = (raw: any, fallbackBucket = 'assets'): string => {
  if (!raw) return '';

  // Unwrap object or stringified JSON
  let str = '';
  if (typeof raw === 'object' && raw !== null) {
    str = raw.url || raw.file_path || raw.path || raw.FilePath || '';
  } else {
    str = String(raw).trim();
    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const parsed = JSON.parse(str);
        str = parsed.url || parsed.file_path || parsed.path || parsed.FilePath || str;
      } catch {}
    }
  }

  if (!str) return '';

  // ---------- Already a full URL ----------
  if (str.startsWith('http://') || str.startsWith('https://')) {
    // Fix the exact double-nested patterns that appear in the logs
    str = str
      .replace(
        /\/storage\/v1\/object\/public\/assets\/storage\/assets\//g,
        '/storage/v1/object/public/assets/'
      )
      .replace(
        /\/storage\/v1\/object\/public\/assets\/storage\//g,
        '/storage/v1/object/public/assets/'
      )
      .replace(
        /\/storage\/assets\/storage\/assets\//g,
        '/storage/v1/object/public/assets/'
      );

    return str;
  }

  // ---------- Relative path ----------
  str = str.replace(/^\/+/, '');
  str = str.replace(/^storage\/v1\/object\/public\//, '');

  // Remove accidental "storage/assets/" or "assets/storage/assets/" prefixes
  str = str
    .replace(/^storage\/assets\//, '')
    .replace(/^assets\/storage\/assets\//, '')
    .replace(/^storage\//, '');

  // Detect real bucket from the path
  let targetBucket = fallbackBucket;
  for (const bucket of KNOWN_STORAGE_BUCKETS) {
    if (str.startsWith(`${bucket}/`)) {
      targetBucket = bucket;
      str = str.slice(bucket.length + 1);
      break;
    }
  }

  // Force everything into the only existing bucket (assets)
  // QR codes live under assets/qr/
  if (targetBucket === 'qr_codes') {
    targetBucket = 'assets';
    if (!str.startsWith('qr/')) {
      str = `qr/${str}`;
    }
  }

  // Encode each segment (important for iOS)
  const encodedPath = str
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const { data } = supabase.storage.from(targetBucket).getPublicUrl(encodedPath);
  return data?.publicUrl || '';
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
  const nativeNextMaint = row.next_maintenance_date ?? row.nextMaintenanceDate ?? null;
  let nextMaintenance = nativeNextMaint ? String(nativeNextMaint) : '';
  if (!nextMaintenance && acquisitionRaw && warrantyRaw) {
    try {
      const d = new Date(String(acquisitionRaw));
      const months = Number(warrantyRaw) || 0;
      if (!Number.isNaN(d.getTime()) && months > 0) {
        d.setMonth(d.getMonth() + months);
        nextMaintenance = d.toISOString();
      }
    } catch {}
  }

  const purchasePriceRaw = row.purchase_Price ?? row.purchasePrice ?? row.purchase_price ?? row.accusion_cost;
  let purchasePrice = '';
  if (purchasePriceRaw !== null && purchasePriceRaw !== undefined && String(purchasePriceRaw) !== '') {
    const num = Number(purchasePriceRaw);
    if (!Number.isNaN(num)) {
      purchasePrice = '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      purchasePrice = String(purchasePriceRaw);
    }
  }

  // Parse linked asset_files array properly
  const assetFilesList = Array.isArray(row.asset_files) ? row.asset_files : (row.asset_files ? [row.asset_files] : []);
  const firstAssetFile = assetFilesList[0] || null;

  // Resolve Image URL – always use the assets bucket
  const imageUrl = resolveStorageUrl(
    row.url ?? row.imageUrl ?? row.image_path ?? row.image ?? firstAssetFile ?? '',
    'assets'
  );

  // Resolve QR Code URL – helper will rewrite qr_codes → assets/qr/
  const qrCodeRawPath = row.qr_code_path || row.qr_code || row.qrCode || '';
  const qrCodeRawUrl = row.qr_code_url || row.qrCodeUrl || '';
  const qrCodeUrl = resolveStorageUrl(qrCodeRawUrl || qrCodeRawPath, 'qr_codes');

  return {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    name: String(row.Asset_name ?? row.name ?? 'Untitled Asset'),
    category: String(row.Category ?? row.category ?? 'Unknown'),
    barcode: String(row.Asset_code ?? row.barcode ?? ''),
    qrCode: qrCodeRawPath ? String(qrCodeRawPath) : '',
    qrCodeUrl,
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
      role: (data as any).role ?? user.role ?? 'Employee',
      department_id: (data as any).department_id ?? (user as any).department_id ?? empNumbers?.Department_id,
      employee_numbers: empNumbers || (user as any).employee_numbers,
      department: deptName || user.department,
      departmentName: deptName,
    } as StoredUser;
  } catch (err) {
    console.warn('Failed to enrich user (continuing with stored user):', err);
    return user;
  }
}

export async function fetchUserAssets(
  user: StoredUser,
  scope: 'own' | 'department' = 'own',
): Promise<UserAsset[]> {
  const userId = String(user.id ?? '');
  if (!userId) return [];

  let rows: any[] = [];
  const userDepartmentId =
    (user as any).department_id ??
    (Array.isArray((user as any).employee_numbers) ? (user as any).employee_numbers[0]?.Department_id : (user as any).employee_numbers?.Department_id) ??
    null;

  try {
    const baseQuery = supabase
      .from('assets')
      .select(`*, users ( employee_numbers("Full_Name"), departments("Name") )`);

    let finalQuery: any = baseQuery;
    if (scope === 'department' && userDepartmentId != null) {
      finalQuery = finalQuery.not('user_id', 'is', null);
    } else {
      finalQuery = finalQuery.eq('user_id', userId);
    }

    finalQuery = finalQuery.order('updated_at', { ascending: false });

    const { data, error } = await finalQuery;

    if (error || !data) {
      let fallbackBuilder = supabase.from('assets').select('*');
      if (scope === 'department' && userDepartmentId != null) {
        fallbackBuilder = fallbackBuilder.not('user_id', 'is', null) as any;
      } else {
        fallbackBuilder = fallbackBuilder.eq('user_id', userId) as any;
      }
      fallbackBuilder = fallbackBuilder.order('updated_at', { ascending: false });
      const fallback = await fallbackBuilder;
      if (fallback.error || !fallback.data) {
        console.error('Failed to fetch user assets:', fallback.error?.message);
        throw fallback.error ?? new Error('No asset data');
      }
      rows = fallback.data;
    } else {
      rows = data;
    }

    if (scope === 'department' && userDepartmentId != null && rows.length > 0) {
      const relevantUserIds = new Set<string>();
      try {
        const deptIdNum = Number(userDepartmentId);
        if (Number.isFinite(deptIdNum) && deptIdNum > 0) {
          const { data: deptUsers }: any = await supabase
            .from('users')
            .select('id, department_id, employee_numbers("Department_id")')
            .or(`department_id.eq.${deptIdNum}`);
          if (Array.isArray(deptUsers)) {
            for (const du of deptUsers) {
              const empNumbers = Array.isArray(du.employee_numbers) ? du.employee_numbers[0] : du.employee_numbers;
              const matchesDept =
                String(du.department_id) === String(deptIdNum) ||
                String(empNumbers?.Department_id) === String(deptIdNum);
              if (matchesDept && du.id != null) relevantUserIds.add(String(du.id));
            }
          }
        }
      } catch (deptErr: any) {
        console.warn('Could not resolve dept-scoped users, using raw assets:', deptErr?.message);
      }

      if (relevantUserIds.size > 0) {
        rows = rows.filter((r: any) => relevantUserIds.has(String(r.user_id)));
      }
    }
  } catch (err: any) {
    console.error('Failed to fetch user assets:', err?.message);
    throw err;
  }

  const assetIds = rows
    .map((r) => (r.id === null || r.id === undefined ? null : Number(r.id)))
    .filter((v): v is number => Number.isFinite(v));

  const filesByAssetId = new Map<number, any[]>();
  try {
    if (assetIds.length > 0) {
      const query = supabase
        .from('asset_files')
        .select('"Asset_file_ID", "Asset_id", file_name, file_path, url, mime_type');
      const fileResult = await (query as any).in('Asset_id', assetIds);
      const files = fileResult?.data;
      if (Array.isArray(files)) {
        files.forEach((f: any) => {
          const rawId = f != null ? (f['Asset_id'] ?? f.asset_id ?? f.AssetId ?? null) : null;
          if (rawId === null || rawId === undefined || rawId === '') return;
          const n = Number(rawId);
          if (Number.isInteger(n) && n > 0) {
            const list = filesByAssetId.get(n) ?? [];
            list.push(f);
            filesByAssetId.set(n, list);
          }
        });
      } else if (fileResult?.error) {
        console.warn('asset_files in() query failed, trying alternative:', fileResult.error?.message);
        const fallback: any[] = [];
        for (const aid of assetIds.slice(0, 30)) {
          try {
            const r = await supabase
              .from('asset_files')
              .select('*')
              .eq('"Asset_id"', aid);
            if (Array.isArray(r?.data)) fallback.push(...r.data.map((x: any) => ({ ...x, __aid: aid })));
          } catch {}
        }
        fallback.forEach((f: any) => {
          const n = Number(f.__aid ?? f['Asset_id'] ?? f.asset_id);
          if (Number.isInteger(n) && n > 0) {
            const list = filesByAssetId.get(n) ?? [];
            list.push(f);
            filesByAssetId.set(n, list);
          }
        });
      }
    }
  } catch (err: any) {
    console.warn('Failed to fetch asset_files separately:', err?.message);
  }

  return rows.map((raw) => {
    const assetId = Number(raw.id);
    if (Number.isFinite(assetId)) {
      const rawFiles = filesByAssetId.get(assetId);
      if (rawFiles && rawFiles.length > 0) {
        raw = { ...raw, asset_files: rawFiles };
      }
    }
    return normalizeUserAsset(raw);
  });
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

export async function fetchAssetCategories(): Promise<string[]> {
  try {
    const KNOWN_CATEGORIES = [
      'Furnitures and Fixtures',
      'General and Office Equipment',
      'Info and Equipment',
      'laboratory Apparatus and equipment',
      'library books',
      'Motor vehicles',
      'P.E Equipment',
      'Low value Asset',
    ];

    let live: string[] = [];
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('Category')
        .not('Category', 'is', null);

      if (!error && Array.isArray(data)) {
        const seen = new Set<string>();
        for (const r of data) {
          const cat = (r as any).Category;
          if (typeof cat === 'string' && cat.trim().length > 0 && !seen.has(cat)) {
            seen.add(cat);
            live.push(cat);
          }
        }
      }
    } catch (e) {
      live = [];
    }

    const merged = new Set<string>([...KNOWN_CATEGORIES, ...live]);
    const result = Array.from(merged).sort((a, b) => a.localeCompare(b));
    return result.length > 0 ? result : KNOWN_CATEGORIES;
  } catch (err) {
    console.warn('[fetchAssetCategories] failed:', err);
    return [
      'Furnitures and Fixtures',
      'General and Office Equipment',
      'Info and Equipment',
      'laboratory Apparatus and equipment',
      'library books',
      'Motor vehicles',
      'P.E Equipment',
      'Low value Asset',
    ];
  }
}

export async function fetchUserRequests(user: StoredUser): Promise<UserRequest[]> {
  const userId = String(user.id ?? '');
  const { data, error } = await supabase
    .from('requests')
    .select('id, request_type, status, Note, created_at, users:user_id(department_id, employee_numbers(Full_Name)), assets(Asset_code, Asset_name)')
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
    password: payload.password,
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