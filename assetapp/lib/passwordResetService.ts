import { supabase } from './supabase';
import { webOrigin } from './mediaUrl';
import { writeAudit } from './auditService';
import { hashPasswordForDatabase, verifyStoredHash } from './passwordHash';
import { generateResetCode, mailerConfigured, sendResetCodeEmail } from './resetMailer';

/**
 * Forgot password — the mobile twin of the web's `/forgot-password` flow.
 *
 * The code itself is a single-use 6-digit number whose bcrypt hash lives in the
 * shared `password_resets` table, and every step after that is the app's own
 * work: it reads the row, checks expiry and single use, and writes the new
 * bcrypt(12) password into the same `users` row the web writes. Either app can
 * finish a reset the other one started.
 *
 * Only the *mailing* used to be delegated to the NUTrace website, because it
 * held the mail credentials. The deployed site has no `MAIL_*` configuration,
 * so Laravel used its default `log` mailer: the message went into
 * `storage/logs/laravel.log`, the site reported success, and the app — which
 * only checked that a code row appeared — showed "code sent" for a mail nobody
 * ever received.
 *
 * So the app mails the code itself now (`lib/resetMailer.ts`). Posting the
 * website's form is kept as a fallback for builds that ship without an email
 * key, and the wording of every message below still follows the web controller
 * so the two apps report failures identically.
 */

/** Same five requirements the web enforces (`Password::defaults()`). */
export const PASSWORD_RULES: { key: string; label: string; test: (value: string) => boolean }[] = [
  { key: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { key: 'lower', label: 'A lowercase letter (a-z)', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', label: 'An uppercase letter (A-Z)', test: (v) => /[A-Z]/.test(v) },
  { key: 'number', label: 'A number (0-9)', test: (v) => /\d/.test(v) },
  { key: 'symbol', label: 'A symbol such as ! @ # $ %', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export const passwordMeetsPolicy = (value: string): boolean =>
  PASSWORD_RULES.every((rule) => rule.test(value));

/**
 * New on the web in the latest update: a password must not be built out of the
 * person's own details.
 *
 * Any word of four or more characters taken from the full name, the email
 * address or the employee number found inside the password is rejected — those
 * are the easiest things for someone else to guess. Mirrors
 * `passwordIsBasedOnIdentity()` in the web's `routes/web.php` exactly, so the
 * same password is refused by both apps.
 */
export function passwordIsBasedOnIdentity(
  password: string,
  identityFragments: (string | null | undefined)[],
): boolean {
  const candidate = String(password ?? '').toLowerCase();
  if (!candidate) return false;

  for (const fragment of identityFragments) {
    if (typeof fragment !== 'string' || fragment === '') continue;
    for (const word of fragment.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= 4 && candidate.includes(word)) return true;
    }
  }

  return false;
}

/** The message the web shows for a password built out of the person's details. */
export const PASSWORD_IDENTITY_MESSAGE =
  'Your password must not contain your name, email address, or employee number.';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const NO_ACCOUNT_MESSAGE =
  'No account is registered with that email address. Please use the email you used to register.';
export const SESSION_INVALID_MESSAGE =
  'Your verification session is no longer valid. Please start the password reset again.';

/** How long a mailed code stays valid — the web uses the same 15 minutes. */
export const RESET_CODE_TTL_MINUTES = 15;

const CODE_INCORRECT = 'The verification code you entered is incorrect. Please try again.';
const CODE_USED = 'This verification code has already been used. Please request a new code.';
const CODE_EXPIRED = 'This verification code has expired. Please request a new code.';

const REQUEST_TIMEOUT_MS = 20_000;

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** `Set-Cookie` values, however the platform chooses to expose them. */
const readSetCookie = (res: Response): string => {
  const headerBag = res.headers as unknown as { getSetCookie?: () => string[] };
  const raw = typeof headerBag.getSetCookie === 'function' ? headerBag.getSetCookie() : [];
  const list = raw.length > 0 ? raw : [res.headers.get('set-cookie')].filter(Boolean) as string[];
  return list
    .map((entry) => String(entry).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

const tokenFromHtml = (html: string): string => {
  const hidden = /name="_token"\s+value="([^"]+)"/.exec(html);
  if (hidden) return hidden[1];
  const meta = /name="csrf-token"\s+content="([^"]+)"/.exec(html);
  return meta ? meta[1] : '';
};

/** The account behind an email address, or null when there is none. */
export async function findAccountByEmail(
  email: string,
): Promise<{ id: number | string; email: string; fullName: string } | null> {
  const address = String(email ?? '').trim();
  if (!address) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id, email, status, employee_numbers(Full_Name)')
    .ilike('email', address)
    .limit(1);

  if (error) {
    console.error('Failed to look up account by email:', error.message);
    throw error;
  }

  // `ilike` treats `_`/`%` as wildcards, so confirm the hit really is this
  // address (underscores are common in NU addresses).
  const rows = (data ?? []) as any[];
  const row = rows.find(
    (candidate) => String(candidate.email ?? '').trim().toLowerCase() === address.toLowerCase(),
  );
  if (!row) return null;
  // The web refuses to recover an account that is not Active — same check here.
  if (String(row.status ?? 'Active').toLowerCase() === 'inactive') return null;

  const employee = Array.isArray(row.employee_numbers) ? row.employee_numbers[0] : row.employee_numbers;
  return {
    id: row.id,
    email: String(row.email ?? address),
    fullName: String(employee?.Full_Name ?? ''),
  };
}

/** Highest `password_resets.id` currently stored — the marker for "a new code landed". */
async function latestResetId(): Promise<number> {
  const { data, error } = await supabase
    .from('password_resets')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return 0;
  return Number((data as any)?.id ?? 0);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the website to write the new code row. The site stores the code just
 * before it hands the message to the mail server, so a fresh row means the
 * request went through — without it, nothing was sent.
 */
async function waitForFreshCode(email: string, previousMaxId: number, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('password_resets')
      .select('id')
      .eq('email', email)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data && Number((data as any).id) > previousMaxId) return true;
    await sleep(1500);
  }
  return false;
}

