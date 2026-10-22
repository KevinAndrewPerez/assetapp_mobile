/**
 * Month windows for the lists that answer "show me this month".
 *
 * The web pages filter by typed date ranges; on a phone the useful question is
 * almost always "the month I am in" or "last month", so the Requests screens
 * offer the last few months as one-tap chips built from the device's own
 * calendar. Everything is expressed as `yyyy-mm-dd` strings because that is
 * what the database stores and what a string comparison can filter correctly
 * without dragging time zones into it.
 */

export type MonthBounds = { from: string; to: string };
export type MonthOption = { key: string; label: string; from: string; to: string };

const pad = (value: number): string => String(value).padStart(2, '0');

/** `2026-10` for the given date (local calendar). */
export const monthKeyOf = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

/** Inclusive first and last day of `yyyy-mm`, or null for anything else. */
export function monthBounds(key: string): MonthBounds | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 1970 || year > 9999) return null;

  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(year, month, 0).getDate();

  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/**
 * The same window as **naive-UTC query bounds**.
 *
 * The database stores `created_at` as naive UTC (the web writes `now()` in UTC,
 * the phone writes `toISOString()`), while the month the user taps is a local
 * calendar month. On a Manila phone (UTC+8) "October" starts at
 * `2026-09-30T16:00:00` UTC; filtering on `2026-10-01T00:00:00` would hide the
 * first eight hours of the month and show the first eight hours of the next
 * one. These bounds are what the Supabase query uses; `withinMonth` is only for
 * values already fetched.
 */
export function monthQueryBounds(key: string): MonthBounds | null {
  const bounds = monthBounds(key);
  if (!bounds) return null;

  const [year, month] = key.split('-').map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);

  // `2026-09-30T16:00:00.000Z` → `2026-09-30T16:00:00` (naive UTC, what the
  // timestamp column holds).
  const naive = (date: Date) => date.toISOString().replace('Z', '').replace(/\.\d{3}$/, '');

  return { from: naive(start), to: naive(end) };
}

/**
 * The last `count` months, newest first, ready for the chips row. The labels
 * come from the device locale so they read the way the user's calendar does.
 */
export function recentMonthOptions(count = 6, now: Date = new Date()): MonthOption[] {
  const options: MonthOption[] = [];

  for (let index = 0; index < count; index += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = monthKeyOf(date);
    const bounds = monthBounds(key);
    if (!bounds) continue;

    options.push({
      key,
      label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      ...bounds,
    });
  }

  return options;
}

/** `2026-10` for a clicked grid cell (month is 1-based). */
export const monthKeyFor = (year: number, month: number): string => `${year}-${pad(month)}`;

/**
 * The twelve months of one year, January first — the grid the month/year
 * picker shows. Future months are marked so the picker can grey them out: a
 * request cannot have been filed next month.
 */
export type YearMonthOption = MonthOption & { month: number; isFuture: boolean };

export function monthOptionsForYear(year: number, now: Date = new Date()): YearMonthOption[] {
  const options: YearMonthOption[] = [];

  for (let month = 1; month <= 12; month += 1) {
    const key = monthKeyFor(year, month);
    const bounds = monthBounds(key);
    if (!bounds) continue;

    const date = new Date(year, month - 1, 1);
    options.push({
      key,
      month,
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      isFuture: date.getTime() > new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - 1,
      ...bounds,
    });
  }

  return options;
}

/** `October 2026` for a month key, for empty-state copy. */
export const monthLabel = (key: string | null): string => {
  const bounds = key ? monthBounds(key) : null;
  if (!bounds) return 'All time';

  const [year, month] = key!.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/**
 * Is a stored timestamp inside the window? Null bounds mean "all time".
 *
 * Only the first ten characters (`yyyy-mm-dd`) are compared: request timestamps
 * arrive with an offset that can shift the calendar day, and slicing keeps the
 * filter aligned with the date the list itself prints.
 */
export function withinMonth(value: unknown, bounds: MonthBounds | null): boolean {
  if (!bounds) return true;
  const day = String(value ?? '').slice(0, 10);
  if (day.length < 10) return false;
  return day >= bounds.from && day <= bounds.to;
}

/** Millisecond value of a stored timestamp, for sorting (0 when unreadable). */
export const timestampOf = (value: unknown): number => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
