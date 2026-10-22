import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAssets, fetchAssetPhotoUrl, AssetSummary } from '../lib/assetService';
import { getStoredUser } from '../lib/userService';
import { PAGE_SIZE, usePagedList } from '../hooks/use-paged-list';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import QRViewModal from '../components/QRViewModal';
import NotificationBell from '@/components/notification-bell';
import { parseStoredTimestamp } from '@/lib/time';

export default function AssetsListScreen() {
  const router = useRouter();
  const { department, departmentId } = useLocalSearchParams() as { department?: string, departmentId?: string };
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [selectedQrValue, setSelectedQrValue] = useState('');
  const [selectedQrTitle, setSelectedQrTitle] = useState('');
  // Photos are fetched per card, only once it is opened (see loadPhoto).
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Assets whose photo has already been asked for, so opening a card twice (or
  // re-rendering the list) never repeats the lookup.
  const photoRequested = useRef<Record<string, boolean>>({});

  const openQrModal = (value: string, title: string) => {
    setSelectedQrValue(value);
    setSelectedQrTitle(title);
    setQrModalVisible(true);
  };

  /**
   * Lazy photo: the list query leaves `asset_files` out, so a card's photo is
   * requested the first time the admin expands it and then kept in state.
   */
  const loadPhoto = useCallback(async (item: AssetSummary) => {
    if (!item?.id || item.imageUrl) return;
    if (photoRequested.current[item.id]) return;
    photoRequested.current[item.id] = true;
    try {
      const url = await fetchAssetPhotoUrl(item.id);
      setPhotoUrls((prev) => ({ ...prev, [item.id]: url }));
    } catch (err) {
      console.warn('[assets-list] Photo lookup failed:', err);
      photoRequested.current[item.id] = false;
      setPhotoUrls((prev) => ({ ...prev, [item.id]: '' }));
    }
  }, []);

  const toggleExpanded = (item: AssetSummary) => {
    const next = expandedId === item.id ? null : item.id;
    setExpandedId(next);
    if (next) void loadPhoto(item);
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        // No `asset_files` embed: a department list can be long, and only the
        // expanded card ever shows a photo.
        const [records, userData] = await Promise.all([
          fetchAssets({ includeFiles: false }),
          getStoredUser()
        ]);
        setAssets(records);
        setUser(userData);
        setExpandedId((prev) => prev ?? (records?.[0]?.id ? String(records[0].id) : null));
        if (records?.[0]) void loadPhoto(records[0]);
      } catch (err) {
        setError((err as Error).message || 'Unable to load assets from Supabase');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [department, departmentId, loadPhoto]);

  const isAdmin = user?.role === 'Admin';

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          assets
            .map((item) => item.category)
            .filter(
              (category): category is string =>
                typeof category === 'string' && category.length > 0,
            ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [assets],
  );

  const statusFilters = [
    'All',
    'Active',
    'For Checking',
    'For Repair',
    'For Replacement',
    'Pulled Out',
    'Disposed',
  ];

  const clearFilters = () => {
    setActiveTag('All');
    setCategoryFilter('All');
    setSearch('');
  };

  const filteredAssets = useMemo(
    () =>
      assets.filter((item) => {
        // If user is Admin, they can filter by department param
        // If user is not Admin, they only see their own department
        let matchesDepartment = true;
        
        if (isAdmin) {
          if (departmentId) {
            matchesDepartment = String(item.departmentId) === String(departmentId) || 
                               item.department?.trim().toLowerCase() === department?.trim().toLowerCase();
          } else if (department) {
            matchesDepartment = item.department?.trim().toLowerCase() === department?.trim().toLowerCase();
          }
        } else {
          // Non-admin users are strictly filtered by their own department_id
          matchesDepartment = String(item.departmentId) === String(user?.department_id);
        }
        
        const matchesTag = activeTag === 'All' ? true : item.status === activeTag;
        const matchesCategory =
          categoryFilter === 'All' ? true : String(item.category ?? '') === categoryFilter;
        const searchable = [item.title, item.category, item.location, item.assetId, item.custodian]
          .join(' ')
          .toLowerCase();

        return (
          matchesDepartment &&
          matchesTag &&
          matchesCategory &&
          searchable.includes(search.toLowerCase())
        );
      }),
    [search, activeTag, categoryFilter, department, departmentId, assets, user, isAdmin],
  );

  // Only the first page is mounted; the window grows as the list is scrolled.
  const {
    visible: visibleAssets,
    hasMore,
    loadMore,
    total: totalAssets,
    shown: shownAssets,
  } = usePagedList(filteredAssets);

  const departmentName = department || (isAdmin ? 'All Assets' : assets.find(a => String(a.departmentId) === String(user?.department_id))?.department || (user?.department ?? (user as any)?.employee_numbers?.Full_Name ?? user?.full_name ?? 'My Assets'));

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const date = parseStoredTimestamp(dateStr);
      if (!date) return dateStr;
      return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{departmentName}</Text>
        </View>
        <NotificationBell />
      </View>

      <ScrollView
        style={styles.screenBody}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={loadMore}
      >
        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <MaterialCommunityIcons name="magnify" size={24} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search assets..."
              value={search}
              onChangeText={setSearch}
              placeholderTextColor="#94A3B8"
            />
          </View>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Filter assets"
          >
            <MaterialCommunityIcons
              name="filter-variant"
              size={24}
              color={activeTag !== 'All' || categoryFilter !== 'All' ? '#F59E0B' : '#1E3A5F'}
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagScrollWrap}
          contentContainerStyle={styles.tagScroll}
        >
          {['All', 'Active', 'For Repair', 'Pulled Out', 'Disposed'].map((tag) => {
            const active = tag === activeTag;
            return (
              <TouchableOpacity
                key={tag}
                style={[styles.tagItem, active && styles.tagItemActive]}
                onPress={() => setActiveTag(tag)}
              >
                <Text style={[styles.tagLabel, active && styles.tagLabelActive]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {visibleAssets.map((item) => {
          const expanded = expandedId === item.id;
          const photoUri = item.imageUrl || photoUrls[item.id] || '';
          const statusColor = item.status === 'Active' ? '#10B981' : item.status === 'For Repair' ? '#F59E0B' : '#64748B';
          const statusBg = item.status === 'Active' ? '#ECFDF5' : item.status === 'For Repair' ? '#FFFBEB' : '#F4F7FB';

          return (
            <View key={item.id} style={styles.assetCard}>
              <TouchableOpacity
                style={styles.assetHeader}
                onPress={() => toggleExpanded(item)}
                activeOpacity={0.8}
              >
                <View style={styles.assetInfo}>
                  <Text style={styles.assetTitle}>{item.title}</Text>
                  <Text style={styles.assetSubtitle}>{item.category}</Text>
                  <Text style={styles.assetLocation}>{item.department}</Text>
                </View>
                <View style={styles.headerRight}>
                  <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.statusText, { color: statusColor }]}>{item.status}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color="#94A3B8"
                  />
                </View>
              </TouchableOpacity>

              {expanded && (
                <View style={styles.assetDetails}>
                  {photoUri ? (
                    <AssetPhoto uri={photoUri} title={item.title} />
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <MaterialCommunityIcons name="image-off-outline" size={28} color="#94A3B8" />
                      <Text style={styles.photoPlaceholderText}>No photo on file</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.qrSection}
                    onPress={() => openQrModal(item.assetId, item.title)}
                    activeOpacity={0.9}
                  >
                    <LinearGradient
                      colors={['#1E3A5F', '#2D5A8E']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.qrGradient}
                    >
                      <View style={styles.qrContainer}>
                        <QRCode value={item.assetId} size={150} backgroundColor="white" />
                      </View>
                      <Text style={styles.qrHint}>Tap QR to Expand</Text>
                      <Text style={styles.qrValue}>{item.assetId}</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <View style={styles.detailGrid}>
                    <DetailItem icon="pound" label="Serial Number" value={item.serialNumber} />
                    <DetailItem icon="calendar-range" label="Acquisition Date" value={formatDate(item.acquisitionDate)} />
                    <DetailItem icon="account-outline" label="Custodian" value={item.custodian} />
                    <DetailItem icon="identifier" label="Asset ID" value={item.assetId} />
                    <DetailItem icon="tag-outline" label="Category" value={item.category} />
                    <DetailItem icon="clock-outline" label="Last Updated" value={formatDate(item.updatedAt)} />
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {!loading && !error && filteredAssets.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No assets match your filter.</Text>
          </View>
        )}

        {hasMore && (
          <TouchableOpacity style={styles.loadMoreButton} onPress={loadMore} activeOpacity={0.85}>
            <MaterialCommunityIcons name="chevron-down" size={18} color="#1E3A5F" />
            <Text style={styles.loadMoreText}>
              Load more assets ({shownAssets} of {totalAssets})
            </Text>
          </TouchableOpacity>
        )}
        {!hasMore && totalAssets > PAGE_SIZE && (
          <Text style={styles.listEndText}>All {totalAssets} assets shown</Text>
        )}
      </ScrollView>

      <QRViewModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        value={selectedQrValue}
        title={selectedQrTitle}
      />

      <Modal
        visible={filterOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterOpen(false)}
      >
        <View style={styles.filterOverlay}>
          <TouchableOpacity
            style={styles.filterBackdrop}
            activeOpacity={1}
            onPress={() => setFilterOpen(false)}
          />
          <View style={styles.filterSheet}>
            <View style={styles.filterHeader}>
              <Text style={styles.filterTitle}>Filter Assets</Text>
              <TouchableOpacity
                onPress={() => setFilterOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close filters"
              >
                <MaterialCommunityIcons name="close" size={22} color="#1E3A5F" />
              </TouchableOpacity>
            </View>

            <Text style={styles.filterSectionLabel}>STATUS</Text>
            <View style={styles.filterChipWrap}>
              {statusFilters.map((status) => {
                const active = activeTag === status;
                return (
                  <TouchableOpacity
                    key={status}
                    style={[styles.filterOption, active && styles.filterOptionActive]}
                    onPress={() => setActiveTag(status)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.filterOptionText, active && styles.filterOptionTextActive]}
                    >
                      {status}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.filterSectionLabel}>CATEGORY</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterChipScroll}
              contentContainerStyle={styles.filterChipWrap}
            >
              {['All', ...categories].map((category) => {
                const active = categoryFilter === category;
                return (
                  <TouchableOpacity
                    key={category}
                    style={[styles.filterOption, active && styles.filterOptionActive]}
                    onPress={() => setCategoryFilter(category)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.filterOptionText, active && styles.filterOptionTextActive]}
                    >
                      {category}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.filterActions}>
              <TouchableOpacity
                style={styles.filterClear}
                onPress={clearFilters}
                activeOpacity={0.85}
              >
                <Text style={styles.filterClearText}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterApply}
                onPress={() => setFilterOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.filterApplyText}>Show {filteredAssets.length} assets</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function AssetPhoto({ uri, title }: { uri: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View style={styles.photoPlaceholder}>
        <MaterialCommunityIcons name="image-off-outline" size={28} color="#94A3B8" />
        <Text style={styles.photoPlaceholderText}>Image unavailable</Text>
      </View>
    );
  }

  return (
    <View style={styles.photoCard}>
      <Image
        source={{ uri }}
        style={styles.assetPhoto}
        resizeMode="cover"
        onError={(event) => {
          console.warn(`[assets-list] Photo failed for "${title}":`, uri, event.nativeEvent?.error ?? event);
          setFailed(true);
        }}
      />
    </View>
  );
}

function DetailItem({ icon, label, value }: { icon: string, label: string, value?: string }) {
  return (
    <View style={styles.detailItemBox}>
      <View style={styles.detailItemHeader}>
        <MaterialCommunityIcons name={icon as any} size={16} color="#94A3B8" />
        <Text style={styles.detailItemLabel}>{label}</Text>
      </View>
      <Text style={styles.detailItemValue}>{value || 'N/A'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E3A5F',
  },
  screenBody: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  header: {
    backgroundColor: '#1E3A5F',
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notificationBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FBBF24',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#1E3A5F',
    fontWeight: '800',
    fontSize: 14,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 50,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: '#1E3A5F',
    fontWeight: '500',
  },
  filterButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // See transfer.tsx: centre the chips and keep the scroller from filling the
  // leftover viewport height.
  tagScrollWrap: { flexGrow: 0 },
  tagScroll: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 10,
    marginBottom: 16,
  },
  tagItem: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 10,
  },
  tagItemActive: {
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
  },
  tagLabel: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  tagLabelActive: {
    color: '#1E3A5F',
  },
  assetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  },
  assetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assetInfo: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  assetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1E3A5F',
    marginBottom: 4,
  },
  assetSubtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  assetLocation: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  assetDetails: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 20,
  },
  photoCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#F1F5F9',
  },
  assetPhoto: {
    width: '100%',
    height: 180,
  },
  photoPlaceholder: {
    height: 120,
    borderRadius: 16,
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
  },
  photoPlaceholderText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  qrSection: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 18,
  },
  qrGradient: {
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  qrContainer: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FBBF24',
  },
  qrHint: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '600',
  },
  qrValue: {
    marginTop: 6,
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItemBox: {
    // Full width: a half-width box left the value text stranded on the left with a
    // block of empty space beside it on phone screens.
    width: '100%',
    backgroundColor: '#F4F7FB',
    borderRadius: 16,
    padding: 14,
  },
  detailItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  detailItemLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailItemValue: {
    fontSize: 14,
    color: '#1E3A5F',
    fontWeight: '700',
  },
  emptyState: {
    marginTop: 24,
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 15,
    textAlign: 'center',
  },
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 12,
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E3A5F',
  },
  listEndText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  filterOverlay: { flex: 1, justifyContent: 'flex-end' },
  filterBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  filterSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  filterTitle: { fontSize: 18, fontWeight: '800', color: '#0C134F' },
  filterSectionLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 9,
  },
  filterChipScroll: { flexGrow: 0 },
  filterChipWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  filterOption: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  filterOptionActive: { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  filterOptionText: { fontSize: 12.5, fontWeight: '700', color: '#475569' },
  filterOptionTextActive: { color: '#FFFFFF' },
  filterActions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  filterClear: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterClearText: { fontSize: 13.5, fontWeight: '800', color: '#64748B' },
  filterApply: {
    flex: 1.6,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterApplyText: { fontSize: 13.5, fontWeight: '800', color: '#0C134F' },
});