/**
 * `password_resets` timestamps are `timestamp without time zone` holding UTC —
 * exactly what Laravel stores with the app on UTC. The `…Z` designator is
 * stripped rather than left on: Postgres converts a zone-bearing string into the
 * session's timezone, while the bare form is stored verbatim, so the digits are
 * the UTC wall clock whatever the session is set to. (`parseStoredTimestamp`
 * adds the zone back when reading.)
 */
const storedTimestamp = (value: Date): string =>
  value.toISOString().replace(/\.\d{3}Z$/, '').replace('T', ' ');

/** Drop every code for an address — the web deletes the previous one too. */
async function clearResetCodes(email: string): Promise<void> {
  const { error } = await supabase.from('password_resets').delete().eq('email', email);
  if (error) console.warn('Could not clear existing reset codes:', error.message);
}

/**
 * Write the code row the way the web writes it: hash first, row before the mail
 * is handed over. Storing the hash (never the code) means the row is useless to
 * anyone reading the table, and `verifyResetCode` compares against it with
 * bcrypt.
 */
async function storeResetCode(email: string, code: string): Promise<void> {
  await clearResetCodes(email);

  const now = new Date();
  const expires = new Date(now.getTime() + RESET_CODE_TTL_MINUTES * 60_000);
  const { error } = await supabase.from('password_resets').insert({
    email,
    token: await hashPasswordForDatabase(code),
    expires_at: storedTimestamp(expires),
    used: false,
    created_at: storedTimestamp(now),
    updated_at: storedTimestamp(now),
  });

  if (error) {
    console.error('Failed to store the reset code:', error.message);
    throw new Error('We could not start a password reset right now. Please try again.');
  }
}

