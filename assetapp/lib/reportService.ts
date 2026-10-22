/**
 * Mobile reports.
 *
 * The web Reports page is built around an export and a print sheet; the phone
 * deliberately has neither. What it does have is the same question the office
 * asks: "what happened this month, to which assets, and in what state?" This
 * module answers it with paged Supabase reads and the same six categories the
 * web catalogue uses.
 *
 * Every list is filtered in the database before it is cut into pages, so a
 * status or date filter covers the whole result rather than the rows already
 * on screen.
 */
import { supabase } from './supabase';
import { requireOfficeSession } from './access';
import { normalizeDisposalStatus } from './disposalService';
import {
  formatStoredDate,
  localDateEndStored,
  localDateStartStored,
  todayLocalIso,
} from './time';

export type ReportCategory =
  | 'inventory'
  | 'acquisitions'
  | 'repairs'
  | 'transfers'
  | 'disposals'
  | 'requests';

export type ReportPeriod =
  | 'all'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

export type ReportFilters = {
  category: ReportCategory;
  period: ReportPeriod;
  /** yyyy-mm-dd, used when period is custom. */
  from: string;
  /** yyyy-mm-dd, used when period is custom. */
  to: string;
  status: string;
  /** Request type; only the requests report uses it. */
  type: string;
};

export type ReportRow = {
  id: string;
  title: string;
  subtitle: string;
  meta: string[];
  status?: string;
};

export type ReportPage = {
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type ReportCategoryMeta = {
  key: ReportCategory;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  dateLabel: string;
  statusOptions: string[];
  typeOptions?: string[];
};

export const REPORT_PAGE_SIZE = 10;

export const REPORT_CATEGORIES: ReportCategoryMeta[] = [
  {
    key: 'inventory',
    label: 'Current Asset Inventory',
    shortLabel: 'Inventory',
    icon: 'archive-outline',
    description: 'What the institution holds right now, and where it is.',
    dateLabel: 'Date acquired',
    statusOptions: [
      'Active',
      'Acquired',
      'For Checking',
      'For Repair',
      'For Replacement',
      'Pullout',
      'Disposal',
    ],
  },
  {
    key: 'acquisitions',
    label: 'Asset Acquisitions',
    shortLabel: 'Acquired',
    icon: 'plus-circle-outline',
    description: 'Assets by the acquisition date recorded on the record.',
    dateLabel: 'Date acquired',
    statusOptions: [
      'Active',
      'Acquired',
      'For Checking',
      'For Repair',
      'For Replacement',
      'Pullout',
      'Disposal',
    ],
  },
  {
    key: 'repairs',
    label: 'Repairs and Maintenance',
    shortLabel: 'Repairs',
    icon: 'wrench-outline',
    description: 'Repair records with their workflow status and recorded cost.',
    dateLabel: 'Repair date',
    statusOptions: ['Pending', 'In Progress', 'Completed', 'Cancelled'],
  },
  {
    key: 'transfers',
    label: 'Asset Transfers',
    shortLabel: 'Transfers',
    icon: 'swap-horizontal',
    description: 'Assets handed from one accountable employee to another.',
    dateLabel: 'Date submitted',
    statusOptions: ['Pending', 'Approved', 'Rejected'],
  },
  {
    key: 'disposals',
    label: 'Asset Disposals',
    shortLabel: 'Disposals',
    icon: 'delete-outline',
    description: 'Assets recorded for disposal, and the state of each record.',
    dateLabel: 'Disposal date',
    statusOptions: ['Pending', 'Approved', 'Completed', 'Cancelled'],
  },
  {
    key: 'requests',
    label: 'Requests and Workflow Statuses',
    shortLabel: 'Requests',
    icon: 'file-document-outline',
    description: 'Every request with the workflow status it carries.',
    dateLabel: 'Date submitted',
    statusOptions: ['Pending', 'Approved', 'Rejected'],
    typeOptions: ['Repair', 'Disposal', 'Transfer', 'Replacement', 'Pullout'],
  },
];

export const REPORT_PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year', label: 'This year' },
  { key: 'last_year', label: 'Last year' },
  { key: 'custom', label: 'Custom' },
];

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  category: 'inventory',
  period: 'this_month',
  from: '',
  to: '',
  status: 'All',
  type: 'All',
};

export const categoryMeta = (category: ReportCategory): ReportCategoryMeta =>
  REPORT_CATEGORIES.find((entry) => entry.key === category) ?? REPORT_CATEGORIES[0];

/** Local calendar date, `yyyy-mm-dd`. */
const iso = (date: Date): string => todayLocalIso(date);

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0);

export type DateBounds = { from: string; to: string; label: string };

