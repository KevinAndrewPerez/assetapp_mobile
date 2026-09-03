import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  completeMaintenance,
  fetchMaintenanceAlerts,
  MaintenanceAlert,
} from '@/lib/assetService';
import { getStoredUser } from '@/lib/userService';

const statusColor = (status?: string) => {
  switch (status) {
    case 'Active':
      return '#10B981';
    case 'For Checking':
      return '#F59E0B';
    case 'Pullout':
      return '#3B82F6';
    case 'Disposal':
      return '#EF4444';
    default:
      return '#64748B';
  }
};

export default function MaintenanceScreen() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<MaintenanceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await fetchMaintenanceAlerts());
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Unable to load maintenance alerts');
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

  const handleComplete = async (alertItem: MaintenanceAlert) => {
    Alert.alert(
      'Complete maintenance?',
      `${alertItem.name} (${alertItem.assetId})\n\nMarking it complete will record today as the last maintenance date and schedule the next one based on its maintenance interval.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Complete',
          style: 'destructive',
          onPress: async () => {
            setCompletingId(alertItem.id);
            try {
              const user = await getStoredUser();
              const result = await completeMaintenance({
                assetId: alertItem.id,
                actorId: user?.id,
                notes: 'Maintenance completed via mobile app',
              });
              Alert.alert(
                'Maintenance completed',
                `${alertItem.name} is now "${result.status}".${
                  result.nextMaintenanceDate
                    ? ` Next maintenance scheduled for ${result.nextMaintenanceDate}.`
                    : ' No next maintenance scheduled.'
                }`,
              );
              await load();
            } catch (err) {
              Alert.alert('Could not complete maintenance', (err as Error).message || 'Please try again.');
            } finally {
              setCompletingId(null);
            }
          },
        },
      ],
    );
  };

  const formatDate = (d?: string | null) => {
    if (!d) return 'Not scheduled';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Maintenance</Text>
        <View style={styles.headerSpacer} />
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
            <Text style={styles.emptyTitle}>Couldn’t load maintenance alerts</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : alerts.length === 0 ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="calendar-check-outline" size={44} color="#94A3B8" />
            <Text style={styles.emptyTitle}>No maintenance due</Text>
            <Text style={styles.emptyText}>
              Assets whose next maintenance date is today or overdue will appear here.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryBanner}>
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color="#92400E" />
              <Text style={styles.summaryText}>
                {alerts.length} asset{alerts.length > 1 ? 's' : ''} scheduled for maintenance
                {alerts.some((a) => a.daysOverdue > 0)
                  ? `, ${alerts.filter((a) => a.daysOverdue > 0).length} overdue`
                  : ' today'}
              </Text>
            </View>

            {alerts.map((item) => {
              const dueColor = item.daysOverdue > 0 ? '#DC2626' : '#F59E0B';
              return (
                <View key={String(item.id)} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.cardIcon}>
                      <MaterialCommunityIcons
                        name="calendar-clock"
                        size={22}
                        color={dueColor}
                      />
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={styles.assetName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.assetCode}>{item.assetId}</Text>
                    </View>
                    <View
                      style={[
                        styles.statusChip,
                        { backgroundColor: `${statusColor(item.status)}18` },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
                        {item.status || '—'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.detailGrid}>
                    <View style={styles.detailItem}>
                      <MaterialCommunityIcons name="calendar-alert" size={15} color="#64748B" />
                      <Text style={styles.detailLabel}>Due</Text>
                      <Text style={styles.detailValue}>{formatDate(item.nextMaintenanceDate)}</Text>
                    </View>
                    {item.custodian ? (
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="account-outline" size={15} color="#64748B" />
                        <Text style={styles.detailLabel}>Custodian</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>
                          {item.custodian}
                        </Text>
                      </View>
                    ) : null}
                    {item.location ? (
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="map-marker-outline" size={15} color="#64748B" />
                        <Text style={styles.detailLabel}>Location</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>
                          {item.location}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.cardFooter}>
                    <View style={[styles.overdueChip, { backgroundColor: `${dueColor}12` }]}>
                      <Text style={[styles.overdueText, { color: dueColor }]}>
                        {item.daysOverdue > 0
                          ? `${item.daysOverdue} day${item.daysOverdue > 1 ? 's' : ''} overdue`
                          : 'Due today'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.completeButton, completingId === item.id && styles.completeButtonDisabled]}
                      onPress={() => handleComplete(item)}
                      disabled={completingId === item.id}
                      activeOpacity={0.8}
                    >
                      {completingId === item.id ? (
                        <ActivityIndicator size="small" color="#0F172A" />
                      ) : (
                        <Text style={styles.completeButtonText}>Mark complete</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
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
  headerSpacer: {
    width: 42,
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
    maxWidth: 270,
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
  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  summaryText: {
    flex: 1,
    color: '#92400E',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  assetName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
  },
  assetCode: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  statusChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailGrid: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: '45%',
    flexShrink: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  detailValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  cardFooter: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  overdueChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  overdueText: {
    fontSize: 12,
    fontWeight: '800',
  },
  completeButton: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#FBBF24',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 116,
  },
  completeButtonDisabled: {
    opacity: 0.6,
  },
  completeButtonText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
});
