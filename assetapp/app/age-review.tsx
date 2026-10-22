/**
 * Service-life Review — assets that have reached the proposed age mark.
 *
 * Read-only, advisory, and labelled as such: the three-year figure is the
 * recommendation, not a confirmed university rule, and nothing on this screen
 * disposes of anything. It answers one question for the Asset Management
 * Office — "which assets are old enough to look at?" — and the office decides
 * what, if anything, happens next through the normal disposal request.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, EmptyState, ListSkeleton, ScreenHeader, SearchBar } from '@/components/ui';
import { colors } from '@/lib/theme';
import { formatStoredDate } from '@/lib/time';
import {
  ageReviewCutoff,
  ageReviewThresholdLabel,
  ageReviewYears,
  fetchAgeReviewPage,
  type AgeReviewAsset,
} from '@/lib/ageReview';

export default function AgeReviewScreen() {
  const router = useRouter();
  const years = useMemo(() => ageReviewYears(), []);
  const cutoff = useMemo(() => ageReviewCutoff(years), [years]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AgeReviewAsset[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadFirstPage = useCallback(async () => {
    try {
      setLoading(true);
      const first = await fetchAgeReviewPage({ years, search: query, page: 0 });
      setRows(first.rows);
      setHasMore(first.hasMore);
      setPage(0);
    } catch (error) {
      console.error('Failed to load the age review list:', error);
      Alert.alert('Error', 'Could not load the review list. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [query, years]);

  useEffect(() => {
    const loadOnOpen = async () => {
      await loadFirstPage();
    };
    loadOnOpen();
  }, [loadFirstPage]);

  // Searching is server-side; debounce so a fast typist does not fire a query
  // per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchAgeReviewPage({ years, search: query, page: page + 1 });
      setRows((current) => [...current, ...next.rows]);
      setHasMore(next.hasMore);
      setPage((current) => current + 1);
    } catch (error) {
      console.error('Failed to load more review assets:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page, query, years]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFirstPage();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Service-life Review"
        subtitle={`Acquired on or before ${formatStoredDate(cutoff)}`}
        onBack={() => router.back()}
      />

      <FlatList
        style={styles.body}
        data={loading ? [] : rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.advisoryCard}>
              <View style={styles.advisoryTitleRow}>
                <MaterialCommunityIcons name="information-outline" size={17} color="#92400E" />
                <Text style={styles.advisoryTitle}>Advisory only</Text>
              </View>
              <Text style={styles.advisoryText}>
                {ageReviewThresholdLabel(years)} is a proposed service-life mark, not a confirmed disposal rule.
                Reaching it prompts a review by the Asset Management Office — it never approves, requires or records a
                disposal. Retired assets and assets with no recorded acquisition date are left out.
              </Text>
            </View>

            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Search code, name, category, location…"
            />

            <Text style={styles.countText}>
              {loading ? 'Loading…' : `${rows.length}${hasMore ? '+' : ''} asset${rows.length === 1 ? '' : 's'} to review`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={5} />
          ) : (
            <EmptyState
              icon="calendar-check-outline"
              title={query ? 'No asset matches' : 'Nothing to review'}
              message={
                query
                  ? 'Try a different search. The list only shows assets that have reached the age mark.'
                  : `No active asset has reached the ${ageReviewThresholdLabel(years)} mark yet.`
              }
            />
          )
        }
        renderItem={({ item }) => <AssetRow asset={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footerLoading} color={colors.navy800} />
          ) : hasMore ? (
            <Button label="Load more" variant="soft" onPress={loadMore} style={styles.loadMore} />
          ) : rows.length > 0 ? (
            <Text style={styles.endText}>End of review list</Text>
          ) : null
        }
      />
    </View>
  );
}

function AssetRow({ asset }: { asset: AgeReviewAsset }) {
  const age = asset.ageYears == null ? null : `${asset.ageYears} yr${asset.ageYears === 1 ? '' : 's'}`;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <MaterialCommunityIcons name="archive-clock-outline" size={22} color={colors.navy800} />
        </View>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardName} numberOfLines={1}>
            {asset.name || 'Unnamed asset'}
          </Text>
          <Text style={styles.cardCode} numberOfLines={1}>
            {asset.code || 'No asset code'}
            {asset.category ? ` · ${asset.category}` : ''}
          </Text>
        </View>
        {age ? (
          <Text style={styles.ageBadge}>{age}</Text>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        {asset.condition ? (
          <Text style={styles.metaBadge}>{asset.condition}</Text>
        ) : null}
        {asset.lifecycleStatus ? (
          <Text style={styles.metaBadge}>{asset.lifecycleStatus}</Text>
        ) : null}
        {asset.location ? (
          <Text style={styles.metaText} numberOfLines={1}>
            {asset.location}
          </Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <MaterialCommunityIcons name="calendar-blank-outline" size={14} color={colors.inkFaint} />
        <Text style={styles.footerText}>Acquired {formatStoredDate(asset.dateAcquired)}</Text>
        {asset.custodian ? (
          <>
            <MaterialCommunityIcons name="account-outline" size={14} color={colors.inkFaint} style={styles.footerIconGap} />
            <Text style={styles.footerText} numberOfLines={1}>
              {asset.custodian}
              {asset.department ? ` · ${asset.department}` : ''}
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  header: { gap: 10, paddingTop: 14, paddingBottom: 6 },
  advisoryCard: {
    marginHorizontal: 16,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 13,
    gap: 6,
  },
  advisoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  advisoryTitle: { fontSize: 13, fontWeight: '800', color: '#92400E' },
  advisoryText: { fontSize: 12.5, lineHeight: 18, color: '#92400E' },
  countText: { paddingHorizontal: 16, fontSize: 12, color: colors.inkMuted, fontWeight: '600' },
  listContent: { paddingBottom: 40 },
  card: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    gap: 9,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleWrap: { flex: 1, gap: 3 },
  cardName: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  cardCode: { fontSize: 12, color: colors.inkMuted },
  ageBadge: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  metaBadge: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#334155',
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  metaText: { fontSize: 11.5, color: colors.inkFaint, fontWeight: '600', flexShrink: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  footerText: { fontSize: 11.5, color: colors.inkFaint, fontWeight: '600', flexShrink: 1 },
  footerIconGap: { marginLeft: 8 },
  footerLoading: { marginVertical: 18 },
  loadMore: { marginHorizontal: 16, marginTop: 14 },
  endText: { textAlign: 'center', color: colors.inkFaint, fontSize: 12, marginTop: 16 },
});
