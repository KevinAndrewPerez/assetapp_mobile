import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchRepairRecords,
  updateRepairStatus,
  sendRepairToReplacement,
  sendRepairToDisposal,
  repairStatusMessage,
  repairDateLabel,
  RepairRecord,
  RepairResult,
  RepairStatus,
  RepairPriority,
  REPAIR_RESULTS,
} from '@/lib/repairService';
import { resolveActingUserLabel } from '@/lib/actorService';

/**
 * Repair Management — the Asset Management Office side of the repair flow.
 *
 * Each card is one repair record (one asset), so a bulk request is processed and
 * tracked per asset. The admin moves it Pending → In Progress → Completed (or
 * Cancelled), records the evaluation details, and — when the asset cannot be
 * repaired — sends it to Replacement or Disposal. Every write goes to the same
 * `repairs` / `assets` / `requests` rows the Laravel web app reads.
 */

const filterTabs = ['All Requests', 'Pending', 'In Progress', 'Completed', 'Cancelled'] as const;
type FilterTab = typeof filterTabs[number];

type AdminActionType = 'start' | 'details' | 'complete' | 'cancel' | 'replacement' | 'disposal';

type AdminAction = {
  type: AdminActionType;
  record: RepairRecord;
  result: RepairResult;
  reason: string;
  technician: string;
  repairCost: string;
  partsReplaced: string;
  expectedCompletion: string;
  inspectionFindings: string;
  adminRemarks: string;
};

const getStatusStyle = (status: RepairStatus) => {
  switch (status) {
    case 'Pending':
      return { backgroundColor: '#FEF3C7', color: '#B45309' };
    case 'In Progress':
      return { backgroundColor: '#DBEAFE', color: '#1D4ED8' };
    case 'Completed':
      return { backgroundColor: '#DCFCE7', color: '#166534' };
    case 'Cancelled':
      return { backgroundColor: '#E5E7EB', color: '#374151' };
    default:
      return { backgroundColor: '#FEF3C7', color: '#B45309' };
  }
};

const priorityTone = (priority: RepairPriority) => {
  if (priority === 'High') return { bg: '#FEE2E2', color: '#B91C1C' };
  if (priority === 'Low') return { bg: '#DCFCE7', color: '#15803D' };
  return { bg: '#FEF3C7', color: '#B45309' };
};

const lifecycleTone = (status?: string) => {
  const key = String(status ?? '').trim().toLowerCase();
  if (key === 'disposal' || key === 'disposed') return { bg: '#FEE2E2', color: '#B91C1C' };
  if (key === 'for repair') return { bg: '#FEF3C7', color: '#B45309' };
  if (key === 'for replacement') return { bg: '#EDE9FE', color: '#6D28D9' };
  if (key === 'pullout') return { bg: '#DBEAFE', color: '#1D4ED8' };
  return { bg: '#DCFCE7', color: '#15803D' };
};

