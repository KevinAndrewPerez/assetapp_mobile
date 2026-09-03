import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { LinkedAsset, RequestItem } from '@/components/requests/request-card';
import { updateRequestStatus } from '@/lib/userService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const filterTabs = ['All Requests', 'Pending', 'In Progress', 'Completed', 'Cancelled'] as const;
type FilterTab = typeof filterTabs[number];
type RepairStatus = 'Pending' | 'In Progress' | 'Completed' | 'Cancelled';

const formatPrice = (raw: any): string | undefined => {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) return String(raw);
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Map a raw asset row to the shape used on the repair cards.
 */
const toLinkedAsset = (a: any): LinkedAsset => ({
  id: a?.id,
  code: String(a?.Asset_code ?? ''),
  name: String(a?.Asset_name ?? 'Unknown Asset'),
  category: a?.Category ? String(a.Category) : undefined,
  condition: a?.Condition ? String(a.Condition) : undefined,
  serialNumber: a?.serial_Number ? String(a.serial_Number) : undefined,
  location: a?.asset_location ? String(a.asset_location) : undefined,
  purchasePrice: formatPrice(a?.purchase_Price),
  warrantyMonths: a?.warranty_months != null ? String(a.warranty_months) : undefined,
  lifecycleStatus: a?.Lifecycle_Status ? String(a.Lifecycle_Status) : undefined,
});

const normalizeRepairStatus = (rawStatus?: string | null): RepairStatus => {
  const status = String(rawStatus ?? '').trim().toLowerCase();

  if (!status) return 'Pending';
  if (status.includes('cancel')) return 'Cancelled';
  if (status.includes('complete') || status.includes('done')) return 'Completed';
  if (status.includes('progress') || status.includes('working') || status.includes('approve') || status.includes('approved')) {
    return 'In Progress';
  }

  return 'Pending';
};

const getStatusStyle = (status: RepairStatus) => {
  switch (status) {
    case 'Pending':
      return { backgroundColor: '#FDE68A', color: '#92400E' };
    case 'In Progress':
      return { backgroundColor: '#DBEAFE', color: '#1D4ED8' };
    case 'Completed':
      return { backgroundColor: '#DCFCE7', color: '#166534' };
    case 'Cancelled':
      return { backgroundColor: '#E5E7EB', color: '#374151' };
    default:
      return { backgroundColor: '#FDE68A', color: '#92400E' };
  }
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
        <MaterialCommunityIcons name={icon as any} size={32} color="#FFFFFF" />
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
      </View>
    </LinearGradient>
  );
}

