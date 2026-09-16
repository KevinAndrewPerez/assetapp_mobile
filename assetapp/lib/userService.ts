import AsyncStorage from '@react-native-async-storage/async-storage';
import bcrypt from 'bcryptjs';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, SUPABASE_URL } from './supabase';
import { resolveMediaUrl } from './mediaUrl';
import { writeAudit } from './auditService';
import {
  ApprovalReport,
  approveRequestWithEvaluation,
  isAssignmentRequest,
} from './requestService';
import { applyRequestStatusToRepairs } from './repairService';
import { applyRequestStatusToDisposals } from './disposalService';
import { createNotification, notifyAdmins } from './notificationService';

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

/**
 * The live `users` table has NO `full_name` column. Names live on the linked
 * `employee_numbers` row (`employee_numbers.Full_Name`), reached through the
 * `users.employee_numbers_id` foreign key. These helpers resolve embedded
 * relation objects (which PostgREST may return as an object or an array)
 * into the flat shape the rest of the app expects (e.g. `user.full_name`).
 */
const firstOf = (value: any): any => (Array.isArray(value) ? value?.[0] : value);

const resolveUserName = (user: any): string =>
  String(firstOf(user?.employee_numbers)?.Full_Name ?? user?.full_name ?? '');

const resolveUserDepartment = (user: any): string =>
  String(firstOf(user?.departments)?.Name ?? user?.department ?? '');

const resolveUserDepartmentId = (user: any): string | number | null =>
  user?.department_id ??
  firstOf(user?.employee_numbers)?.Department_id ??
  null;

const toStoredUser = (row: any): StoredUser => {
  const deptName = resolveUserDepartment(row);
  return {
    ...row,
    employee_numbers: firstOf(row?.employee_numbers) ?? undefined,
    departments: firstOf(row?.departments) ?? undefined,
    department_id: resolveUserDepartmentId(row),
    full_name: resolveUserName(row) || row?.full_name || '',
    department: deptName || row?.department || '',
    departmentName: deptName || row?.departmentName || '',
  } as StoredUser;
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
  imageUrl?: string;
  linkedAssets?: { code: string; name: string; imageUrl?: string }[];
};

export type RequestLinkedAsset = {
  id: string | number;
  code: string;
  name: string;
  imageUrl?: string;
};

export type RequestDetail = {
  id: string;
  requestId: string;
  requestType: string;
  status: string;
  reason: string;
  dateSubmitted: string;
  submittedBy: string;
  department: string;
  assignTo?: string;
  linkedAssets: RequestLinkedAsset[];
  attachedFileName?: string;
  attachedFileUrl?: string;
};

const resolveStorageUrl = (raw: any, fallbackBucket = 'assets'): string => resolveMediaUrl(raw, fallbackBucket);

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
      ? '#ECFDF5'
      : status === 'For Repair'
      ? '#FFFBEB'
      : status === 'Disposal'
      ? '#FEF2F2'
      : '#F4F7FB';

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

const resolveAssetFileUrl = (files: any): string => {
  const first = Array.isArray(files) ? files[0] : files;
  if (!first) return '';
  return resolveStorageUrl(first, 'assets');
};