const formatPrice = (value: number | null) =>
  value === null || value === undefined
    ? '—'
    : `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const parseDateInput = (raw: string): string | undefined => {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, mm, dd, yyyy] = match;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? text : new Date(parsed).toISOString().slice(0, 10);
};

/** ISO / free text → mm/dd/yyyy for the modal inputs. */
const toDateInput = (raw: string): string => {
  if (!raw) return '';
  const match = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : String(raw);
};

interface StatCardProps {
  title: string;
  value: string | number;
  icon: string;
  gradientColors: string[];
}

function StatCard({ title, value, icon, gradientColors }: StatCardProps) {
  return (
    <LinearGradient
      colors={gradientColors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.statCard}
    >
      <View style={styles.statCardContent}>
        <MaterialCommunityIcons name={icon as any} size={28} color="#FFFFFF" />
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
      </View>
    </LinearGradient>
  );
}

const REPAIR_TIMELINE: RepairStatus[] = ['Pending', 'In Progress', 'Completed'];

function RepairTimeline({ record }: { record: RepairRecord }) {
  const cancelled = record.status === 'Cancelled';
  const currentIndex = cancelled ? 1 : REPAIR_TIMELINE.indexOf(record.status);
  const steps = cancelled ? ['Pending', 'In Progress', 'Cancelled'] : REPAIR_TIMELINE;

  return (
    <View style={styles.timeline}>
      {steps.map((step, index) => {
        const done = cancelled ? index <= 2 : index <= currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step} style={styles.timelineStep}>
            <View style={styles.timelineRow}>
              <View
                style={[
                  styles.timelineDot,
                  done && (cancelled && index === 2 ? styles.timelineDotCancelled : styles.timelineDotDone),
                  active && styles.timelineDotActive,
                ]}
              />
              {index < steps.length - 1 ? (
                <View style={[styles.timelineLine, done && styles.timelineLineDone]} />
              ) : null}
            </View>
            <Text style={[styles.timelineLabel, active && styles.timelineLabelActive]}>{step}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function RepairManagement() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All Requests');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [records, setRecords] = useState<RepairRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actorLabel, setActorLabel] = useState('Admin');
  const [actorId, setActorId] = useState<string | number | null>(null);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<AdminAction | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      const data = await fetchRepairRecords();
      setRecords(data);
    } catch (error) {
      console.error('Failed to fetch repair records:', error);
      Alert.alert('Error', 'Failed to load repair records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const actor = await resolveActingUserLabel();
      setActorId(actor.id);
      setActorLabel(actor.label);
      await loadRecords();
    };
    bootstrap();
  }, [loadRecords]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecords();
    setRefreshing(false);
  };

  const stats = useMemo(
    () => ({
      total: records.length,
      pending: records.filter((r) => r.status === 'Pending').length,
      inProgress: records.filter((r) => r.status === 'In Progress').length,
      completed: records.filter((r) => r.status === 'Completed').length,
    }),
    [records],
  );

  const filteredRecords = useMemo(() => {
    if (activeFilter === 'All Requests') return records;
    return records.filter((r) => r.status === activeFilter);
  }, [activeFilter, records]);

  const openAction = (type: AdminActionType, record: RepairRecord) => {
    setAction({
      type,
      record,
      result: record.result ?? 'Repairable',
      reason: '',
      technician: record.technician,
      repairCost: record.repairCost != null ? String(record.repairCost) : '',
      partsReplaced: record.partsReplaced,
      expectedCompletion: toDateInput(record.expectedCompletion),
      inspectionFindings: record.inspectionFindings,
      adminRemarks: record.adminRemarks,
    });
  };

  const closeAction = () => setAction(null);

  const confirmAction = async () => {
    if (!action) return;
    const { type, record } = action;

    const needsReason = type === 'cancel' || type === 'replacement' || type === 'disposal';
    if (needsReason && !action.reason.trim()) {
      Alert.alert('Reason required', 'Please give a short reason so the requestor knows what happened.');
      return;
    }

    const fields = {
      technician: action.technician.trim() || undefined,
      repairCost: action.repairCost.trim() || undefined,
      partsReplaced: action.partsReplaced.trim() || undefined,
      expectedCompletion: parseDateInput(action.expectedCompletion),
      inspectionFindings: action.inspectionFindings.trim() || undefined,
      adminRemarks: action.adminRemarks.trim() || undefined,
    };

    try {
      setSaving(true);

      if (type === 'replacement') {
        await sendRepairToReplacement({
          repairId: record.repairId,
          actorId,
          actorLabel,
          reason: action.reason.trim(),
          replacementReason: action.result,
        });
        Alert.alert('Sent to Replacement', `${record.assetName} is now flagged For Replacement.`);
      } else if (type === 'disposal') {
        await sendRepairToDisposal({
          repairId: record.repairId,
          actorId,
          actorLabel,
          reason: action.reason.trim(),
          disposalReason: action.result,
        });
        Alert.alert('Sent to Disposal', `${record.assetName} is now marked for disposal.`);
      } else {
        const status: RepairStatus =
          type === 'complete'
            ? 'Completed'
            : type === 'cancel'
              ? 'Cancelled'
              : type === 'start'
                ? 'In Progress'
                : record.status;

        await updateRepairStatus({
          repairId: record.repairId,
          status,
          actorId,
          actorLabel,
          fields: {
            ...fields,
            repairResult: type === 'complete' ? action.result : record.result ?? undefined,
            cancellationReason: type === 'cancel' ? action.reason.trim() : undefined,
          },
        });

        if (type === 'complete') {
          Alert.alert(
            'Repair completed',
            action.result === 'Repairable'
              ? `${record.assetName} was repaired and is now Active.`
              : `${record.assetName} was marked "${action.result}" and is now For Replacement.`,
          );
        } else if (type === 'cancel') {
          Alert.alert('Repair cancelled', `${record.assetName} was restored to Active.`);
        } else {
          Alert.alert('Saved', 'Repair details updated.');
        }
      }

      closeAction();
      await loadRecords();
    } catch (error: any) {
      console.error('Repair action failed:', error);
      Alert.alert('Action failed', error?.message || 'Could not update the repair record.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Repair Management</Text>
          <View style={styles.headerSpacer} />
        </View>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1E3A5F" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const modalTitle: Record<AdminActionType, string> = {
    start: 'Start Repair',
    details: 'Repair Details',
    complete: 'Complete Repair',
    cancel: 'Cancel Repair',
    replacement: 'Send to Replacement',
    disposal: 'Send to Disposal',
  };

  const modalHelper: Record<AdminActionType, string> = {
    start: 'Record who will handle the repair and move the request to In Progress.',
    details: 'Record the evaluation and servicing information. The web app shows these notes too.',
    complete: 'Choose the repair result. Repairable returns the asset to Active; Beyond Repair / For Replacement moves it to the replacement process.',
    cancel: 'The repair is closed and the asset is restored to Active. A reason is required.',
    replacement: 'Creates a replacement record for this asset and flags it For Replacement. A reason is required.',
    disposal: 'Creates a disposal record for this asset and marks it disposed. A reason is required.',
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Repair Management</Text>
          <Text style={styles.subtitle}>Evaluate, track and close every repair request</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.statsContainer}>
            <StatCard title="Total Repairs" value={stats.total} icon="hammer" gradientColors={['#EF4444', '#DC2626']} />
            <StatCard title="Pending" value={stats.pending} icon="clock-outline" gradientColors={['#F59E0B', '#D97706']} />
            <StatCard title="In Progress" value={stats.inProgress} icon="sync" gradientColors={['#3B82F6', '#1D4ED8']} />
            <StatCard title="Completed" value={stats.completed} icon="check-circle" gradientColors={['#10B981', '#059669']} />
          </View>

          <View style={styles.filterContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              contentContainerStyle={styles.filterContent}
            >
              {filterTabs.map((tab) => {
                const isActive = tab === activeFilter;
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.filterButton, isActive ? styles.filterButtonActive : null]}
                    onPress={() => setActiveFilter(tab)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterLabel, isActive ? styles.filterLabelActive : null]}>{tab}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.listContainer}>
            {filteredRecords.length > 0 ? (
              filteredRecords.map((record) => {
                const statusStyle = getStatusStyle(record.status);
                const priorityStyle = priorityTone(record.priority);
                const lifeTone = lifecycleTone(record.lifecycleStatus);
                const isExpanded = expandedId === record.repairId;
                const canStart = record.status === 'Pending';
                const canComplete = record.status === 'Pending' || record.status === 'In Progress';
                const canCancel = record.status === 'Pending' || record.status === 'In Progress';

                return (
                  <View key={record.repairId} style={styles.recordCard}>
                    <View style={styles.recordHeader}>
                      <View style={styles.assetSummary}>
                        <View style={styles.assetIconWrap}>
                          <MaterialCommunityIcons name="wrench" size={26} color="#F87171" />
                        </View>
                        <View style={styles.assetTextWrap}>
                          <Text style={styles.assetName} numberOfLines={2}>
                            {record.assetName}
                          </Text>
                          <Text style={styles.assetCode}>{record.assetCode}</Text>
                          <Text style={styles.requestorText}>
                            {record.requestRef} • {record.requesterName}
                          </Text>
                          <View style={styles.pillRow}>
                            <View style={[styles.statusPillCompact, { backgroundColor: statusStyle.backgroundColor }]}>
                              <Text style={[styles.statusTextCompact, { color: statusStyle.color }]}>
                                {record.status}
                              </Text>
                            </View>
                            <View style={[styles.statusPillCompact, { backgroundColor: priorityStyle.bg }]}>
                              <Text style={[styles.statusTextCompact, { color: priorityStyle.color }]}>
                                {record.priority}
                              </Text>
                            </View>
                            {record.lifecycleStatus ? (
                              <View style={[styles.statusPillCompact, { backgroundColor: lifeTone.bg }]}>
                                <Text style={[styles.statusTextCompact, { color: lifeTone.color }]}>
                                  {record.lifecycleStatus}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </View>

                      <View style={styles.iconActions}>
                        <TouchableOpacity
                          style={styles.actionIcon}
                          activeOpacity={0.8}
                          onPress={() => setExpandedId(isExpanded ? null : record.repairId)}
                        >
                          <MaterialCommunityIcons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color="#0F172A"
                          />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {isExpanded && (
                      <View style={styles.expandedDetails}>
                        <RepairTimeline record={record} />

                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Reported Problem</Text>
                          <View style={styles.notesBox}>
                            <Text style={styles.notesText}>{record.issue || 'No problem description provided.'}</Text>
                          </View>
                        </View>

                        <View style={styles.detailGridMain}>
                          <View style={styles.detailBlockSmall}>
                            <Text style={styles.detailLabel}>Reported</Text>
                            <Text style={styles.detailValue}>{repairDateLabel(record.reportedDate)}</Text>
                          </View>
                          <View style={styles.detailBlockSmall}>
                            <Text style={styles.detailLabel}>Department</Text>
                            <Text style={styles.detailValue}>{record.department}</Text>
                          </View>
                          <View style={styles.detailBlockSmall}>
                            <Text style={styles.detailLabel}>Request No.</Text>
                            <Text style={styles.detailValue}>{record.requestRef}</Text>
                          </View>
                        </View>

                        <View style={styles.statusMessage}>
                          <MaterialCommunityIcons
                            name={record.status === 'Cancelled' ? 'close-circle-outline' : 'information-outline'}
                            size={16}
                            color={record.status === 'Cancelled' ? '#B91C1C' : '#1D4ED8'}
                          />
                          <Text
                            style={[
                              styles.statusMessageText,
                              record.status === 'Cancelled' && { color: '#B91C1C' },
                            ]}
                          >
                            {repairStatusMessage(record.status, record.result)}
                          </Text>
                        </View>

                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Asset Information</Text>
                          <View style={styles.assetInfoStack}>
                            <View style={styles.assetInfoItem}>
                              <Text style={styles.detailAssetName}>{record.assetName}</Text>
                              <Text style={styles.detailAssetCode}>{record.assetCode}</Text>
                              {record.lifecycleStatus ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Lifecycle Status</Text>
                                  <Text style={styles.assetInfoValue}>{record.lifecycleStatus}</Text>
                                </View>
                              ) : null}
                              {record.category ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Category</Text>
                                  <Text style={styles.assetInfoValue}>{record.category}</Text>
                                </View>
                              ) : null}
                              {record.condition ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Condition</Text>
                                  <Text style={styles.assetInfoValue}>{record.condition}</Text>
                                </View>
                              ) : null}
                              {record.serialNumber ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Serial Number</Text>
                                  <Text style={styles.assetInfoValue}>{record.serialNumber}</Text>
                                </View>
                              ) : null}
                              {record.location ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Location</Text>
                                  <Text style={styles.assetInfoValue}>{record.location}</Text>
                                </View>
                              ) : null}
                              {record.purchasePrice ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Purchase Price</Text>
                                  <Text style={styles.assetInfoValue}>{record.purchasePrice}</Text>
                                </View>
                              ) : null}
                              {record.warrantyMonths ? (
                                <View style={styles.assetMiniRow}>
                                  <Text style={styles.assetInfoLabel}>Warranty (Months)</Text>
                                  <Text style={styles.assetInfoValue}>{record.warrantyMonths}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        </View>

                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Servicing &amp; Evaluation</Text>
                          <View style={styles.assetInfoStack}>
                            <View style={styles.assetInfoItem}>
                              <View style={styles.assetMiniRowFirst}>
                                <Text style={styles.assetInfoLabel}>Technician / Provider</Text>
                                <Text style={styles.assetInfoValue}>{record.technician || '—'}</Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Repair Cost</Text>
                                <Text style={styles.assetInfoValue}>{formatPrice(record.repairCost)}</Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Repair Result</Text>
                                <Text style={styles.assetInfoValue}>{record.result || '—'}</Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Expected Completion</Text>
                                <Text style={styles.assetInfoValue}>
                                  {record.expectedCompletion ? repairDateLabel(record.expectedCompletion) : '—'}
                                </Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Parts Replaced</Text>
                                <Text style={styles.assetInfoValue}>{record.partsReplaced || '—'}</Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Inspection Findings</Text>
                                <Text style={styles.assetInfoValue}>{record.inspectionFindings || '—'}</Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Admin Remarks</Text>
                                <Text style={styles.assetInfoValue}>{record.adminRemarks || '—'}</Text>
                              </View>
                              <View style={styles.assetMiniRow}>
                                <Text style={styles.assetInfoLabel}>Recorded By</Text>
                                <Text style={styles.assetInfoValue}>{record.approvedBy || '—'}</Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        <View style={styles.actionRow}>
                          {canStart ? (
                            <TouchableOpacity
                              style={[styles.statusActionButton, styles.primaryActionButton]}
                              onPress={() => openAction('start', record)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.actionButtonText}>Start Repair</Text>
                            </TouchableOpacity>
                          ) : null}

                          {canComplete ? (
                            <TouchableOpacity
                              style={[styles.statusActionButton, styles.secondaryActionButton]}
                              onPress={() => openAction('complete', record)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.actionButtonText}>Completed</Text>
                            </TouchableOpacity>
                          ) : null}

                          {canCancel ? (
                            <TouchableOpacity
                              style={[styles.statusActionButton, styles.cancelActionButton]}
                              onPress={() => openAction('cancel', record)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.actionButtonText}>Cancel</Text>
                            </TouchableOpacity>
                          ) : null}

                          <TouchableOpacity
                            style={[styles.statusActionButton, styles.neutralActionButton]}
                            onPress={() => openAction('details', record)}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.actionButtonText}>Update Details</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.sendStack}>
                          <TouchableOpacity
                            style={styles.sendButton}
                            activeOpacity={0.9}
                            onPress={() => openAction('replacement', record)}
                          >
                            <MaterialCommunityIcons name="swap-horizontal" size={18} color="#FFFFFF" />
                            <Text style={styles.sendButtonText} numberOfLines={1} adjustsFontSizeToFit>
                              Send to Replacement
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.sendButtonDisposal}
                            activeOpacity={0.9}
                            onPress={() => openAction('disposal', record)}
                          >
                            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.sendButtonText} numberOfLines={1} adjustsFontSizeToFit>
                              Send to Disposal
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="inbox-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyStateText}>No repair records found</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      <TouchableOpacity
        style={styles.fabButton}
        onPress={() => router.push('/submit-request')}
        activeOpacity={0.9}
      >
        <LinearGradient
          colors={['#EF4444', '#DC2626']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabGradient}
        >
          <MaterialCommunityIcons name="plus" size={22} color="#FFFFFF" />
          <Text style={styles.fabText}>New Repair</Text>
        </LinearGradient>
      </TouchableOpacity>

      <Modal visible={action !== null} transparent animationType="fade" onRequestClose={closeAction}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalCardWrap}>
            <View style={styles.modalCard}>
              {action ? (
                <>
                  <View style={styles.modalHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalTitle}>{modalTitle[action.type]}</Text>
                      <Text style={styles.modalSubtitle} numberOfLines={2}>
                        {action.record.assetName} • {action.record.assetCode}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.modalCloseButton} onPress={closeAction}>
                      <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalBody}>
                    <Text style={styles.modalHelper}>{modalHelper[action.type]}</Text>

                    {action.type === 'complete' || action.type === 'replacement' || action.type === 'disposal' ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.modalLabel}>
                          {action.type === 'complete' ? 'Repair Result' : 'Reason Category'}
                        </Text>
                        <View style={styles.resultRow}>
                          {REPAIR_RESULTS.map((result) => {
                            const active = action.result === result;
                            return (
                              <TouchableOpacity
                                key={result}
                                style={[styles.resultChip, active && styles.resultChipActive]}
                                onPress={() => setAction({ ...action, result })}
                                activeOpacity={0.85}
                              >
                                <Text style={[styles.resultChipText, active && styles.resultChipTextActive]}>
                                  {result}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}

                    {action.type === 'cancel' || action.type === 'replacement' || action.type === 'disposal' ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.modalLabel}>
                          Reason <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          style={[styles.modalInput, styles.modalTextArea]}
                          placeholder={
                            action.type === 'cancel'
                              ? 'e.g. Repair is no longer necessary'
                              : action.type === 'replacement'
                                ? 'e.g. Beyond economic repair'
                                : 'e.g. Damaged beyond use'
                          }
                          placeholderTextColor="#94A3B8"
                          multiline
                          value={action.reason}
                          onChangeText={(text) => setAction({ ...action, reason: text })}
                        />
                      </View>
                    ) : null}

                    <View style={styles.fieldBlock}>
                      <Text style={styles.modalLabel}>Technician / Service Provider</Text>
                      <TextInput
                        style={styles.modalInput}
                        placeholder="e.g. IT Services - J. Dela Cruz"
                        placeholderTextColor="#94A3B8"
                        value={action.technician}
                        onChangeText={(text) => setAction({ ...action, technician: text })}
                      />
                    </View>

                    <View style={styles.modalTwoCol}>
                      <View style={styles.modalCol}>
                        <Text style={styles.modalLabel}>Repair Cost</Text>
                        <TextInput
                          style={styles.modalInput}
                          placeholder="0.00"
                          placeholderTextColor="#94A3B8"
                          keyboardType="decimal-pad"
                          value={action.repairCost}
                          onChangeText={(text) => setAction({ ...action, repairCost: text })}
                        />
                      </View>
                      <View style={styles.modalCol}>
                        <Text style={styles.modalLabel}>Expected Completion</Text>
                        <TextInput
                          style={styles.modalInput}
                          placeholder="mm/dd/yyyy"
                          placeholderTextColor="#94A3B8"
                          keyboardType="numbers-and-punctuation"
                          value={action.expectedCompletion}
                          onChangeText={(text) => setAction({ ...action, expectedCompletion: text })}
                        />
                      </View>
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text style={styles.modalLabel}>Parts Replaced</Text>
                      <TextInput
                        style={styles.modalInput}
                        placeholder="e.g. 1x SSD 512GB, 1x battery"
                        placeholderTextColor="#94A3B8"
                        value={action.partsReplaced}
                        onChangeText={(text) => setAction({ ...action, partsReplaced: text })}
                      />
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text style={styles.modalLabel}>Inspection Findings</Text>
                      <TextInput
                        style={[styles.modalInput, styles.modalTextArea]}
                        placeholder="What the technician found when evaluating the asset..."
                        placeholderTextColor="#94A3B8"
                        multiline
                        value={action.inspectionFindings}
                        onChangeText={(text) => setAction({ ...action, inspectionFindings: text })}
                      />
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text style={styles.modalLabel}>Admin Remarks</Text>
                      <TextInput
                        style={[styles.modalInput, styles.modalTextArea]}
                        placeholder="Notes shared with the requestor..."
                        placeholderTextColor="#94A3B8"
                        multiline
                        value={action.adminRemarks}
                        onChangeText={(text) => setAction({ ...action, adminRemarks: text })}
                      />
                    </View>
                  </ScrollView>

                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.modalCancelBtn} onPress={closeAction} activeOpacity={0.85}>
                      <Text style={styles.modalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalConfirmBtn, saving && { opacity: 0.7 }]}
                      onPress={confirmAction}
                      disabled={saving}
                      activeOpacity={0.9}
                    >
                      {saving ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.modalConfirmText}>
                          {action.type === 'start'
                            ? 'Start Repair'
                            : action.type === 'complete'
                              ? 'Save & Complete'
                              : action.type === 'cancel'
                                ? 'Cancel Repair'
                                : action.type === 'replacement'
                                  ? 'Send to Replacement'
                                  : action.type === 'disposal'
                                    ? 'Send to Disposal'
                                    : 'Save Details'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#1E3A5F',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 14,
    backgroundColor: '#1E3A5F',
  },
  backButton: {
    padding: 4,
    marginRight: 12,
  },
  headerSpacer: {
    width: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 110,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  statCard: {
    width: '48%',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  statCardContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 6,
  },
  statTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 3,
    textAlign: 'center',
  },
  filterContainer: {
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  filterScroll: {
    paddingHorizontal: 12,
  },
  filterContent: {
    gap: 8,
    paddingRight: 8,
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  filterButtonActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#1E3A5F',
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  filterLabelActive: {
    color: '#FFFFFF',
  },
  listContainer: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 30,
  },
  recordCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  assetSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  assetTextWrap: {
    flex: 1,
    gap: 2,
  },
  assetIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 20,
    flexShrink: 1,
  },
  assetCode: {
    fontSize: 12,
    color: '#64748B',
    letterSpacing: 0.1,
  },
  requestorText: {
    fontSize: 12,
    color: '#475569',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  statusPillCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusTextCompact: {
    fontSize: 11,
    fontWeight: '700',
  },
  iconActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandedDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 14,
  },
  timeline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  timelineStep: {
    flex: 1,
    alignItems: 'flex-start',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E2E8F0',
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  timelineDotDone: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  timelineDotActive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  timelineDotCancelled: {
    backgroundColor: '#B91C1C',
    borderColor: '#B91C1C',
  },
  timelineLine: {
    flex: 1,
    height: 3,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 2,
  },
  timelineLineDone: {
    backgroundColor: '#16A34A',
  },
  timelineLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  timelineLabelActive: {
    color: '#0F172A',
  },
  detailSection: {
    gap: 6,
  },
  detailGridMain: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  detailBlockSmall: {
    flex: 1,
    minWidth: 0,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  notesBox: {
    minHeight: 60,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
  },
  notesText: {
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
  },
  statusMessage: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 10,
    alignItems: 'flex-start',
  },
  statusMessageText: {
    flex: 1,
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 17,
  },
  assetInfoStack: {
    gap: 10,
  },
  assetInfoItem: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  assetMiniRowFirst: {
    marginBottom: 8,
  },
  assetMiniRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F7',
    paddingTop: 8,
  },
  assetInfoLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  assetInfoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 19,
  },
  detailAssetName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailAssetCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusActionButton: {
    flexGrow: 1,
    minWidth: 100,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionButton: {
    backgroundColor: '#2563EB',
  },
  secondaryActionButton: {
    backgroundColor: '#16A34A',
  },
  cancelActionButton: {
    backgroundColor: '#4B5563',
  },
  neutralActionButton: {
    backgroundColor: '#1E3A5F',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  sendStack: {
    gap: 10,
    marginTop: 4,
  },
  sendButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7C3AED',
    borderWidth: 1,
    borderColor: '#6D28D9',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  sendButtonDisposal: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    borderWidth: 1,
    borderColor: '#B91C1C',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#94A3B8',
    marginTop: 12,
    fontWeight: '500',
  },
  fabButton: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 8,
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  modalCardWrap: {
    width: '100%',
    maxHeight: '100%',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingTop: 16,
    paddingBottom: 16,
    maxHeight: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  modalHelper: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  fieldBlock: {
    marginBottom: 14,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  required: {
    color: '#DC2626',
  },
  modalInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8DEE8',
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 46,
    fontSize: 14,
    color: '#0F172A',
  },
  modalTextArea: {
    minHeight: 84,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  modalTwoCol: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCol: {
    flex: 1,
  },
  resultRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  resultChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D8DEE8',
    backgroundColor: '#FFFFFF',
  },
  resultChipActive: {
    borderColor: '#1E3A5F',
    backgroundColor: '#EFF6FF',
  },
  resultChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  resultChipTextActive: {
    color: '#1E3A5F',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  modalConfirmBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