export default function RepairModule() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All Requests');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
  });

  const fetchRepairRequests = async () => {
    try {
      setLoading(true);

      // Many requests leave `asset_id` NULL — the actual asset links live on
      // the per-asset `repairs` log rows (repairs.Assets_id per Request_id).
      // Resolve each request's asset(s) from BOTH sources so rows never render
      // as "Unknown Asset".
      const { data, error } = await supabase
        .from('requests')
        .select(`
          id,
          request_type,
          status,
          Note,
          created_at,
          updated_at,
          users:user_id (
            department_id,
            employee_numbers (
              Full_Name
            ),
            departments:department_id (
              Name
            )
          ),
          assets (Asset_code, Asset_name)
        `)
        .eq('request_type', 'Repair');

      if (error) throw error;

      const reqRows: any[] = data || [];
      const reqIds = reqRows.map((r: any) => String(r.id)).filter(Boolean);

      let repairRows: any[] = [];
      if (reqIds.length > 0) {
        const { data: repData, error: repErr } = await supabase
          .from('repairs')
          .select('Repair_id, Request_id, Assets_id, status')
          .in('Request_id', reqIds);
        if (repErr) {
          console.error('Failed to fetch repairs for asset resolution:', repErr.message);
        } else {
          repairRows = repData || [];
        }
      }

      const repairsByRequest = new Map<string, any[]>();
      repairRows.forEach((row: any) => {
        const key = String(row.Request_id ?? '');
        if (!key) return;
        const list = repairsByRequest.get(key) ?? [];
        list.push(row);
        repairsByRequest.set(key, list);
      });

      const wantedAssetIds: number[] = [];
      const wantAsset = (raw: any) => {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0 && !wantedAssetIds.includes(n)) wantedAssetIds.push(n);
      };
      reqRows.forEach((req: any) => {
        wantAsset(req.asset_id);
        (repairsByRequest.get(String(req.id)) ?? []).forEach((r: any) => wantAsset(r.Assets_id));
      });

      let assetRows: any[] = [];
      if (wantedAssetIds.length > 0) {
        const { data: aData, error: aErr } = await supabase
          .from('assets')
          .select('id, Asset_code, Asset_name, Category, Condition, serial_Number, asset_location, purchase_Price, warranty_months, Lifecycle_Status')
          .in('id', wantedAssetIds);
        if (aErr) {
          console.error('Failed to fetch assets for repair rows:', aErr.message);
        } else {
          assetRows = aData || [];
        }
      }
      const assetsById = new Map(assetRows.map((a: any) => [String(a.id), a]));

      const mappedItems: RequestItem[] = reqRows.map((req: any) => {
        const user = req.users;
        const fullName = user?.employee_numbers?.Full_Name || 'Unknown';
        const departmentName = user?.departments?.Name || user?.department_id || 'N/A';
        const normalizedStatus = normalizeRepairStatus(req.status);

        // Direct request link first, then any per-asset repairs-log links.
        const seen = new Set<string>();
        const linked: LinkedAsset[] = [];
        const pushAsset = (raw: any) => {
          if (!raw || raw.id == null) return;
          const id = String(raw.id);
          if (seen.has(id)) return;
          seen.add(id);
          linked.push(toLinkedAsset(raw));
        };
        if (req.asset_id != null) pushAsset(assetsById.get(String(req.asset_id)));
        (repairsByRequest.get(String(req.id)) ?? []).forEach((r: any) => {
          pushAsset(assetsById.get(String(r.Assets_id)));
        });

        const mainAsset = linked[0];
        return {
          id: String(req.id),
          title: mainAsset?.name ?? 'No asset linked',
          requestId: `REP-${req.id}`,
          assetName: mainAsset?.name ?? 'No asset linked',
          assetId: mainAsset?.code || 'N/A',
          linkedAssets: linked.length > 0 ? linked : undefined,
          requestType: 'Repair',
          department: String(departmentName),
          submittedBy: fullName,
          dateSubmitted: new Date(req.created_at).toLocaleDateString(),
          reason: req.Note || '',
          status: normalizedStatus,
          statusLabel: normalizedStatus,
          priority: 'Medium',
          completedAt:
            normalizedStatus === 'Completed' && req.updated_at
              ? new Date(req.updated_at).toLocaleDateString()
              : undefined,
        };
      });

      setItems(mappedItems);

      // Calculate stats
      const total = mappedItems.length;
      const pending = mappedItems.filter((i) => i.status === 'Pending').length;
      const inProgress = mappedItems.filter((i) => i.status === 'In Progress').length;
      const completed = mappedItems.filter((i) => i.status === 'Completed').length;

      setStats({ total, pending, inProgress, completed });
    } catch (error) {
      console.error('Failed to fetch repair requests:', error);
      Alert.alert('Error', 'Failed to load repair requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepairRequests();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRepairRequests();
    setRefreshing(false);
  };

  const filteredRequests = useMemo(() => {
    switch (activeFilter) {
      case 'Pending':
        return items.filter((item) => item.status === 'Pending');
      case 'In Progress':
        return items.filter((item) => item.status === 'In Progress');
      case 'Completed':
        return items.filter((item) => item.status === 'Completed');
      case 'Cancelled':
        return items.filter((item) => item.status === 'Cancelled');
      default:
        return items;
    }
  }, [activeFilter, items]);

  const handleStatusUpdate = async (requestId: string, nextStatus: RepairStatus) => {
    try {
      const userJson = await AsyncStorage.getItem('user');
      if (!userJson) {
        Alert.alert('Error', 'User session not found.');
        return;
      }

      const user = JSON.parse(userJson);

      if (nextStatus === 'Completed') {
        Alert.alert(
          'Confirm completion',
          'This repair request will be marked as completed and cannot be edited afterwards. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Confirm',
              onPress: async () => {
                try {
                  await updateRequestStatus(requestId, nextStatus, user.id);
                  Alert.alert('Success', 'Repair request marked as completed.');
                  fetchRepairRequests();
                } catch (error) {
                  console.error('Failed to complete repair request:', error);
                  Alert.alert('Error', 'Failed to complete repair request.');
                }
              },
            },
          ]
        );
        return;
      }

      await updateRequestStatus(requestId, nextStatus as any, user.id);
      Alert.alert('Success', `Repair request updated to ${nextStatus}.`);
      fetchRepairRequests();
    } catch (error) {
      console.error('Failed to update repair status:', error);
      Alert.alert('Error', 'Failed to update repair request.');
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

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Repair Management</Text>
          <Text style={styles.subtitle}>Manage and track all repairs requests here</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Stat Cards */}
          <View style={styles.statsContainer}>
          <StatCard
            title="Total Repairs"
            value={stats.total}
            icon="hammer"
            gradientColors={['#EF4444', '#DC2626']}
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon="clock-outline"
            gradientColors={['#F59E0B', '#D97706']}
          />
          <StatCard
            title="In Progress"
            value={stats.inProgress}
            icon="sync"
            gradientColors={['#3B82F6', '#1D4ED8']}
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            icon="check-circle"
            gradientColors={['#10B981', '#059669']}
          />
        </View>

        {/* Filter Menu */}
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
                  <Text style={[styles.filterLabel, isActive ? styles.filterLabelActive : null]}>
                    {tab}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Repair Requests List */}
        <View style={styles.listContainer}>
          {filteredRequests.length > 0 ? (
            filteredRequests.map((item) => {
              const priorityStyle =
                item.priority === 'High'
                  ? styles.priorityHigh
                  : item.priority === 'Low'
                    ? styles.priorityLow
                    : styles.priorityMedium;

              const statusStyle = getStatusStyle(item.status as RepairStatus);
              const isExpanded = expandedId === item.id;
              const canEditStatus = item.status !== 'Completed' && item.status !== 'Cancelled';

              return (
                <View key={item.id} style={styles.recordCard}>
                  <View style={styles.recordHeader}>
                    <View style={styles.assetSummary}>
                      <View style={styles.assetIconWrap}>
                        <MaterialCommunityIcons name="wrench" size={28} color="#F87171" />
                      </View>
                      <View style={styles.assetTextWrap}>
                        <Text style={styles.assetName}>{item.title}</Text>
                        <Text style={styles.assetCode}>{item.assetId}</Text>
                        {item.linkedAssets && item.linkedAssets.length > 1 ? (
                          <Text style={styles.assetExtra}>{`${item.linkedAssets.length} assets linked`}</Text>
                        ) : null}
                        <Text style={styles.requestorText}>Requested by: {item.submittedBy}</Text>
                        <View style={[styles.statusPillCompact, { backgroundColor: statusStyle.backgroundColor }]}>
                          <Text style={[styles.statusTextCompact, { color: statusStyle.color }]}>{item.status}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.iconActions}>
                      <TouchableOpacity
                        style={styles.actionIcon}
                        activeOpacity={0.8}
                        onPress={() => setExpandedId(isExpanded ? null : item.id)}
                      >
                        <MaterialCommunityIcons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color="#0F172A"
                        />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionIcon} activeOpacity={0.8}>
                        <MaterialCommunityIcons name="trash-can-outline" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {isExpanded && (
                    <View style={styles.expandedDetails}>
                      <View style={styles.detailGridMain}>
                        <View style={styles.detailBlockLarge}>
                          <Text style={styles.detailLabel}>Issue</Text>
                          <Text style={styles.detailValue}>{item.reason || 'No issue description provided'}</Text>
                        </View>

                        <View style={styles.detailBlockSmall}>
                          <Text style={styles.detailLabel}>Priority</Text>
                          <View style={[styles.priorityPill, priorityStyle]}>
                            <Text style={styles.priorityText}>{item.priority || 'Medium'}</Text>
                          </View>
                        </View>

                        <View style={styles.detailBlockSmall}>
                          <Text style={styles.detailLabel}>Date</Text>
                          <Text style={styles.detailValue}>{item.dateSubmitted}</Text>
                        </View>
                      </View>

                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Notes</Text>
                        <View style={styles.notesBox}>
                          <Text style={styles.notesText}>{item.reason || 'No additional notes provided.'}</Text>
                        </View>
                      </View>

                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Asset details</Text>
                        <View style={styles.assetInfoStack}>
                          {item.linkedAssets && item.linkedAssets.length > 0 ? (
                            item.linkedAssets.map((asset, idx) => (
                              <View key={asset.id ?? asset.code ?? idx} style={styles.assetInfoItem}>
                                <Text style={styles.detailAssetName}>{asset.name}</Text>
                                <Text style={styles.detailAssetCode}>{asset.code || '—'}</Text>
                                {asset.lifecycleStatus ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Lifecycle Status</Text>
                                    <Text style={styles.assetInfoValue}>{asset.lifecycleStatus}</Text>
                                  </View>
                                ) : null}
                                {asset.category ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Category</Text>
                                    <Text style={styles.assetInfoValue}>{asset.category}</Text>
                                  </View>
                                ) : null}
                                {asset.condition ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Condition</Text>
                                    <Text style={styles.assetInfoValue}>{asset.condition}</Text>
                                  </View>
                                ) : null}
                                {asset.serialNumber ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Serial Number</Text>
                                    <Text style={styles.assetInfoValue}>{asset.serialNumber}</Text>
                                  </View>
                                ) : null}
                                {asset.location ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Location</Text>
                                    <Text style={styles.assetInfoValue}>{asset.location}</Text>
                                  </View>
                                ) : null}
                                {asset.purchasePrice ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Purchase Price</Text>
                                    <Text style={styles.assetInfoValue}>{asset.purchasePrice}</Text>
                                  </View>
                                ) : null}
                                {asset.warrantyMonths ? (
                                  <View style={styles.assetMiniRow}>
                                    <Text style={styles.assetInfoLabel}>Warranty (Months)</Text>
                                    <Text style={styles.assetInfoValue}>{asset.warrantyMonths}</Text>
                                  </View>
                                ) : null}
                              </View>
                            ))
                          ) : (
                            <View style={styles.assetInfoItem}>
                              <Text style={styles.assetInfoValue}>
                                No asset has been linked to this request yet.
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={[styles.statusActionButton, styles.primaryActionButton, !canEditStatus && styles.disabledActionButton]}
                          onPress={() => canEditStatus && handleStatusUpdate(item.id, 'In Progress')}
                          disabled={!canEditStatus}
                        >
                          <Text style={styles.actionButtonText}>In Progress</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.statusActionButton, styles.secondaryActionButton, !canEditStatus && styles.disabledActionButton]}
                          onPress={() => canEditStatus && handleStatusUpdate(item.id, 'Completed')}
                          disabled={!canEditStatus}
                        >
                          <Text style={styles.actionButtonText}>Completed</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.statusActionButton, styles.cancelActionButton, styles.disabledActionButton]}
                          onPress={() => {}}
                          disabled={true}
                        >
                          <Text style={styles.actionButtonText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.sendStack}>
                        <TouchableOpacity style={styles.sendButton} activeOpacity={0.9}>
                          <MaterialCommunityIcons name="swap-horizontal" size={18} color="#FFFFFF" />
                          <Text style={styles.sendButtonText} numberOfLines={1} adjustsFontSizeToFit>Send to Replacement</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.sendButtonDisposal} activeOpacity={0.9}>
                          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FFFFFF" />
                          <Text style={styles.sendButtonTextDisposal} numberOfLines={1} adjustsFontSizeToFit>Send to Disposal</Text>
                        </TouchableOpacity>
                      </View>

                      {item.status === 'Completed' && item.completedAt ? (
                        <Text style={styles.completedDateText}>Completed on {item.completedAt}</Text>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="inbox-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyStateText}>No repair requests found</Text>
            </View>
          )}
        </View>

        </ScrollView>
      </SafeAreaView>

      <Modal visible={selectedImage !== null} transparent animationType="fade" onRequestClose={() => setSelectedImage(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedImage(null)}>
              <MaterialCommunityIcons name="close" size={22} color="#0F172A" />
            </TouchableOpacity>
            {selectedImage ? (
              <Text style={styles.modalText}>No Image Attached</Text>
            ) : null}
          </View>
        </View>
      </Modal>

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
    paddingVertical: 18,
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
    paddingBottom: 96,
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
    alignItems: 'center',
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
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
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
  statusPillCompact: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusTextCompact: {
    fontSize: 11,
    fontWeight: '700',
  },
  assetCode: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    letterSpacing: 0.1,
  },
  assetExtra: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    marginTop: 3,
  },
  requestorText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
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
  infoRow: {
    display: 'none',
  },
  infoBlock: {
    flex: 1,
    minWidth: 70,
  },
  infoLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 5,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  infoSubValue: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
  },
  priorityPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },
  priorityLow: {
    backgroundColor: '#DCFCE7',
  },
  priorityMedium: {
    backgroundColor: '#FEF3C7',
  },
  priorityHigh: {
    backgroundColor: '#FEE2E2',
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#111827',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  expandedDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 14,
  },
  detailSection: {
    gap: 6,
  },
  detailGridMain: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  detailBlockLarge: {
    flex: 2,
    minWidth: 0,
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
  detailSubValue: {
    fontSize: 12,
    color: '#475569',
  },
  notesBox: {
    minHeight: 90,
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
    minHeight: 58,
    justifyContent: 'center',
  },
  assetInfoLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  assetInfoValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
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
  assetMiniRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F7',
    paddingTop: 8,
  },
  imagePlaceholderCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  imagePlaceholder: {
    width: '100%',
    minHeight: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D7E0EA',
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    marginTop: 6,
  },
  imagePlaceholderText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusActionButton: {
    flex: 1,
    minWidth: 90,
    paddingVertical: 10,
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
  disabledActionButton: {
    opacity: 0.7,
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
  sendButtonTextDisposal: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  completedDateText: {
    fontSize: 12,
    color: '#166534',
    fontWeight: '700',
    marginTop: 4,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    minHeight: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
  },
  spacer: {
    height: 12,
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
});
