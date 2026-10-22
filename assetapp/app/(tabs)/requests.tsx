import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { RequestCard, RequestItem, RequestStatus } from '@/components/requests/request-card';
import { updateRequestStatus, type RequestDecisionOptions } from '@/lib/userService';
import { DISPOSAL_APPROVAL_REASONS, deriveDisposalReason, todayIsoDay } from '@/lib/disposalForm';
import { summarizeApproval } from '@/lib/requestService';
import { sortByReviewOrder } from '@/lib/reviewOrder';
import { formatStoredDate } from '@/lib/time';
import NotificationBell from '@/components/notification-bell';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AssetScanButton } from '@/components/asset-scanner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { headerTopPadding } from '@/lib/theme';
import { MonthFilter } from '@/components/month-filter';
import { monthLabel, monthQueryBounds, timestampOf } from '@/lib/monthFilter';
import { ADMIN_AREA_MESSAGE, isOfficeRole } from '@/lib/access';
import { friendlyErrorMessage } from '@/lib/errorMessage';
import { PAGE_SIZE, usePagedList } from '@/hooks/use-paged-list';

const tabs = ['All', 'Pending', 'Completed'] as const;
type RequestTab = typeof tabs[number];

/** How the filtered list is ordered. */
type RequestSort = 'review' | 'newest' | 'oldest';