const normalizeUserRequest = (row: any): UserRequest => {
  const status = String(row.status ?? row.request_status ?? 'Pending');
  const statusColor = status === 'Pending' ? '#F59E0B' : status === 'Approved' ? '#10B981' : '#EF4444';
  const statusBg = status === 'Pending' ? '#FFFBEB' : status === 'Approved' ? '#ECFDF5' : '#FEF2F2';
  const asset = row.assets ?? row.asset ?? null;
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const empNumbers = Array.isArray(user?.employee_numbers) ? user?.employee_numbers[0] : user?.employee_numbers;

  // A request may link several assets through `request_items`; resolve them all
  // (including each asset's photo from `asset_files`).
  const rawItems = Array.isArray(row.request_items)
    ? row.request_items
    : row.request_items
      ? [row.request_items]
      : [];
  const itemAssets = rawItems
    .map((it: any) => {
      const a = Array.isArray(it?.assets) ? it.assets[0] : it?.assets;
      if (!a) return null;
      const imageUrl = resolveAssetFileUrl(a.asset_files);
      return {
        code: String(a.Asset_code ?? ''),
        name: String(a.Asset_name ?? ''),
        imageUrl,
      };
    })
    .filter((a: any) => a && (a.code || a.name));

  const firstItem = itemAssets[0] ?? null;
  const directImage = resolveAssetFileUrl(asset?.asset_files);
  const title =
    itemAssets.length > 1
      ? `${firstItem.name || 'Asset'} +${itemAssets.length - 1} more`
      : String(asset?.Asset_name ?? asset?.name ?? firstItem?.name ?? row.title ?? 'Asset Request');
  const barcode = String(asset?.Asset_code ?? asset?.asset_code ?? firstItem?.code ?? row.asset_id ?? '');

  return {
    id: String(row.id ?? ''),
    title,
    requestType: String(row.request_type ?? row.type ?? 'Request'),
    status,
    statusColor,
    statusBg,
    reason: String(row.Note ?? row.note ?? row.reason ?? ''),
    dateSubmitted: new Date(String(row.created_at ?? row.createdAt ?? row.date ?? '')).toLocaleDateString(),
    barcode,
    assetId: barcode,
    submittedBy: String(empNumbers?.Full_Name ?? 'Unknown User'),
    department: String(user?.department_id ?? row.department ?? ''),
    imageUrl: firstItem?.imageUrl || directImage || '',
    linkedAssets: itemAssets.length > 0 ? itemAssets : undefined,
  };
};

/**
 * Full detail of a single request, including every linked asset (bulk requests)
 * and each asset's photo from `asset_files`.
 */
export async function fetchRequestDetail(
  requestId: string | number,
): Promise<RequestDetail | null> {
  const { data, error } = await supabase
    .from('requests')
    .select(
      `*, users:user_id(department_id, employee_numbers(Full_Name), departments:department_id(Name)), assets(Asset_code, Asset_name, asset_files(Asset_file_ID, file_name, file_path, url)), request_items(assets(Asset_code, Asset_name, asset_files(Asset_file_ID, file_name, file_path, url)))`,
    )
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch request detail:', error.message);
    throw error;
  }
  if (!data) return null;

  const user = Array.isArray(data.users) ? data.users[0] : data.users;
  const emp = Array.isArray(user?.employee_numbers) ? user?.employee_numbers[0] : user?.employee_numbers;
  const dept = Array.isArray(user?.departments) ? user?.departments[0] : user?.departments;
  const direct = Array.isArray(data.assets) ? data.assets[0] : data.assets;

  const rawItems = Array.isArray(data.request_items)
    ? data.request_items
    : data.request_items
      ? [data.request_items]
      : [];
  const linkedAssets: RequestLinkedAsset[] = [];
  const pushAsset = (a: any) => {
    if (!a) return;
    const id = a.id ?? '';
    if (linkedAssets.some((x) => String(x.id) === String(id) && id !== '')) return;
    linkedAssets.push({
      id,
      code: String(a.Asset_code ?? ''),
      name: String(a.Asset_name ?? ''),
      imageUrl: resolveAssetFileUrl(a.asset_files),
    });
  };

  rawItems.forEach((it: any) => pushAsset(Array.isArray(it?.assets) ? it.assets[0] : it?.assets));
  pushAsset(direct);

  const attachedFileUrl = data.url ? resolveStorageUrl(data.url, 'request_files') : '';

  return {
    id: String(data.id ?? ''),
    requestId: `REQ-${String(data.id ?? '')}`,
    requestType: String(data.request_type ?? 'Request'),
    status: String(data.status ?? 'Pending'),
    reason: String(data.Note ?? ''),
    dateSubmitted: new Date(String(data.created_at ?? '')).toLocaleDateString(),
    submittedBy: String(emp?.Full_Name ?? 'Unknown'),
    department: String(dept?.Name ?? user?.department_id ?? ''),
    assignTo: data.assign_to_user_id != null ? String(data.assign_to_user_id) : undefined,
    linkedAssets: linkedAssets.filter((a) => a.code || a.name),
    attachedFileName: String(data.file_name ?? ''),
    attachedFileUrl,
  };
}

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
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`id, email, department_id, role, status, profile_photo, created_at, updated_at, employee_numbers("Full_Name", "Department_id", "Employee_number"), departments:department_id("Name")`)
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      // Fallback: plain row (no embedded relations)
      const fallback = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      if (fallback.error) {
        console.error('Failed to fetch live user:', fallback.error.message);
        throw fallback.error;
      }
      return toStoredUser(fallback.data);
    }

    return toStoredUser(data);
  } catch (e: any) {
    console.error('Failed to fetch live user:', e?.message);
    throw e;
  }
}

