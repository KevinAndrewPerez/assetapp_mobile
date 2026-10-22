/**
 * Turn whatever a failed call threw into one sentence a phone user can act on.
 *
 * Supabase/PostgREST failures used to reach the screen as `error.message`:
 * "duplicate key value violates unique constraint ...", "JWSError ..." or a raw
 * `TypeError: Network request failed`. Those are not useful to an employee
 * reporting a broken laptop, and the database text leaks schema details. This
 * helper maps the failures the app actually hits — offline, timeout, expired
 * session, refused write — and only passes through messages the app itself wrote
 * (validation and workflow rules), never an error that looks like a database or
 * JavaScript failure.
 */

const OFFLINE = 'No internet connection. Check your connection and try again.';
const TIMEOUT = 'The server took too long to respond. Please try again in a moment.';
const SESSION =
  'Your session has expired or is no longer allowed. Please sign in again.';
const SERVER = 'The server could not complete that change. Please try again.';
const GENERIC = 'Something went wrong. Please try again.';

/** Text that marks an error as an internal failure rather than a user rule. */
const INTERNAL_MARKERS = [
  'postgrest',
  'sqlstate',
  'pgrst',
  'violates',
  'constraint',
  'duplicate key',
  'syntax error',
  'relation "',
  'column "',
  'jws',
  'jwt',
  'stack',
  'nodename nor servname',
  'ECONNREFUSED',
  'ENOTFOUND',
];

const textOf = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const source = error as {
    message?: unknown;
    error_description?: unknown;
    details?: unknown;
    hint?: unknown;
    status?: unknown;
    code?: unknown;
  };
  return [source.message, source.error_description, source.details, source.hint, source.code]
    .filter((part) => typeof part === 'string' || typeof part === 'number')
    .join(' ')
    .trim();
};

/**
 * @param error whatever was thrown
 * @param fallback the message to use when the error carries nothing usable
 */
export function friendlyErrorMessage(error: unknown, fallback: string = GENERIC): string {
  const raw = textOf(error);
  const status = Number((error as { status?: unknown } | null)?.status ?? 0);

  if (!raw && status === 0) return fallback;

  if (
    /network request failed|fetch failed|failed to fetch|networkerror|network error|internet|offline|connection (reset|refused|closed)|socket|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|no address/i.test(
      raw,
    )
  ) {
    return OFFLINE;
  }

  if (/timeout|timed out|aborterror|aborted|ETIMEDOUT|504|gateway timeout/i.test(raw) || status === 504) {
    return TIMEOUT;
  }

  if (
    /jwt|token|session|not authenticated|invalid login|unauthor|forbidden|permission denied/i.test(raw) ||
    status === 401 ||
    status === 403
  ) {
    return SESSION;
  }

  if (status >= 500 || /internal server error|bad gateway|service unavailable/i.test(raw)) {
    return SERVER;
  }

  // Our own validation / workflow messages are short and free of internals.
  const looksInternal =
    raw.length > 180 ||
    raw.includes('\n') ||
    INTERNAL_MARKERS.some((marker) => raw.toLowerCase().includes(marker.toLowerCase()));
  if (looksInternal) return fallback;

  return raw || fallback;
}

/** True when the failure is worth retrying without changing anything. */
export function isRetryableErrorMessage(message: string): boolean {
  return message === OFFLINE || message === TIMEOUT || message === SERVER;
}