/**
 * Turn a preset (or the two custom dates) into inclusive calendar bounds.
 *
 * The phone's own calendar is used, not UTC, so "This Month" is the month the
 * person is actually working in.
 */
export function periodBounds(filters: ReportFilters): DateBounds {
  const now = new Date();

  switch (filters.period) {
    case 'this_month':
      return {
        from: iso(startOfMonth(now)),
        to: iso(endOfMonth(now)),
        label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      };
    case 'last_month': {
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        from: iso(startOfMonth(previous)),
        to: iso(endOfMonth(previous)),
        label: previous.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      };
    }
    case 'this_year':
      return {
        from: iso(new Date(now.getFullYear(), 0, 1)),
        to: iso(new Date(now.getFullYear(), 11, 31)),
        label: String(now.getFullYear()),
      };
    case 'last_year':
      return {
        from: iso(new Date(now.getFullYear() - 1, 0, 1)),
        to: iso(new Date(now.getFullYear() - 1, 11, 31)),
        label: String(now.getFullYear() - 1),
      };
    case 'custom':
      return {
        from: filters.from,
        to: filters.to,
        label:
          filters.from && filters.to
            ? `${formatStoredDate(filters.from)} - ${formatStoredDate(filters.to)}`
            : filters.from
              ? `From ${formatStoredDate(filters.from)}`
              : filters.to
                ? `Until ${formatStoredDate(filters.to)}`
                : 'Custom range',
      };
    default:
      return { from: '', to: '', label: 'All time' };
  }
}

/** Apply the report's date window to a date or timestamp column. */
function applyDate(
  query: any,
  field: string,
  kind: 'date' | 'timestamp',
  bounds: DateBounds,
): any {
  let next = query;

  // Date columns store a calendar day, so the chosen day is compared as-is.
  // Timestamp columns store naive UTC: the local day has to be converted, or a
  // UTC+8 phone loses the first/last eight hours of every period
  // (`lib/time.ts → localDateStartStored`).
  const from = kind === 'date' ? bounds.from : localDateStartStored(bounds.from);
  const to = kind === 'date' ? bounds.to : localDateEndStored(bounds.to);

  if (from) next = next.gte(field, from);
  if (to) next = next.lte(field, to);

  return next;
}

function rangeFor(page: number, pageSize = REPORT_PAGE_SIZE) {
  const from = page * pageSize;
  return { from, to: from + pageSize - 1 };
}

function fail(error: unknown, fallback: string): never {
  throw new Error((error as any)?.message || fallback);
}

const assetLabel = (asset: any): string => {
  const name = String(asset?.Asset_name ?? '').trim();
  const code = String(asset?.Asset_code ?? '').trim();
  if (name && code) return `${name} (${code})`;
  return name || code || 'Asset';
};

const ref = (prefix: string, value: unknown): string =>
  `${prefix}-${String(value ?? '').padStart(4, '0')}`;

const nested = (value: any): any => (Array.isArray(value) ? value[0] : value);

/* ─────────────────────────── category readers ─────────────────────────── */

async function inventoryPage(
  filters: ReportFilters,
  bounds: DateBounds,
  page: number,
): Promise<ReportPage> {
  const { from, to } = rangeFor(page);

  let query = supabase
    .from('assets')
    .select(
      'id, Asset_code, Asset_name, Category, Lifecycle_Status, asset_location, accusion_date',
      { count: 'exact' },
    );

  if (filters.status !== 'All') query = query.eq('Lifecycle_Status', filters.status);
  query = applyDate(query, 'accusion_date', 'date', bounds);

  const { data, count, error } = await query
    .order('Asset_name', { ascending: true })
    .range(from, to);

  if (error) fail(error, 'Could not load the asset inventory.');

  const rows = (data ?? []).map((row: any) => ({
    id: String(row.id),
    title: assetLabel(row),
    subtitle: [row.Category, row.asset_location].filter(Boolean).join(' | ') || 'No category or location',
    meta: [`Acquired ${formatStoredDate(row.accusion_date) || 'not recorded'}`],
    status: String(row.Lifecycle_Status ?? 'Acquired'),
  }));

  return pageResult(rows, count, page);
}

