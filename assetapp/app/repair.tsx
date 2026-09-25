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
import DateTimePicker from '@react-native-community/datetimepicker';
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
import { headerTopPadding } from '@/lib/theme';

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
  repairDescription: string;
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
      return { backgroundColor: '#FEF6E4', color: '#92400E' };
    case 'In Progress':
      return { backgroundColor: '#EFF6FF', color: '#1D4ED8' };
    case 'Completed':
      return { backgroundColor: '#ECFDF5', color: '#047857' };
    case 'Cancelled':
      return { backgroundColor: '#E2E8F0', color: '#334155' };
    default:
      return { backgroundColor: '#FEF6E4', color: '#92400E' };
  }
};

const priorityTone = (priority: RepairPriority) => {
  if (priority === 'High') return { bg: '#FEF2F2', color: '#B91C1C' };
  if (priority === 'Low') return { bg: '#ECFDF5', color: '#15803D' };
  return { bg: '#FEF6E4', color: '#92400E' };
};

const lifecycleTone = (status?: string) => {
  const key = String(status ?? '').trim().toLowerCase();
  if (key === 'disposal' || key === 'disposed') return { bg: '#FEF2F2', color: '#B91C1C' };
  if (key === 'for repair') return { bg: '#FEF6E4', color: '#92400E' };
  if (key === 'for replacement') return { bg: '#EDE9FE', color: '#6D28D9' };
  if (key === 'pullout') return { bg: '#EFF6FF', color: '#1D4ED8' };
  return { bg: '#ECFDF5', color: '#15803D' };
};

const resultTone = (result: RepairResult) => {
  if (result === 'Repairable') return { bg: '#ECFDF5', color: '#047857' };
  if (result === 'Beyond Repair') return { bg: '#FEF2F2', color: '#B91C1C' };
  return { bg: '#EFF6FF', color: '#1D4ED8' };
};

/**
 * Expected-completion monitoring (system logic §6): compare the target date the
 * admin recorded against today so a repair that is running late is obvious.
 */
const expectedCompletionHint = (
  record: RepairRecord,
): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } => {
  const raw = String(record.expectedCompletion ?? '').trim();
  if (!raw) return { text: 'No target date recorded yet', tone: 'muted' };
  const due = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(due)) return { text: 'Recorded target date', tone: 'muted' };
  if (record.status === 'Completed') return { text: 'Repair closed', tone: 'ok' };
  if (record.status === 'Cancelled') return { text: 'Repair cancelled', tone: 'muted' };

  const days = Math.ceil((due - Date.now()) / 86_400_000);
  if (days < 0) {
    const late = Math.abs(days);
    return { text: `Overdue by ${late} day${late === 1 ? '' : 's'}`, tone: 'danger' };
  }
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  return { text: `${days} day${days === 1 ? '' : 's'} remaining`, tone: 'ok' };
};

const hintColor = (tone: 'ok' | 'warn' | 'danger' | 'muted') => {
  if (tone === 'danger') return '#B91C1C';
  if (tone === 'warn') return '#B45309';
  if (tone === 'ok') return '#047857';
  return '#64748B';
};

