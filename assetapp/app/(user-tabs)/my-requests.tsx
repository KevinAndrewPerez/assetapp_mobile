import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  RefreshControl,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchUserRequests, getStoredUser } from '@/lib/userService';
import { requestTypeMeta } from '@/lib/lifecycle';
import NotificationBell from '@/components/notification-bell';
import { headerTopPadding } from '@/lib/theme';

const tabs = ['All', 'Pending', 'Approved', 'Rejected'] as const;
type RequestTab = (typeof tabs)[number];

const statusTone = (status: string) => {
  if (status === 'Approved') return { bg: '#ECFDF5', fg: '#047857', icon: 'check-circle-outline' };
  if (status === 'Rejected') return { bg: '#FEF2F2', fg: '#B91C1C', icon: 'close-circle-outline' };
  return { bg: '#FFFBEB', fg: '#92400E', icon: 'clock-outline' };
};

export default function MyRequests() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<RequestTab>('All');
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getStoredUser();
      if (!user) return;
      const data = await fetchUserRequests(user);
      setRequests(data);
    } catch (error) {
      console.error('Failed to load user requests:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
    }, [loadRequests]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  };

  const counts = useMemo(
    () => ({
      All: requests.length,
      Pending: requests.filter((r) => r.status === 'Pending').length,
      Approved: requests.filter((r) => r.status === 'Approved').length,
      Rejected: requests.filter((r) => r.status === 'Rejected').length,
    }),
    [requests],
  );

  const filteredRequests = useMemo(
    () => (activeTab === 'All' ? requests : requests.filter((item) => item.status === activeTab)),
    [activeTab, requests],
  );

  const emptyCopy: Record<RequestTab, string> = {
    All: 'You have not submitted any request yet.',
    Pending: 'No request is waiting for the office.',
    Approved: 'No approved request yet.',
    Rejected: 'No rejected request.',
  };

  if (loading && requests.length === 0) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Requests</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.newRequestButton}
              onPress={() => router.push('/submit-request' as any)}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="plus" size={18} color="#1E3A5F" />
              <Text style={styles.newRequestText}>New</Text>
            </TouchableOpacity>
            <NotificationBell />
          </View>
        </View>
        <View style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FDB833" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Requests</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.newRequestButton}
            onPress={() => router.push('/submit-request' as any)}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="plus" size={18} color="#1E3A5F" />
            <Text style={styles.newRequestText}>New</Text>
          </TouchableOpacity>
          <NotificationBell />
        </View>
      </View>

      <View style={styles.container}>
        {/* Tabs */}
        <View style={styles.tabContainer}>
          {tabs.map((tab) => {
            const active = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, active && styles.activeTab]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, active && styles.activeTabText]}>{tab}</Text>
                <View style={[styles.tabCount, active && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>
                    {counts[tab]}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {filteredRequests.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons name="file-document-outline" size={34} color="#94A3B8" />
              </View>
              <Text style={styles.emptyStateText}>{emptyCopy[activeTab]}</Text>
              <TouchableOpacity
                style={styles.emptyAction}
                activeOpacity={0.85}
                onPress={() => router.push('/submit-request' as any)}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#1E3A5F" />
                <Text style={styles.emptyActionText}>Submit a request</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredRequests.map((request) => {
              const type = requestTypeMeta(request.requestType);
              const status = statusTone(request.status);
              const assetCount = Array.isArray(request.linkedAssets)
                ? request.linkedAssets.length
                : 1;
              return (
                <TouchableOpacity
                  key={request.id}
                  style={styles.requestCard}
                  activeOpacity={0.85}
                  onPress={() =>
                    router.push({ pathname: '/request-detail', params: { id: request.id } })
                  }
                >
                  <View style={[styles.cardAccent, { backgroundColor: type.tone.fg }]} />

                  <View style={styles.cardBody}>
                    <View style={styles.cardTopRow}>
                      <View style={[styles.typeIcon, { backgroundColor: type.tone.bg }]}>
                        <MaterialCommunityIcons
                          name={type.icon as any}
                          size={18}
                          color={type.tone.fg}
                        />
                      </View>
                      <View style={styles.titleWrap}>
                        <Text style={styles.requestTitle} numberOfLines={1}>
                          {request.title}
                        </Text>
                        <Text style={styles.requestMeta} numberOfLines={1}>
                          {type.label} Request • REQ-{request.id}
                          {assetCount > 1 ? ` • ${assetCount} assets` : ''}
                        </Text>
                      </View>
                      {request.imageUrl ? (
                        <Image
                          source={{ uri: request.imageUrl }}
                          style={styles.assetPhoto}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.assetPhotoPlaceholder}>
                          <MaterialCommunityIcons name="cube-outline" size={22} color="#94A3B8" />
                        </View>
                      )}
                    </View>

                    <View style={[styles.statusRow, { backgroundColor: status.bg }]}>
                      <MaterialCommunityIcons
                        name={status.icon as any}
                        size={14}
                        color={status.fg}
                      />
                      <Text style={[styles.statusText, { color: status.fg }]}>{request.status}</Text>
                    </View>

                    {request.reason ? (
                      <Text style={styles.reasonText} numberOfLines={2}>
                        {request.reason}
                      </Text>
                    ) : null}

                    <View style={styles.cardFooter}>
                      <View style={styles.footerMeta}>
                        <MaterialCommunityIcons name="calendar-blank-outline" size={14} color="#94A3B8" />
                        <Text style={styles.footerMetaText}>{request.dateSubmitted}</Text>
                        {request.barcode ? (
                          <>
                            <MaterialCommunityIcons
                              name="qrcode"
                              size={14}
                              color="#94A3B8"
                              style={{ marginLeft: 10 }}
                            />
                            <Text style={styles.footerMetaText} numberOfLines={1}>
                              {request.barcode}
                            </Text>
                          </>
                        ) : null}
                      </View>
                      <MaterialCommunityIcons name="chevron-right" size={20} color="#CBD5E1" />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={styles.spacer} />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#0C134F',
  },
  container: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: headerTopPadding,
    paddingBottom: 12,
    backgroundColor: '#0C134F',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  newRequestButton: {
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FDB833',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 999,
  },
  newRequestText: {
    color: '#1E3A5F',
    fontWeight: '700',
    fontSize: 12.5,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF1F7',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#FDB833',
  },
  tabText: {
    fontSize: 13.5,
    color: '#64748B',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#0F172A',
    fontWeight: '800',
  },
  tabCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  tabCountActive: {
    backgroundColor: '#FEF3C7',
  },
  tabCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  tabCountTextActive: {
    color: '#92400E',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 112,
  },
  requestCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardAccent: {
    width: 5,
  },
  cardBody: {
    flex: 1,
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    gap: 3,
  },
  requestTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  requestMeta: {
    fontSize: 11.5,
    color: '#64748B',
  },
  assetPhoto: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
  },
  assetPhotoPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 10,
  },
  statusText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  reasonText: {
    marginTop: 9,
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  footerMetaText: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontWeight: '600',
    flexShrink: 1,
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  emptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  emptyAction: {
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FDB833',
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 999,
  },
  emptyActionText: {
    color: '#1E3A5F',
    fontWeight: '700',
    fontSize: 12.5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    height: 20,
  },
});
