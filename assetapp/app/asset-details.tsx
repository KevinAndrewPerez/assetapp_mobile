import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAssets, AssetSummary } from '../lib/assetService';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import QRViewModal from '../components/QRViewModal';

export default function AssetDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams() as { id: string };
  const [asset, setAsset] = useState<AssetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrModalVisible, setQrModalVisible] = useState(false);

  useEffect(() => {
    const loadAsset = async () => {
      try {
        setLoading(true);
        const assets = await fetchAssets();
        const found = assets.find(a => a.id === id);
        setAsset(found || null);
      } catch (error) {
        console.error('Error loading asset details:', error);
      } finally {
        setLoading(false);
      }
    };

    if (id) loadAsset();
  }, [id]);

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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1E3A5F" />
      </View>
    );
  }

  if (!asset) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Asset Not Found</Text>
        </View>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={64} color="#94A3B8" />
          <Text style={styles.emptyText}>The requested asset could not be found.</Text>
          <TouchableOpacity style={styles.goBackButton} onPress={() => router.back()}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Asset Details</Text>
        <TouchableOpacity style={styles.editButton}>
          <MaterialCommunityIcons name="pencil-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Asset Basic Info Card */}
        <View style={styles.mainCard}>
          <View style={styles.statusBadgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: asset.status === 'Active' ? '#F0FDF4' : '#FFFBEB' }]}>
              <View style={[styles.statusDot, { backgroundColor: asset.status === 'Active' ? '#10B981' : '#FBBF24' }]} />
              <Text style={[styles.statusText, { color: asset.status === 'Active' ? '#10B981' : '#FBBF24' }]}>{asset.status}</Text>
            </View>
            <Text style={styles.assetIdText}>#{asset.assetId}</Text>
          </View>

          <Text style={styles.assetTitle}>{asset.title}</Text>
          <Text style={styles.assetCategory}>{asset.category}</Text>
          
          <View style={styles.locationRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={16} color="#64748B" />
            <Text style={styles.locationText}>{asset.department} • {asset.location || 'No specific location'}</Text>
          </View>
        </View>

        {/* QR Code Section */}
        <TouchableOpacity 
          style={styles.qrSection} 
          onPress={() => setQrModalVisible(true)}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={['#1E3A5F', '#2D5A8E']}
            style={styles.qrGradient}
          >
            <View style={styles.qrContainer}>
              <QRCode value={asset.assetId} size={160} backgroundColor="white" />
            </View>
            <Text style={styles.qrLabel}>Tap to Expand QR Code</Text>
            <View style={styles.qrFooter}>
              <MaterialCommunityIcons name="qrcode-scan" size={20} color="#FBBF24" />
              <Text style={styles.qrAssetId}>{asset.assetId}</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Detailed Information */}
        <View style={styles.detailsSection}>
          <Text style={styles.sectionTitle}>Technical Details</Text>
          <View style={styles.detailsGrid}>
            <DetailBox icon="barcode" label="Serial Number" value={asset.serialNumber} />
            <DetailBox icon="calendar-check" label="Acquisition Date" value={formatDate(asset.acquisitionDate)} />
            <DetailBox icon="account-tie" label="Custodian" value={asset.custodian} />
            <DetailBox icon="update" label="Last Updated" value={formatDate(asset.updatedAt)} />
            <DetailBox icon="tag" label="Category" value={asset.category} />
            <DetailBox icon="office-building" label="Department" value={asset.department} />
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsSection}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionButton}>
              <View style={[styles.actionIcon, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="wrench-outline" size={24} color="#3B82F6" />
              </View>
              <Text style={styles.actionLabel}>Report Issue</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionButton}>
              <View style={[styles.actionIcon, { backgroundColor: '#FEF2F2' }]}>
                <MaterialCommunityIcons name="history" size={24} color="#EF4444" />
              </View>
              <Text style={styles.actionLabel}>View History</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton}>
              <View style={[styles.actionIcon, { backgroundColor: '#F0FDF4' }]}>
                <MaterialCommunityIcons name="share-variant-outline" size={24} color="#10B981" />
              </View>
              <Text style={styles.actionLabel}>Transfer</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.spacer} />
      </ScrollView>

      <QRViewModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        value={asset.assetId}
        title={asset.title}
      />
    </SafeAreaView>
  );
}

function DetailBox({ icon, label, value }: { icon: string, label: string, value?: string }) {
  return (
    <View style={styles.detailBox}>
      <View style={styles.detailHeader}>
        <MaterialCommunityIcons name={icon as any} size={18} color="#94A3B8" />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue}>{value || 'N/A'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  editButton: {
    padding: 8,
    marginRight: -8,
  },
  scrollContent: {
    padding: 20,
  },
  mainCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 3,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  assetIdText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  assetTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1E3A5F',
    marginBottom: 8,
  },
  assetCategory: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 16,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationText: {
    fontSize: 14,
    color: '#64748B',
  },
  qrSection: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 24,
    elevation: 5,
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  qrGradient: {
    padding: 30,
    alignItems: 'center',
  },
  qrContainer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 16,
  },
  qrLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
  },
  qrFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 10,
  },
  qrAssetId: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  detailsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E3A5F',
    marginBottom: 16,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailBox: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 14,
    color: '#1E3A5F',
    fontWeight: '700',
  },
  actionsSection: {
    marginBottom: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E3A5F',
  },
  spacer: {
    height: 40,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  goBackButton: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  goBackText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
