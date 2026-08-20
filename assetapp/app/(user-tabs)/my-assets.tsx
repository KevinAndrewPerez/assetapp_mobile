import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchUserAssets,
  fetchUserPendingRequestsCount,
  getStoredUser,
  UserAsset,
} from '@/lib/userService';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function MyAssets() {
  const [assets, setAssets] = useState<UserAsset[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState('');
  const [selectedImageTitle, setSelectedImageTitle] = useState('');

  const [imgScale, setImgScale] = useState(1);

  const openImageModal = (url: string, title: string) => {
    setSelectedImageUrl(url);
    setSelectedImageTitle(title);
    setImgScale(1);
    setImageModalVisible(true);
  };

  const closeImageModal = () => {
    setImageModalVisible(false);
    setSelectedImageUrl('');
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return dateStr;
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

        const [fetchedAssets, pending] = await Promise.all([
          fetchUserAssets(user),
          fetchUserPendingRequestsCount(user),
        ]);

        setAssets(fetchedAssets);
        setPendingCount(pending);
        setExpandedId((prev) => prev ?? (fetchedAssets?.[0]?.id ? String(fetchedAssets[0].id) : null));
      } catch (error) {
        console.error('Failed to load user assets:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, []);

  const totalAssets = assets.length;
  const activeAssets = useMemo(
    () => assets.filter((a) => a.status === 'Active').length,
    [assets],
  );

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
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Assets</Text>
          <TouchableOpacity style={styles.notificationButton}>
            <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
            <View style={styles.notificationBadge}>
              <Text style={styles.badgeText}>3</Text>
            </View>
          </TouchableOpacity>
        </View>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#f4b942" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Assets</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
          <View style={styles.notificationBadge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>
      <SafeAreaView style={styles.container}>

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
        {/* Stat Cards Row */}
        <View style={styles.statsRow}>
          <StatCard
            label="Total Assets"
            value={String(totalAssets)}
            icon="database"
            gradientColors={['#344CB7', '#577BC1']}
          />
          <StatCard
            label="Active Assets"
            value={String(activeAssets)}
            icon="check-circle"
            gradientColors={['#000957', '#344CB7']}
          />
          <StatCard
            label="Pending Requests"
            value={String(pendingCount)}
            icon="clock-outline"
            gradientColors={['#FFEB00', '#F4C430']}
            darkText
          />
        </View>

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
                    style={styles.imageSection}
                    onPress={() => asset.imageUrl ? openImageModal(asset.imageUrl!, asset.name) : undefined}
                    activeOpacity={0.9}
                  >
                    <LinearGradient
                      colors={['#F1F5F9', '#E2E8F0']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.imageGradient}
                    >
                      {asset.imageUrl ? (
                        <Image
                          source={{ uri: asset.imageUrl }}
                          style={styles.assetImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.imagePlaceholder}>
                          <MaterialCommunityIcons name="image-off-outline" size={64} color="#94A3B8" />
                          <Text style={styles.imagePlaceholderText}>No image available</Text>
                        </View>
                      )}
                      <Text style={styles.imageHint}>Tap image to expand</Text>
                      <View style={styles.imageAssetIdRow}>
                        <MaterialCommunityIcons name="barcode-scan" size={16} color="#0C134F" />
                        <Text style={styles.imageAssetIdText}>{asset.barcode}</Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>

                  <View style={styles.detailList}>
                    <DetailItem icon="pound" label="Serial Number" value={asset.serialNumber} />
                    <DetailItem icon="calendar-range" label="Acquisition Date" value={formatDate(asset.acquisitionDate)} />
                    <DetailItem icon="account-outline" label="Assigned to" value={asset.assignedTo || asset.custodian} />
                    <DetailItem icon="wrench" label="Next Maintenance" value={formatDate(asset.nextMaintenance)} />
                    <DetailItem icon="cash-multiple" label="Purchase Price" value={asset.purchasePrice} />
                    <DetailItem icon="map-marker-outline" label="Location" value={asset.location} />
                  </View>
                </View>
              )}
            </View>
          ))
        )}
        <View style={styles.spacer} />
      </ScrollView>

      {/* Image Zoom Modal */}
      <Modal
        visible={imageModalVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={closeImageModal}
        statusBarTranslucent
      >
        <View style={styles.imageModalContainer}>
          <View style={styles.imageModalHeader}>
            <TouchableOpacity onPress={closeImageModal} style={styles.imageModalCloseBtn}>
              <MaterialCommunityIcons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.imageModalTitle} numberOfLines={1}>
              {selectedImageTitle}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.imageModalScroll}
            contentContainerStyle={styles.imageModalScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            {selectedImageUrl ? (
              <Image
                source={{ uri: selectedImageUrl }}
                style={[styles.fullImage, { transform: [{ scale: imgScale }] }]}
                resizeMode="contain"
              />
            ) : null}
          </ScrollView>

          <View style={styles.imageModalFooter}>
            <TouchableOpacity
              onPress={() => setImgScale((s) => Math.max(0.5, s - 0.25))}
              style={styles.zoomBtn}
            >
              <MaterialCommunityIcons name="magnify-minus-outline" size={22} color="#0C134F" />
            </TouchableOpacity>
            <Text style={styles.zoomLevelText}>{Math.round(imgScale * 100)}%</Text>
            <TouchableOpacity
              onPress={() => setImgScale((s) => Math.min(4, s + 0.25))}
              style={styles.zoomBtn}
            >
              <MaterialCommunityIcons name="magnify-plus-outline" size={22} color="#0C134F" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      </SafeAreaView>
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
  gradientColors,
  darkText,
}: {
  label: string;
  value: string;
  icon: string;
  gradientColors: [string, string];
  darkText?: boolean;
}) {
  const labelColor = darkText ? 'rgba(12, 19, 79, 0.85)' : 'rgba(255, 255, 255, 0.9)';
  const valueColor = darkText ? '#0C134F' : '#FFFFFF';
  const iconBg = darkText ? 'rgba(12, 19, 79, 0.15)' : 'rgba(255, 255, 255, 0.2)';
  const iconColor = darkText ? '#0C134F' : '#FFFFFF';

  return (
    <View style={styles.statCardWrap}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statCardGradient}
      >
        <View style={styles.statCardTop}>
          <Text style={[styles.statCardLabel, { color: labelColor }]}>{label}</Text>
          <View style={[styles.statCardIconWrap, { backgroundColor: iconBg }]}>
            <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
          </View>
        </View>
        <Text style={[styles.statCardValue, { color: valueColor }]}>{value}</Text>
      </LinearGradient>
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
  screenContainer: {
    flex: 1,
    backgroundColor: '#0C134F',
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
    paddingVertical: 0,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#0C134F',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  notificationButton: {
    position: 'relative',
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
  searchSection: {
    flexDirection: 'row',
    padding: 16,
    paddingTop: 12,
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
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statCardWrap: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  statCardGradient: {
    padding: 14,
    borderRadius: 14,
    minHeight: 92,
  },
  statCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    flex: 1,
  },
  statCardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statCardValue: {
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
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
  imageSection: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  imageGradient: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  assetImage: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    marginTop: 8,
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  imageHint: {
    marginTop: 12,
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  imageAssetIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  imageAssetIdText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0C134F',
    letterSpacing: 0.6,
  },
  detailList: {
    gap: 10,
  },
  detailItemBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
  },
  detailItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  detailItemLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailItemValue: {
    fontSize: 15,
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
  // Image modal styles
  imageModalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: '#0C134F',
  },
  imageModalCloseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  imageModalScroll: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: SCREEN_WIDTH - 32,
    height: SCREEN_WIDTH * 1.2,
  },
  imageModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#0C134F',
    paddingBottom: 32,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLevelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    minWidth: 50,
    textAlign: 'center',
  },
});
