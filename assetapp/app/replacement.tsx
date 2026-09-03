import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/notification-bell';
import {
  fetchReplacementRecords,
  linkReplacementAsset,
  markReplacementReceived,
  ReplacementRecord,
} from '@/lib/assetService';
import { getStoredUser } from '@/lib/userService';

const filterTabs = ['All', 'Approved', 'Received'] as const;
type FilterTab = typeof filterTabs[number];

export default function ReplacementModule() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<ReplacementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [acting, setActing] = useState(false);

  // QR scanner for linking a new asset to a specific replacement.
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanTargetId, setScanTargetId] = useState<string | null>(null);
  const [scanTargetOldCode, setScanTargetOldCode] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const records = await fetchReplacementRecords();
      setItems(records);
    } catch (error) {
      console.error('Failed to fetch replacement records:', error);
      Alert.alert('Error', 'Failed to load replacement records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const counts = useMemo(() => ({
    All: items.length,
    Approved: items.filter((item) => item.status === 'Approved').length,
    Received: items.filter((item) => item.status === 'Received').length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchesTab = activeFilter === 'All' || item.status === activeFilter;
      const matchesSearch = normalizedQuery.length === 0 || [
        item.oldAsset.code,
        item.oldAsset.name,
        item.newAsset?.code,
        item.newAsset?.name,
        item.requestedBy,
        item.status,
      ].join(' ').toLowerCase().includes(normalizedQuery);
      return matchesTab && matchesSearch;
    });
  }, [activeFilter, items, searchQuery]);

  const openScanner = async (record: ReplacementRecord) => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Camera Permission', 'Camera permission is required to scan QR codes.');
        return;
      }
    }
    setScanTargetId(record.replacementId);
    setScanTargetOldCode(record.oldAsset.code);
    setScanned(false);
    setScannerVisible(true);
  };

  const handleScanned = async (value: string) => {
    if (scanned) return;
    setScanned(true);
    const code = String(value ?? '').trim();
    if (!code) {
      setScanned(false);
      Alert.alert('Invalid QR', 'The scanned QR code is empty.');
      return;
    }

    try {
      const { data: assetRow, error: assetErr } = await supabase
        .from('assets')
        .select('id, Asset_code, Asset_name')
        .eq('Asset_code', code)
        .maybeSingle();

      if (assetErr) throw assetErr;
      if (!assetRow) {
        Alert.alert('Invalid asset', 'No asset was found for the scanned code.');
        return;
      }

      const user = await getStoredUser();
      setActing(true);
      await linkReplacementAsset(scanTargetId!, assetRow.id, user?.id ?? null);
      Alert.alert(
        'Asset linked',
        `"${assetRow.Asset_name || assetRow.Asset_code}" is now the replacement asset.`,
      );
      setScannerVisible(false);
      await fetchData();
    } catch (err) {
      console.error('Failed to link replacement asset:', err);
      Alert.alert('Link failed', (err as Error).message || 'Unable to link the replacement asset.');
    } finally {
      setActing(false);
      setScanned(false);
    }
  };

  const handleMarkReceived = async (record: ReplacementRecord) => {
    try {
      const user = await getStoredUser();
      setActing(true);
      await markReplacementReceived(record.replacementId, user?.id ?? null);
      Alert.alert('Received', 'Replacement marked as received. New asset is Active; old asset is Pullout.');
      await fetchData();
    } catch (err) {
      console.error('Failed to mark replacement received:', err);
      Alert.alert('Error', (err as Error).message || 'Unable to update the replacement status.');
    } finally {
      setActing(false);
    }
  };

  const statusStyle = (status: string) =>
    status === 'Received'
      ? { backgroundColor: '#DCFCE7', color: '#166534' }
      : { backgroundColor: '#DBEAFE', color: '#1D4ED8' };

  if (loading && items.length === 0) {
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
            <NotificationBell color="#1E293B" />
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
            {filteredItems.length > 0 ? filteredItems.map((item) => {
              const isExpanded = expandedId === item.replacementId;
              const st = statusStyle(item.status);
              const canReceive = item.status === 'Approved';
              return (
                <View key={item.replacementId} style={styles.recordCard}>
                  <TouchableOpacity
                    style={styles.recordHeader}
                    activeOpacity={0.8}
                    onPress={() => setExpandedId(isExpanded ? null : item.replacementId)}
                  >
                    <View style={styles.assetSummary}>
                      <View style={styles.assetIconWrap}>
                        <MaterialCommunityIcons name="sync" size={26} color="#2563EB" />
                      </View>
                      <View style={styles.assetTextWrap}>
                        <Text style={styles.assetName}>{item.oldAsset.name}</Text>
                        <Text style={styles.assetCode}>{item.oldAsset.code}</Text>
                        <Text style={styles.requestorText}>Requested by: {item.requestedBy}</Text>
                        <View style={[styles.statusPill, { backgroundColor: st.backgroundColor }]}>
                          <Text style={[styles.statusText, { color: st.color }]}>{item.status}</Text>
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
                          <Text style={styles.detailValue}>{item.oldAsset.code}</Text>
                          <Text style={styles.detailSubValue}>{item.oldAsset.name}</Text>
                        </View>
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>New asset</Text>
                          {item.newAsset ? (
                            <>
                              <Text style={styles.detailValue}>{item.newAsset.code}</Text>
                              <Text style={styles.detailSubValue}>{item.newAsset.name}</Text>
                            </>
                          ) : (
                            <Text style={styles.detailSubValue}>No new asset linked yet</Text>
                          )}
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

                      {canReceive && (
                        <View style={styles.actionButtons}>
                          <TouchableOpacity
                            style={[styles.linkButton, acting && { opacity: 0.6 }]}
                            activeOpacity={0.85}
                            disabled={acting}
                            onPress={() => openScanner(item)}
                          >
                            <MaterialCommunityIcons name="qrcode-scan" size={18} color="#FFFFFF" />
                            <Text style={styles.linkButtonText}>
                              {item.newAsset ? 'Change Replacement Asset' : 'Link Replacement Asset'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.receiveButton, (!item.newAsset || acting) && { opacity: 0.45 }]}
                            activeOpacity={0.85}
                            disabled={!item.newAsset || acting}
                            onPress={() => handleMarkReceived(item)}
                          >
                            <MaterialCommunityIcons name="check-circle-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.receiveButtonText}>Mark Received</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {item.status === 'Received' && (
                        <View style={styles.receivedNote}>
                          <MaterialCommunityIcons name="check-circle" size={16} color="#166534" />
                          <Text style={styles.receivedNoteText}>Replacement received — new asset Active, old asset Pullout.</Text>
                        </View>
                      )}
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

      {/* QR scanner for linking a new replacement asset */}
      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <View style={{ width: 42 }} />
            <Text style={styles.scannerTitle}>Scan Replacement Asset QR</Text>
            <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerVisible(false)} activeOpacity={0.8}>
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleScanned(String(data ?? ''))}
            />
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>
              Scan the QR of the asset replacing {scanTargetOldCode || 'the old asset'}
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
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
  notesBox: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12 },
  notesText: { fontSize: 14, color: '#111827', lineHeight: 20 },
  actionButtons: { gap: 10, marginTop: 4 },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1E3A5F',
    borderRadius: 12,
    paddingVertical: 13,
  },
  linkButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  receiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 13,
  },
  receiveButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  receivedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 10,
  },
  receivedNoteText: { color: '#166534', fontSize: 12, fontWeight: '600', flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42 },
  emptyStateText: { marginTop: 12, color: '#94A3B8', fontSize: 16, fontWeight: '600' },
  scannerContainer: { flex: 1, backgroundColor: '#0F172A' },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#0F172A',
  },
  scannerClose: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  cameraWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scanHint: { marginTop: 18, color: '#E2E8F0', fontSize: 14, fontWeight: '600' },
});