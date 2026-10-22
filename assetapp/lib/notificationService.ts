import { sortByReviewOrder } from './reviewOrder';
import { supabase } from './supabase';
import { formatStoredDate, parseStoredTimestamp } from './time';

// The office is defined once, in `lib/access.ts` (web `Access::ASSET_OFFICE_ROLES`:
// Admin only). Re-exported because the bell and the request screens import it
// from here.
import { OFFICE_ROLES, isOfficeRole } from './access';
export { OFFICE_ROLES, isOfficeRole };

/** The account the bell belongs to — id plus role, so the office sees its queue. */
export type NotificationAccount = {
  id?: string | number | null;
  role?: string | null;
};

export type AppNotification = {
  id: number | string;
  user_id: number | string;
  title: string;
  message: string;
  type: string; // REQUEST | REPAIR | REPLACEMENT | DISPOSAL | ...
  reference_id?: number | string | null;
  reference_type?: string | null;
  is_read: boolean;
  created_at: string;
  updated_at?: string;
  /** Live status of the request this notification points at (if any). */
  request_status?: string | null;
  /** When that request was submitted — the review queue's waiting time. */
  request_created_at?: string | null;
};

/** True when the notification points at a row we can open in request-detail. */
export const notificationReferencesRequest = (n: AppNotification): boolean =>
  String(n.reference_type ?? '').trim().toLowerCase() === 'request' &&
  n.reference_id !== null &&
  n.reference_id !== undefined &&
  n.reference_id !== '';

/** The distinct requests a page of notifications points at. */
const referencedRequestIds = (list: AppNotification[]): (string | number)[] => {
  const ids = new Set<string | number>();
  list.forEach((n) => {
    if (notificationReferencesRequest(n)) ids.add(n.reference_id as string | number);
  });
  return Array.from(ids);
};

/**
 * Attach the current status of every referenced request, so the bell can be
 * ordered the way the office works — pending first, longest wait on top
 * (see lib/reviewOrder.ts). Best-effort: if the lookup fails the notifications
 * are still returned, just in their feed order.
 */
async function attachRequestStatuses(list: AppNotification[]): Promise<AppNotification[]> {
  const ids = referencedRequestIds(list);
  if (ids.length === 0) return list;

  try {
    const { data, error } = await supabase
      .from('requests')
      .select('id, status, created_at')
      .in('id', ids);
    if (error) {
      console.warn('Request lookup for notifications failed:', error.message);
      return list;
    }

    const byId = new Map<string, { status: string | null; createdAt: string | null }>();
    ((data ?? []) as any[]).forEach((row) => {
      if (row?.id === undefined || row?.id === null) return;
      byId.set(String(row.id), { status: row.status ?? null, createdAt: row.created_at ?? null });
    });

    return list.map((n) => {
      const request = byId.get(String(n.reference_id));
      return request
        ? { ...n, request_status: request.status, request_created_at: request.createdAt }
        : n;
    });
  } catch (err) {
    console.warn('Request lookup for notifications failed:', err);
    return list;
  }
}

const NOTIFICATION_TYPE_BY_REQUEST: Record<string, string> = {
  repair: 'REPAIR',
  disposal: 'DISPOSAL',
  replacement: 'REPLACEMENT',
  pullout: 'PULLOUT',
  transfer: 'REQUEST',
};

/**
 * The office's queue has to be complete even when a request was filed through
 * a path that writes no notification row — the web's disposal and replacement
 * screens do not — so every request still pending that the office has no note
 * for is added to the bell as a card of its own, titled the way the mobile
 * app's own notifications are. Pending only: decided requests are history and
 * a "new request" card for one would be a lie.
 *
 * These cards carry no stored row, so they are marked read: read state belongs
 * to the notifications table, and the Pending pill plus the top of the list
 * carry their priority instead (see lib/reviewOrder.ts).
 */