async function acquisitionPage(
  filters: ReportFilters,
  bounds: DateBounds,
  page: number,
): Promise<ReportPage> {
  // Acquisitions are assets with an acquisition date in the period. The
  // inventory reader would include undated rows; this report deliberately does
  // not, because there is no acquisition event to place on the timeline.
  const { from, to } = rangeFor(page);

  let query = supabase
    .from('assets')
    .select(
      'id, Asset_code, Asset_name, Category, Lifecycle_Status, asset_location, accusion_date',
      { count: 'exact' },
    )
    .not('accusion_date', 'is', null);

  if (filters.status !== 'All') query = query.eq('Lifecycle_Status', filters.status);
  query = applyDate(query, 'accusion_date', 'date', bounds);

  const { data, count, error } = await query
    .order('accusion_date', { ascending: false })
    .range(from, to);

  if (error) fail(error, 'Could not load acquisitions.');

  const rows = (data ?? []).map((row: any) => ({
    id: String(row.id),
    title: assetLabel(row),
    subtitle: [row.Category, row.asset_location].filter(Boolean).join(' | ') || 'No category or location',
    meta: [`Acquired ${formatStoredDate(row.accusion_date)}`],
    status: String(row.Lifecycle_Status ?? 'Acquired'),
  }));

  return pageResult(rows, count, page);
}

