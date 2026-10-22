import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

import NotificationBell from '@/components/notification-bell';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ListSkeleton,
  ScreenHeader,
  StatusPill,
} from '@/components/ui';
import { colors, radius, shadow, spacing, type } from '@/lib/theme';
import { formatStoredDate, todayLocalIso } from '@/lib/time';
import { friendlyErrorMessage } from '@/lib/errorMessage';
import {
  DEFAULT_REPORT_FILTERS,
  REPORT_CATEGORIES,
  REPORT_PERIODS,
  categoryMeta,
  fetchReportPage,
  periodBounds,
  type ReportCategory,
  type ReportFilters,
  type ReportPeriod,
  type ReportRow,
} from '@/lib/reportService';

/**
 * Reports on the phone.
 *
 * Same six report categories and the same date/status questions as the web,
 * but no download or print: the phone is for reading the answer on the spot.
 * Every filter is applied before the page is fetched, and "Load more" asks the
 * database for the next page rather than slicing a list already in memory.
 */
export default function ReportsScreen() {
  const router = useRouter();

  const [filters, setFilters] = useState<ReportFilters>({ ...DEFAULT_REPORT_FILTERS });
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rangeOpen, setRangeOpen] = useState(false);
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [draftFrom, setDraftFrom] = useState<string>('');
  const [draftTo, setDraftTo] = useState<string>('');

  const meta = useMemo(() => categoryMeta(filters.category), [filters.category]);
  const bounds = useMemo(() => periodBounds(filters), [filters]);
  const requestToken = useRef(0);

  const load = useCallback(
    async (nextFilters: ReportFilters, nextPage: number, append: boolean) => {
      const token = ++requestToken.current;

      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }

      try {
        const result = await fetchReportPage(nextFilters, nextPage);
        if (token !== requestToken.current) return;

        setRows((previous) => (append ? [...previous, ...result.rows] : result.rows));
        setTotal(result.total);
        setPage(result.page);
        setHasMore(result.hasMore);
        setError(null);
      } catch (err) {
        if (token !== requestToken.current) return;
        setError(friendlyErrorMessage(err, 'Could not load this report. Please try again.'));
        if (!append) {
          setRows([]);
          setTotal(0);
          setHasMore(false);
        }
      } finally {
        if (token === requestToken.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const loadFirstPage = async () => {
      await load(filters, 0, false);
    };
    loadFirstPage();
  }, [filters, load]);

  const patchFilters = (patch: Partial<ReportFilters>) => {
    setFilters((previous) => {
      const next = { ...previous, ...patch };

      // A new category gets a clean status/type vocabulary. Carrying "Active"
      // into the Repairs report would silently show an empty list.
      if (patch.category && patch.category !== previous.category) {
        next.status = 'All';
        next.type = 'All';
      }

      return next;
    });
  };

  const choosePeriod = (period: ReportPeriod) => {
    if (period === 'custom') {
      setDraftFrom(filters.from);
      setDraftTo(filters.to);
      setRangeOpen(true);
      return;
    }

    patchFilters({ period, from: '', to: '' });
  };

  const applyCustomRange = () => {
    if (!draftFrom || !draftTo) {
      return;
    }

    patchFilters({ period: 'custom', from: draftFrom, to: draftTo });
    setRangeOpen(false);
    setPicker(null);
  };

  const refresh = async () => {
    setRefreshing(true);
    await load(filters, 0, false);
  };

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      load(filters, page + 1, true);
    }
  };

  const openPicker = (mode: 'from' | 'to') => setPicker(mode);

  const setPickedDate = (value: string) => {
    if (picker === 'from') setDraftFrom(value);
    if (picker === 'to') setDraftTo(value);
    if (Platform.OS !== 'ios') setPicker(null);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Reports"
        subtitle="NU Trace activity by period"
        onBack={() => router.back()}
        right={<NotificationBell />}
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Card style={styles.introCard}>
          <View style={styles.introIcon}>
            <MaterialCommunityIcons name={meta.icon as any} size={22} color={colors.navy800} />
          </View>
          <View style={styles.introText}>
            <Text style={styles.introTitle}>{meta.label}</Text>
            <Text style={styles.introDescription}>{meta.description}</Text>
          </View>
        </Card>

        <Text style={styles.sectionLabel}>Report</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {REPORT_CATEGORIES.map((category) => (
            <Chip
              key={category.key}
              label={category.shortLabel}
              active={filters.category === category.key}
              onPress={() => patchFilters({ category: category.key as ReportCategory })}
            />
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Period</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {REPORT_PERIODS.map((period) => (
            <Chip
              key={period.key}
              label={period.label}
              active={filters.period === period.key}
              onPress={() => choosePeriod(period.key)}
            />
          ))}
        </ScrollView>

        <View style={styles.rangeLine}>
          <MaterialCommunityIcons name="calendar-range" size={15} color={colors.inkMuted} />
          <Text style={styles.rangeText}>{bounds.label}</Text>
          <Text style={styles.rangeHint}>on {meta.dateLabel.toLowerCase()}</Text>
        </View>

        <Text style={styles.sectionLabel}>
          {filters.category === 'requests' ? 'Approval status' : 'Status'}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          <Chip
            label="All"
            active={filters.status === 'All'}
            onPress={() => patchFilters({ status: 'All' })}
          />
          {meta.statusOptions.map((status) => (
            <Chip
              key={status}
              label={status}
              active={filters.status === status}
              onPress={() => patchFilters({ status })}
            />
          ))}
        </ScrollView>

        {meta.typeOptions ? (
          <>
            <Text style={styles.sectionLabel}>Request type</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipRow}
            >
              <Chip
                label="All"
                active={filters.type === 'All'}
                onPress={() => patchFilters({ type: 'All' })}
              />
              {meta.typeOptions.map((requestType) => (
                <Chip
                  key={requestType}
                  label={requestType}
                  active={filters.type === requestType}
                  onPress={() => patchFilters({ type: requestType })}
                />
              ))}
            </ScrollView>
          </>
        ) : null}

        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{loading ? '...' : total.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Matching records</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{rows.length.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Loaded on this phone</Text>
          </Card>
        </View>

        {error ? (
          <Card style={styles.errorCard}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.dangerInk} />
            <View style={styles.errorTextWrap}>
              <Text style={styles.errorTitle}>The report could not be loaded</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <Button label="Retry" variant="soft" small onPress={() => load(filters, 0, false)} />
          </Card>
        ) : null}

        {loading ? (
          <ListSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="file-search-outline"
            title="No records match this report"
            message="Try another period or clear the status filter. The report only shows records that carry the date this category reports on."
          />
        ) : (
          <View style={styles.rows}>
            {rows.map((row) => (
              <Card key={`${filters.category}-${row.id}`} style={styles.reportCard}>
                <View style={styles.reportTop}>
                  <Text style={styles.reportTitle} numberOfLines={2}>
                    {row.title}
                  </Text>
                  {row.status ? <StatusPill status={row.status} /> : null}
                </View>

                <Text style={styles.reportSubtitle} numberOfLines={2}>
                  {row.subtitle}
                </Text>

                <View style={styles.metaLine}>
                  <MaterialCommunityIcons name="clock-outline" size={13} color={colors.inkFaint} />
                  <Text style={styles.metaText} numberOfLines={2}>
                    {row.meta.join('  |  ')}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        )}

        {!loading && rows.length > 0 ? (
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
            </Text>
            {hasMore ? (
              <Button
                label={loadingMore ? 'Loading...' : 'Load more'}
                icon="chevron-down"
                variant="soft"
                loading={loadingMore}
                onPress={loadMore}
              />
            ) : (
              <Text style={styles.footerEnd}>End of the report</Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={rangeOpen} transparent animationType="fade" onRequestClose={() => setRangeOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Custom date range</Text>
              <TouchableOpacity onPress={() => setRangeOpen(false)} activeOpacity={0.75}>
                <MaterialCommunityIcons name="close" size={22} color={colors.inkMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>
              Choose the first and last day to include. Both dates are inclusive.
            </Text>

            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>From</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => openPicker('from')} activeOpacity={0.85}>
                <MaterialCommunityIcons name="calendar-month" size={18} color={colors.navy800} />
                <Text style={styles.dateValue}>{draftFrom ? formatStoredDate(draftFrom) : 'Choose a date'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>To</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => openPicker('to')} activeOpacity={0.85}>
                <MaterialCommunityIcons name="calendar-month" size={18} color={colors.navy800} />
                <Text style={styles.dateValue}>{draftTo ? formatStoredDate(draftTo) : 'Choose a date'}</Text>
              </TouchableOpacity>
            </View>

            {picker ? (
              <DateTimePicker
                value={new Date(`${picker === 'from' ? draftFrom || todayLocalIso() : draftTo || todayLocalIso()}T12:00:00`)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onValueChange={(_event: any, selected?: Date) => {
                  if (selected) setPickedDate(todayLocalIso(selected));
                }}
                onDismiss={() => setPicker(null)}
              />
            ) : null}

            <View style={styles.modalActions}>
              <Button label="Cancel" variant="soft" onPress={() => setRangeOpen(false)} />
              <Button
                label="Apply range"
                icon="calendar-check"
                onPress={applyCustomRange}
                disabled={!draftFrom || !draftTo}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 120, gap: spacing.md },

  introCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  introIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introText: { flex: 1 },
  introTitle: { ...type.cardTitle, color: colors.ink },
  introDescription: { ...type.caption, color: colors.inkMuted, marginTop: 3, lineHeight: 17 },

  sectionLabel: {
    ...type.label,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  // See transfer.tsx: a bare horizontal ScrollView stretches its chips to the
  // leftover viewport height.
  chipScroll: { flexGrow: 0 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 },

  rangeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  rangeText: { fontSize: 12.5, fontWeight: '700', color: colors.navy800 },
  rangeHint: { fontSize: 12, color: colors.inkFaint },

  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  summaryValue: { fontSize: 24, fontWeight: '800', color: colors.navy800 },
  summaryLabel: { fontSize: 11.5, color: colors.inkMuted, marginTop: 3, textAlign: 'center' },

  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.dangerBg },
  errorTextWrap: { flex: 1 },
  errorTitle: { fontSize: 13, fontWeight: '700', color: colors.dangerInk },
  errorText: { fontSize: 12, color: colors.dangerInk, marginTop: 2, lineHeight: 16 },

  rows: { gap: 10 },
  reportCard: { padding: 14 },
  reportTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  reportTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink, lineHeight: 19 },
  reportSubtitle: { fontSize: 12.5, color: colors.inkMuted, marginTop: 5, lineHeight: 17 },
  metaLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 8 },
  metaText: { flex: 1, fontSize: 11.5, color: colors.inkFaint, lineHeight: 16 },

  footer: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  footerText: { fontSize: 12, color: colors.inkMuted },
  footerEnd: { fontSize: 11.5, color: colors.inkFaint },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 18,
    gap: 12,
    ...shadow.card,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  modalHint: { fontSize: 12.5, color: colors.inkMuted, lineHeight: 18 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateLabel: { width: 46, fontSize: 12, fontWeight: '700', color: colors.inkSoft },
  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    height: 46,
  },
  dateValue: { fontSize: 13, fontWeight: '600', color: colors.ink },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