export async function enrichUserWithEmployeeData(user: StoredUser): Promise<StoredUser> {
  const userId = String(user.id ?? '');
  if (!userId) return user;

  try {
    const { data, error } = await supabase
      .from('users')
      .select(`*, employee_numbers("Full_Name", "Department_id", "Employee_number"), departments:department_id("Name")`)
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      // Keep whatever we have stored locally.
      return user;
    }

    const enriched = toStoredUser(data);

    // Names/departments may be missing when the employee_numbers link is absent;
    // try to resolve the department name from either id we have.
    let deptName = enriched.department;
    const deptId = enriched.department_id ?? (user as any).department_id ?? null;
    if (!deptName && deptId != null) {
      try {
        const { data: deptData } = await supabase
          .from('departments')
          .select('Name')
          .eq('id', deptId)
          .maybeSingle();
        deptName = (deptData as any)?.Name || '';
      } catch { /* ignore */ }
    }

    return {
      ...user,
      ...enriched,
      role: enriched.role ?? user.role ?? 'Employee',
      department_id: deptId,
      full_name: enriched.full_name || user.full_name || '',
      department: deptName || user.department || '',
      departmentName: deptName || user.departmentName || '',
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
    .select('id, request_type, status, Note, created_at, users:user_id(department_id, employee_numbers(Full_Name)), assets(Asset_code, Asset_name, asset_files(Asset_file_ID, file_name, file_path, url)), request_items(assets(Asset_code, Asset_name, asset_files(Asset_file_ID, file_name, file_path, url)))')
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

/**
 * Create a request for one or more assets. `assetIds` may contain numeric ids
 * or Asset_code strings; each is resolved to an id. The request row keeps the
 * first asset as `requests.asset_id` (for backward compatibility) and every
 * asset is linked through `request_items`.
 */
export type RequestFile = {
  file_name?: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
  url?: string;
};

export async function submitUserRequest(
  user: StoredUser,
  requestType: string,
  assetIds: (string | number)[],
  note: string,
  file?: RequestFile | null,
) {
  const userId = user.id ?? null;
  if (!userId) {
    throw new Error('Current user is missing ID');
  }
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    throw new Error('Please select at least one asset before submitting.');
  }

  const resolvedIds: number[] = [];
  for (const raw of assetIds) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;

    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0 && !resolvedIds.includes(n)) resolvedIds.push(n);
      continue;
    }

    const { data: assetRow, error: assetErr } = await supabase
      .from('assets')
      .select('id')
      .eq('Asset_code', trimmed)
      .maybeSingle();
    if (assetErr) {
      console.error('Failed to resolve asset code to id:', assetErr.message);
      throw assetErr;
    }
    if (!assetRow?.id) {
      throw new Error(`Invalid asset code: ${trimmed} — no matching asset found.`);
    }
    const n = Number(assetRow.id);
    if (!resolvedIds.includes(n)) resolvedIds.push(n);
  }

  if (resolvedIds.length === 0) {
    throw new Error('No valid assets selected.');
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('requests')
    .insert([{
      user_id: userId,
      asset_id: resolvedIds[0],
      request_type: requestType,
      Note: note,
      status: 'Pending',
      file_name: file?.file_name ?? null,
      file_path: file?.file_path ?? null,
      file_size: file?.file_size ?? null,
      mime_type: file?.mime_type ?? null,
      url: file?.url ?? null,
      created_at: now,
      updated_at: now,
    }])
    .select('id')
    .single();
  if (error) {
    console.error('Failed to submit request:', error.message);
    throw error;
  }

  const requestId = (data as any)?.id;
  const { error: itemsError } = await supabase.from('request_items').insert(
    resolvedIds.map((assetId) => ({
      request_id: requestId,
      asset_id: assetId,
      created_at: now,
      updated_at: now,
    })),
  );
  if (itemsError) {
    console.error('Failed to link request items:', itemsError.message);
    throw itemsError;
  }

  // A request submitted by a user has to reach the Asset Management Office:
  // every admin gets a bell notification carrying the same reference the
  // Requests screen shows.
  const requester = String(user.full_name ?? user.email ?? 'A user');
  await notifyAdmins({
    title: `New ${requestType} Request — REQ-${requestId}`,
    message: `${requester} submitted a ${requestType} request for ${resolvedIds.length} asset${
      resolvedIds.length > 1 ? 's' : ''
    }.${note ? ` Note: ${note}` : ''}`,
    type: 'REQUEST',
    referenceId: requestId,
    referenceType: 'request',
  });

  return data;
}

