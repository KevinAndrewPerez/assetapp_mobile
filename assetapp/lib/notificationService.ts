import { supabase } from './supabase';

/**
 * Roles that make up the Asset Management Office — the accounts that review
 * requests. Mirrors the mobile login router (Admin / AssetOfficer).
 */
export const OFFICE_ROLES = ['Admin', 'AssetOfficer'];

/** True when a stored user belongs to the Asset Management Office. */
export const isOfficeRole = (role?: string | null): boolean => {
  const key = String(role ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return OFFICE_ROLES.some((candidate) => candidate.toLowerCase() === key);
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
};

export async function fetchNotifications(
  userId: string | number | undefined | null,
  limit = 50,
): Promise<{ notifications: AppNotification[]; unread: number }> {
  if (!userId) return { notifications: [], unread: 0 };

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId as any)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const list = (data ?? []) as AppNotification[];
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact' })
    .eq('user_id', userId as any)
    .eq('is_read', false);

  return {
    notifications: list.map((n) => ({ ...n, is_read: Boolean(n.is_read) })),
    unread: count ?? list.filter((n) => !n.is_read).length,
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
 * Send the same notification to every Asset Management Office account (Admin /
 * AssetOfficer) — used whenever a user submits a request so the office sees it
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
    const date = new Date(ts);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString();
  } catch {
    return ts;
  }
}
