import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import NotificationBell from '@/components/notification-bell';
import { supabase } from '@/lib/supabase';
import { fetchDisposalForms, type DisposalFormRecord } from '@/lib/disposalForm';
import { fetchDisposalRecords, type DisposalRecord } from '@/lib/disposalService';
import { ADMIN_AREA_MESSAGE, isOfficeRole } from '@/lib/access';
import { formatStoredDate } from '@/lib/time';
import { headerTopPadding } from '@/lib/theme';
import { friendlyErrorMessage } from '@/lib/errorMessage';
import { usePagedList } from '@/hooks/use-paged-list';

/**
 * Disposal Management, for the Asset Management Office.
 *
 * This screen used to scan an asset and write a disposal row on the spot,
 * which retired the asset without an approved request or the official form.
 * The web's workflow is the opposite: a request is approved, the official NU
 * Lipa form is prepared, printed and signed, and only then is the disposal
 * finalized — the single step that marks the asset Disposed.
 *
 * So the screen now shows that workflow instead of bypassing it:
 *
 *   Requests  the disposal requests, their status, and the stage of the
 *             official form (awaiting preparation → ready → printed → signed →
 *             finalized)
 *   Records   the `disposals` rows the web writes at finalization, read-only
 *
 * Preparing, printing, filing the signed copy and finalizing happen on the web
 * application; the phone displays the authoritative stage and links to the
 * request, where the shared form's details can be saved.
 */

type DisposalRequestRow = {
  id: string;
  status: string;
  note: string;
  createdAt: string;
  requesterName: string;
  department: string;
  assetCodes: string[];
  assetNames: string[];
  form: DisposalFormRecord | null;
  recordedCount: number;
};

type Tab = 'Requests' | 'Records';
type RequestFilter = 'All' | 'Pending' | 'Approved' | 'Rejected';

const REQUEST_FILTERS: RequestFilter[] = ['All', 'Pending', 'Approved', 'Rejected'];

const statusTone = (status: string) => {
  const key = String(status ?? '').trim().toLowerCase();
  if (key === 'approved') return { bg: '#ECFDF5', text: '#047857' };
  if (key === 'rejected') return { bg: '#FEF2F2', text: '#B91C1C' };
  return { bg: '#FEF6E4', text: '#92400E' };
};

