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

const departments: Record<string, string> = {
  engineering: 'College of Engineering',
  business: 'College of Business Administration',
  arts: 'College of Arts & Sciences',
  itso: 'ITSO - IT Services Office',
  administration: 'Administration',
  finance: 'Finance Department',
};

const tags = ['All', 'Acquired', 'Active', 'For Repair', 'Pulled Out', 'Disposed'];

export default function AssetsListScreen() {
  const router = useRouter();
  const { department } = useLocalSearchParams() as { department?: string };
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('All');
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAssets = async () => {
      setLoading(true);
      setError(null);

      try {
        const records = await fetchAssets();
        setAssets(records);
        if (!expandedId && records.length > 0) {
          setExpandedId(records[0].id);
        }
      } catch (err) {
        setError((err as Error).message || 'Unable to load assets from Supabase');
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, [department]);

  const departmentName = department ? departments[department] ?? 'Assets' : 'Assets';

  const filteredAssets = useMemo(
    () =>
      assets.filter((item) => {
        const matchesDepartment = department ? item.department === department : true;
        const matchesTag = activeTag === 'All' ? true : item.status === activeTag;
        const searchable = [item.title, item.category, item.location, item.assetId, item.custodian]
          .join(' ')
          .toLowerCase();

        return matchesDepartment && matchesTag && searchable.includes(search.toLowerCase());
      }),
    [search, activeTag, department, assets],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{departmentName}</Text>
          <Text style={styles.headerSubtitle}>View all assets in the department</Text>
        </View>
        <View style={styles.notificationBadge}>
          <Text style={styles.notificationBadgeText}>{filteredAssets.length}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <MaterialCommunityIcons name="magnify" size={20} color="#6B7280" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search assets..."
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity style={styles.filterButton} activeOpacity={0.8}>
            <MaterialCommunityIcons name="filter-variant" size={22} color="#0F172A" />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagScroll}
        >
          {tags.map((tag) => {
            const active = tag === activeTag;
            return (
              <TouchableOpacity
                key={tag}
                style={[styles.tagItem, active && styles.tagItemActive]}
                onPress={() => setActiveTag(tag)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tagLabel, active && styles.tagLabelActive]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Loading assets from Supabase...</Text>
          </View>
        )}

        {error && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Error: {error}</Text>
          </View>
        )}

        {!loading && !error && filteredAssets.map((item) => {
          const expanded = expandedId === item.id;
          return (
            <View key={item.id} style={styles.assetCard}>
              <TouchableOpacity
                style={styles.assetHeader}
                activeOpacity={0.8}
                onPress={() => setExpandedId(expanded ? null : item.id)}
              >
                <View style={styles.assetInfo}>
                  <Text style={styles.assetTitle}>{item.title}</Text>
                  <Text style={styles.assetSubtitle}>{item.category || 'Uncategorized'}</Text>
                  <Text style={styles.assetLocation}>{item.location || 'No location set'}</Text>
                </View>
                <View
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    backgroundColor: expanded ? '#0F172A' : '#E5E7EB',
                    marginRight: 8,
                  }}
                >
                  <Text
                    style={{
                      color: expanded ? '#FFFFFF' : '#0F172A',
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {item.status}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={24}
                  color="#374151"
                />
              </TouchableOpacity>

              {expanded && (
                <View style={styles.assetDetails}>
                  <View style={styles.qrCard}>
                    <MaterialCommunityIcons name="qrcode-scan" size={72} color="#FBBF24" />
                    <Text style={styles.qrText}>{item.assetId}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Serial Number</Text>
                      <Text style={styles.detailValue}>{item.serialNumber || 'N/A'}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Acquisition Date</Text>
                      <Text style={styles.detailValue}>{item.acquisitionDate || 'N/A'}</Text>
                    </View>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Custodian</Text>
                      <Text style={styles.detailValue}>{item.custodian || 'Unassigned'}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Asset ID</Text>
                      <Text style={styles.detailValue}>{item.assetId}</Text>
                    </View>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailItemFull}>
                      <Text style={styles.detailLabel}>Category</Text>
                      <Text style={styles.detailValue}>{item.category || 'Unknown'}</Text>
                    </View>
                  </View>

                  <View style={styles.detailFooter}>
                    <Text style={styles.updatedLabel}>Last updated</Text>
                    <Text style={styles.updatedValue}>{item.updatedAt || 'Not available'}</Text>
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
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  notificationBadge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#0F172A',
    fontWeight: '700',
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
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  filterButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  tagScroll: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 10,
  },
  tagItem: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 10,
  },
  tagItemActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  tagLabel: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  tagLabelActive: {
    color: '#FFFFFF',
  },
  assetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  assetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  assetInfo: {
    flex: 1,
  },
  assetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  assetSubtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 4,
  },
  assetLocation: {
    color: '#6B7280',
    fontSize: 12,
  },
  assetDetails: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 18,
    gap: 16,
  },
  qrCard: {
    backgroundColor: '#FDF6E7',
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  qrText: {
    marginTop: 12,
    color: '#92400E',
    fontWeight: '700',
    fontSize: 14,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  detailItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 14,
  },
  detailItemFull: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 14,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  detailValue: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
  },
  detailFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  updatedLabel: {
    color: '#6B7280',
    fontSize: 12,
  },
  updatedValue: {
    fontSize: 13,
    color: '#111827',
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
    color: '#6B7280',
    fontSize: 15,
    textAlign: 'center',
  },
});
