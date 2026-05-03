import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { RequestCard, RequestItem, RequestStatus } from '@/components/requests/request-card';

interface RequestData {
  id: number;
  request_type: string;
  status: string;
  Note: string;
  created_at: string;
  users: { full_name: string; department: string };
  assets: { Asset_code: string; Asset_name: string };
}

const tabs = ['All', 'Pending', 'Completed'] as const;
type RequestTab = typeof tabs[number];

export default function RequestsScreen() {
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
        .select('id, request_type, status, Note, created_at, users(full_name, department), assets(Asset_code, Asset_name)');

      if (error) throw error;

      const mappedItems: RequestItem[] = (data || []).map((req: RequestData) => ({
        id: String(req.id),
        title: req.assets?.Asset_name || 'Unknown Asset',
        requestId: `REQ-${req.id}`,
        assetName: req.assets?.Asset_name || 'Unknown',
        assetId: req.assets?.Asset_code || 'N/A',
        requestType: req.request_type,
        department: req.users?.department || 'N/A',
        submittedBy: req.users?.full_name || 'Unknown',
        dateSubmitted: new Date(req.created_at).toLocaleDateString(),
        reason: req.Note || '',
        status: req.status,
        statusLabel: req.status as RequestStatus,
      }));

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
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Requests</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0F172A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Requests</Text>
        <View style={styles.notificationContainer}>
          <Text style={styles.notificationText}>3</Text>
        </View>
      </View>

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
            onApprove={() => {}}
            onReject={() => {}}
          />
        ))}
        {filteredRequests.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No requests found.</Text>
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
    paddingVertical: 16,
    backgroundColor: '#0F172A',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  notificationContainer: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationText: {
    color: '#0F172A',
    fontWeight: '700',
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
