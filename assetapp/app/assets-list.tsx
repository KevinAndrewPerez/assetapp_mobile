import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { fetchAssets, AssetSummary } from '../lib/assetService';
import { getStoredUser } from '../lib/userService';

const tags = ['All', 'Acquired', 'Active', 'For Repair', 'Pulled Out', 'Disposed'];

export default function AssetsListScreen() {
  const router = useRouter();
  const { department, departmentId } = useLocalSearchParams() as { department?: string, departmentId?: string };
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('All');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [records, userData] = await Promise.all([
          fetchAssets(),
          getStoredUser()
        ]);
        setAssets(records);
        setUser(userData);
      } catch (err) {
        setError((err as Error).message || 'Unable to load assets from Supabase');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [department, departmentId]);

  const isAdmin = user?.role === 'Admin';

  const handleAssetPress = (assetId: string) => {
    router.push({
      pathname: '/asset-details',
      params: { id: assetId }
    } as any);
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
        const searchable = [item.title, item.category, item.location, item.assetId, item.custodian]
          .join(' ')
          .toLowerCase();

        return matchesDepartment && matchesTag && searchable.includes(search.toLowerCase());
      }),
    [search, activeTag, department, departmentId, assets, user, isAdmin],
  );

  const departmentName = department || (isAdmin ? 'All Assets' : assets.find(a => String(a.departmentId) === String(user?.department_id))?.department || 'My Department');

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{departmentName}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
            <MaterialCommunityIcons name="chevron-left" size={16} color="#FBBF24" />
            <Text style={styles.backLinkText}>Back to Departments</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.notificationBadge}>
          <Text style={styles.notificationBadgeText}>3</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
          <TouchableOpacity style={styles.filterButton}>
            <MaterialCommunityIcons name="filter-variant" size={24} color="#1E3A5F" />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
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

        {filteredAssets.map((item) => {
          return (
            <View key={item.id} style={styles.assetCard}>
              <TouchableOpacity 
                style={styles.assetHeader} 
                onPress={() => handleAssetPress(item.id)}
                activeOpacity={0.7}
              >
                <View style={styles.assetInfo}>
                  <Text style={styles.assetTitle}>{item.title}</Text>
                  <Text style={styles.assetSubtitle}>{item.category}</Text>
                  <Text style={styles.assetLocation}>{item.department}</Text>
                </View>
                <View style={styles.headerRight}>
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, { backgroundColor: item.status === 'Active' ? '#10B981' : '#FBBF24' }]} />
                    <Text style={[styles.statusText, { color: item.status === 'Active' ? '#10B981' : '#FBBF24' }]}>{item.status}</Text>
                  </View>
                  <MaterialCommunityIcons 
                    name="chevron-right" 
                    size={24} 
                    color="#94A3B8" 
                  />
                </View>
              </TouchableOpacity>
            </View>
          );
        })}

        {!loading && !error && filteredAssets.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No assets match your filter.</Text>
          </View>
        )}
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
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  backLinkText: {
    fontSize: 13,
    color: '#FBBF24',
    marginLeft: 2,
    fontWeight: '600',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 52,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: '#1E3A5F',
    fontWeight: '500',
  },
  filterButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  tagScroll: {
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
    borderRadius: 24,
    padding: 20,
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
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
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
  qrCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  qrBox: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FBBF24',
    shadowColor: '#FBBF24',
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  qrText: {
    marginTop: 12,
    color: '#1E3A5F',
    fontWeight: '800',
    fontSize: 15,
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
});