/**
 * Upload a photo attached to a request into the `request_files` bucket (the
 * same bucket the web app uses) and return the fields stored on `requests`
 * (file_name / file_path / file_size / mime_type / url).
 */
export async function uploadRequestPhoto(uri: string): Promise<RequestFile> {
  const cleanedUri = String(uri ?? '').split('?')[0]?.split('#')[0] ?? '';
  const rawExt = cleanedUri.includes('.') ? cleanedUri.split('.').pop() : '';
  const fileExt = String(rawExt || 'jpg').toLowerCase();
  const fileName = `request_${Date.now()}.${fileExt}`;
  const filePath = `request_files/${fileName}`;

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

  const { error } = await supabase.storage.from('request_files').upload(filePath, arrayBuffer, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) {
    if (error.message.includes('Bucket not found')) {
      throw new Error('Supabase Storage bucket "request_files" not found. Please create it in your Supabase dashboard.');
    }
    if (error.message.toLowerCase().includes('row-level security')) {
      throw new Error('Photo upload blocked by Row Level Security on the "request_files" bucket.');
    }
    throw error;
  }

  const { data: publicUrl } = supabase.storage.from('request_files').getPublicUrl(filePath);
  const url = publicUrl?.publicUrl ?? '';

  return {
    file_name: fileName,
    file_path: filePath,
    file_size: arrayBuffer.byteLength,
    mime_type: contentType,
    url,
  };
}

export async function registerUser(payload: {
  fullName: string;
  email: string;
  departmentId: number | string;
  unitHeadsNumber: string;
  password: string;
  role?: string;
}) {
  const now = new Date().toISOString();

  // The live `users` table has no `full_name` / `unit_heads_number` columns:
  // the display name lives on `employee_numbers.Full_Name` and is linked via
  // `users.employee_numbers_id`. Create (or reuse) that record first.
  const employeeNumber = String(payload.unitHeadsNumber ?? '').trim();
  let employeeNumbersId: number | null = null;

  if (employeeNumber) {
    const { data: existingEmp, error: findEmpErr } = await supabase
      .from('employee_numbers')
      .select('id')
      .eq('Employee_number', employeeNumber)
      .maybeSingle();
    if (findEmpErr) {
      console.error('Failed to look up employee number:', findEmpErr.message);
      throw findEmpErr;
    }

    if (existingEmp?.id != null) {
      employeeNumbersId = Number(existingEmp.id);
      const { error: updateEmpErr } = await supabase
        .from('employee_numbers')
        .update({
          Full_Name: payload.fullName,
          Department_id: payload.departmentId,
          updated_at: now,
        })
        .eq('id', employeeNumbersId);
      if (updateEmpErr) {
        console.error('Failed to update employee record:', updateEmpErr.message);
        throw updateEmpErr;
      }
    } else {
      const { data: createdEmp, error: createEmpErr } = await supabase
        .from('employee_numbers')
        .insert([{
          Department_id: payload.departmentId,
          Full_Name: payload.fullName,
          Employee_number: employeeNumber,
          status: 'Active',
          created_at: now,
          updated_at: now,
        }])
        .select('id')
        .single();
      if (createEmpErr) {
        console.error('Failed to create employee record:', createEmpErr.message);
        throw createEmpErr;
      }
      employeeNumbersId = Number((createdEmp as any)?.id);
    }
  }

  // Passwords in this database are stored as bcrypt hashes (e.g. `$2y$12$...`).
  // bcryptjs emits `$2a$`, which Postgres `crypt()` verifies the same way.
  const passwordHash = await bcrypt.hash(payload.password, 12);

  const { data, error } = await supabase.from('users').insert([{
    department_id: payload.departmentId,
    employee_numbers_id: employeeNumbersId,
    email: payload.email,
    password: passwordHash,
    role: payload.role ?? 'Employee',
    status: 'Active',
    created_at: now,
    updated_at: now,
  }]).select().single();

  if (error) {
    console.error('Failed to register user:', error.message);
    throw error;
  }
  return data;
}