const assetLabelOf = (row: DisposalRequestRow): string => {
  const names = row.assetNames.filter(Boolean);
  if (names.length === 0) return row.assetCodes.filter(Boolean).join(', ') || 'Unknown asset';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1} more`;
};

const codesOf = (row: DisposalRequestRow): string => row.assetCodes.filter(Boolean).join(', ');

export default function DisposalScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Requests');
  const [filter, setFilter] = useState<RequestFilter>('All');
  const [search, setSearch] = useState('');
  const [requests, setRequests] = useState<DisposalRequestRow[]>([]);
  const [records, setRecords] = useState<DisposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [viewerChecked, setViewerChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('user');
        const stored = raw ? JSON.parse(raw) : null;
        setViewerRole(String(stored?.role ?? ''));
      } catch {
        setViewerRole('');
      } finally {
        setViewerChecked(true);
      }
    })();
  }, []);

  const canView = isOfficeRole(viewerRole);

  const load = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from('requests')
        .select(
          `id, request_type, status, Note, created_at,
           users:user_id (employee_numbers (Full_Name), email, departments:department_id (Name)),
           assets (Asset_code, Asset_name),
           request_items (assets (Asset_code, Asset_name))`,
        )
        .ilike('request_type', 'disposal')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as any[];
      const ids = rows.map((row) => row?.id).filter((id) => id != null);

      // One read for every form stage, and one for the finalized records; the
      // stage shown is the web's, never a value this screen inferred.
      const [forms, disposalRecords] = await Promise.all([
        fetchDisposalForms(ids),
        fetchDisposalRecords().catch(() => [] as DisposalRecord[]),
      ]);

      const recordsByRequest = new Map<string, number>();
      disposalRecords.forEach((record) => {
        const key = String(record.requestId ?? '');
        if (!key) return;
        recordsByRequest.set(key, (recordsByRequest.get(key) ?? 0) + 1);
      });

      const mapped: DisposalRequestRow[] = rows.map((row: any) => {
        const user = Array.isArray(row?.users) ? row.users[0] : row?.users;
        const employee = Array.isArray(user?.employee_numbers) ? user.employee_numbers[0] : user?.employee_numbers;
        const department = Array.isArray(user?.departments) ? user.departments[0] : user?.departments;

        const assetCodes = new Set<string>();
        const assetNames = new Set<string>();
        const addAsset = (asset: any) => {
          if (!asset) return;
          const code = String(asset.Asset_code ?? '').trim();
          const name = String(asset.Asset_name ?? '').trim();
          if (code) assetCodes.add(code);
          if (name) assetNames.add(name);
        };
        const direct = Array.isArray(row?.assets) ? row.assets[0] : row?.assets;
        addAsset(direct);
        (row?.request_items ?? []).forEach((item: any) =>
          addAsset(Array.isArray(item?.assets) ? item.assets[0] : item?.assets),
        );

        const id = String(row?.id ?? '');
        return {
          id,
          status: String(row?.status ?? 'Pending'),
          note: String(row?.Note ?? ''),
          createdAt: String(row?.created_at ?? ''),
          requesterName: String(employee?.Full_Name ?? user?.email ?? 'Unknown'),
          department: String(department?.Name ?? ''),
          assetCodes: Array.from(assetCodes),
          assetNames: Array.from(assetNames),
          form: forms.get(id) ?? null,
          recordedCount: recordsByRequest.get(id) ?? 0,
        };
      });

      setRequests(mapped);
      setRecords(disposalRecords);
    } catch (error) {
      console.error('Failed to load disposal management:', error);
      setLoadError(friendlyErrorMessage(error, 'Could not load disposal management. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on focus: a form moved on the web (printed, signed, finalized) must
  // not leave a stale stage on the phone. Only the first visit shows the loader.
  const firstLoad = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (!canView) return;
      void load(firstLoad.current);
      firstLoad.current = false;
    }, [canView, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  };

  const filteredRequests = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return requests.filter((row) => {
      if (filter !== 'All' && String(row.status).toLowerCase() !== filter.toLowerCase()) return false;
      if (!needle) return true;
      return [row.id, row.requesterName, row.department, row.note, ...row.assetCodes, ...row.assetNames]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, requests, search]);

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [
        record.assetCode,
        record.assetName,
        record.reason,
        record.reasonCategory,
        record.method,
        record.requesterName,
        record.department,
        record.requestRef,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [records, search]);

  const requestPages = usePagedList(filteredRequests);
  const recordPages = usePagedList(filteredRecords);

  const formCounts = useMemo(() => {
    const counts = { draft: 0, ready: 0, printed: 0, signed: 0, finalized: 0, missing: 0 };
    requests.forEach((row) => {
      if (!row.form) {
        if (String(row.status).toLowerCase() === 'approved') counts.missing += 1;
        return;
      }
      counts[row.form.stage] += 1;
    });
    return counts;
  }, [requests]);

  if (!viewerChecked) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Disposal</Text>
        </View>
        <View style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0F172A" />
          </View>
        </View>
      </View>
    );
  }

  if (!canView) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Disposal</Text>
          <NotificationBell />
        </View>
        <View style={styles.container}>
          <View style={styles.accessState}>
            <View style={styles.accessIconWrap}>
              <MaterialCommunityIcons name="shield-lock-outline" size={38} color="#64748B" />
            </View>
            <Text style={styles.accessTitle}>Office only</Text>
            <Text style={styles.accessText}>{ADMIN_AREA_MESSAGE}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              activeOpacity={0.85}
              onPress={() => router.replace('/(user-tabs)' as any)}
            >
              <MaterialCommunityIcons name="arrow-left" size={18} color="#0C134F" />
              <Text style={styles.retryButtonText}>Back to my dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Disposal</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            activeOpacity={0.8}
            onPress={() => router.push('/archived-disposals' as any)}
            accessibilityLabel="Archived disposal records"
          >
            <MaterialCommunityIcons name="archive-outline" size={21} color="#FFFFFF" />
          </TouchableOpacity>
          <NotificationBell />
        </View>
      </View>

      <View style={styles.container}>
        <View style={styles.tabRow}>
          {(['Requests', 'Records'] as Tab[]).map((value) => {
            const active = tab === value;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.tabButton, active && styles.tabButtonActive]}
                onPress={() => setTab(value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{value}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.searchRow}>
          <MaterialCommunityIcons name="magnify" size={19} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={tab === 'Requests' ? 'Search asset, requester or note' : 'Search disposed asset or reason'}
            placeholderTextColor="#94A3B8"
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} activeOpacity={0.8}>
              <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {tab === 'Requests' ? (
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onMomentumScrollEnd={requestPages.loadMore}
          >
            <View style={styles.infoCard}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#1D4ED8" />
              <Text style={styles.infoText}>
                Approving a disposal request prepares the official NU Lipa form. Preparing, printing, the signed
                copy and finalization happen in the web application; only finalization marks an asset Disposed.
              </Text>
            </View>

            <View style={styles.statRow}>
              <Stat label="Awaiting form" value={formCounts.missing} />
              <Stat label="In preparation" value={formCounts.draft} />
              <Stat label="Ready / printed" value={formCounts.ready + formCounts.printed} />
              <Stat label="Finalized" value={formCounts.finalized} />
            </View>

            <View style={styles.filterRow}>
              {REQUEST_FILTERS.map((value) => {
                const active = filter === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setFilter(value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{value}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {loadError ? (
              <View style={styles.errorState}>
                <MaterialCommunityIcons name="wifi-off" size={38} color="#94A3B8" />
                <Text style={styles.errorStateText}>{loadError}</Text>
                <TouchableOpacity style={styles.retryButton} activeOpacity={0.85} onPress={() => void load()}>
                  <MaterialCommunityIcons name="refresh" size={18} color="#0C134F" />
                  <Text style={styles.retryButtonText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0F172A" />
              </View>
            ) : requestPages.visible.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  {search || filter !== 'All' ? 'No disposal request matches this view.' : 'No disposal requests yet.'}
                </Text>
              </View>
            ) : (
              <>
                {requestPages.visible.map((row) => {
                  const tone = statusTone(row.status);
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={styles.card}
                      activeOpacity={0.9}
                      onPress={() => router.push({ pathname: '/request-detail', params: { id: row.id } })}
                    >
                      <View style={styles.cardTop}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {assetLabelOf(row)}
                        </Text>
                        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.statusPillText, { color: tone.text }]}>{row.status}</Text>
                        </View>
                      </View>
                      {codesOf(row) ? (
                        <Text style={styles.cardCode} numberOfLines={1}>
                          {codesOf(row)}
                        </Text>
                      ) : null}
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        REQ-{row.id} · {formatStoredDate(row.createdAt)} · {row.requesterName || 'Unknown'}
                        {row.department ? ` · ${row.department}` : ''}
                      </Text>
                      {row.note ? (
                        <Text style={styles.cardNote} numberOfLines={2}>
                          {row.note}
                        </Text>
                      ) : null}

                      <View style={styles.formRow}>
                        {row.form ? (
                          <View
                            style={[
                              styles.stagePill,
                              row.form.isFinalized ? styles.stagePillDone : styles.stagePillOpen,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stagePillText,
                                row.form.isFinalized ? styles.stagePillTextDone : styles.stagePillTextOpen,
                              ]}
                            >
                              {row.form.stageLabel}
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.stagePillMissing}>
                            <Text style={styles.stagePillMissingText}>
                              {String(row.status).toLowerCase() === 'approved'
                                ? 'Official form not generated'
                                : 'No form — request not approved'}
                            </Text>
                          </View>
                        )}
                        {/* Legacy open records exist for some requests approved
                            by the old direct path; only a finalized form means
                            the assets are actually disposed. */}
                        {row.form?.isFinalized && row.recordedCount > 0 ? (
                          <Text style={styles.recordedText}>
                            {row.recordedCount} record{row.recordedCount === 1 ? '' : 's'} disposed
                          </Text>
                        ) : null}
                        <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {requestPages.hasMore ? (
                  <TouchableOpacity
                    style={styles.loadMoreButton}
                    onPress={requestPages.loadMore}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#0C134F" />
                    <Text style={styles.loadMoreText}>
                      Load more requests ({requestPages.shown} of {requestPages.total})
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onMomentumScrollEnd={recordPages.loadMore}
          >
            <View style={styles.infoCard}>
              <MaterialCommunityIcons name="file-document-check-outline" size={18} color="#047857" />
              <Text style={styles.infoText}>
                These are the disposal records — the same rows the web application reads and writes. A record
                written by the web at finalization is closed history; a row from the old direct-disposal flow may
                still be open. Read-only here: finalization, archiving and inventory removal stay on the web.
              </Text>
            </View>

            {loadError ? (
              <View style={styles.errorState}>
                <MaterialCommunityIcons name="wifi-off" size={38} color="#94A3B8" />
                <Text style={styles.errorStateText}>{loadError}</Text>
                <TouchableOpacity style={styles.retryButton} activeOpacity={0.85} onPress={() => void load()}>
                  <MaterialCommunityIcons name="refresh" size={18} color="#0C134F" />
                  <Text style={styles.retryButtonText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0F172A" />
              </View>
            ) : recordPages.visible.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  {search ? 'No disposal record matches this search.' : 'No disposal has been finalized yet.'}
                </Text>
              </View>
            ) : (
              <>
                {recordPages.visible.map((record) => (
                  <TouchableOpacity
                    key={record.disposalId}
                    style={styles.card}
                    activeOpacity={record.assetId ? 0.9 : 1}
                    onPress={
                      record.assetId
                        ? () => router.push({ pathname: '/asset-details', params: { id: record.assetId! } })
                        : undefined
                    }
                  >
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {record.assetName || 'Unknown asset'}
                      </Text>
                      <View style={[styles.statusPill, { backgroundColor: '#F1F5F9' }]}>
                        <Text style={[styles.statusPillText, { color: '#334155' }]}>
                          {record.assetCode || record.status}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {record.disposalDate ? `${formatStoredDate(record.disposalDate)} · ` : ''}
                      {record.reasonCategory || record.reason || 'Reason not recorded'}
                      {record.method ? ` · ${record.method}` : ''}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {record.requesterName || 'Unknown requester'}
                      {record.department ? ` · ${record.department}` : ''}
                      {record.requestId ? ` · REQ-${record.requestId}` : ''}
                    </Text>
                    {record.remarks ? (
                      <Text style={styles.cardNote} numberOfLines={2}>
                        {record.remarks}
                      </Text>
                    ) : null}
                    <View style={styles.formRow}>
                      <Text style={styles.recordedText}>
                        {record.lifecycleStatus ? `Asset status: ${record.lifecycleStatus}` : 'Disposal recorded'}
                      </Text>
                      {record.assetId ? <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" /> : null}
                    </View>
                  </TouchableOpacity>
                ))}

                {recordPages.hasMore ? (
                  <TouchableOpacity style={styles.loadMoreButton} onPress={recordPages.loadMore} activeOpacity={0.85}>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#0C134F" />
                    <Text style={styles.loadMoreText}>
                      Load more records ({recordPages.shown} of {recordPages.total})
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#0C134F' },
  container: { flex: 1, backgroundColor: '#F4F7FB' },
  loadingContainer: { flex: 1, minHeight: 220, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingTop: headerTopPadding,
    paddingBottom: 16,
    backgroundColor: '#0C134F',
    gap: 10,
  },
  backButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 21, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabButton: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: { borderBottomColor: '#1D4ED8' },
  tabLabel: { color: '#475569', fontSize: 14, fontWeight: '700' },
  tabLabelActive: { color: '#1D4ED8' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  list: { padding: 16, paddingBottom: 112 },
  infoCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 12.5, color: '#1E3A8A', lineHeight: 18 },
  statRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '800', color: '#0C134F' },
  statLabel: { fontSize: 10, color: '#64748B', fontWeight: '700', marginTop: 2, textAlign: 'center' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  filterChip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: { backgroundColor: '#0C134F', borderColor: '#0C134F' },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  filterChipTextActive: { color: '#FFFFFF' },
  card: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0F172A' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11.5, fontWeight: '800' },
  cardCode: { fontSize: 12, color: '#475569', marginTop: 3, fontWeight: '600' },
  cardMeta: { fontSize: 12, color: '#64748B', marginTop: 4 },
  cardNote: { fontSize: 12.5, color: '#334155', marginTop: 6, lineHeight: 18 },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  stagePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  stagePillOpen: { backgroundColor: '#FEF6E4', borderColor: '#FDE68A' },
  stagePillTextOpen: { color: '#92400E' },
  stagePillDone: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  stagePillTextDone: { color: '#047857' },
  stagePillText: { fontSize: 11.5, fontWeight: '800' },
  stagePillMissing: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  stagePillMissingText: { fontSize: 11.5, fontWeight: '800', color: '#B91C1C' },
  recordedText: { flex: 1, fontSize: 11.5, color: '#64748B', fontWeight: '600' },
  errorState: {
    marginTop: 8,
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 10,
  },
  errorStateText: { color: '#475569', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyState: { paddingVertical: 42, alignItems: 'center' },
  emptyStateText: { fontSize: 14, color: '#94A3B8', textAlign: 'center' },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#FDB833',
    marginTop: 2,
  },
  retryButtonText: { color: '#0C134F', fontSize: 13.5, fontWeight: '800' },
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  loadMoreText: { fontSize: 14, fontWeight: '700', color: '#0C134F' },
  accessState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingBottom: 60,
    gap: 12,
  },
  accessIconWrap: {
    width: 78,
    height: 78,
    borderRadius: 26,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  accessText: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 21 },
});
