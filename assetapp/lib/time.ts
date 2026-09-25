/**
 * Timestamp helpers for the NUTrace mobile app.
 *
 * Every timestamp the database hands us is a **naive UTC** value:
 *   • Laravel runs with `config('app.timezone') = 'UTC'`
 *   • Postgres `now()` is UTC
 *   • the mobile services write `new Date().toISOString()`
 * PostgREST then returns those `timestamp without time zone` columns *without*
 * an offset — `"2026-09-24T15:26:24"` — and JavaScript reads a date-time string
 * with no zone as **local** time. On a Manila phone (UTC+8) that is eight hours
 * off: an event that really happened at 11:26 PM was shown as 3:26 PM, and a
 * morning event the next day was shown on the previous date. That is the
 * "time and date malfunction" in the Activity Log.
 *
 * `parseStoredTimestamp()` treats a zone-less value as UTC (the truth) and
 * leaves anything that already carries a zone alone.
 */

/** `2026-09-24T15:26:24` with an optional space separator / seconds / millis. */
const NAIVE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a value coming out of the database.
 *
 *  • naive `yyyy-mm-dd hh:mm:ss`  → that wall clock **in UTC**
 *  • `yyyy-mm-dd` (date column)   → local midnight, so the calendar day never
 *                                   jumps backwards for a UTC+8 reader
 *  • values that already carry `Z`/offset are parsed as-is
 */
export function parseStoredTimestamp(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const naive = NAIVE_DATE_TIME.exec(raw);
  if (naive) {
    const millis = Number(`0.${naive[7] ?? '0'}`) * 1000;
    return new Date(
      Date.UTC(
        Number(naive[1]),
        Number(naive[2]) - 1,
        Number(naive[3]),
        Number(naive[4]),
        Number(naive[5]),
        Number(naive[6] ?? '0'),
        millis,
      ),
    );
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Normalize any stored value to an ISO-8601 UTC string (or `''`). */
export function normalizeStoredTimestamp(value: unknown): string {
  const date = parseStoredTimestamp(value);
  return date ? date.toISOString() : '';
}

/** `Sep 24, 2026, 11:26 PM` — the Activity Log / detail-row format. */
export function formatStoredTimestamp(
  value: unknown,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = parseStoredTimestamp(value);
  if (!date) return typeof value === 'string' ? value : '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options,
  });
}

/** `Sep 24, 2026` — date only. */
export function formatStoredDate(value: unknown): string {
  const date = parseStoredTimestamp(value);
  if (!date) return typeof value === 'string' ? value : '';
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

/** Today's calendar date on the phone, as `yyyy-mm-dd` (never UTC-shifted). */
export function todayLocalIso(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** The value to write into a Postgres `timestamp without time zone` (UTC). */
export function toStoredTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}
