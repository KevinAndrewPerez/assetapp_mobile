import { supabase } from './supabase';
import { toStoredTimestamp } from './time';

export type AuditEntry = {
  actorId?: string | number | null;
  assetId?: string | number | null;
  requestId?: string | number | null;
  actionType: string;
  description: string;
  notes?: string;
};

/**
 * `audit_logs.action_type` is a fixed enum:
 *   CREATE | UPDATE | REPAIR | REPLACEMENT | DISPOSAL | TRANSFER | LOGIN | APPROVAL
 * Anything else is rejected by the database, so the mobile's richer action names
 * are mapped onto the closest storable value here (the original wording still
 * lives in `action_description`/`notes`). Before this map existed, every
 * 'PULLOUT' (4 call sites) and 'MAINTENANCE' entry was silently discarded.
 */
const ACTION_TYPE_ALIASES: Record<string, string> = {
  PULLOUT: 'TRANSFER',
  MAINTENANCE: 'UPDATE',
  ASSIGN: 'UPDATE',
  RECEIVE: 'UPDATE',
  ACCOUNTABILITY: 'TRANSFER',
  EVALUATION: 'UPDATE',
  // A sign-out belongs in the same LOGIN bucket — the enum has no `LOGOUT`
  // value. The friendly wording lives in `action_description`/`notes`.
  LOGOUT: 'LOGIN',
  SIGN_IN: 'LOGIN',
  SIGN_OUT: 'LOGIN',
};

// ---------------------------------------------------------------------------
// Privacy: an audit trail must never expose a user's network address.
// ---------------------------------------------------------------------------

/**
 * Strip IP addresses (and the phrases that introduce them) out of audit text.
 *
 * The web's `LogUserLogin` middleware stores `User logged in from IP: <addr>`
 * and `<name> authenticated successfully from <addr>`, and the admin then reads
 * those rows in this app's Activity Log. The address is not the admin's
 * business, so the displayed text is scrubbed here — the same rows keep their
 * original wording in the database for the server-side trail.
 */
export function stripNetworkIdentifiers(value: unknown): string {
  if (value == null) return '';
  let text = String(value);

  // `... from IP: 122.2.3.4` / `from ip 122.2.3.4` / `from IP: ::1` — the phrase
  // *and* the address that follows it go together.
  text = text.replace(/\s*\bfrom\s+ip\b\s*:?\s*[0-9a-f:.]*/gi, ' ');
  // A bare IPv4 (also `127.0.0.1`).
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '');
  // A bare IPv6 with four or more hextet groups. Deliberately strict so it can
  // never swallow a `15:26:24` clock time.
  text = text.replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '');
  // A compressed IPv6 (`fe80::`, `::1`): a run of colons with optional hextets.
  text = text.replace(/(?:^|[\s(=,])::?(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4}(?=$|[\s.,;)\]])/gi, ' ');
  // `localhost`, and any `from <address>` that lost its address above.
  text = text.replace(/\blocalhost\b/gi, '');
  text = text.replace(/\s+\bfrom\b(?=\s*[.,;]|\s*$)/gi, '');

  return text.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
}

/** The notice the Activity Log shows instead of the raw sign-in / sign-out row. */
export const AUDIT_LOGIN_NOTICE = 'This user account has logged in.';
export const AUDIT_LOGOUT_NOTICE = 'This user account has logged out.';

/**
 * Turn a sign-in / sign-out audit row into the human notice the admin should
 * read, or `null` when the row is some other kind of activity.
 */
export function auditSessionNotice(row: any): string | null {
  const haystack = `${row?.action_description ?? ''} ${row?.notes ?? ''}`.toLowerCase();
  if (/logged?\s*out|signed\s*out|logout/.test(haystack)) return AUDIT_LOGOUT_NOTICE;
  if (/logged?\s*in|signed\s*in|login|authenticated/.test(haystack)) return AUDIT_LOGIN_NOTICE;
  if (String(row?.action_type ?? '').toUpperCase() === 'LOGIN') return AUDIT_LOGIN_NOTICE;
  return null;
}

/** True for the sign-in / sign-out rows of the shared audit trail. */
export const isSessionAuditRow = (row: any): boolean => auditSessionNotice(row) !== null;

/**
 * Record a mobile sign-in or sign-out in `audit_logs`.
 *
 * Until now only the Laravel web app wrote LOGIN rows, so an admin using the
 * phone could not see who signed in to — or out of — the mobile app. The wording
 * is deliberately free of any device or network detail.
 */
export async function writeSessionAudit(options: {
  actorId?: string | number | null;
  actorName?: string | null;
  event: 'login' | 'logout';
}): Promise<void> {
  const who = String(options.actorName ?? '').trim();
  const isLogin = options.event === 'login';
  const label = isLogin ? 'signed in to the NUTrace mobile app' : 'signed out of the NUTrace mobile app';
  await writeAudit({
    actorId: options.actorId ?? null,
    actionType: isLogin ? 'LOGIN' : 'LOGOUT',
    description: `${who ? `${who} ` : 'A user account '}${label}.`,
    notes: isLogin ? AUDIT_LOGIN_NOTICE : AUDIT_LOGOUT_NOTICE,
  });
}

const STORABLE_ACTION_TYPES = [
  'CREATE',
  'UPDATE',
  'REPAIR',
  'REPLACEMENT',
  'DISPOSAL',
  'TRANSFER',
  'LOGIN',
  'APPROVAL',
] as const;

/** Map any app action name onto a value `audit_logs.action_type` accepts. */
export const normalizeAuditActionType = (raw: unknown): string => {
  const value = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!value) return 'UPDATE';
  if ((STORABLE_ACTION_TYPES as readonly string[]).includes(value)) return value;
  if (ACTION_TYPE_ALIASES[value]) return ACTION_TYPE_ALIASES[value];
  // Fall back on the closest storable bucket so the entry is never lost.
  if (value.includes('REPAIR')) return 'REPAIR';
  if (value.includes('REPLAC')) return 'REPLACEMENT';
  if (value.includes('DISPOS')) return 'DISPOSAL';
  if (value.includes('PULLOUT') || value.includes('TRANSFER')) return 'TRANSFER';
  if (value.includes('LOGIN') || value.includes('AUTH')) return 'LOGIN';
  if (value.includes('APPROV')) return 'APPROVAL';
  if (value.includes('CREATE') || value.includes('REGISTER')) return 'CREATE';
  return 'UPDATE';
};

/**
 * Append an entry to the shared `audit_logs` trail. Best-effort: a logging
 * failure must never roll back or block the action the user actually performed.
 * Failures are logged (PostgREST returns errors instead of throwing, so the
 * error has to be inspected explicitly or it disappears).
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const now = toStoredTimestamp();
    const { error } = await supabase.from('audit_logs').insert([
      {
        user_id: entry.actorId ?? null,
        asset_id: entry.assetId ?? null,
        request_id: entry.requestId ?? null,
        notes: stripNetworkIdentifiers(entry.notes ?? entry.description),
        action_type: normalizeAuditActionType(entry.actionType),
        action_description: stripNetworkIdentifiers(entry.description),
        created_at: now,
        updated_at: now,
      },
    ]);
    if (error) {
      console.warn(`Audit log write rejected (${entry.actionType}):`, error.message);
    }
  } catch (err) {
    console.warn('Audit log write failed:', err);
  }
}
