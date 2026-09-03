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
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { RequestCard, RequestItem, RequestStatus } from '@/components/requests/request-card';
import { updateRequestStatus } from '@/lib/userService';
import NotificationBell from '@/components/notification-bell';
import AsyncStorage from '@react-native-async-storage/async-storage';

const tabs = ['All', 'Pending', 'Completed'] as const;
type RequestTab = typeof tabs[number];

export default function RequestsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<RequestTab>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRequests = async () => {
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
        assets (Asset_code, Asset_name, asset_files (Asset_file_ID, file_name, file_path, url)),
        request_items (assets (Asset_code, Asset_name, asset_files (Asset_file_ID, file_name, file_path, url)))
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const requests = (data as any[] || []);
    const requestIds = requests.map((r: any) => r?.id).filter((v: any) => v !== null && v !== undefined);

    // Multi-asset requests link assets through `request_items` (requests.asset_id
    // is often NULL in this database), so resolve those too.
    const itemsByRequest = new Map<string, any[]>();
    if (requestIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from('request_items')
        .select('request_id, assets (Asset_code, Asset_name, asset_files (Asset_file_ID, file_name, file_path, url))')
        .in('request_id', requestIds);
      if (itemsErr) {
        console.error('Failed to fetch request items:', itemsErr.message);
      } else {
        (items || []).forEach((it: any) => {
          const key = String(it?.request_id ?? '');
          if (!key) return;
          const list = itemsByRequest.get(key) ?? [];
          list.push(it);
          itemsByRequest.set(key, list);
        });
      }
    }

    // Fallback: some requests only carry asset links inside `replacements`
    // (old_assets_id per Request_id), e.g. requests approved before items were
    // recorded. Resolve those so no request renders as "Unknown Asset".
    const replacementAssetsByRequest = new Map<string, any[]>();
    if (requestIds.length > 0) {
      const { data: repRows, error: repErr } = await supabase
        .from('replacements')
        .select('Request_id, old_assets_id, new_assets_id')
        .in('Request_id', requestIds);
      if (repErr) {
        console.error('Failed to fetch replacement links:', repErr.message);
      } else {
        const wanted: number[] = [];
        (repRows || []).forEach((r: any) => {
          [r.old_assets_id, r.new_assets_id].forEach((raw) => {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0 && !wanted.includes(n)) wanted.push(n);
          });
        });
        if (wanted.length > 0) {
          const { data: aRows } = await supabase
            .from('assets')
            .select('id, Asset_code, Asset_name')
            .in('id', wanted);
          const byId = new Map<string, any>();
          (aRows || []).forEach((a: any) => {
            if (a.id != null) byId.set(String(a.id), a);
          });
          (repRows || []).forEach((r: any) => {
            const key = String(r.Request_id ?? '');
            if (!key) return;
            const asset = byId.get(String(r.old_assets_id ?? ''));
            if (!asset) return;
            const list = replacementAssetsByRequest.get(key) ?? [];
            if (!list.some((x) => x.id === asset.id)) list.push(asset);
            replacementAssetsByRequest.set(key, list);
          });
        }
      }
    }

    const fileUrlOf = (files: any): string => {
      const first = Array.isArray(files) ? files[0] : files;
      if (!first) return '';
      const raw = String(first?.url ?? first?.file_path ?? '');
      if (!raw) return '';
      if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
      const clean = raw.replace(/^\/+/, '').replace(/^storage\/v1\/object\/public\//, '').replace(/^storage\/assets\//, '').replace(/^assets\//, '');
      if (!clean) return '';
      const { data } = supabase.storage.from('assets').getPublicUrl(clean);
      return data?.publicUrl || '';
    };

    const mappedItems: RequestItem[] = requests.map((req: any) => {
      const user = req.users;
      const fullName = user?.employee_numbers?.Full_Name || 'Unknown';

      const linked: { id?: string | number | null; code: string; name: string; imageUrl?: string }[] = (itemsByRequest.get(String(req.id)) ?? [])
        .map((it: any) => {
          const a = Array.isArray(it?.assets) ? it.assets[0] : it?.assets;
          return a
            ? { id: a.id, code: String(a.Asset_code ?? ''), name: String(a.Asset_name ?? ''), imageUrl: fileUrlOf(a.asset_files) }
            : null;
        })
        .filter((a: any): a is NonNullable<typeof a> => a && (a.code || a.name));

      if (linked.length === 0) {
        (replacementAssetsByRequest.get(String(req.id)) ?? []).forEach((a: any) => {
          if (a && a.id != null && !linked.some((x) => String(x.id) === String(a.id))) {
            linked.push({ id: a.id, code: String(a.Asset_code ?? ''), name: String(a.Asset_name ?? '') });
          }
        });
      }

      const firstLinked = linked[0];
      const directAsset = Array.isArray(req.assets) ? req.assets[0] : req.assets;
      const directName = directAsset?.Asset_name || '';
      const directCode = directAsset?.Asset_code || '';
      const directImage = fileUrlOf(directAsset?.asset_files);
      const assetName = directName || firstLinked?.name || 'Unknown Asset';
      const assetCode = directCode || firstLinked?.code || 'N/A';

      return {
        id: String(req.id),
        title: linked.length > 1 ? `${firstLinked?.name || 'Asset'} +${linked.length - 1} more` : assetName,
        requestId: `REQ-${req.id}`,
        assetName,
        assetId: assetCode,
        requestType: req.request_type,
        department: user?.department_id || 'N/A',
        submittedBy: fullName,
        dateSubmitted: new Date(req.created_at).toLocaleDateString(),
        reason: req.Note || '',
        status: req.status,
        statusLabel: req.status as RequestStatus,
        linkedAssets:
          linked.length > 0
            ? linked.map((a, i) => ({ ...a, imageUrl: a.imageUrl || (i === 0 ? directImage : '') }))
            : directName || directCode
              ? [{ id: directAsset?.id, code: directCode, name: directName, imageUrl: directImage }]
              : undefined,
      };
    });

    setItems(mappedItems);
  } catch (error) {
    console.error('Failed to fetch requests:', error);
  } finally {
    setLoading(false);
  }
};

  useEffect(() => {
    fetchRequests();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  };

  const filteredRequests = useMemo(() => {
    if (activeTab === 'Pending') {
      return items.filter((item) => item.status === 'Pending');
    }
    if (activeTab === 'Completed') {
      return items.filter((item) => item.status !== 'Pending');
    }
    return items;
  }, [activeTab, items]);

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Requests</Text>
          <NotificationBell />
        </View>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0F172A" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const handleViewDetails = (requestId: string) => {
    router.push({ pathname: '/request-detail', params: { id: requestId } });
  };

  const handleAction = async (requestId: string, status: 'Approved' | 'Rejected') => {
    try {
      const userJson = await AsyncStorage.getItem('user');
      if (!userJson) {
        Alert.alert('Error', 'User session not found.');
        return;
      }
      const user = JSON.parse(userJson);

      await updateRequestStatus(requestId, status, user.id);
      Alert.alert('Success', `Request ${status.toLowerCase()} successfully.`);
      fetchRequests(); // Refresh list
    } catch (error) {
      console.error(`Failed to ${status.toLowerCase()} request:`, error);
      Alert.alert('Error', `Failed to ${status.toLowerCase()} request.`);
    }
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Requests</Text>
        <NotificationBell />
      </View>
      <SafeAreaView style={styles.container}>
      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const active = tab === activeTab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {filteredRequests.map((item) => (
          <RequestCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onApprove={() => handleAction(item.id, 'Approved')}
            onReject={() => handleAction(item.id, 'Rejected')}
            onViewDetails={() => handleViewDetails(item.id)}
          />
        ))}
        {filteredRequests.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No requests found.</Text>
          </View>
        )}
      </ScrollView>
      </SafeAreaView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingTop: 48,
    paddingBottom: 16,
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
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabButton: {
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  tabButtonActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#1D4ED8',
  },
  tabLabel: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#1D4ED8',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyState: {
    marginTop: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 15,
  },
});
