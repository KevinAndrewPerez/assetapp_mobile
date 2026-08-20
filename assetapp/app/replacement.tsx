import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const filterTabs = ['All', 'Pending', 'Approved', 'Received'] as const;
type FilterTab = typeof filterTabs[number];

type ReplacementItem = {
  id: string;
  oldAssetId: string;
  oldAssetName: string;
  newAssetId: string;
  newAssetName: string;
  requestedBy: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Received';
  createdAt: string;
};

interface StatCardProps {
  title: string;
  value: number;
  icon: string;
  color: string;
  iconColor: string;
}

function StatCard({ title, value, icon, color, iconColor }: StatCardProps) {
  return (
    <View style={[styles.statCard, { backgroundColor: color }]}>
      <View style={styles.statHeaderRow}>
        <Text style={styles.statTitle}>{title}</Text>
        <View style={[styles.statIconWrap, { backgroundColor: `${iconColor}22` }]}>
          <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
        </View>
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const getReplacementStatus = (status?: string | null) => {
  if (!status) return 'Pending';
  const normalized = status.toLowerCase();
  if (normalized.includes('receiv')) return 'Received';
  if (normalized.includes('approv')) return 'Approved';
  return 'Pending';
};

const getProgressState = (status: ReplacementItem['status']) => {
  switch (status) {
    case 'Approved':
      return [true, true, false];
    case 'Received':
      return [true, true, true];
    default:
      return [true, false, false];
  }
};

const getStatusStyles = (status: ReplacementItem['status']) => {
  switch (status) {
    case 'Approved':
      return {
        backgroundColor: '#FDE68A',
        color: '#B45309',
        label: 'Approved',
      };
    case 'Received':
      return {
        backgroundColor: '#DCFCE7',
        color: '#166534',
        label: 'Received',
      };
    default:
      return {
        backgroundColor: '#FEF3C7',
        color: '#B45309',
        label: 'Pending',
      };
  }
};

export default function ReplacementModule() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
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
          request_type,
          status,
          Note,
          created_at,
          users:user_id (
            department_id,
            employee_numbers (
              Full_Name
            )
          ),
          assets (Asset_code, Asset_name)
        `)
        .eq('request_type', 'Replacement')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mappedItems: ReplacementItem[] = (data as any[] || []).map((req: any) => {
        const user = req.users;
        const fullName = user?.employee_numbers?.Full_Name || 'Unknown';

        return {
          id: String(req.id),
          oldAssetId: req.assets?.Asset_code || 'N/A',
          oldAssetName: req.assets?.Asset_name || 'Unknown Asset',
          newAssetId: 'Link new asset',
          newAssetName: 'Replacement asset',
          requestedBy: fullName,
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

  const filteredRequests = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      const matchesTab =
        activeFilter === 'All' ||
        item.status === activeFilter;

      const matchesSearch =
        normalizedQuery.length === 0 ||
        [
          item.oldAssetId,
          item.oldAssetName,
          item.requestedBy,
          item.reason,
          item.status,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return matchesTab && matchesSearch;
    });
  }, [activeFilter, items, searchQuery]);

  const stats = useMemo(() => ({
    total: items.length,
    pending: items.filter((item) => item.status === 'Pending').length,
    approved: items.filter((item) => item.status === 'Approved').length,
    received: items.filter((item) => item.status === 'Received').length,
  }), [items]);

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
          <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Replacement Records</Text>
          <Text style={styles.subtitle}>Manage and track all asset replacement requests</Text>
        </View>
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

          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconButton} activeOpacity={0.8}>
              <MaterialCommunityIcons name="bell-outline" size={18} color="#1E293B" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.avatarButton} activeOpacity={0.8}>
              <Text style={styles.avatarText}>A</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatCard title="Total" value={stats.total} icon="clipboard-list" color="#F8FAFC" iconColor="#0EA5E9" />
          <StatCard title="Pending" value={stats.pending} icon="clock-outline" color="#FFF7ED" iconColor="#F59E0B" />
          <StatCard title="Approved" value={stats.approved} icon="check-circle-outline" color="#FFF7ED" iconColor="#F97316" />
          <StatCard title="Received" value={stats.received} icon="check-all" color="#F0FDF4" iconColor="#22C55E" />
        </View>

        <View style={styles.filterContainer}>
          {filterTabs.map((tab) => {
            const isActive = tab === activeFilter;
            return (
              <TouchableOpacity
                key={tab}
                activeOpacity={0.8}
                onPress={() => setActiveFilter(tab)}
                style={[styles.filterButton, isActive && styles.filterButtonActive]}
              >
                <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.recordsCard}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.tableHeaderCell}>OLD ASSET CODE</Text>
            <Text style={styles.tableHeaderCell}>NEW ASSET CODE</Text>
            <Text style={styles.tableHeaderCell}>REQUESTED BY</Text>
            <Text style={styles.tableHeaderCell}>REASON</Text>
            <Text style={styles.tableHeaderCell}>PROGRESS</Text>
            <Text style={styles.tableHeaderCell}>STATUS</Text>
            <Text style={styles.tableHeaderCell}>ACTIONS</Text>
          </View>

          {filteredRequests.length > 0 ? (
            filteredRequests.map((item) => {
              const progressState = getProgressState(item.status);
              const statusStyle = getStatusStyles(item.status);

              return (
                <View key={item.id} style={styles.tableRow}>
                  <View style={styles.assetCell}>
                    <View style={styles.assetThumb}>
                      <MaterialCommunityIcons name="desktop-classic" size={18} color="#EF4444" />
                    </View>
                    <View>
                      <Text style={styles.assetCode}>{item.oldAssetId}</Text>
                      <Text style={styles.assetMeta}>{item.oldAssetName}</Text>
                    </View>
                  </View>

                  <View style={styles.metaCell}>
                    <Text style={styles.linkText}>{item.newAssetId}</Text>
                    <Text style={styles.assetMeta}>{item.newAssetName}</Text>
                  </View>

                  <View style={styles.metaCell}>
                    <Text style={styles.requestedBy}>{item.requestedBy}</Text>
                  </View>

                  <View style={styles.metaCell}>
                    <Text style={styles.reasonText}>{item.reason}</Text>
                  </View>

                  <View style={styles.progressCell}>
                    <View style={styles.progressTrack}>
                      {[1, 2, 3].map((step) => (
                        <React.Fragment key={step}>
                          <View
                            style={[
                              styles.progressStep,
                              progressState[step - 1] ? styles.progressStepActive : styles.progressStepInactive,
                            ]}
                          >
                            <Text style={styles.progressStepText}>{step}</Text>
                          </View>
                          {step < 3 && <View style={styles.progressDash} />}
                        </React.Fragment>
                      ))}
                    </View>
                  </View>

                  <View style={styles.metaCell}>
                    <View style={[styles.statusPill, { backgroundColor: statusStyle.backgroundColor }]}>
                      <Text style={[styles.statusText, { color: statusStyle.color }]}>{statusStyle.label}</Text>
                    </View>
                  </View>

                  <View style={styles.actionCell}>
                    <TouchableOpacity style={styles.actionIconButton} activeOpacity={0.8}>
                      <MaterialCommunityIcons name="eye-outline" size={16} color="#2563EB" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionIconButton} activeOpacity={0.8}>
                      <MaterialCommunityIcons name="pencil-outline" size={16} color="#0EA5E9" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionIconButton} activeOpacity={0.8}>
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="inbox-outline" size={42} color="#CBD5E1" />
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
  screenContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  container: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 14,
    backgroundColor: '#0F172A',
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextWrap: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 4,
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
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
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#0EA5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  statCard: {
    width: '48%',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 104,
  },
  statHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statTitle: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    marginTop: 10,
    fontSize: 32,
    color: '#0F172A',
    fontWeight: '700',
  },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterButtonActive: {
    backgroundColor: '#F1F5F9',
    borderColor: '#3B82F6',
  },
  filterText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#2563EB',
  },
  recordsCard: {
    marginHorizontal: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    minWidth: 980,
  },
  tableHeaderCell: {
    flex: 1,
    minWidth: 120,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    minWidth: 980,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  assetCell: {
    flex: 1,
    minWidth: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  assetThumb: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFE4E6',
  },
  assetCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    textTransform: 'uppercase',
  },
  assetMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  metaCell: {
    flex: 1,
    minWidth: 120,
    paddingHorizontal: 10,
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  requestedBy: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  reasonText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  progressCell: {
    flex: 1,
    minWidth: 150,
    paddingHorizontal: 10,
  },
  progressTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressStep: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressStepActive: {
    backgroundColor: '#0EA5E9',
  },
  progressStepInactive: {
    backgroundColor: '#E2E8F0',
  },
  progressStepText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  progressDash: {
    width: 18,
    height: 2,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionCell: {
    flex: 1,
    minWidth: 110,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
  },
  actionIconButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 42,
  },
  emptyStateText: {
    marginTop: 12,
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '600',
  },
});