const SORT_OPTIONS: { key: RequestSort; label: string }[] = [
  { key: 'review', label: 'Review order' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

const isoDayOf = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** `yyyy-mm-dd` → local midnight, for the date picker. */
const parseIsoDay = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

export default function RequestsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<RequestTab>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [sort, setSort] = useState<RequestSort>('review');
  // A failed load is not an empty month: the list has to say so instead of
  // rendering "No requests found" over a network error.
  const [loadError, setLoadError] = useState<string | null>(null);
  // One status change per request at a time; a second tap is ignored rather
  // than posting the same decision twice.
  const updatesInFlight = useRef<Set<string>>(new Set());
  // The card whose decision is being written, so it can show progress instead
  // of inviting a second tap.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Only the Asset Management Office may open this list (web: /admin/requests).
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [viewerChecked, setViewerChecked] = useState(false);
  // A decision waiting for the details the web asks for: a disposal reason and
  // expected date on approval, an optional reason on rejection.
  const [decision, setDecision] = useState<{ item: RequestItem; status: 'Approved' | 'Rejected' } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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

  const canReview = isOfficeRole(viewerRole);

  /**
   * @param showLoader false for refreshes and post-update reloads, which should
   *   update the list in place instead of replacing it with a full-screen spinner.
   */
  const fetchRequests = useCallback(async (showLoader = true) => {
  try {
    if (showLoader) setLoading(true);
    setLoadError(null);

    // The month window is applied in the query, not after it: the office's
    // request table only grows, and there is no reason for a phone to download
    // years of rows to then hide them.
    let query = supabase
      .from('requests')
      .select(`
        id, 
        request_type, 
        status, 
        Note, 
        created_at, 
        users:user_id (
          department_id,
          employee_numbers (
            Full_Name
          ),
          departments:department_id (
            Name
          )
        ), 
        assets (Asset_code, Asset_name, Lifecycle_Status, asset_files (Asset_file_ID, file_name, file_path, url)),
        request_items (assets (Asset_code, Asset_name, Lifecycle_Status, asset_files (Asset_file_ID, file_name, file_path, url)))
      `);

    // The local month as a naive-UTC window (see monthQueryBounds).
    const bounds = monthKey ? monthQueryBounds(monthKey) : null;
    if (bounds) {
      query = query.gte('created_at', bounds.from).lte('created_at', bounds.to);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const requests = (data as any[] || []);
    const requestIds = requests.map((r: any) => r?.id).filter((v: any) => v !== null && v !== undefined);

    // Multi-asset requests link assets through `request_items` (requests.asset_id
    // is often NULL in this database), so resolve those too.
    const itemsByRequest = new Map<string, any[]>();

    // Fallback links: some requests only carry asset links inside `replacements`
    // (old_assets_id per Request_id), e.g. requests approved before items were
    // recorded. Resolve those so no request renders as "Unknown Asset".
    const replacementAssetsByRequest = new Map<string, any[]>();

    if (requestIds.length > 0) {
      // The two lookups are independent, so they share one round trip's wait
      // instead of being fetched one after the other.
      const [itemsRes, repRes] = await Promise.all([
        supabase
          .from('request_items')
          .select('request_id, assets (Asset_code, Asset_name, Lifecycle_Status, asset_files (Asset_file_ID, file_name, file_path, url))')
          .in('request_id', requestIds),
        supabase
          .from('replacements')
          .select('Request_id, old_assets_id, new_assets_id')
          .in('Request_id', requestIds),
      ]);

      if (itemsRes.error) {
        console.error('Failed to fetch request items:', itemsRes.error.message);
      } else {
        (itemsRes.data || []).forEach((it: any) => {
          const key = String(it?.request_id ?? '');
          if (!key) return;
          const list = itemsByRequest.get(key) ?? [];
          list.push(it);
          itemsByRequest.set(key, list);
        });
      }

      if (repRes.error) {
        console.error('Failed to fetch replacement links:', repRes.error.message);
      } else {
        const repRows = repRes.data || [];
        const wanted: number[] = [];
        repRows.forEach((r: any) => {
          [r.old_assets_id, r.new_assets_id].forEach((raw) => {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0 && !wanted.includes(n)) wanted.push(n);
          });
        });
        if (wanted.length > 0) {
          const { data: aRows } = await supabase
            .from('assets')
            .select('id, Asset_code, Asset_name, Lifecycle_Status')
            .in('id', wanted);
          const byId = new Map<string, any>();
          (aRows || []).forEach((a: any) => {
            if (a.id != null) byId.set(String(a.id), a);
          });
          repRows.forEach((r: any) => {
            const key = String(r.Request_id ?? '');
            if (!key) return;
            const asset = byId.get(String(r.old_assets_id ?? ''));
            if (!asset) return;
            const list = replacementAssetsByRequest.get(key) ?? [];
            if (!list.some((x) => x.id === asset.id)) list.push(asset);
            replacementAssetsByRequest.set(key, list);
          });
        }
      }
    }

    const fileUrlOf = (files: any): string => resolveMediaUrl(files, 'assets');

    // The office's review order, the same rule /admin/requests applies on the
    // web: pending requests on top — the one waiting longest first — and the
    // decided ones after them, newest first (lib/reviewOrder.ts). The query
    // above fetches newest-first, so the order is re-applied here.
    const orderedRequests = sortByReviewOrder(requests, (req: any) => ({
      status: req?.status,
      requestedAt: req?.created_at,
      updatedAt: req?.created_at,
      id: req?.id,
    }));

    const mappedItems: RequestItem[] = orderedRequests.map((req: any) => {
      const user = req.users;
      const fullName = user?.employee_numbers?.Full_Name || 'Unknown';

      // The request row stores `users.department_id`; show the department's name,
      // never the bare id (it used to render as a stray "· 4" on the card).
      const departmentRelation = Array.isArray(user?.departments)
        ? user.departments[0]
        : user?.departments;
      const department = String(departmentRelation?.Name ?? '').trim();

      const linked: {
        id?: string | number | null;
        code: string;
        name: string;
        imageUrl?: string;
        lifecycleStatus?: string;
      }[] = (itemsByRequest.get(String(req.id)) ?? [])
        .map((it: any) => {
          const a = Array.isArray(it?.assets) ? it.assets[0] : it?.assets;
          return a
            ? {
                id: a.id,
                code: String(a.Asset_code ?? ''),
                name: String(a.Asset_name ?? ''),
                imageUrl: fileUrlOf(a.asset_files),
                lifecycleStatus: String(a.Lifecycle_Status ?? ''),
              }
            : null;
        })
        .filter((a: any): a is NonNullable<typeof a> => a && (a.code || a.name));

      if (linked.length === 0) {
        (replacementAssetsByRequest.get(String(req.id)) ?? []).forEach((a: any) => {
          if (a && a.id != null && !linked.some((x) => String(x.id) === String(a.id))) {
            linked.push({
              id: a.id,
              code: String(a.Asset_code ?? ''),
              name: String(a.Asset_name ?? ''),
              lifecycleStatus: String(a.Lifecycle_Status ?? ''),
            });
          }
        });
      }

      const firstLinked = linked[0];
      const directAsset = Array.isArray(req.assets) ? req.assets[0] : req.assets;
      const directName = directAsset?.Asset_name || '';
      const directCode = directAsset?.Asset_code || '';
      const directImage = fileUrlOf(directAsset?.asset_files);
      const assetName = directName || firstLinked?.name || 'Unknown Asset';
      const assetCode = directCode || firstLinked?.code || 'N/A';

      return {
        id: String(req.id),
        title: linked.length > 1 ? `${firstLinked?.name || 'Asset'} +${linked.length - 1} more` : assetName,
        requestId: `REQ-${req.id}`,
        assetName,
        assetId: assetCode,
        requestType: req.request_type,
        department,
        submittedBy: fullName,
        dateSubmitted: formatStoredDate(req.created_at),
        submittedAt: req.created_at,
        reason: req.Note || '',
        status: req.status,
        statusLabel: req.status as RequestStatus,
        linkedAssets:
          linked.length > 0
            ? linked.map((a, i) => ({ ...a, imageUrl: a.imageUrl || (i === 0 ? directImage : '') }))
            : directName || directCode
              ? [
                  {
                    id: directAsset?.id,
                    code: directCode,
                    name: directName,
                    imageUrl: directImage,
                    lifecycleStatus: String(directAsset?.Lifecycle_Status ?? ''),
                  },
                ]
              : undefined,
      };
    });     setItems(mappedItems);
  } catch (error) {
    console.error('Failed to fetch requests:', error);
    setLoadError(friendlyErrorMessage(error, 'Could not load requests. Please try again.'));
  } finally {
    setLoading(false);
  }
}, [monthKey]);

  // Refresh whenever the tab is focused: a decision taken elsewhere (the web,
  // another phone) must not leave a stale queue on screen. Only the first load
  // shows the full-screen spinner; later visits update in place.
  const firstLoad = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (!canReview) return;
      void fetchRequests(firstLoad.current);
      firstLoad.current = false;
    }, [canReview, fetchRequests]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRequests(false);
    setRefreshing(false);
  };

  const filteredRequests = useMemo(() => {
    let list = items;

    if (activeTab === 'Pending') {
      list = list.filter((item) => item.status === 'Pending');
    } else if (activeTab === 'Completed') {
      list = list.filter((item) => item.status !== 'Pending');
    }

    // Review order (pending longest-waiting first) is what the office works in
    // by default; the date sorts are there for looking a month up by hand.
    if (sort === 'newest') {
      return [...list].sort((a, b) => timestampOf(b.submittedAt) - timestampOf(a.submittedAt));
    }
    if (sort === 'oldest') {
      return [...list].sort((a, b) => timestampOf(a.submittedAt) - timestampOf(b.submittedAt));
    }
    return list;
  }, [activeTab, items, sort]);

  // The month's requests can be long; mount the first page and grow it in place.
  const {
    visible: visibleRequests,
    hasMore,
    loadMore,
    total: totalRequests,
    shown: shownRequests,
  } = usePagedList(filteredRequests);

  if (!viewerChecked) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Requests</Text>
          <View style={styles.headerActions}>
            <NotificationBell />
          </View>
        </View>
        <View style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0F172A" />
          </View>
        </View>
      </View>
    );
  }

  // A deep link (or a stale session) must not show the office's queue to an
  // account that cannot act on it. The web answers this on the server; the
  // phone can only be honest on screen — see lib/access.ts.
  if (!canReview) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Requests</Text>
          <View style={styles.headerActions}>
            <NotificationBell />
          </View>
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

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Requests</Text>
          <View style={styles.headerActions}>
            <AssetScanButton />
            <NotificationBell />
          </View>
        </View>
        {/* Plain body: the navy header already clears the status bar. */}
        <View style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0F172A" />
          </View>
        </View>
      </View>
    );
  }

  const handleViewDetails = (requestId: string) => {
    router.push({ pathname: '/request-detail', params: { id: requestId } });
  };

  /**
   * Apply one decision to one request.
   *
   * The Approve/Reject buttons and the status chips used to have two copies of
   * this, either of which could post again while the first write was still in
   * flight. One implementation with an in-flight guard covers both, refreshes the
   * list in place, and reports what actually happened.
   */
  const applyStatus = async (
    requestId: string,
    status: RequestStatus,
    options: RequestDecisionOptions = {},
  ): Promise<boolean> => {
    if (updatesInFlight.current.has(requestId)) return false;
    updatesInFlight.current.add(requestId);
    setBusyId(requestId);

    try {
      const userJson = await AsyncStorage.getItem('user');
      if (!userJson) {
        Alert.alert('Sign in required', 'Your session was not found. Please sign in again.');
        return false;
      }
      const user = JSON.parse(userJson);

      // The service enforces the workflow rules against the live rows: only a
      // Pending request can be decided, only by the office, never your own, and
      // a disposal approval prepares the official form before the status flips.
      const report = await updateRequestStatus(requestId, status as any, user.id, options);
      if (report) {
        Alert.alert('Request Approved', summarizeApproval(report));
      } else {
        Alert.alert(
          'Status updated',
          status === 'Approved'
            ? 'Request marked Approved. A disposal approval prepares the official form; the asset is retired only when that form is finalized on the web.'
            : `Request marked ${status}.`,
        );
      }

      // Refresh in place — a full-screen spinner here would hide the result the
      // admin just produced.
      await fetchRequests(false);
      return true;
    } catch (error) {
      console.error('Failed to update request status:', error);
      Alert.alert(
        'Update failed',
        friendlyErrorMessage(error, 'Failed to update request status. Please try again.'),
      );
      return false;
    } finally {
      updatesInFlight.current.delete(requestId);
      setBusyId((current) => (current === requestId ? null : current));
    }
  };

  const closeDecision = () => {
    if (decisionBusy) return;
    setDecision(null);
    setDecisionError(null);
    setDatePickerOpen(false);
  };

  const openDecision = (item: RequestItem, status: 'Approved' | 'Rejected') => {
    setDecision({ item, status });
    setDecisionError(null);
    setDatePickerOpen(false);
    const isDisposal = String(item.requestType ?? '').trim().toLowerCase() === 'disposal';
    // The web derives the reason from the requester's note when none is chosen;
    // showing that derivation makes the office's decision explicit.
    setDecisionReason(status === 'Approved' && isDisposal ? deriveDisposalReason(item.reason) : '');
    setDecisionDate('');
  };

  const confirmDecision = async () => {
    if (!decision || decisionBusy) return;
    const isDisposal = String(decision.item.requestType ?? '').trim().toLowerCase() === 'disposal';

    if (decision.status === 'Approved') {
      if (isDisposal && !decisionReason.trim()) {
        setDecisionError('Choose the reason of disposal recorded on the official form.');
        return;
      }
      if (decisionDate && !/^\d{4}-\d{2}-\d{2}$/.test(decisionDate)) {
        setDecisionError('Enter a valid expected date of disposal.');
        return;
      }
    }

    if (decisionReason.length > 500) {
      setDecisionError('The reason cannot exceed 500 characters.');
      return;
    }

    setDecisionBusy(true);
    const options: RequestDecisionOptions =
      decision.status === 'Approved'
        ? { approvedReason: decisionReason.trim() || null, expectedDisposalDate: decisionDate || null }
        : { rejectionReason: decisionReason.trim() || null };

    const ok = await applyStatus(decision.item.id, decision.status, options);
    setDecisionBusy(false);
    if (ok) {
      setDecision(null);
      setDecisionError(null);
    }
  };

  const handleAction = (item: RequestItem, status: 'Approved' | 'Rejected') => {
    const isDisposal = String(item.requestType ?? '').trim().toLowerCase() === 'disposal';
    // A disposal approval carries the reason and expected date the official form
    // is prepared from; a rejection may carry the reason the requester sees.
    if (isDisposal || status === 'Rejected') {
      openDecision(item, status);
      return;
    }
    void applyStatus(item.id, status);
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Requests</Text>
        <View style={styles.headerActions}>
          <AssetScanButton />
          <NotificationBell />
        </View>
      </View>
      {/* Plain body: the navy header already clears the status bar. */}
      <View style={styles.container}>
      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const active = tab === activeTab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Month filter: one tap to the month being worked on, applied in the
          query; "Choose month" reaches any earlier month and year. */}
      <MonthFilter value={monthKey} onChange={setMonthKey} />

      <View style={styles.sortRow}>
        <Text style={styles.sortLabel}>Sort</Text>
        {SORT_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.key}
            style={[styles.sortButton, sort === option.key ? styles.sortButtonActive : null]}
            onPress={() => setSort(option.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.sortButtonText, sort === option.key ? styles.sortButtonTextActive : null]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onMomentumScrollEnd={loadMore}
      >
        {loadError ? (
          <View style={styles.errorState}>
            <MaterialCommunityIcons name="wifi-off" size={40} color="#94A3B8" />
            <Text style={styles.errorStateText}>{loadError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              activeOpacity={0.85}
              onPress={() => void fetchRequests()}
            >
              <MaterialCommunityIcons name="refresh" size={18} color="#0C134F" />
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {visibleRequests.map((item) => (
          <RequestCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onApprove={() => handleAction(item, 'Approved')}
            onReject={() => handleAction(item, 'Rejected')}
            busy={busyId === item.id}
            onViewDetails={() => handleViewDetails(item.id)}
          />
        ))}

        {!loadError && hasMore && (
          <TouchableOpacity style={styles.loadMoreButton} onPress={loadMore} activeOpacity={0.85}>
            <MaterialCommunityIcons name="chevron-down" size={18} color="#0C134F" />
            <Text style={styles.loadMoreText}>
              Load more requests ({shownRequests} of {totalRequests})
            </Text>
          </TouchableOpacity>
        )}
        {!loadError && !hasMore && totalRequests > PAGE_SIZE && (
          <Text style={styles.listEndText}>All {totalRequests} requests shown</Text>
        )}

        {!loadError && filteredRequests.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              {monthKey ? `No requests found for ${monthLabel(monthKey)}.` : 'No requests found.'}
            </Text>
          </View>
        )}
      </ScrollView>
      </View>

      {/* One decision at a time. The disposal reason and expected date are the
          values the web's approve route feeds into the official form, so they
          are asked for here rather than guessed. */}
      <Modal visible={Boolean(decision)} transparent animationType="fade" onRequestClose={closeDecision}>
        <View style={styles.decisionBackdrop}>
          <View style={styles.decisionSheet}>
            <View style={styles.decisionHeader}>
              <Text style={styles.decisionTitle}>
                {decision?.status === 'Approved' ? 'Approve disposal request' : 'Reject request'}
              </Text>
              <TouchableOpacity onPress={closeDecision} disabled={decisionBusy} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.decisionBody} contentContainerStyle={styles.decisionBodyContent}>
              <Text style={styles.decisionAsset} numberOfLines={2}>
                {decision?.item.assetName} · {decision?.item.requestId}
              </Text>
              <Text style={styles.decisionNote} numberOfLines={4}>
                Requester’s note: {decision?.item.reason || 'No note provided.'}
              </Text>

              {decision?.status === 'Approved' ? (
                <>
                  <Text style={styles.decisionLabel}>Reason of disposal (printed on the official form)</Text>
                  <View style={styles.decisionChips}>
                    {DISPOSAL_APPROVAL_REASONS.map((reason) => {
                      const active = decisionReason === reason;
                      return (
                        <TouchableOpacity
                          key={reason}
                          style={[styles.decisionChip, active && styles.decisionChipActive]}
                          onPress={() => setDecisionReason(reason)}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.decisionChipText, active && styles.decisionChipTextActive]}>
                            {reason}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.decisionLabel}>Expected date of disposal (optional)</Text>
                  <TouchableOpacity
                    style={styles.decisionDate}
                    activeOpacity={0.85}
                    onPress={() => setDatePickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Choose the expected date of disposal"
                  >
                    <MaterialCommunityIcons name="calendar-blank-outline" size={17} color="#64748B" />
                    <Text style={styles.decisionDateText}>
                      {decisionDate || 'Choose a date'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                  {decisionDate ? (
                    <TouchableOpacity onPress={() => setDecisionDate('')} activeOpacity={0.8}>
                      <Text style={styles.decisionClear}>Clear the date</Text>
                    </TouchableOpacity>
                  ) : null}

                  <Text style={styles.decisionHint}>
                    Approving prepares the official NU Lipa disposal form for the Asset Management Office. It does
                    not dispose of the asset: the asset keeps its current status until the signed form is filed and
                    the disposal is finalized in the web application.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.decisionLabel}>Reason for rejection (optional)</Text>
                  <TextInput
                    style={styles.decisionInput}
                    value={decisionReason}
                    onChangeText={setDecisionReason}
                    placeholder="Tell the requester why this request was rejected"
                    placeholderTextColor="#94A3B8"
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                  />
                  <Text style={styles.decisionHint}>
                    The requester sees this reason on the request. A rejected request cannot be decided again.
                  </Text>
                </>
              )}

              {decisionError ? <Text style={styles.decisionError}>{decisionError}</Text> : null}
            </ScrollView>

            <View style={styles.decisionActions}>
              <TouchableOpacity
                style={[styles.decisionCancel, decisionBusy && styles.decisionButtonDisabled]}
                activeOpacity={0.85}
                onPress={closeDecision}
                disabled={decisionBusy}
              >
                <Text style={styles.decisionCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.decisionConfirm,
                  decision?.status === 'Rejected' && styles.decisionConfirmDanger,
                  decisionBusy && styles.decisionButtonDisabled,
                ]}
                activeOpacity={0.85}
                onPress={() => void confirmDecision()}
                disabled={decisionBusy}
              >
                {decisionBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.decisionConfirmText}>
                    {decision?.status === 'Approved' ? 'Approve' : 'Reject'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {datePickerOpen ? (
              <DateTimePicker
                value={parseIsoDay(decisionDate || todayIsoDay())}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selected) => {
                  if (Platform.OS !== 'ios') setDatePickerOpen(false);
                  if (event.type === 'dismissed' || !selected) return;
                  setDecisionDate(isoDayOf(selected));
                }}
              />
            ) : null}
          </View>
        </View>
      </Modal>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingTop: headerTopPadding,
    paddingBottom: 16,
    backgroundColor: '#0C134F',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  notificationButton: {
    position: 'relative',
    height: 42,
    borderRadius: 14,
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#FDB833',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E3A5F',
  },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  // The active underline is reserved on every tab (transparent when inactive),
  // so switching tabs changes the colour only — adding a 3px border on the
  // active tab used to nudge its label 3px out of line with the others.
  tabButton: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#1D4ED8',
  },
  tabLabel: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#1D4ED8',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  sortLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sortButton: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sortButtonActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  sortButtonTextActive: {
    color: '#FFFFFF',
  },
  list: {
    padding: 16,
    // Clearance for the floating tab bar.
    paddingBottom: 112,
  },
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E9EEF5',
  },
  accessTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  accessText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
    textAlign: 'center',
  },
  emptyState: {
    marginTop: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 15,
  },
  errorState: {
    marginTop: 8,
    marginBottom: 16,
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 10,
  },
  errorStateText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
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
  retryButtonText: {
    color: '#0C134F',
    fontSize: 13.5,
    fontWeight: '800',
  },
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
  loadMoreText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0C134F',
  },
  listEndText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  decisionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  decisionSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    maxHeight: '86%',
  },
  decisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  decisionTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: '#0F172A' },
  decisionBody: { maxHeight: 420 },
  decisionBodyContent: { paddingBottom: 6 },
  decisionAsset: { fontSize: 14, fontWeight: '800', color: '#0C134F', marginBottom: 4 },
  decisionNote: { fontSize: 12.5, color: '#64748B', lineHeight: 18, marginBottom: 14 },
  decisionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  decisionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  decisionChip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  decisionChipActive: { backgroundColor: '#0C134F', borderColor: '#0C134F' },
  decisionChipText: { fontSize: 12.5, fontWeight: '700', color: '#475569' },
  decisionChipTextActive: { color: '#FFFFFF' },
  decisionDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
  },
  decisionDateText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  decisionClear: { fontSize: 12, fontWeight: '700', color: '#B91C1C', marginTop: 8 },
  decisionInput: {
    minHeight: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
    marginBottom: 10,
  },
  decisionHint: { fontSize: 12, color: '#64748B', lineHeight: 17, marginTop: 10 },
  decisionError: { fontSize: 12.5, color: '#B91C1C', marginTop: 10, fontWeight: '600' },
  decisionActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  decisionCancel: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  decisionCancelText: { fontSize: 14, fontWeight: '800', color: '#475569' },
  decisionConfirm: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#047857',
  },
  decisionConfirmDanger: { backgroundColor: '#B91C1C' },
  decisionConfirmText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  decisionButtonDisabled: { opacity: 0.6 },
});
