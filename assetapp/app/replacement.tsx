import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const filterTabs = ['All', 'Pending', 'Approved', 'Received'] as const;
type FilterTab = typeof filterTabs[number];
type ReplacementStatus = Exclude<FilterTab, 'All'>;

type ReplacementItem = {
  id: string;
  oldAssetId: string;
  oldAssetName: string;
  newAssetId: string;
  newAssetName: string;
  requestedBy: string;
  reason: string;
  status: ReplacementStatus;
  createdAt: string;
};

const getReplacementStatus = (status?: string | null): ReplacementStatus => {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized.includes('receiv')) return 'Received';
  if (normalized.includes('approv')) return 'Approved';
  return 'Pending';
};

const getStatusStyle = (status: ReplacementStatus) => {
  switch (status) {
    case 'Approved':
    case 'Received':
      return { backgroundColor: '#DCFCE7', color: '#166534' };
    default:
      return { backgroundColor: '#FEF3C7', color: '#B45309' };
  }
};

export default function ReplacementModule() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<ReplacementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchReplacementRequests = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('requests')
        .select(`
          id,
          status,
          Note,
          created_at,
          asset_id,
          user_id,
          users:user_id (employee_numbers (Full_Name))
        `)
        .ilike('request_type', '%replacement%')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const requests = (data as any[] || []);
      const assetReferences = Array.from(new Set(
        requests
          .map((request) => String(request.asset_id ?? '').trim())
          .filter(Boolean),
      ));
      const { data: assetRows, error: assetsError } = assetReferences.length > 0
        ? await supabase.from('assets').select('id, Asset_code, Asset_name').or(
          `id.in.(${assetReferences.join(',')}),Asset_code.in.(${assetReferences.join(',')})`,
        )
        : { data: [], error: null };

      if (assetsError) throw assetsError;

      const assetsByReference = new Map<string, { code: string; name: string }>();
      (assetRows as any[] || []).forEach((asset) => {
        const normalized = {
          code: String(asset.Asset_code ?? asset.id ?? 'N/A'),
          name: String(asset.Asset_name ?? 'Unknown Asset'),
        };
        if (asset.id !== null && asset.id !== undefined) assetsByReference.set(String(asset.id), normalized);
        if (asset.Asset_code) assetsByReference.set(String(asset.Asset_code), normalized);
      });

      const mappedItems: ReplacementItem[] = requests.map((req: any) => {
        const asset = assetsByReference.get(String(req.asset_id ?? '').trim());
        return {
          id: String(req.id),
          oldAssetId: asset?.code || String(req.asset_id || 'N/A'),
          oldAssetName: asset?.name || 'Unknown Asset',
        newAssetId: 'Link new asset',
        newAssetName: 'Replacement asset',
        requestedBy: req.users?.employee_numbers?.Full_Name || 'Unknown',
        reason: req.Note || 'Approved replacement request',
        status: getReplacementStatus(req.status),
        createdAt: new Date(req.created_at).toLocaleDateString(),
        };
      });

      setItems(mappedItems);
    } catch (error) {
      console.error('Failed to fetch replacement requests:', error);
      Alert.alert('Error', 'Failed to load replacement requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReplacementRequests();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchReplacementRequests();
    setRefreshing(false);
  };

  const counts = useMemo(() => ({
    All: items.length,
    Pending: items.filter((item) => item.status === 'Pending').length,
    Approved: items.filter((item) => item.status === 'Approved').length,
    Received: items.filter((item) => item.status === 'Received').length,
  }), [items]);

  const filteredRequests = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchesTab = activeFilter === 'All' || item.status === activeFilter;
      const matchesSearch = normalizedQuery.length === 0 || [
        item.oldAssetId,
        item.oldAssetName,
        item.requestedBy,
        item.reason,
        item.status,
      ].join(' ').toLowerCase().includes(normalizedQuery);
      return matchesTab && matchesSearch;
    });
  }, [activeFilter, items, searchQuery]);

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Replacement Records</Text>
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

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Replacement Records</Text>
        <View style={styles.headerSpacer} />
      </View>

      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.searchBarWrap}>
            <View style={styles.searchBar}>
              <MaterialCommunityIcons name="magnify" size={18} color="#64748B" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                placeholder="Search replacements..."
                placeholderTextColor="#94A3B8"
              />
            </View>
            <TouchableOpacity style={styles.iconButton} activeOpacity={0.8}>
              <MaterialCommunityIcons name="bell-outline" size={18} color="#1E293B" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.avatarButton} activeOpacity={0.8}>
              <Text style={styles.avatarText}>A</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterContent}
            style={styles.filterScroll}
          >
            {filterTabs.map((tab) => {
              const isActive = tab === activeFilter;
              return (
                <TouchableOpacity
                  key={tab}
                  activeOpacity={0.8}
                  onPress={() => setActiveFilter(tab)}
                  style={[styles.filterButton, isActive && styles.filterButtonActive]}
                >
                  <Text style={[styles.filterLabel, isActive && styles.filterLabelActive]}>
                    {tab} ({counts[tab]})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.listContainer}>
            {filteredRequests.length > 0 ? filteredRequests.map((item) => {
              const isExpanded = expandedId === item.id;
              const statusStyle = getStatusStyle(item.status);
              return (
                <View key={item.id} style={styles.recordCard}>
                  <TouchableOpacity
                    style={styles.recordHeader}
                    activeOpacity={0.8}
                    onPress={() => setExpandedId(isExpanded ? null : item.id)}
                  >
                    <View style={styles.assetSummary}>
                      <View style={styles.assetIconWrap}>
                        <MaterialCommunityIcons name="sync" size={26} color="#2563EB" />
                      </View>
                      <View style={styles.assetTextWrap}>
                        <Text style={styles.assetName}>{item.oldAssetName}</Text>
                        <Text style={styles.assetCode}>{item.oldAssetId}</Text>
                        <Text style={styles.requestorText}>Requested by: {item.requestedBy}</Text>
                        <View style={[styles.statusPill, { backgroundColor: statusStyle.backgroundColor }]}>
                          <Text style={[styles.statusText, { color: statusStyle.color }]}>{item.status}</Text>
                        </View>
                      </View>
                    </View>
                    <MaterialCommunityIcons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={24}
                      color="#0F172A"
                    />
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.expandedDetails}>
                      <View style={styles.detailGrid}>
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>Old asset</Text>
                          <Text style={styles.detailValue}>{item.oldAssetId}</Text>
                          <Text style={styles.detailSubValue}>{item.oldAssetName}</Text>
                        </View>
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>New asset</Text>
                          <Text style={styles.linkText}>{item.newAssetId}</Text>
                          <Text style={styles.detailSubValue}>{item.newAssetName}</Text>
                        </View>
                      </View>
                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Requested by</Text>
                        <Text style={styles.detailValue}>{item.requestedBy}</Text>
                      </View>
                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Date</Text>
                        <Text style={styles.detailValue}>{item.createdAt}</Text>
                      </View>
                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Reason</Text>
                        <View style={styles.notesBox}>
                          <Text style={styles.notesText}>{item.reason}</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              );
            }) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="inbox-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyStateText}>No replacement records found</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#1E3A5F' },
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 14,
    backgroundColor: '#1E3A5F',
  },
  backButton: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  headerSpacer: { width: 32 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: 24 },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A' },
  iconButton: {
    width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0',
  },
  avatarButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0EA5E9', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '700' },
  filterScroll: { backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  filterContent: { gap: 8, paddingHorizontal: 18, paddingVertical: 12 },
  filterButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#E2E8F0', borderWidth: 1, borderColor: '#CBD5E1' },
  filterButtonActive: { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  filterLabel: { fontSize: 13, fontWeight: '600', color: '#475569' },
  filterLabelActive: { color: '#FFFFFF' },
  listContainer: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 30 },
  recordCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assetSummary: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  assetIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#DBEAFE', justifyContent: 'center', alignItems: 'center' },
  assetTextWrap: { flex: 1 },
  assetName: { fontSize: 15, fontWeight: '700', color: '#0F172A', lineHeight: 20 },
  assetCode: { fontSize: 12, color: '#64748B', marginTop: 2 },
  requestorText: { fontSize: 12, color: '#475569', marginTop: 2 },
  statusPill: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700' },
  expandedDetails: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 14 },
  detailGrid: { flexDirection: 'row', gap: 12 },
  detailBlock: { flex: 1 },
  detailSection: { gap: 5 },
  detailLabel: { fontSize: 12, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  detailValue: { fontSize: 14, color: '#111827', fontWeight: '700', marginTop: 4 },
  detailSubValue: { fontSize: 12, color: '#64748B', marginTop: 3 },
  linkText: { fontSize: 14, color: '#2563EB', fontWeight: '700', marginTop: 4 },
  notesBox: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12 },
  notesText: { fontSize: 14, color: '#111827', lineHeight: 20 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42 },
  emptyStateText: { marginTop: 12, color: '#94A3B8', fontSize: 16, fontWeight: '600' },
});