export async function searchUsers(query: string) {
  if (!query || query.length < 2) return [];

  // No `full_name` column on `users`: match against the linked
  // employee_numbers record and the email, then filter client-side.
  const { data, error } = await supabase
    .from('users')
    .select('id, email, employee_numbers(Full_Name, Employee_number), departments(Name)')
    .limit(50);

  if (error) {
    console.error('Failed to search users:', error.message);
    throw error;
  }

  const needle = query.toLowerCase();
  return (data ?? [])
    .filter((u: any) => {
      const emp = firstOf(u.employee_numbers);
      const fullName = String(emp?.Full_Name ?? '');
      const empNo = String(emp?.Employee_number ?? '');
      return (
        fullName.toLowerCase().includes(needle) ||
        empNo.toLowerCase().includes(needle) ||
        String(u.email ?? '').toLowerCase().includes(needle)
      );
    })
    .slice(0, 10)
    .map((u: any) => ({
      id: u.id,
      fullName: String(firstOf(u.employee_numbers)?.Full_Name ?? ''),
      email: u.email,
      departmentName: firstOf(u.departments)?.Name || 'No Department'
    }));
}

export async function updateRequestStatus(
  requestId: string,
  status: 'Pending' | 'In Progress' | 'Completed' | 'Cancelled' | 'Approved' | 'Rejected',
  adminId: string | number,
): Promise<ApprovalReport | null> {
  const { data: request, error: fetchError } = await supabase
    .from('requests')
    .select('*, assets(Asset_code, Asset_name)')
    .eq('id', requestId)
    .single();

  if (fetchError) throw fetchError;

  // ---------- Assignment requests (Transfer / asset request) ----------
  // Approving an issue/transfer request must NOT blindly override an asset's
  // lifecycle status: each linked asset is evaluated individually and only the
  // suitable ones are assigned. The report is returned so the UI can show
  // which assets were issued and which must run their own process first.
  if (status === 'Approved' && isAssignmentRequest(request.request_type)) {
    return approveRequestWithEvaluation({
      requestId: String(requestId ?? '').trim(),
      actorId: adminId,
      assignToUserId: (request as any).assign_to_user_id ?? null,
      notes: String(request.Note ?? request.note ?? ''),
    });
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('requests')
    .update({
      status,
      updated_at: now,
    })
    .eq('id', requestId);

  if (updateError) throw updateError;

  const note = String(request.Note ?? request.note ?? '');
  const isTerminal = status === 'Cancelled' || status === 'Rejected';
  const requestIdText = String(requestId ?? '').trim();

  // Resolve the asset(s) attached to this request. `requests.asset_id` is often
  // NULL in this database — assets get linked through `request_items` and the
  // per-asset log rows (repairs.Assets_id per Request_id), so fall back to those.
  const directAssetIdRaw = Number(request.asset_id);
  const hasDirectAsset = Number.isFinite(directAssetIdRaw) && directAssetIdRaw > 0;

  const linkedAssetIds: number[] = [];
  const pushAsset = (n: number) => {
    if (Number.isFinite(n) && n > 0 && !linkedAssetIds.includes(n)) linkedAssetIds.push(n);
  };
  if (hasDirectAsset) pushAsset(directAssetIdRaw);

  const { data: repairRows } = await supabase
    .from('repairs')
    .select('Repair_id, Assets_id, status')
    .eq('Request_id', requestIdText);
  const linkedRepairRows: any[] = Array.isArray(repairRows) ? repairRows : [];
  for (const row of linkedRepairRows) pushAsset(Number(row?.Assets_id));

  // Multi-asset requests are linked through `request_items`.
  const { data: itemRows } = await supabase
    .from('request_items')
    .select('asset_id')
    .eq('request_id', requestIdText);
  for (const row of (Array.isArray(itemRows) ? itemRows : [])) pushAsset(Number(row?.asset_id));

  // ---------- Repairs ----------
  // Repair decisions are applied per asset through the shared repair service:
  // it updates the repair row, moves the asset through its lifecycle, writes the
  // audit trail, notifies the owner and re-derives the request status. Every
  // write lands in the same rows the Laravel web app reads.
  if (request.request_type === 'Repair') {
    await applyRequestStatusToRepairs({
      requestId: requestIdText,
      status,
      actorId: adminId,
      actorLabel: await resolveApprover(adminId),
      notes: note,
    });
  }

  // ---------- Disposals ----------
  // A disposal is a reviewed transaction: approving it authorizes the disposal,
  // completing it marks the asset Disposed (never deleted) and cancelling it
  // returns the asset to the status it had before. Same rows the web reads.
  if (request.request_type === 'Disposal') {
    await applyRequestStatusToDisposals({
      requestId: requestIdText,
      status,
      actorId: adminId,
      actorLabel: await resolveApprover(adminId),
      notes: note,
    });
  }

  // ---------- Terminal pullout decisions ----------
  // Rejecting or cancelling a pullout request must also close its transaction;
  // the assets themselves stay exactly as they are (never hidden or deleted).
  if (request.request_type === 'Pullout' && isTerminal) {
    const decisionStatus = status === 'Rejected' ? 'rejected' : 'cancelled';
    const { error: cancelErr } = await supabase
      .from('pullouts')
      .update({ status: decisionStatus, updated_at: now })
      .eq('request_id', requestIdText);
    if (cancelErr) throw cancelErr;

    for (const assetId of linkedAssetIds) {
      await writeAudit({
        actorId: adminId,
        assetId,
        requestId: requestIdText,
        actionType: 'PULLOUT',
        description: `Pullout request ${decisionStatus}`,
        notes: note || `Pullout request ${decisionStatus}`,
      });
    }
  }

  // ---------- Approvals for the other request types ----------
  // (Repairs and disposals are handled above through their own per-asset
  // workflows, because their transitions are per asset, not per request.)
  if (
    status === 'Approved' &&
    request.request_type !== 'Repair' &&
    request.request_type !== 'Disposal' &&
    linkedAssetIds.length > 0
  ) {
    const approver = await resolveApprover(adminId);

    if (request.request_type === 'Pullout') {
      // Pullouts live in the `pullouts` table (not disposals); the DB/web uses
      // the literal status "Pullout" on the asset. Pulled-out assets are NOT
      // deleted or hidden — they stay in the inventory so departmental
      // reporting and the audit history remain intact.
      const { error: aErr } = await supabase
        .from('assets')
        .update({ Lifecycle_Status: 'Pullout', updated_at: now })
        .in('id', linkedAssetIds);
      if (aErr) throw aErr;

      // Approve the pullout transaction(s) already created for this request.
      const { data: existingTransactions } = await supabase
        .from('pullouts')
        .select('id')
        .eq('request_id', requestIdText);
      const transactionIds = (Array.isArray(existingTransactions) ? existingTransactions : [])
        .map((row: any) => row?.id)
        .filter((id: any) => id != null);

      if (transactionIds.length > 0) {
        const { error: syncErr } = await supabase
          .from('pullouts')
          .update({ status: 'approved', Approve_by: approver, updated_at: now })
          .in('id', transactionIds);
        if (syncErr) throw syncErr;
      } else {
        // Legacy request created before pullout transactions existed: group the
        // linked assets under one transaction, one item row per asset.
        const { data: header, error: headerErr } = await supabase
          .from('pullouts')
          .insert([
            {
              request_id: requestIdText,
              asset_id: linkedAssetIds[0],
              Approve_by: approver,
              Description: 'Approved pullout request',
              notes: note,
              pullout_date: now.slice(0, 10),
              status: 'approved',
              destination: null,
              expected_return_date: null,
              created_at: now,
              updated_at: now,
            },
          ])
          .select('id')
          .single();
        if (headerErr) throw headerErr;

        const headerId = (header as any)?.id;
        if (headerId != null) {
          const { error: itemsErr } = await supabase.from('pullout_items').insert(
            linkedAssetIds.map((assetId) => ({
              pullout_id: headerId,
              asset_id: assetId,
              created_at: now,
              updated_at: now,
            })),
          );
          if (itemsErr) throw itemsErr;
        }
      }

      for (const assetId of linkedAssetIds) {
        await writeAudit({
          actorId: adminId,
          assetId,
          requestId: requestIdText,
          actionType: 'PULLOUT',
          description: `Pullout request approved (${linkedAssetIds.length > 1 ? 'bulk' : 'single'})`,
          notes: note || 'Approved pullout request',
        });
      }
    } else if (request.request_type === 'Replacement') {
      // A `replacements` row needs both old and new asset ids; the new asset
      // is chosen later (web/admin), so only flag the old asset here.
      const { error: aErr } = await supabase
        .from('assets')
        .update({ Lifecycle_Status: 'For Replacement', updated_at: now })
        .in('id', linkedAssetIds);
      if (aErr) throw aErr;
    } else {
      const { error: auditErr } = await supabase.from('audit_logs').insert([{
        user_id: adminId,
        request_id: requestIdText,
        asset_id: linkedAssetIds[0],
        notes: note || `${request.request_type} request approved`,
        action_type: 'UPDATE',
        action_description: `${request.request_type} request approved`,
        created_at: now,
        updated_at: now,
      }]);
      if (auditErr) throw auditErr;
    }
  }

  // The requester hears about the decision — same notifications the web's
  // approve / reject endpoints send.
  if (status === 'Approved' || status === 'Rejected') {
    const requesterId = (request as any).user_id ?? null;
    if (requesterId != null) {
      const typeLabel = String(request.request_type ?? 'request');
      const directAsset = firstOf((request as any).assets);
      const assetLabel =
        [directAsset?.Asset_name, directAsset?.Asset_code].filter(Boolean).join(' ') ||
        (linkedAssetIds.length > 0
          ? `${linkedAssetIds.length} asset(s)`
          : 'your asset');
      const isReplacement = typeLabel.trim().toLowerCase().includes('replacement');

      await createNotification({
        userId: requesterId,
        title: isReplacement
          ? status === 'Approved'
            ? 'Replacement Request Approved'
            : 'Request Rejected'
          : `Request ${status}`,
        message:
          status === 'Approved'
            ? `Your ${typeLabel} request for ${assetLabel} has been approved by the Asset Management Office.`
            : `Your ${typeLabel} request for ${assetLabel} has been rejected. Please check your request for more details.`,
        type: 'REQUEST',
        referenceId: requestIdText,
        referenceType: 'request',
      });
    }
  }

  return null;
}

/**
 * Resolve an approver label for log tables. Existing rows store either an
 * email (e.g. alex@nu-lipa.edu.ph) or "Admin".
 */
async function resolveApprover(adminId: string | number): Promise<string> {
  try {
    const { data } = await supabase
      .from('users')
      .select('email')
      .eq('id', adminId as any)
      .maybeSingle();
    if (data?.email) return String(data.email);
  } catch {
    /* fall through */
  }
  return 'Admin';
}

export type PendingRequestAlert = {
  id: string;
  requestId: string;
  requestType: string;
  title: string;
  submittedBy: string;
  dateSubmitted: string;
  status: string;
  assetCode?: string;
};

/**
 * Pending requests submitted by employees / department heads — feeds the
 * "User Requests" alert on the admin dashboard (pending first).
 */
export async function fetchPendingRequestsForAlerts(limit = 25): Promise<PendingRequestAlert[]> {
  const { data, error } = await supabase
    .from('requests')
    .select(
      'id, request_type, status, Note, created_at, assets(Asset_code, Asset_name), users:user_id(employee_numbers(Full_Name))',
    )
    .eq('status', 'Pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    const emp = Array.isArray(user?.employee_numbers) ? user.employee_numbers[0] : user?.employee_numbers;
    return {
      id: String(row.id ?? ''),
      requestId: `REQ-${String(row.id ?? '')}`,
      requestType: String(row.request_type ?? 'Request'),
      title: String(asset?.Asset_name ?? row.request_type ?? 'Request'),
      submittedBy: String(emp?.Full_Name ?? 'Unknown'),
      dateSubmitted: new Date(String(row.created_at ?? '')).toLocaleDateString(),
      status: String(row.status ?? 'Pending'),
      assetCode: String(asset?.Asset_code ?? ''),
    };
  });
}

