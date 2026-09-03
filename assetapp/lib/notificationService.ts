import { supabase } from './supabase';

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