async function fetchPendingRequestCards(
  userId: string | number,
  notifications: AppNotification[],
): Promise<AppNotification[]> {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('id, request_type, status, Note, created_at, users:user_id(employee_numbers(Full_Name))')
      .ilike('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('Pending request lookup for notifications failed:', error.message);
      return [];
    }

    const covered = new Set(
      notifications
        .filter((n) => String(n.reference_type ?? '').toLowerCase() === 'request')
        .map((n) => String(n.reference_id)),
    );

    return ((data ?? []) as any[])
      .filter((row) => row?.id !== undefined && row?.id !== null && !covered.has(String(row.id)))
      .map((row) => {
        const type = String(row.request_type ?? 'Asset');
        const requester = String(
          (Array.isArray(row.users?.employee_numbers)
            ? row.users.employee_numbers[0]?.Full_Name
            : row.users?.employee_numbers?.Full_Name) ?? 'A user',
        );
        const note = String(row.Note ?? '').trim();

        return {
          id: `request-${row.id}`,
          user_id: userId,
          title: `New ${type} Request — REQ-${row.id}`,
          message: `${requester} submitted a ${type} request.${note ? ` Note: ${note}` : ''}`,
          type: NOTIFICATION_TYPE_BY_REQUEST[type.trim().toLowerCase()] ?? 'REQUEST',
          reference_id: row.id,
          reference_type: 'request',
          is_read: true,
          created_at: row.created_at,
          request_status: row.status,
          request_created_at: row.created_at,
        } as AppNotification;
      });
  } catch (err) {
    console.warn('Pending request lookup for notifications failed:', err);
    return [];
  }
}

export async function fetchNotifications(
  account: NotificationAccount | null | undefined,
  limit = 50,
): Promise<{ notifications: AppNotification[]; unread: number }> {
  const userId = account?.id;
  if (!userId) return { notifications: [], unread: 0 };

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId as any)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const list = (data ?? []) as AppNotification[];
  const enriched = await attachRequestStatuses(list);
  const officeQueue = isOfficeRole(account?.role)
    ? await fetchPendingRequestCards(userId, enriched)
    : [];
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact' })
    .eq('user_id', userId as any)
    .eq('is_read', false);

  // The same order the web's Requests page and its bell use: a request still
  // pending outranks every other update, and among those the one waiting
  // longest sits on top; decided requests and everything else follow, newest
  // first (lib/reviewOrder.ts).
  const ordered = sortByReviewOrder([...enriched, ...officeQueue], (n) => ({
    status: n.request_status,
    requestedAt: n.request_created_at,
    updatedAt: n.created_at,
    id: n.id,
  }));

  return {
    notifications: ordered.map((n) => ({ ...n, is_read: Boolean(n.is_read) })),
    unread: count ?? enriched.filter((n) => !n.is_read).length,
  };
}

/**
 * Create a notification for a user. Mirrors the web app's `createNotification`
 * helper so a mobile action (repair submitted / in progress / completed / …)
 * shows up in the same bell list on every client. Best-effort: a notification
 * failure must never block the action the user actually performed.
 */
export async function createNotification(params: {
  userId: string | number | undefined | null;
  title: string;
  message: string;
  type?: string;
  referenceId?: string | number | null;
  referenceType?: string | null;
}): Promise<void> {
  if (params.userId === undefined || params.userId === null || params.userId === '') return;

  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('notifications').insert([
      {
        user_id: params.userId,
        title: params.title,
        message: params.message,
        type: params.type ?? 'REQUEST',
        reference_id: params.referenceId ?? null,
        reference_type: params.referenceType ?? null,
        is_read: false,
        created_at: now,
        updated_at: now,
      },
    ]);
    if (error) console.warn('Notification insert failed:', error.message);
  } catch (err) {
    console.warn('Notification insert failed:', err);
  }
}

/**
 * Send the same notification to every Asset Management Office account (Admin)
 * — used whenever a user submits a request so the office sees it
 * in the bell right away, without opening the Requests screen. Best-effort: a
 * notification failure must never block the request the user actually filed.
 */
export async function notifyAdmins(options: {
  title: string;
  message: string;
  type?: string;
  referenceId?: string | number | null;
  referenceType?: string | null;
}): Promise<number> {
  try {
    const { data, error } = await supabase.from('users').select('id, role').in('role', OFFICE_ROLES);
    if (error) {
      console.warn('Office lookup for notifications failed:', error.message);
      return 0;
    }

    let sent = 0;
    for (const admin of ((data ?? []) as any[])) {
      if (admin?.id === undefined || admin?.id === null) continue;
      await createNotification({
        userId: admin.id,
        title: options.title,
        message: options.message,
        type: options.type ?? 'REQUEST',
        referenceId: options.referenceId ?? null,
        referenceType: options.referenceType ?? 'request',
      });
      sent += 1;
    }
    return sent;
  } catch (err) {
    console.warn('Admin notification failed:', err);
    return 0;
  }
}

