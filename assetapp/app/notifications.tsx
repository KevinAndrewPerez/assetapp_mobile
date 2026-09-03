import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  AppNotification,
  fetchNotifications,
  formatNotificationTime,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notificationService';
import { getStoredUser } from '@/lib/userService';

const TYPE_META: Record<string, { icon: string; color: string }> = {
  REQUEST: { icon: 'file-document-outline', color: '#3B82F6' },
  REPAIR: { icon: 'wrench-outline', color: '#F59E0B' },
  REPLACEMENT: { icon: 'swap-horizontal', color: '#8B5CF6' },
  DISPOSAL: { icon: 'trash-can-outline', color: '#EF4444' },
  PULLOUT: { icon: 'arrow-up-bold-box-outline', color: '#0EA5E9' },
};

const metaFor = (type: string) =>
  TYPE_META[(type || '').toUpperCase()] ?? {
    icon: 'bell-outline',
    color: '#64748B',
  };

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const user = await getStoredUser();
      const result = await fetchNotifications(user?.id);
      setNotifications(result.notifications);
      setUnread(result.unread);
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Unable to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const markRead = async (n: AppNotification) => {
    if (n.is_read) return;
    // Optimistic update
    setNotifications((prev) =>
      prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)),
    );
    setUnread((prev) => Math.max(0, prev - 1));
    try {
      await markNotificationRead(n.id);
    } catch (e) {
      console.warn('Failed to mark notification read:', e);
    }
  };

  const markAllRead = async () => {
    if (unread === 0) return;
    const user = await getStoredUser();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
    try {
      await markAllNotificationsRead(user?.id);
    } catch (e) {
      console.warn('Failed to mark all notifications read:', e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity
          style={styles.markAllButton}
          onPress={markAllRead}
          activeOpacity={0.8}
          disabled={unread === 0}
        >
          <Text style={[styles.markAllText, unread === 0 && styles.markAllTextDisabled]}>
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#0F172A" />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={44} color="#94A3B8" />
            <Text style={styles.emptyTitle}>Couldn’t load notifications</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="bell-check-outline" size={44} color="#94A3B8" />
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.emptyText}>
              Updates about your requests, repairs, and replacements will show up here.
            </Text>
          </View>
        ) : (
          notifications.map((n) => {
            const meta = metaFor(n.type);
            const isUnread = !n.is_read;
            return (
              <TouchableOpacity
                key={String(n.id)}
                style={[styles.card, isUnread && styles.cardUnread]}
                onPress={() => markRead(n)}
                activeOpacity={0.8}
              >
                <View style={[styles.iconContainer, { backgroundColor: `${meta.color}18` }]}>
                  <MaterialCommunityIcons name={(meta.icon as any)} size={22} color={meta.color} />
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text
                      style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}
                      numberOfLines={2}
                    >
                      {n.title}
                    </Text>
                    {isUnread && <View style={styles.unreadDot} />}
                  </View>
                  {n.message ? (
                    <Text style={styles.cardMessage} numberOfLines={3}>
                      {n.message}
                    </Text>
                  ) : null}
                  <Text style={styles.cardTime}>{formatNotificationTime(n.created_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#0F172A',
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  markAllButton: {
    minWidth: 84,
    alignItems: 'flex-end',
  },
  markAllText: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '700',
  },
  markAllTextDisabled: {
    color: 'rgba(255, 255, 255, 0.35)',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 260,
  },
  retryButton: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: '#0F172A',
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardUnread: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 20,
  },
  cardTitleUnread: {
    fontWeight: '800',
    color: '#1E293B',
  },
  unreadDot: {
    marginTop: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  cardMessage: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
  },
  cardTime: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
});
