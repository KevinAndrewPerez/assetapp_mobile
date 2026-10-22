/**
 * Assets that have reached the proposed service-life mark, offered for review.
 *
 * The mobile half of the web's `App\Support\AssetAgeReview`, and deliberately
 * read-only for the same reason: reaching the age mark is a prompt for the
 * Asset Management Office to look at an asset, not a decision that it should be
 * disposed of. Nothing here creates a disposal request, approves one, or writes
 * a lifecycle status.
 *
 * The university has not confirmed three years as an enforced disposal rule, so
 * the mark stays a review prompt and lives in configuration — the web reads
 * `DISPOSAL_AGE_REVIEW_YEARS`, the phone reads its `EXPO_PUBLIC_` twin, and
 * both default to the proposed figure of 3.
 */
import { supabase } from './supabase';
import { INVENTORY_REMOVED_AT, inventoryRemovalReady } from './inventory';

export const AGE_REVIEW_DEFAULT_YEARS = 3;
export const AGE_REVIEW_PAGE_SIZE = 25;

/** `assets.accusion_date` is the schema's spelling of the acquisition date. */
export const ACQUISITION_COLUMN = 'accusion_date';

/** Lifecycle values that mean the asset has already left service. */
export const RETIRED_LIFECYCLE_STATUSES = ['Disposal', 'Pullout'];

/** The proposed mark, in whole years (never below one). */
export function ageReviewYears(): number {
  const configured = Number(String(process.env.EXPO_PUBLIC_DISPOSAL_AGE_REVIEW_YEARS ?? '').trim());
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : AGE_REVIEW_DEFAULT_YEARS;
}

export const ageReviewThresholdLabel = (years = ageReviewYears()): string =>
  `${years} ${years === 1 ? 'year' : 'years'}`;

/** The first acquisition date that counts as having reached the mark. */
export function ageReviewCutoff(years = ageReviewYears(), now: Date = new Date()): string {
  const cutoff = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
}

/** Whole years of service for an acquisition date, or null when unreadable. */
export function yearsOfService(dateAcquired: unknown, now: Date = new Date()): number | null {
  const day = String(dateAcquired ?? '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;

  let years = now.getFullYear() - year;
  const anniversaryPassed = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= date);
  if (!anniversaryPassed) years -= 1;

  return Math.max(0, years);
}

export type AgeReviewAsset = {
  id: string;
  code: string;
  name: string;
  category: string;
  condition: string;
  lifecycleStatus: string;
  dateAcquired: string;
  ageYears: number | null;
  location: string;
  purchasePrice: string;
  custodian: string;
  department: string;
};

export type AgeReviewPage = { rows: AgeReviewAsset[]; hasMore: boolean };

/** Resolve custodians and departments for a page of assets. */
async function decorate(rows: any[]): Promise<AgeReviewAsset[]> {
  const userIds = Array.from(new Set(rows.map((row) => row?.user_id).filter((id) => id !== null && id !== undefined)));

  const users = new Map<string, { fullName: string; departmentId: unknown }>();
  if (userIds.length > 0) {
    const { data } = await supabase
      .from('users')
      .select('id, department_id, employee_numbers (Full_Name)')
      .in('id', userIds as any[]);

    (data ?? []).forEach((user: any) => {
      const employee = Array.isArray(user?.employee_numbers) ? user.employee_numbers[0] : user?.employee_numbers;
      users.set(String(user.id), {
        fullName: String(employee?.Full_Name ?? '').trim(),
        departmentId: user?.department_id ?? null,
      });
    });
  }

  const departmentIds = Array.from(
    new Set(Array.from(users.values()).map((user) => user.departmentId).filter((id) => id !== null && id !== undefined)),
  );
  const departments = new Map<string, string>();
  if (departmentIds.length > 0) {
    const { data } = await supabase.from('departments').select('id, Name').in('id', departmentIds as any[]);
    (data ?? []).forEach((department: any) => departments.set(String(department.id), String(department.Name ?? '')));
  }

  return rows.map((row) => {
    const user = users.get(String(row?.user_id ?? ''));
    const dateAcquired = String(row?.[ACQUISITION_COLUMN] ?? '');
    return {
      id: String(row?.id ?? ''),
      code: String(row?.Asset_code ?? ''),
      name: String(row?.Asset_name ?? ''),
      category: String(row?.Category ?? ''),
      condition: String(row?.Condition ?? ''),
      lifecycleStatus: String(row?.Lifecycle_Status ?? ''),
      dateAcquired,
      ageYears: yearsOfService(dateAcquired),
      location: String(row?.asset_location ?? ''),
      purchasePrice: row?.purchase_Price == null ? '' : String(row.purchase_Price),
      custodian: user?.fullName ?? '',
      department: user?.departmentId == null ? '' : departments.get(String(user.departmentId)) ?? '',
    } satisfies AgeReviewAsset;
  });
}

/**
 * One page of assets at or past the mark, oldest first.
 *
 * Excludes assets already retired, assets removed from the inventory, and
 * assets with no acquisition date — an age cannot be calculated from a date
 * that was never recorded.
 */
export async function fetchAgeReviewPage(options: {
  years?: number;
  search?: string;
  page?: number;
} = {}): Promise<AgeReviewPage> {
  const years = options.years ?? ageReviewYears();
  const page = options.page ?? 0;
  const from = page * AGE_REVIEW_PAGE_SIZE;
  const to = from + AGE_REVIEW_PAGE_SIZE;

  const columns = [
    'id',
    'Asset_code',
    'Asset_name',
    'Category',
    'Condition',
    'Lifecycle_Status',
    ACQUISITION_COLUMN,
    'asset_location',
    'purchase_Price',
    'user_id',
  ];
  if (await inventoryRemovalReady()) columns.push(INVENTORY_REMOVED_AT);

  let query = supabase
    .from('assets')
    .select(columns.join(', '))
    .not(ACQUISITION_COLUMN, 'is', null)
    .lte(ACQUISITION_COLUMN, ageReviewCutoff(years))
    .not('Lifecycle_Status', 'in', `(${RETIRED_LIFECYCLE_STATUSES.map((status) => `"${status}"`).join(',')})`)
    .order(ACQUISITION_COLUMN, { ascending: true })
    .order('Asset_code', { ascending: true })
    .range(from, to);

  if (await inventoryRemovalReady()) query = query.is(INVENTORY_REMOVED_AT, null);

  const search = String(options.search ?? '').trim();
  if (search) {
    const escaped = search.replace(/[%,()]/g, ' ').trim();
    query = query.or(
      `Asset_code.ilike.%${escaped}%,Asset_name.ilike.%${escaped}%,Category.ilike.%${escaped}%,asset_location.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > AGE_REVIEW_PAGE_SIZE;

  return { rows: await decorate(rows.slice(0, AGE_REVIEW_PAGE_SIZE)), hasMore };
}