/**
 * Has this title already been recorded for this request? Used by the approval
 * notices, where a retried tap must not produce a second bell entry.
 */
async function notificationTitleExists(
  userId: string | number,
  title: string,
  referenceId: string | number,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId as any)
      .eq('title', title)
      .eq('reference_id', referenceId as any)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/** "A", "A and B", "A, B, and C" — the web's asset label. */
const joinAssetCodes = (codes: string[]): string => {
  const list = codes.map((code) => String(code).trim()).filter(Boolean);
  if (list.length === 0) return 'the asset';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
};

/**
 * The notices the web's approve route writes for a disposal request: the
 * requester is told the form is being prepared, and the other Asset Management
 * Office accounts are told a form is waiting — never the approver about their
 * own action. Same titles, type and reference the web uses, so a phone-created
 * notice appears in the web bell too.
 *
 * A request can only be approved once; the title check makes a retried tap or a
 * second write harmless. Best-effort: a notification failure never undoes the
 * approval.
 */
export async function notifyDisposalApproval(options: {
  requestId: string | number;
  requesterId: string | number | null | undefined;
  actorId: string | number | null | undefined;
  assetCodes: string[];
}): Promise<void> {
  const referenceId = options.requestId;
  const label = joinAssetCodes(options.assetCodes);

  if (options.requesterId !== null && options.requesterId !== undefined && options.requesterId !== '') {
    const title = 'Disposal Request Approved';
    if (!(await notificationTitleExists(options.requesterId, title, referenceId))) {
      await createNotification({
        userId: options.requesterId,
        title,
        message:
          options.assetCodes.length === 1
            ? `Your disposal request for asset ${label} has been approved. The Asset Management Office is preparing the official disposal form.`
            : `Your disposal request for assets ${label} has been approved. The Asset Management Office is preparing the official disposal forms.`,
        type: 'DISPOSAL',
        referenceId,
        referenceType: 'disposal',
      });
    }
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, role, status')
      .in('role', [...OFFICE_ROLES])
      .eq('status', 'Active');
    if (error) {
      console.warn('Office lookup for disposal notifications failed:', error.message);
      return;
    }

    for (const officer of ((data ?? []) as any[])) {
      const id = officer?.id;
      if (id === null || id === undefined) continue;
      if (String(id) === String(options.requesterId ?? '')) continue;
      if (String(id) === String(options.actorId ?? '')) continue;

      const title = 'Disposal Approved — Official Form to Prepare';
      if (await notificationTitleExists(id, title, referenceId)) continue;

      await createNotification({
        userId: id,
        title,
        message:
          `Disposal request #${referenceId} for ${label} was approved. The official NU Lipa disposal form ` +
          'is ready to be completed, printed and filed on the Disposal page.',
        type: 'DISPOSAL',
        referenceId,
        referenceType: 'disposal',
      });
    }
  } catch (error) {
    console.warn('Office disposal notification failed:', error);
  }
}

/**
 * True when a notification of this type already exists for the referenced
 * record — used so recurring checks (maintenance due, lifespan expired) don't
 * spam the same person every time a screen loads.
 */
export async function notificationExists(
  type: string,
  referenceId: string | number | null | undefined,
): Promise<boolean> {
  if (referenceId === null || referenceId === undefined || referenceId === '') return false;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('type', type)
      .eq('reference_id', referenceId as any)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

export async function fetchUnreadNotificationCount(
  userId: string | number | undefined | null,
): Promise<number> {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact' })
    .eq('user_id', userId as any)
    .eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(
  notificationId: string | number,
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('id', notificationId as any);
  if (error) throw error;
}

export async function markAllNotificationsRead(
  userId: string | number | undefined | null,
): Promise<void> {
  if (!userId) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('user_id', userId as any)
    .eq('is_read', false);
  if (error) throw error;
}

/** Small helper shared by screens that show notification times. */
export function formatNotificationTime(ts: string): string {
  try {
    // naive UTC from Postgres → real instant (see lib/time.ts)
    const date = parseStoredTimestamp(ts);
    if (!date) return ts;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return formatStoredDate(date);
  } catch {
    return ts;
  }
}
