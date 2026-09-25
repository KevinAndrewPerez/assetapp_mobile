import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import {
  completeMaintenance,
  fetchMaintenanceAlerts,
  MaintenanceAlert,
} from '@/lib/assetService';
import { canCompleteMaintenanceStatus, maintenanceBlockedReason } from '@/lib/lifecycle';
import { getStoredUser } from '@/lib/userService';

const NAVY = '#0C134F';
const NAVY_MID = '#1E3A5F';
const GOLD = '#FBBF24';
const GOLD_LIGHT = '#F59E0B';

const STATUS_COLORS: Record<string, string> = {
  'Active': '#10B981',
  'For Checking': '#F59E0B',
  'Pullout': '#3B82F6',
  'Disposal': '#EF4444',
  'For Repair': '#F59E0B',
};

export default function MaintenanceScreen() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<MaintenanceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | number | null>(null);
  const [modalData, setModalData] = useState<MaintenanceAlert | null>(null);
  // Stored as `yyyy-mm-dd` (the format the database and the service expect) and
  // displayed in full — the admin picks it from a calendar instead of typing.
  const [completionDate, setCompletionDate] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [maintenanceNotes, setMaintenanceNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  /** Today's date on the phone (local), not UTC — otherwise a 7am completion
   *  would be recorded as yesterday. */
  const todayLocalIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  };

  const openCompleteModal = (alertItem: MaintenanceAlert) => {
    setModalData(alertItem);
    setCompletionDate(todayLocalIso());
    setDatePickerOpen(false);
    setMaintenanceNotes('');
  };

  const closeCompleteModal = () => {
    setModalData(null);
    setCompletionDate('');
    setDatePickerOpen(false);
    setMaintenanceNotes('');
  };

  const isoToDate = (value: string): Date | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
    if (!match) return null;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const formatLongDate = (value: string): string => {
    const d = isoToDate(value);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const handleMarkComplete = async () => {
    if (!modalData) return;
    setSubmitting(true);
    try {
      const user = await getStoredUser();
      const result = await completeMaintenance({
        assetId: modalData.id,
        actorId: user?.id,
        // The date the admin picked drives last_maintenance_date and the next
        // schedule — it used to be dropped, so every completion landed on today.
        performedDate: completionDate || undefined,
        notes: maintenanceNotes || 'Maintenance completed via mobile app',
      });
      Alert.alert(
        'Maintenance Completed',
        `${modalData.name} is now "${result.status}".${result.nextMaintenanceDate ? `\nNext maintenance scheduled for ${result.nextMaintenanceDate}.` : '\nNo next maintenance scheduled.'}`,
      );
      closeCompleteModal();
      await load();
    } catch (err) {
      Alert.alert('Could not complete maintenance', (err as Error).message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateShort = (d?: string | null) => {
    if (!d) return 'N/A';
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

  const formatPrice = (p?: number | null) => {
    if (p == null || Number.isNaN(Number(p))) return '—';
    return `₱${Number(p).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Maintenance</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.screenBody}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={NAVY} />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={44} color="#94A3B8" />
            <Text style={styles.emptyTitle}>Couldn&apos;t load maintenance alerts</Text>
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
            <TouchableOpacity style={styles.backButtonSimple} onPress={() => router.back()} activeOpacity={0.8}>
              <MaterialCommunityIcons name="arrow-left" size={18} color={NAVY} />
              <Text style={styles.backButtonText}>Back to assets</Text>
            </TouchableOpacity>
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
              const isOverdue = item.daysOverdue > 0;
              const dueColor = isOverdue ? '#DC2626' : GOLD_LIGHT;
              const badgeColor = isOverdue ? '#EF4444' : GOLD;
              const badgeLabel = isOverdue ? 'OVERDUE' : 'DUE SOON';
              const statusColor = STATUS_COLORS[item.status || ''] || '#64748B';
              // Disposal is final and an Acquired asset is not issued yet — only
              // a serviceable asset has upkeep left to complete.
              const canComplete = canCompleteMaintenanceStatus(item.status);

              return (
                <View key={String(item.id)} style={styles.assetCard}>
                  {/* Card Header */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <View style={[styles.badgeContainer, { backgroundColor: `${badgeColor}18`, borderColor: badgeColor }]}>
                        <MaterialCommunityIcons name="calendar-clock" size={18} color={badgeColor} />
                      </View>
                      <View style={styles.cardHeaderInfo}>
                        <View style={styles.badgeRow}>
                          <View style={[styles.badgePill, { backgroundColor: badgeColor }]}>
                            <Text style={styles.badgeText}>{badgeLabel}</Text>
                          </View>
                          <Text style={styles.assetName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}>
                      <MaterialCommunityIcons name="circle" size={8} color={statusColor} style={styles.statusDot} />
                      <Text style={[styles.statusText, { color: statusColor }]}>{item.status || '—'}</Text>
                    </View>
                  </View>

                  <Text style={styles.assetCode}>{item.assetId}</Text>

                  {/* Detail Grid — 2 columns on phones so cards stay compact */}
                  <View style={styles.detailGrid}>
                    <View style={styles.detailItem}>
                      <View style={styles.detailHeader}>
                        <MaterialCommunityIcons name="calendar-check-outline" size={13} color="#94A3B8" />
                        <Text style={styles.detailLabel} numberOfLines={1}>ACQUIRED</Text>
                      </View>
                      <Text style={styles.detailValue}>{item.acquisitionDate ? formatDateShort(item.acquisitionDate) : '—'}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <View style={styles.detailHeader}>
                        <MaterialCommunityIcons name="cash-multiple" size={13} color="#94A3B8" />
                        <Text style={styles.detailLabel} numberOfLines={1}>PRICE</Text>
                      </View>
                      <Text style={styles.detailValue} numberOfLines={1}>{formatPrice(item.purchasePrice)}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <View style={styles.detailHeader}>
                        <MaterialCommunityIcons name="barcode" size={13} color="#94A3B8" />
                        <Text style={styles.detailLabel} numberOfLines={1}>SERIAL #</Text>
                      </View>
                      <Text style={styles.detailValue} numberOfLines={1}>{item.serialNumber || '—'}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <View style={styles.detailHeader}>
                        <MaterialCommunityIcons name="map-marker-outline" size={13} color="#94A3B8" />
                        <Text style={styles.detailLabel} numberOfLines={1}>LOCATION</Text>
                      </View>
                      <Text style={styles.detailValue} numberOfLines={1}>{item.location || '—'}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <View style={styles.detailHeader}>
                        <MaterialCommunityIcons name="tag-outline" size={13} color="#94A3B8" />
                        <Text style={styles.detailLabel} numberOfLines={1}>CATEGORY</Text>
                      </View>
                      <Text style={styles.detailValue} numberOfLines={2}>{item.category || '—'}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <View style={styles.detailHeader}>
                        <MaterialCommunityIcons name="account-outline" size={13} color="#94A3B8" />
                        <Text style={styles.detailLabel} numberOfLines={1}>ASSIGNED TO</Text>
                      </View>
                      <Text style={styles.detailValue} numberOfLines={1}>{item.custodian || '—'}</Text>
                    </View>
                  </View>

                  {/* Maintenance Info */}
                  <View style={styles.maintenanceSection}>
                    <View style={styles.maintenanceHeader}>
                      <View style={styles.upkeepLabel}>
                        <Text style={[styles.upkeepText, { color: GOLD_LIGHT }]}>UPKEEP</Text>
                      </View>
                      <Text style={[styles.maintenanceTitle, { color: NAVY }]}>Maintenance Schedule</Text>
                      <View style={[styles.badgePill, { backgroundColor: badgeColor }]}>
                        <Text style={[styles.badgeTextSmall, { color: NAVY }]}>{badgeLabel}</Text>
                      </View>
                    </View>

                    <View style={styles.detailGrid}>
                      <View style={styles.detailItem}>
                        <View style={styles.detailHeader}>
                          <MaterialCommunityIcons name="clock-outline" size={13} color="#94A3B8" />
                          <Text style={styles.detailLabel} numberOfLines={1}>INTERVAL</Text>
                        </View>
                        <Text style={styles.detailValue} numberOfLines={1}>{item.maintenanceInterval ? `${item.maintenanceInterval} mo` : '—'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <View style={styles.detailHeader}>
                          <MaterialCommunityIcons name="calendar-alert-outline" size={13} color={dueColor} />
                          <Text style={[styles.detailLabel, { color: dueColor }]} numberOfLines={1}>NEXT DUE</Text>
                        </View>
                        <Text style={[styles.detailValue, { color: dueColor }]} numberOfLines={1}>{formatDateShort(item.nextMaintenanceDate)}</Text>
                      </View>
                      {item.lastMaintenanceDate ? (
                        <View style={styles.detailItem}>
                          <View style={styles.detailHeader}>
                            <MaterialCommunityIcons name="history" size={13} color="#94A3B8" />
                            <Text style={styles.detailLabel} numberOfLines={1}>LAST DONE</Text>
                          </View>
                          <Text style={styles.detailValue} numberOfLines={1}>{formatDateShort(item.lastMaintenanceDate)}</Text>
                        </View>
                      ) : null}
                      <View style={styles.detailItem}>
                        <View style={styles.detailHeader}>
                          <MaterialCommunityIcons name="wrench-outline" size={13} color="#94A3B8" />
                          <Text style={styles.detailLabel} numberOfLines={1}>REPAIRS</Text>
                        </View>
                        <Text style={styles.detailValue}>{item.repairCounts ?? 0} repair(s)</Text>
                      </View>
                    </View>
                  </View>

                  {/* Mark Complete Button — only while the asset is serviceable */}
                  {canComplete ? (
                    <TouchableOpacity
                      style={styles.markCompleteButton}
                      onPress={() => openCompleteModal(item)}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={isOverdue ? ['#DC2626', '#B91C1C'] : ['#10B981', '#059669']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.markCompleteGradient}
                      >
                        <MaterialCommunityIcons name="check-circle" size={22} color="#FFFFFF" />
                        <Text style={styles.markCompleteText} numberOfLines={1}>
                          Mark Maintenance Complete
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.blockedNotice}>
                      <MaterialCommunityIcons name="lock-outline" size={17} color="#B91C1C" />
                      <Text style={styles.blockedNoticeText}>{maintenanceBlockedReason(item.status)}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Mark Maintenance Complete Modal */}
      {modalData && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Mark Maintenance Complete</Text>
              <TouchableOpacity onPress={closeCompleteModal} activeOpacity={0.7}>
                <MaterialCommunityIcons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {/* Completion Date */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>COMPLETION DATE</Text>
                <TouchableOpacity
                  style={styles.dateInputWrap}
                  activeOpacity={0.85}
                  onPress={() => setDatePickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Choose the maintenance completion date"
                >
                  <MaterialCommunityIcons name="calendar" size={18} color="#64748B" />
                  <Text style={styles.dateInput} numberOfLines={1}>
                    {completionDate ? formatLongDate(completionDate) : 'Select a date'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={18} color="#94A3B8" />
                </TouchableOpacity>
                {datePickerOpen ? (
                  <View style={styles.datePickerWrap}>
                    <DateTimePicker
                      value={isoToDate(completionDate) ?? new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onValueChange={(_event, selected) => {
                        if (Platform.OS !== 'ios') setDatePickerOpen(false);
                        if (selected) {
                          const iso = `${selected.getFullYear()}-${String(
                            selected.getMonth() + 1,
                          ).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
                          setCompletionDate(iso);
                        }
                      }}
                      onDismiss={() => setDatePickerOpen(false)}
                    />
                    {Platform.OS === 'ios' ? (
                      <TouchableOpacity
                        style={styles.datePickerDone}
                        activeOpacity={0.85}
                        onPress={() => setDatePickerOpen(false)}
                      >
                        <Text style={styles.datePickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* Maintenance Notes */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>MAINTENANCE NOTES (OPTIONAL)</Text>
                <TextInput
                  style={styles.textArea}
                  placeholder="e.g., Replaced filters, lubricated joints, all systems operational"
                  placeholderTextColor="#94A3B8"
                  value={maintenanceNotes}
                  onChangeText={setMaintenanceNotes}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {/* Asset Summary */}
              <View style={[styles.assetSummaryBox, { borderLeftColor: GOLD_LIGHT }]}>
                <Text style={styles.assetSummaryLabel}>Asset being marked:</Text>
                <Text style={styles.assetSummaryName}>{modalData.name}</Text>
                <Text style={styles.assetSummaryCode}>{modalData.assetId}</Text>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={closeCompleteModal}
                disabled={submitting}
              >
                <Text style={styles.modalBtnGhostText} numberOfLines={1}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGreen]}
                onPress={handleMarkComplete}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="check-circle" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnGreenText} numberOfLines={1}>Mark Complete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0C134F',
  },
  screenBody: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  header: {
    backgroundColor: '#0C134F',
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
    fontSize: 19,
    fontWeight: '800',
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
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: NAVY,
    height: 40,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  backButtonSimple: {
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    height: 40,
  },
  backButtonText: {
    color: NAVY,
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
  assetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  badgeContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  cardHeaderInfo: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  badgePill: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  badgeText: {
    color: NAVY,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeTextSmall: {
    color: NAVY,
    fontSize: 11,
    fontWeight: '700',
  },
  assetName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    flexShrink: 1,
  },
  assetCode: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 10,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    marginLeft: 8,
  },
  statusDot: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailItem: {
    width: '47.5%',
    flexGrow: 1,
    backgroundColor: '#F4F7FB',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    lineHeight: 18,
  },
  maintenanceSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginBottom: 12,
  },
  maintenanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  upkeepLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  upkeepText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  maintenanceTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 4,
  },
  // Hero CTA.
  //
  // The wrapper used to be `alignItems: 'center'` with no width on the gradient,
  // so the gradient shrank to its content and sat as a narrow red pill in the
  // middle of the grey button — the white gutters on both sides in the reported
  // screenshot, with the label overflowing the pill. The gradient now stretches
  // to the full width of the wrapper (`flex: 1`) and owns the horizontal padding,
  // and the label shrinks/ellipsizes instead of spilling out.
  markCompleteButton: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    height: 52,
    backgroundColor: '#DC2626',
  },
  markCompleteGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  markCompleteText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    flexShrink: 1,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: NAVY,
    flex: 1,
  },
  modalBody: {
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 14,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  dateInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F4F7FB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 50,
  },
  dateInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 14.5,
    color: '#0F172A',
  },
  datePickerWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginTop: 10,
  },
  datePickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: NAVY_MID,
  },
  datePickerDoneText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  blockedNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
  },
  blockedNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#B91C1C',
    fontWeight: '600',
  },
  textArea: {
    backgroundColor: '#F4F7FB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingTop: 12,
    fontSize: 14.5,
    color: '#0F172A',
    minHeight: 96,
    textAlignVertical: 'top',
  },
  assetSummaryBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: GOLD_LIGHT,
  },
  assetSummaryLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  assetSummaryName: {
    fontSize: 14,
    fontWeight: '700',
    color: NAVY,
    marginTop: 2,
  },
  assetSummaryCode: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  modalBtn: {
    // `row` keeps the icon beside the label — without it they stacked inside the
    // fixed 48px height and the label wrapped out of the button.
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    height: 48,
  },
  modalBtnGhost: {
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalBtnGhostText: {
    color: '#64748B',
    fontWeight: '800',
    fontSize: 14,
  },
  modalBtnGreen: {
    backgroundColor: '#10B981',
  },
  modalBtnGreenText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
});