async function repairPage(
  filters: ReportFilters,
  bounds: DateBounds,
  page: number,
): Promise<ReportPage> {
  const { from, to } = rangeFor(page);

  let query = supabase
    .from('repairs')
    .select(
      'Repair_id, Assets_id, Repair_Date, status, Repair_Cost, Repair_Description, Repair_result',
      { count: 'exact' },
    );

  if (filters.status !== 'All') query = query.eq('status', filters.status);
  query = applyDate(query, 'Repair_Date', 'timestamp', bounds);

  const { data, count, error } = await query
    .order('Repair_Date', { ascending: false })
    .range(from, to);

  if (error) fail(error, 'Could not load repairs.');

  const rows = data ?? [];
  const assetIds = Array.from(
    new Set(rows.map((row: any) => row.Assets_id).filter((id: any) => id != null)),
  );

  let assetsById = new Map<string, any>();
  if (assetIds.length > 0) {
    const assets = await supabase
      .from('assets')
      .select('id, Asset_code, Asset_name')
      .in('id', assetIds);

    if (assets.error) fail(assets.error, 'Could not load the repaired assets.');
    assetsById = new Map((assets.data ?? []).map((asset: any) => [String(asset.id), asset]));
  }

  const mapped = rows.map((row: any) => {
    const asset = assetsById.get(String(row.Assets_id)) ?? {};
    const cost = Number(row.Repair_Cost ?? 0);
    return {
      id: String(row.Repair_id),
      title: assetLabel(asset),
      subtitle: String(row.Repair_Description ?? 'No description').trim(),
      meta: [
        `Repair date ${formatStoredDate(row.Repair_Date)}`,
        cost > 0 ? `Cost PHP ${cost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : 'Cost not recorded',
        row.Repair_result ? `Result: ${row.Repair_result}` : '',
      ].filter(Boolean),
      status: String(row.status ?? 'Pending'),
    };
  });

  return pageResult(mapped, count, page);
}

async function transferPage(
  filters: ReportFilters,
  bounds: DateBounds,
  page: number,
): Promise<ReportPage> {
  const { from, to } = rangeFor(page);

  let query = supabase
    .from('requests')
    .select('id, status, Note, created_at, user_id, assign_to_user_id', { count: 'exact' })
    .eq('request_type', 'Transfer');

  if (filters.status !== 'All') query = query.eq('status', filters.status);
  query = applyDate(query, 'created_at', 'timestamp', bounds);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) fail(error, 'Could not load transfers.');

  const rows = data ?? [];
  const userIds = Array.from(
    new Set(
      rows
        .flatMap((row: any) => [row.user_id, row.assign_to_user_id])
        .filter((id: any) => id != null),
    ),
  );

  let namesById = new Map<string, string>();
  if (userIds.length > 0) {
    const people = await supabase
      .from('users')
      .select('id, email, employee_numbers(Full_Name)')
      .in('id', userIds);

    if (people.error) fail(people.error, 'Could not load the people on these transfers.');
    namesById = new Map(
      (people.data ?? []).map((person: any) => [
        String(person.id),
        String(nested(person.employee_numbers)?.Full_Name ?? person.email ?? 'Unknown'),
      ]),
    );
  }

  const mapped = rows.map((row: any) => {
    const fromName = namesById.get(String(row.user_id)) ?? 'Unknown';
    const toName = namesById.get(String(row.assign_to_user_id)) ?? 'Unassigned';
    return {
      id: String(row.id),
      title: ref('TR', row.id),
      subtitle: `${fromName} -> ${toName}`,
      meta: [
        `Submitted ${formatStoredDate(row.created_at)}`,
        String(row.Note ?? '').trim(),
      ].filter(Boolean),
      status: String(row.status ?? 'Pending'),
    };
  });

  return pageResult(mapped, count, page);
}

async function disposalPage(
  filters: ReportFilters,
  bounds: DateBounds,
  page: number,
): Promise<ReportPage> {
  const { from, to } = rangeFor(page);

  let query = supabase
    .from('disposals')
    .select(
      'Disposal_ID, Asset_id, Request_id, disposal_date, Description, disposal_reason, notes, Approve_by',
      { count: 'exact' },
    );

  if (filters.status !== 'All') {
    // Disposal state lives in the notes field in the web and mobile writers'
    // shared `Status: X` format; filtering here keeps the page count honest.
    query = query.ilike('notes', `%Status: ${filters.status}%`);
  }

  query = applyDate(query, 'disposal_date', 'date', bounds);

  const { data, count, error } = await query
    .order('disposal_date', { ascending: false })
    .range(from, to);

  if (error) fail(error, 'Could not load disposals.');

  const rows = data ?? [];
  const assetIds = Array.from(
    new Set(rows.map((row: any) => row.Asset_id).filter((id: any) => id != null)),
  );

  let assetsById = new Map<string, any>();
  if (assetIds.length > 0) {
    const assets = await supabase
      .from('assets')
      .select('id, Asset_code, Asset_name')
      .in('id', assetIds);

    if (assets.error) fail(assets.error, 'Could not load the disposed assets.');
    assetsById = new Map((assets.data ?? []).map((asset: any) => [String(asset.id), asset]));
  }

  const mapped = rows.map((row: any) => {
    const asset = assetsById.get(String(row.Asset_id)) ?? {};
    const note = String(row.notes ?? '');
    const stored = /Status:\s*([^|]+)/i.exec(note)?.[1] ?? '';
    return {
      id: String(row.Disposal_ID),
      title: assetLabel(asset),
      subtitle:
        String(row.disposal_reason ?? '').trim() ||
        String(row.Description ?? '').trim() ||
        'No reason recorded',
      meta: [
        `Disposal date ${formatStoredDate(row.disposal_date) || 'not recorded'}`,
        String(row.Approve_by ?? '').trim() ? `Recorded by ${String(row.Approve_by).trim()}` : '',
        row.Request_id ? ref('REQ', row.Request_id) : '',
      ].filter(Boolean),
      status: normalizeDisposalStatus(stored),
    };
  });

  return pageResult(mapped, count, page);
}

async function requestPage(
  filters: ReportFilters,
  bounds: DateBounds,
  page: number,
): Promise<ReportPage> {
  const { from, to } = rangeFor(page);

  let query = supabase
    .from('requests')
    .select('id, request_type, status, Note, created_at', { count: 'exact' });

  if (filters.status !== 'All') query = query.eq('status', filters.status);
  if (filters.type !== 'All') query = query.eq('request_type', filters.type);
  query = applyDate(query, 'created_at', 'timestamp', bounds);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) fail(error, 'Could not load requests.');

  const mapped = (data ?? []).map((row: any) => ({
    id: String(row.id),
    title: `${ref('REQ', row.id)} | ${String(row.request_type ?? 'Request')}`,
    subtitle: String(row.Note ?? '').trim() || 'No note recorded',
    meta: [`Submitted ${formatStoredDate(row.created_at)}`],
    status: String(row.status ?? 'Pending'),
  }));

  return pageResult(mapped, count, page);
}

function pageResult(rows: ReportRow[], count: number | null, page: number): ReportPage {
  const total = Number(count ?? rows.length);
  return {
    rows,
    total,
    page,
    pageSize: REPORT_PAGE_SIZE,
    hasMore: (page + 1) * REPORT_PAGE_SIZE < total,
  };
}

/**
 * One page of the selected report.
 *
 * The category decides which table and which date field; status and period are
 * applied in the same query, before `.range()` cuts the page.
 */
export async function fetchReportPage(
  filters: ReportFilters,
  page = 0,
): Promise<ReportPage> {
  // Reports are institution-wide, so they belong to the Asset Management
  // Office. The route is guarded too, but a direct call must not be able to
  // read every table with the anon key and an Employee session.
  await requireOfficeSession('Reports belong to the Asset Management Office.');

  const bounds = periodBounds(filters);

  switch (filters.category) {
    case 'acquisitions':
      return acquisitionPage(filters, bounds, page);
    case 'repairs':
      return repairPage(filters, bounds, page);
    case 'transfers':
      return transferPage(filters, bounds, page);
    case 'disposals':
      return disposalPage(filters, bounds, page);
    case 'requests':
      return requestPage(filters, bounds, page);
    case 'inventory':
    default:
      return inventoryPage(filters, bounds, page);
  }
}
