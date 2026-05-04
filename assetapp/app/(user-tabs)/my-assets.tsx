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

export default function MyAssets() {
  const [assets, setAssets] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAssets = async () => {
      setLoading(true);
      try {
        const user = await getStoredUser();
        if (!user) return;
        const data = await fetchUserAssets(user);
        setAssets(data);
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
            <TouchableOpacity key={asset.id} style={styles.assetCard}>
              <View style={styles.assetInfo}>
                <Text style={styles.assetName}>{asset.name}</Text>
                <Text style={styles.assetCategory}>{asset.category}</Text>
                <View style={styles.barcodeContainer}>
                  <MaterialCommunityIcons name="barcode-scan" size={14} color="#64748B" />
                  <Text style={styles.barcodeText}>{asset.barcode}</Text>
                </View>
              </View>
              <View style={[styles.statusTag, { backgroundColor: asset.statusBg }]}> 
                <Text style={[styles.statusTagText, { color: asset.statusColor }]}>{asset.status}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={styles.spacer} />
      </ScrollView>
    </SafeAreaView>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  assetInfo: {
    flex: 1,
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