/**
 * Mail a fresh 6-digit code.
 *
 * The app owns the code: it generates it, stores the bcrypt hash in
 * `password_resets` and sends the message through the email service
 * (`lib/resetMailer.ts`). The account is checked first — an address that is not
 * registered must not receive anything, the same gate the web applies.
 *
 * When the build ships without an email key the flow falls back to asking the
 * NUTrace website to send the mail, which is only useful if that deployment
 * ever gets a real `MAIL_*` configuration.
 */
export async function sendResetCode(email: string): Promise<void> {
  const address = String(email ?? '').trim();

  if (mailerConfigured()) {
    const account = await findAccountByEmail(address);
    if (!account) throw new Error(NO_ACCOUNT_MESSAGE);

    const code = generateResetCode();
    await storeResetCode(account.email, code);

    try {
      await sendResetCodeEmail(account.email, code);
    } catch (error) {
      // A code nobody received must not stay in the table: the next attempt
      // starts clean instead of comparing against a message that never arrived.
      await clearResetCodes(account.email);
      throw error;
    }
    return;
  }

  await sendResetCodeViaWebsite(address);
}

/**
 * Ask the NUTrace website to email the code — the fallback path.
 *
 * The verification endpoint is CSRF-protected, so the token is read from the
 * page and the session cookie travels back with it. React Native keeps cookies
 * in the platform's HTTP stack, so normally the token alone is enough; if the
 * endpoint answers 419 (Laravel's "page expired") the request is retried once
 * with the cookie the page handed us, in case the cookie jar was unavailable.
 *
 * Note that this path cannot know whether the site's mailer actually delivered:
 * the site writes the code row before it hands the message to the mail server
 * and, with the `log` mailer, reports success without sending anything.
 */
export async function sendResetCodeViaWebsite(email: string): Promise<void> {
  const address = String(email ?? '').trim();
  const base = webOrigin();
  const endpoint = `${base}/forgot-password`;

  let page: Response;
  try {
    page = await fetchWithTimeout(endpoint, { headers: { Accept: 'text/html' } });
  } catch {
    throw new Error(
      `Could not reach the verification service at ${base} to send your code. Check your connection and try again.`,
    );
  }

  const html = await page.text();
  const token = tokenFromHtml(html);
  const cookie = readSetCookie(page);
  if (!token) {
    throw new Error(
      'The verification service did not respond correctly. Please try again.',
    );
  }

  const previousMaxId = await latestResetId();
  const body = `_token=${encodeURIComponent(token)}&email=${encodeURIComponent(address)}`;

  const post = (useCookie: boolean) =>
    fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
        ...(useCookie && cookie ? { Cookie: cookie } : {}),
      },
      body,
      redirect: 'manual',
    });

  let response: Response;
  try {
    response = await post(false);
    if (response.status === 419) {
      response = await post(true);
    }
  } catch {
    throw new Error(
      'The request to the NU TRACE website did not go through. Check your connection and try again.',
    );
  }

  if (response.status >= 500) {
    throw new Error('The NU TRACE website is temporarily unavailable. Please try again shortly.');
  }
  if (response.status === 419) {
    // Laravel's CSRF guard: the site refused the form even with the cookie the
    // page handed us (it can happen on some devices' cookie handling).
    throw new Error(
      'The verification service did not accept the reset request. Please try again.',
    );
  }

  // 302 means the site accepted the address and moved on to the code step; the
  // row check below confirms the code was actually created.
  const wroteCode = await waitForFreshCode(address, previousMaxId);
  if (!wroteCode) {
    throw new Error(
      'The verification code was not created. Please make sure that email belongs to your account, then try again.',
    );
  }
}

type ResetRow = { id: number; token: string; used: boolean; expires_at: string | null };