/** One servicing/evaluation field — wide blocks stack, short ones sit in pairs. */
function ServiceField({
  label,
  value,
  hint,
  hintTone,
  wide,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'ok' | 'warn' | 'danger' | 'muted';
  wide?: boolean;
  icon?: string;
}) {
  return (
    <View style={[styles.serviceField, wide ? styles.serviceFieldWide : null]}>
      <View style={styles.serviceFieldLabelRow}>
        {icon ? <MaterialCommunityIcons name={icon as any} size={13} color="#94A3B8" /> : null}
        <Text style={styles.serviceFieldLabel}>{label}</Text>
      </View>
      <Text style={styles.serviceFieldValue}>{value}</Text>
      {hint ? (
        <Text style={[styles.serviceFieldHint, { color: hintColor(hintTone ?? 'muted') }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

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

/** mm/dd/yyyy → Date, so the calendar opens on the date already recorded. */
const dateFromInput = (raw: string): Date | null => {
  const match = String(raw ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(date.getTime()) ? null : date;
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
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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

  /**
   * Repair evidence/history (system logic §9): every repair of one asset, oldest
   * first — a later repair is a new transaction, never an overwrite, so the
   * card can show it as "Repair #n" alongside the earlier ones.
   */
  const repairsByAsset = useMemo(() => {
    const map = new Map<string, RepairRecord[]>();
    for (const record of records) {
      const list = map.get(record.assetId);
      if (list) list.push(record);
      else map.set(record.assetId, [record]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aTime = Date.parse(a.reportedDate || a.createdAt || '') || 0;
        const bTime = Date.parse(b.reportedDate || b.createdAt || '') || 0;
        return aTime - bTime;
      });
    }
    return map;
  }, [records]);

  const openAction = (type: AdminActionType, record: RepairRecord) => {
    setAction({
      type,
      record,
      result: record.result ?? 'Repairable',
      reason: '',
      repairDescription: record.issue ?? '',
      technician: record.technician,
      repairCost: record.repairCost != null ? String(record.repairCost) : '',
      partsReplaced: record.partsReplaced,
      expectedCompletion: toDateInput(record.expectedCompletion),
      inspectionFindings: record.inspectionFindings,
      adminRemarks: record.adminRemarks,
    });
  };

  const closeAction = () => {
    setDatePickerOpen(false);
    setAction(null);
  };

  const confirmAction = async () => {
    if (!action) return;
    const { type, record } = action;

    // Finishing a repair with "Beyond Repair" closes it and moves the asset into
    // the disposal process; "For Replacement" moves it into the replacement
    // process. Both need a reason, exactly like the explicit send buttons.
    const completesToDisposal = type === 'complete' && action.result === 'Beyond Repair';
    const completesToReplacement = type === 'complete' && action.result === 'For Replacement';
    const sendsToReplacement = type === 'replacement' || completesToReplacement;
    const sendsToDisposal = type === 'disposal' || completesToDisposal;

    const needsReason =
      type === 'cancel' || sendsToReplacement || sendsToDisposal;
    if (needsReason && !action.reason.trim()) {
      Alert.alert('Reason required', 'Please give a short reason so the requestor knows what happened.');
      return;
    }

    // Servicing information is only recorded for the actions that document it —
    // cancelling a repair just needs its reason.
    const documentsServicing = type === 'start' || type === 'details' || type === 'complete';
    const fields = {
      repairDescription: documentsServicing ? action.repairDescription.trim() || undefined : undefined,
      technician: documentsServicing ? action.technician.trim() || undefined : undefined,
      repairCost: documentsServicing ? action.repairCost.trim() || undefined : undefined,
      partsReplaced: documentsServicing ? action.partsReplaced.trim() || undefined : undefined,
      expectedCompletion: documentsServicing ? parseDateInput(action.expectedCompletion) : undefined,
      inspectionFindings: documentsServicing ? action.inspectionFindings.trim() || undefined : undefined,
      adminRemarks: action.adminRemarks.trim() || undefined,
    };

    try {
      setSaving(true);
      let successTitle = 'Saved';
      let successMessage = 'Servicing record updated.';
      // Flipped when the evaluation table could not be written and the details
      // had to fall back to the legacy notes mirror (no silent data loss).
      let evaluationWarning = false;

      if (sendsToReplacement) {
        await sendRepairToReplacement({
          repairId: record.repairId,
          actorId,
          actorLabel,
          reason: action.reason.trim(),
          replacementReason: action.result,
          markCompleted: completesToReplacement,
        });
        successTitle = completesToReplacement ? 'Repair completed' : 'Sent to Replacement';
        successMessage = completesToReplacement
          ? `${record.assetName} was evaluated and marked "For Replacement". The replacement process is now open.`
          : `${record.assetName} is now flagged For Replacement.`;
      } else if (sendsToDisposal) {
        await sendRepairToDisposal({
          repairId: record.repairId,
          actorId,
          actorLabel,
          reason: action.reason.trim(),
          disposalReason: action.result,
          markCompleted: completesToDisposal,
        });
        successTitle = completesToDisposal ? 'Repair completed' : 'Sent to Disposal';
        successMessage = completesToDisposal
          ? `${record.assetName} was evaluated as "Beyond Repair" and is now in the disposal process.`
          : `${record.assetName} is now marked for disposal.`;
      } else {
        const status: RepairStatus =
          type === 'complete'
            ? 'Completed'
            : type === 'cancel'
              ? 'Cancelled'
              : type === 'start'
                ? 'In Progress'
                : record.status;

        const response = await updateRepairStatus({
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
        evaluationWarning = response.evaluationSaved === false;

        if (type === 'complete') {
          successTitle = 'Repair completed';
          successMessage = `${record.assetName} was repaired and is now Active.`;
        } else if (type === 'cancel') {
          successTitle = 'Repair cancelled';
          successMessage = `${record.assetName} was restored to Active.`;
        } else if (type === 'start') {
          successTitle = 'Repair started';
          successMessage = action.technician.trim()
            ? `${record.assetName} is now In Progress — assigned to ${action.technician.trim()}.`
            : `${record.assetName} is now In Progress.`;
        }
      }

      if (evaluationWarning) {
        Alert.alert(
          'Saved with a warning',
          `${successMessage} The servicing record could not be stored in the repair evaluation table, so it was saved to the repair notes instead.`,
        );
      } else if (sendsToReplacement || sendsToDisposal) {
        // The asset has left the repair process — offer the screen where that
        // process continues instead of silently dropping the admin here.
        Alert.alert(successTitle, successMessage, [
          { text: 'Stay here', style: 'cancel' },
          {
            text: sendsToReplacement ? 'Open Replacement' : 'Open Disposal',
            onPress: () => (sendsToReplacement ? router.push('/replacement') : router.push('/disposal')),
          },
        ]);
      } else {
        Alert.alert(successTitle, successMessage);
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
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
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
    start: 'Record who will handle the repair, what is expected and when. Starting moves the request to In Progress.',
    details: 'Record the servicing work: parts replaced, actual cost, inspection findings and remarks.',
    complete:
      'Record the evaluation. Repairable returns the asset to Active; Beyond Repair closes the repair and moves the asset into disposal; For Replacement opens the replacement process. This decision is final.',
    cancel: 'The repair is closed and the asset is restored to Active. A reason is required.',
    replacement: 'Creates a replacement record for this asset and flags it For Replacement. A reason is required.',
    disposal: 'Creates a disposal record for this asset and marks it disposed. A reason is required.',
  };

  // Servicing information is only recorded by the actions that document it.
  const documentsServicingAction =
    action?.type === 'start' || action?.type === 'details' || action?.type === 'complete';

  // A result that ends the repair needs a documented reason too, so the
  // requestor is told why the asset left the repair process.
  const showsReasonField =
    action?.type === 'cancel' ||
    action?.type === 'replacement' ||
    action?.type === 'disposal' ||
    (action?.type === 'complete' && action.result !== 'Repairable');

  const confirmLabel = (): string => {
    if (!action) return 'Save';
    if (action.type === 'start') return 'Start Repair';
    if (action.type === 'cancel') return 'Cancel Repair';
    if (action.type === 'replacement') return 'Send to Replacement';
    if (action.type === 'disposal') return 'Send to Disposal';
    if (action.type === 'complete') {
      if (action.result === 'Beyond Repair') return 'Complete & Send to Disposal';
      if (action.result === 'For Replacement') return 'Complete & Send to Replacement';
      return 'Save & Complete';
    }
    return 'Save Details';
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

      {/* Body keeps only the side/bottom insets — the header already clears the
          status bar, so its top inset would be a dead strip. */}
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
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
                const dueHint = expectedCompletionHint(record);
                const assetHistory = repairsByAsset.get(record.assetId) ?? [];
                const historyIndex = assetHistory.findIndex((r) => r.repairId === record.repairId);
                const repairNumber = historyIndex >= 0 ? historyIndex + 1 : 1;
                const previousRepairs = historyIndex > 0 ? assetHistory.slice(0, historyIndex) : [];
                const isExpanded = expandedId === record.repairId;
                const canStart = record.status === 'Pending';
                const canComplete = record.status === 'Pending' || record.status === 'In Progress';
                const canCancel = record.status === 'Pending' || record.status === 'In Progress';

                // A repair is final once it is Completed / Cancelled, or once the
                // asset has already left the repair process. From that point the
                // record is history: no more editing and no more sending it
                // anywhere else — one decision, taken once.
                const lifecycleKey = String(record.lifecycleStatus ?? '').trim().toLowerCase();
                const canFinalize =
                  canComplete && lifecycleKey !== 'disposal' && lifecycleKey !== 'disposed';
                const canSend = canFinalize && lifecycleKey !== 'for replacement';

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
                          <View style={styles.sectionHeadRow}>
                            <Text style={styles.detailLabel}>Servicing &amp; Evaluation</Text>
                            {record.result ? (
                              <View
                                style={[styles.miniPill, { backgroundColor: resultTone(record.result).bg }]}
                              >
                                <Text style={[styles.miniPillText, { color: resultTone(record.result).color }]}>
                                  {record.result}
                                </Text>
                              </View>
                            ) : null}
                            {repairNumber > 1 ? (
                              <Text style={styles.repairNumberLabel}>Repair #{repairNumber}</Text>
                            ) : null}
                          </View>

                          {!record.evaluationId ? (
                            <Text style={styles.sectionHint}>
                              No servicing record yet — Start Repair to assign the technician, or Update Details to
                              document the work.
                            </Text>
                          ) : null}

                          <View style={styles.serviceGrid}>
                            <ServiceField
                              label="Technician / Provider"
                              icon="account-wrench-outline"
                              value={record.technician || '—'}
                            />
                            <ServiceField
                              label="Repair Cost"
                              icon="cash"
                              value={formatPrice(record.repairCost)}
                            />
                            <ServiceField
                              label="Expected Completion"
                              icon="calendar-clock"
                              wide
                              value={
                                record.expectedCompletion ? repairDateLabel(record.expectedCompletion) : 'Not set'
                              }
                              hint={dueHint.text}
                              hintTone={dueHint.tone}
                            />
                            <ServiceField
                              label="Parts Replaced"
                              icon="cog-outline"
                              wide
                              value={record.partsReplaced || '—'}
                            />
                            <ServiceField
                              label="Inspection Findings"
                              icon="magnify-scan"
                              wide
                              value={record.inspectionFindings || '—'}
                            />
                            <ServiceField
                              label="Admin Remarks"
                              icon="comment-text-outline"
                              wide
                              value={record.adminRemarks || '—'}
                            />
                          </View>

                          <View style={styles.recordedByRow}>
                            <MaterialCommunityIcons name="account-check-outline" size={15} color="#64748B" />
                            <Text style={styles.recordedByText}>
                              Recorded By{' '}
                              <Text style={styles.recordedByStrong}>
                                {record.recordedByName || record.approvedBy || '—'}
                              </Text>
                              {record.evaluationUpdatedAt
                                ? ` • ${repairDateLabel(record.evaluationUpdatedAt)}`
                                : ''}
                            </Text>
                          </View>

                          {previousRepairs.length > 0 ? (
                            <View style={styles.historyBlock}>
                              <Text style={styles.detailLabel}>Repair History of This Asset</Text>
                              {previousRepairs.map((previous, index) => (
                                <View key={previous.repairId} style={styles.historyRow}>
                                  <Text style={styles.historyText} numberOfLines={1}>
                                    #{index + 1} • {repairDateLabel(previous.reportedDate || previous.createdAt)} •{' '}
                                    {previous.technician || 'Technician not recorded'}
                                  </Text>
                                  <Text style={styles.historyStatus}>
                                    {previous.result || previous.status}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
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

                          {canFinalize ? (
                            <TouchableOpacity
                              style={[styles.statusActionButton, styles.neutralActionButton]}
                              onPress={() => openAction('details', record)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.actionButtonText}>Update Details</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        {canSend ? (
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
                        ) : null}

                        {!canFinalize ? (
                          <View style={styles.finalizedNotice}>
                            <MaterialCommunityIcons name="lock-check-outline" size={16} color="#15803D" />
                            <Text style={styles.finalizedNoticeText}>
                              This repair is final{record.result ? ` — ${record.result}` : ` — ${record.status}`}.
                              {lifecycleKey === 'disposal' || lifecycleKey === 'disposed'
                                ? ' The asset has already been disposed of.'
                                : lifecycleKey === 'for replacement'
                                  ? ' The asset is in the replacement process.'
                                  : ' The servicing details and the send buttons are closed.'}
                            </Text>
                          </View>
                        ) : null}
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
                        {action.type === 'complete' ? (
                          <Text style={styles.resultHint}>
                            {action.result === 'Repairable'
                              ? 'The asset is functional again and returns to Active.'
                              : action.result === 'Beyond Repair'
                                ? 'Closes this repair and moves the asset straight into the disposal process.'
                                : 'Closes this repair and opens the replacement process for this asset.'}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    {showsReasonField ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.modalLabel}>
                          Reason <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          style={[styles.modalInput, styles.modalTextArea]}
                          placeholder={
                            action.type === 'cancel'
                              ? 'e.g. Repair is no longer necessary'
                              : action.type === 'replacement' ||
                                  (action.type === 'complete' && action.result === 'For Replacement')
                                ? 'e.g. Beyond economic repair'
                                : action.type === 'complete'
                                  ? 'e.g. Damaged beyond use — parts no longer available'
                                  : 'e.g. Damaged beyond use'
                          }
                          placeholderTextColor="#94A3B8"
                          multiline
                          value={action.reason}
                          onChangeText={(text) => setAction({ ...action, reason: text })}
                        />
                      </View>
                    ) : null}

                    {documentsServicingAction ? (
                      <>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.modalLabel}>Repair Description</Text>
                          <TextInput
                            style={[styles.modalInput, styles.modalTextArea]}
                            placeholder="What was reported / what the repair needs to cover..."
                            placeholderTextColor="#94A3B8"
                            multiline
                            value={action.repairDescription}
                            onChangeText={(text) => setAction({ ...action, repairDescription: text })}
                          />
                        </View>

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
                            <Text style={styles.modalLabel}>
                              {action.type === 'start' ? 'Estimated Repair Cost' : 'Actual Repair Cost'}
                            </Text>
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
                            <TouchableOpacity
                              style={styles.dateField}
                              activeOpacity={0.85}
                              onPress={() => setDatePickerOpen(true)}
                              accessibilityRole="button"
                              accessibilityLabel="Choose the expected completion date"
                            >
                              <MaterialCommunityIcons name="calendar-month" size={18} color="#1E3A5F" />
                              <Text
                                style={[
                                  styles.dateFieldText,
                                  !action.expectedCompletion && styles.dateFieldPlaceholder,
                                ]}
                                numberOfLines={1}
                              >
                                {action.expectedCompletion || 'Set a date'}
                              </Text>
                              {action.expectedCompletion ? (
                                <TouchableOpacity
                                  onPress={() => setAction({ ...action, expectedCompletion: '' })}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                                </TouchableOpacity>
                              ) : null}
                            </TouchableOpacity>
                          </View>
                        </View>

                        {datePickerOpen ? (
                          <View style={styles.datePickerWrap}>
                            <DateTimePicker
                              value={dateFromInput(action.expectedCompletion) ?? new Date()}
                              mode="date"
                              display={Platform.OS === 'ios' ? 'inline' : 'default'}
                              onValueChange={(_, selected) => {
                                if (Platform.OS !== 'ios') setDatePickerOpen(false);
                                const iso = `${selected.getFullYear()}-${String(
                                  selected.getMonth() + 1,
                                ).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`;
                                setAction({ ...action, expectedCompletion: toDateInput(iso) });
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
                      </>
                    ) : null}

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

                    <View style={styles.recordedByNotice}>
                      <MaterialCommunityIcons name="account-check-outline" size={15} color="#1E3A5F" />
                      <Text style={styles.recordedByNoticeText}>
                        Recorded By <Text style={styles.recordedByNoticeName}>{actorLabel}</Text> — captured
                        automatically from your login.
                      </Text>
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
                        <Text style={styles.modalConfirmText} numberOfLines={1} adjustsFontSizeToFit>
                          {confirmLabel()}
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
    backgroundColor: '#F4F7FB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: headerTopPadding,
    paddingBottom: 14,
    backgroundColor: '#1E3A5F',
  },
  backButton: {
    padding: 4,
    marginRight: 12,
    height: 42,
    borderRadius: 14,
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
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
    backgroundColor: '#F4F7FB',
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    height: 50,
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
    borderColor: '#EDF1F7',
    borderRadius: 18,
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
    backgroundColor: '#FEF2F2',
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
    paddingHorizontal: 9,
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
    backgroundColor: '#F4F7FB',
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
    backgroundColor: '#F4F7FB',
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
    backgroundColor: '#F4F7FB',
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
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
  },
  primaryActionButton: {
    backgroundColor: '#2563EB',
  },
  secondaryActionButton: {
    backgroundColor: '#16A34A',
  },
  cancelActionButton: {
    backgroundColor: '#475569',
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
    paddingHorizontal: 12,
    borderRadius: 14,
    minHeight: 48,
    height: 48,
  },
  sendButtonDisposal: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    borderRadius: 14,
    minHeight: 48,
    height: 48,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
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
    width: 42,
    height: 42,
    borderRadius: 14,
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
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 14.5,
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
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  dateFieldText: {
    flex: 1,
    fontSize: 14.5,
    color: '#0F172A',
    fontWeight: '600',
  },
  dateFieldPlaceholder: {
    color: '#94A3B8',
    fontWeight: '400',
  },
  datePickerWrap: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    marginBottom: 14,
    padding: 6,
  },
  datePickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#1E3A5F',
    marginRight: 6,
    marginBottom: 6,
  },
  datePickerDoneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    height: 40,
  },
  resultChipActive: {
    borderColor: '#1E3A5F',
    backgroundColor: '#EFF6FF',
  },
  resultChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
  resultChipTextActive: {
    color: '#1E3A5F',
  },
  resultHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748B',
  },
  finalizedNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  finalizedNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: '#15803D',
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#334155',
  },
  modalConfirmBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionHint: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
  },
  miniPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  miniPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  repairNumberLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E3A5F',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  serviceField: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  serviceFieldWide: {
    flexBasis: '100%',
  },
  serviceFieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  serviceFieldLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  serviceFieldValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  serviceFieldHint: {
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 3,
  },
  recordedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  recordedByText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
  },
  recordedByStrong: {
    fontWeight: '700',
    color: '#1E3A5F',
  },
  historyBlock: {
    gap: 6,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
  },
  historyStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  recordedByNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 4,
  },
  recordedByNoticeText: {
    flex: 1,
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
  },
  recordedByNoticeName: {
    fontWeight: '800',
    color: '#1E3A5F',
  },
});
