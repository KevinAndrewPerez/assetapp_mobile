import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

/**
 * Mailing the forgot-password code from the app itself.
 *
 * The web flow used to own this: the app posted the address to the NUTrace
 * website and Laravel sent the message. On the deployed site no `MAIL_*`
 * variables are configured, so Laravel falls back to its default `log` mailer —
 * it writes the message into `storage/logs/laravel.log`, reports success and no
 * email ever leaves the server. The site still writes the code row, which is why
 * the app used to show "code sent" while the inbox stayed empty.
 *
 * So the app now generates the code, stores the same row the web stores and
 * hands the message to an email API over HTTPS. Configuration (see
 * BUILD_APP.md — the values must reach the build through `.env` or
 * `app.json → extra`):
 *
 *   EXPO_PUBLIC_MAIL_API_KEY   the provider's key           (required)
 *   EXPO_PUBLIC_MAIL_FROM      a verified sender address     (default: Resend's
 *                              testing sender while no domain is verified)
 *   EXPO_PUBLIC_MAIL_FROM_NAME display name, default NU TRACE
 *   EXPO_PUBLIC_MAIL_PROVIDER  `resend` (default) or `brevo`
 */

type Provider = 'resend' | 'brevo';

const extra = (): Record<string, string> =>
  ((Constants.expoConfig as { extra?: Record<string, string> } | null)?.extra ?? {}) as Record<
    string,
    string
  >;

/**
 * `process.env` is read with literal keys on purpose: Metro only inlines
 * `process.env.EXPO_PUBLIC_X` when it can see the name at build time, so a
 * computed lookup would always be empty on a real device.
 */
const configured = (value: string | undefined, key: string): string =>
  String(value || extra()[key] || '').trim();

const apiKey = () => configured(process.env.EXPO_PUBLIC_MAIL_API_KEY, 'EXPO_PUBLIC_MAIL_API_KEY');
const fromEmail = () =>
  configured(process.env.EXPO_PUBLIC_MAIL_FROM, 'EXPO_PUBLIC_MAIL_FROM') ||
  // Resend's shared testing sender: it can only deliver to the address that owns
  // the Resend account until a domain is verified, which is exactly what the
  // capstone needs while there is no university domain to verify.
  'onboarding@resend.dev';
const fromName = () =>
  configured(process.env.EXPO_PUBLIC_MAIL_FROM_NAME, 'EXPO_PUBLIC_MAIL_FROM_NAME') || 'NU TRACE';
const provider = (): Provider =>
  configured(process.env.EXPO_PUBLIC_MAIL_PROVIDER, 'EXPO_PUBLIC_MAIL_PROVIDER').toLowerCase() ===
  'brevo'
    ? 'brevo'
    : 'resend';

/** True once an email API key is present — the app can mail the code itself. */
export const mailerConfigured = (): boolean => apiKey().length > 0;

/** Human name of the sender, for the one error message that needs it. */
export const mailerDescription = (): string => `${fromName()} <${fromEmail()}>`;

/**
 * A 6-digit code nobody can guess from the clock.
 *
 * `expo-crypto` draws real random bytes (WebCrypto on web, the platform's
 * CSPRNG on a phone). Bytes at or above 250 are rejected before the modulo so
 * every digit stays equally likely — a plain `% 10` would favour 0-5.
 */
export function generateResetCode(): string {
  const LIMIT = 250; // largest multiple of 10 that fits in a byte
  let code = '';
  while (code.length < 6) {
    for (const byte of Crypto.getRandomBytes(8)) {
      if (byte >= LIMIT) continue;
      code += String(byte % 10);
      if (code.length === 6) break;
    }
  }
  return code;
}

/** Subject line, copied from the web so both apps send the same mail. */
export const RESET_CODE_SUBJECT = 'NU TRACE - Password Reset Verification Code';

/** Body, verbatim the web's `Mail::raw` message. */
export const resetCodeMessage = (code: string): string =>
  [
    'Hello,',
    '',
    'You requested to reset your NU TRACE password.',
    '',
    `Your verification code is: ${code}`,
    '',
    'This code is valid for 15 minutes and can only be used once.',
    'If you did not request a password reset, you can safely ignore this email.',
    '',
    '— NU TRACE Asset Management System',
  ].join('\n');

const MAIL_TIMEOUT_MS = 20_000;

/** The provider's own explanation, shortened to something a screen can show. */
const providerReason = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const detail = parsed.message ?? parsed.error ?? parsed.detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 160);
    if (detail && typeof detail === 'object') {
      const nested = (detail as Record<string, unknown>).message;
      if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 160);
    }
  } catch {
    // Not JSON — fall through to the plain text.
  }
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 160);
};

async function postJson(url: string, headers: Record<string, string>, payload: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    console.warn(`[resetMailer] ${url} unreachable:`, err?.message);
    throw new Error(
      'Could not reach the email service. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return;

  const body = await response.text().catch(() => '');
  const reason = providerReason(body);
  console.warn(`[resetMailer] ${url} answered ${response.status}: ${body.slice(0, 400)}`);
  throw new Error(
    `The email service refused to send the code (${response.status})${
      reason ? `: ${reason}` : ''
    }`,
  );
}

/**
 * Hand the code to the provider. Throws with a readable message when the
 * message cannot be accepted — the caller must not report success then.
 */
export async function sendResetCodeEmail(to: string, code: string): Promise<void> {
  if (!mailerConfigured()) {
    throw new Error(
      'The app has no email service configured, so the verification code cannot be sent yet.',
    );
  }

  const from = fromEmail();
  const name = fromName();
  const subject = RESET_CODE_SUBJECT;
  const text = resetCodeMessage(code);

  if (provider() === 'brevo') {
    // Brevo: POST https://api.brevo.com/v3/smtp/email
    await postJson(
      'https://api.brevo.com/v3/smtp/email',
      { 'api-key': apiKey() },
      {
        sender: { email: from, name },
        to: [{ email: to }],
        subject,
        textContent: text,
      },
    );
    return;
  }

  // Resend: POST https://api.resend.com/emails
  await postJson(
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${apiKey()}` },
    {
      from: name ? `${name} <${from}>` : from,
      to: [to],
      subject,
      text,
    },
  );
}