/** The newest reset row for an email, or null when there is none. */
async function loadResetRow(email: string): Promise<ResetRow | null> {
  const { data, error } = await supabase
    .from('password_resets')
    .select('id, token, used, expires_at')
    .eq('email', email)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to read the reset code row:', error.message);
    throw error;
  }
  if (!data) return null;

  const row = data as any;
  return {
    id: Number(row.id),
    token: String(row.token ?? ''),
    used: row.used === true || Number(row.used) === 1,
    expires_at: row.expires_at ? String(row.expires_at) : null,
  };
}

/**
 * `password_resets.expires_at` is a `timestamp without time zone` holding UTC
 * (the database runs on UTC). A bare ISO string would be read as *local* time by
 * the phone — in Manila (UTC+8) that made a just-mailed 15-minute code look
 * eight hours expired — so the missing zone is added explicitly.
 */
const parseStoredTimestamp = (value: string | null): Date | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const parsed = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isExpired = (row: ResetRow): boolean => {
  const expiry = parseStoredTimestamp(row.expires_at);
  if (!expiry) return false;
  return expiry.getTime() <= Date.now();
};

/**
 * Check a code exactly the way the web's `/forgot-password/verify` does:
 * correct, unused and unexpired. The stored value is PHP-bcrypt (`$2y$…`),
 * which bcryptjs reads natively.
 */
export async function verifyResetCode(email: string, code: string): Promise<void> {
  const entered = String(code ?? '').trim();
  if (!/^\d{6}$/.test(entered)) {
    throw new Error('Please enter the 6-digit code from your email.');
  }

  const row = await loadResetRow(email);
  if (!row) throw new Error(SESSION_INVALID_MESSAGE);
  if (row.used) throw new Error(CODE_USED);
  if (isExpired(row)) throw new Error(CODE_EXPIRED);

  const matches = await verifyStoredHash(entered, row.token);
  if (!matches) throw new Error(CODE_INCORRECT);
}

/**
 * Save the new password: re-check the code (the web does the same so a stale
 * screen cannot write), refuse passwords built out of the account's own
 * details, store a bcrypt(12) hash — the format `verify_user_password` and
 * Laravel's `Hash::check` both accept — delete the used code and leave an audit
 * entry.
 */
export async function completePasswordReset(
  email: string,
  code: string,
  newPassword: string,
  confirmation: string,
): Promise<void> {
  const address = String(email ?? '').trim();

  if (!passwordMeetsPolicy(newPassword)) {
    throw new Error('Your password does not meet all the requirements.');
  }
  if (newPassword !== confirmation) {
    throw new Error('Passwords do not match.');
  }

  const account = await findAccountByEmail(address);
  if (!account) {
    throw new Error('Your account could not be found. Please contact the administrator.');
  }

  // The stored spelling of the address is what the code row and the account
  // both use — the typed one may differ in case.
  await verifyResetCode(account.email, code);

  // `passwordIsBasedOnIdentity` on the web: no word of the person's own name (4+
  // characters) and nothing from the email's local part.
  const identity = [account.fullName, account.email.split('@')[0]];
  const lowered = newPassword.toLowerCase();
  for (const fragment of identity) {
    const words = String(fragment ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    for (const word of words) {
      if (word.length >= 4 && lowered.includes(word)) {
        throw new Error('Your password must not contain your name or email address.');
      }
    }
  }

  const passwordHash = await hashPasswordForDatabase(newPassword);
  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from('users')
    .update({ password: passwordHash, updated_at: now })
    .eq('id', account.id as any)
    .select('id');

  if (error) {
    console.error('Failed to save the new password:', error.message);
    throw new Error('Password reset failed. Please try again.');
  }
  // A silent no-op (wrong id, blocked by a policy) must not look like success.
  if (!updated || updated.length === 0) {
    console.error('The password update matched no account row:', account.id);
    throw new Error('Password reset failed. Please try again.');
  }

  // Single use: drop the code so it cannot be replayed.
  await supabase.from('password_resets').delete().eq('email', account.email);

  await writeAudit({
    actorId: account.id,
    actionType: 'UPDATE',
    description: 'User reset their password through the forgot-password flow',
    notes: `Password was changed for account ${address}`,
  });
}

