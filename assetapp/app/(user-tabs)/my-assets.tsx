import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchUserAssets, getStoredUser } from '@/lib/userService';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import QRViewModal from '@/components/QRViewModal';

export default function MyAssets() {
  const [assets, setAssets] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [selectedQrValue, setSelectedQrValue] = useState('');
  const [selectedQrTitle, setSelectedQrTitle] = useState('');

  const openQrModal = (value: string, title: string) => {
    setSelectedQrValue(value);
    setSelectedQrTitle(title);
    setQrModalVisible(true);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  useEffect(() => {
    const loadAssets = async () => {
      setLoading(true);
      try {
        const user = await getStoredUser();
        if (!user) return;
        const data = await fetchUserAssets(user);
        setAssets(data);
        setExpandedId((prev) => prev ?? (data?.[0]?.id ? String(data[0].id) : null));
      } catch (error) {
        console.error('Failed to load user assets:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, []);

  const filteredAssets = useMemo(
    () =>
      assets.filter((asset) => {
        const query = searchQuery.toLowerCase();
        return (
          asset.name.toLowerCase().includes(query) ||
          asset.category.toLowerCase().includes(query) ||
          asset.barcode.toLowerCase().includes(query)
        );
      }),
    [assets, searchQuery],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Assets</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f4b942" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Assets</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-badge-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchSection}>
        <View style={styles.searchContainer}>
          <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" style={styles.searchIcon} />
          <TextInput
            placeholder="Search assets..."
            style={styles.searchInput}
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity style={styles.filterButton}>
          <MaterialCommunityIcons name="filter-variant" size={20} color="#1a3a5c" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {filteredAssets.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No assigned assets found.</Text>
          </View>
        ) : (
          filteredAssets.map((asset) => (
            <View key={asset.id} style={styles.assetCard}>
              <TouchableOpacity
                style={styles.assetHeader}
                onPress={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                activeOpacity={0.8}
              >
                <View style={styles.assetInfo}>
                  <Text style={styles.assetName}>{asset.name}</Text>
                  <Text style={styles.assetCategory}>{asset.category}</Text>
                  <View style={styles.barcodeContainer}>
                    <MaterialCommunityIcons name="barcode-scan" size={14} color="#64748B" />
                    <Text style={styles.barcodeText}>{asset.barcode}</Text>
                  </View>
                </View>
                <View style={styles.headerRight}>
                  <View style={[styles.statusTag, { backgroundColor: asset.statusBg }]}>
                    <Text style={[styles.statusTagText, { color: asset.statusColor }]}>{asset.status}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={expandedId === asset.id ? 'chevron-up' : 'chevron-down'}
                    size={22}
                    color="#94A3B8"
                  />
                </View>
              </TouchableOpacity>

              {expandedId === asset.id && (
                <View style={styles.assetDetails}>
                  <TouchableOpacity
                    style={styles.qrSection}
                    onPress={() => openQrModal(asset.barcode, asset.name)}
                    activeOpacity={0.9}
                  >
                    <LinearGradient
                      colors={['#1E3A5F', '#2D5A8E']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.qrGradient}
                    >
                      <View style={styles.qrContainer}>
                        <QRCode value={asset.barcode} size={150} backgroundColor="white" />
                      </View>
                      <Text style={styles.qrHint}>Tap QR to Expand</Text>
                      <Text style={styles.qrValue}>{asset.barcode}</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <View style={styles.detailGrid}>
                    <DetailItem icon="pound" label="Serial Number" value={asset.serialNumber} />
                    <DetailItem icon="calendar-range" label="Acquisition Date" value={formatDate(asset.acquisitionDate)} />
                    <DetailItem icon="account-outline" label="Custodian" value={asset.custodian} />
                    <DetailItem icon="identifier" label="Asset ID" value={asset.barcode} />
                    <DetailItem icon="tag-outline" label="Category" value={asset.category} />
                    <DetailItem icon="clock-outline" label="Last Updated" value={formatDate(asset.updatedAt)} />
                  </View>
                </View>
              )}
            </View>
          ))
        )}
        <View style={styles.spacer} />
      </ScrollView>

      <QRViewModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        value={selectedQrValue}
        title={selectedQrTitle}
      />
    </SafeAreaView>
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
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#1a3a5c',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    paddingTop: Platform.OS === 'ios' ? 10 : 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notificationButton: {
    padding: 4,
  },
  searchSection: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1e293b',
  },
  filterButton: {
    width: 44,
    height: 44,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
  },
  assetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  assetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetInfo: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  assetCategory: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 6,
  },
  barcodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  barcodeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  assetDetails: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 16,
  },
  qrSection: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  qrGradient: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  qrContainer: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f4b942',
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
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
  },
  detailItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  detailItemLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailItemValue: {
    fontSize: 13,
    color: '#1a3a5c',
    fontWeight: '700',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 15,
  },
  spacer: {
    height: 20,
  },
});
