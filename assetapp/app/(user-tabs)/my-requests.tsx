import React, { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchUserRequests, getStoredUser } from '@/lib/userService';

const tabs = ['All', 'Pending', 'Completed'] as const;
type RequestTab = typeof tabs[number];

export default function MyRequests() {
  const [activeTab, setActiveTab] = useState<RequestTab>('All');
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getStoredUser();
      if (!user) return;
      const data = await fetchUserRequests(user);
      setRequests(data);
    } catch (error) {
      console.error('Failed to load user requests:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
    }, [loadRequests]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  };

  const filteredRequests = useMemo(() => {
    if (activeTab === 'Pending') {
      return requests.filter((item) => item.status === 'Pending');
    }
    if (activeTab === 'Completed') {
      return requests.filter((item) => item.status !== 'Pending');
    }
    return requests;
  }, [activeTab, requests]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Custom Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Requests</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-badge-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {['All', 'Pending', 'Completed'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredRequests.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No requests found.</Text>
          </View>
        ) : (
          filteredRequests.map((request) => (
            <View key={request.id} style={styles.requestCard}>
              <View style={styles.cardHeader}>
                <View style={styles.titleContainer}>
                  <Text style={styles.requestTitle}>{request.title}</Text>
                  <View style={styles.badgeContainer}>
                    <View style={[styles.badge, { backgroundColor: '#F1F5F9' }]}> 
                      <Text style={[styles.badgeText, { color: '#334155' }]}>{request.requestType}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: request.statusBg }]}> 
                      <Text style={[styles.badgeText, { color: request.statusColor }]}>{request.status}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.qrPlaceholder}>
                  <MaterialCommunityIcons name="qrcode" size={40} color="#f4b942" />
                  <Text style={styles.barcodeText}>{request.barcode}</Text>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <Text style={styles.reasonLabel}>
                  Reason: <Text style={styles.reasonText}>{request.reason}</Text>
                </Text>
                <Text style={styles.dateLabel}>
                  Date: <Text style={styles.dateText}>{request.dateSubmitted}</Text>
                </Text>
              </View>
            </View>
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
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tab: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#f4b942',
  },
  tabText: {
    fontSize: 15,
    color: '#64748B',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#f4b942',
    fontWeight: '700',
  },
  scrollContent: {
    padding: 16,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  requestTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 8,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  qrPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 12,
    padding: 8,
    width: 90,
  },
  barcodeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 4,
  },
  cardFooter: {
    gap: 4,
  },
  reasonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  reasonText: {
    fontWeight: '400',
    color: '#334155',
  },
  dateLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  dateText: {
    fontWeight: '400',
    color: '#334155',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 15,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    height: 20,
  },
});
