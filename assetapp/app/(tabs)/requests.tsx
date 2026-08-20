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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { RequestCard, RequestItem, RequestStatus } from '@/components/requests/request-card';
import { updateRequestStatus } from '@/lib/userService';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
        assets (Asset_code, Asset_name)
      `);

    if (error) throw error;

    const mappedItems: RequestItem[] = (data as any[] || []).map((req: any) => {
      const user = req.users;
      const fullName = user?.employee_numbers?.Full_Name || 'Unknown';

      return {
        id: String(req.id),
        title: req.assets?.Asset_name || 'Unknown Asset',
        requestId: `REQ-${req.id}`,
        assetName: req.assets?.Asset_name || 'Unknown',
        assetId: req.assets?.Asset_code || 'N/A',
        requestType: req.request_type,
        department: user?.department_id || 'N/A',
        submittedBy: fullName,
        dateSubmitted: new Date(req.created_at).toLocaleDateString(),
        reason: req.Note || '',
        status: req.status,
        statusLabel: req.status as RequestStatus,
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
          <TouchableOpacity style={styles.notificationButton}>
            <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
            <View style={styles.notificationBadge}>
              <Text style={styles.badgeText}>3</Text>
            </View>
          </TouchableOpacity>
        </View>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0F172A" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

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
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
          <View style={styles.notificationBadge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
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
