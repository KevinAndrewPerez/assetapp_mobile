import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { RequestCard, RequestItem, RequestStatus } from '@/components/requests/request-card';

const requests: RequestItem[] = [
  {
    id: 'req-1',
    title: 'HP Printer LaserJet Pro',
    requestId: 'REQ-2024-03-087',
    assetName: 'HP Printer LaserJet Pro',
    assetId: 'AST-2024-03-005',
    requestType: 'Repair',
    department: 'Engineering',
    submittedBy: 'Dr. Maria Santos',
    dateSubmitted: 'April 12, 2026',
    reason: 'Printer is producing faded prints and paper jams.',
    status: 'Pending',
    statusLabel: 'Pending',
  },
  {
    id: 'req-2',
    title: 'Old Desktop PC i3',
    requestId: 'REQ-2015-02-143',
    assetName: 'Old Desktop PC i3',
    assetId: 'AST-2025-06-134',
    requestType: 'Pullout',
    department: 'Finance',
    submittedBy: 'Prof. Juan Cruz',
    dateSubmitted: 'April 11, 2026',
    reason: 'PC is outdated and scheduled for pullout after replacement.',
    status: 'Pending',
    statusLabel: 'Pending',
  },
  {
    id: 'req-3',
    title: 'Canon Scanner DR-C225',
    requestId: 'REQ-2024-01-056',
    assetName: 'Canon Scanner DR-C225',
    assetId: 'AST-2024-00-056',
    requestType: 'Repair',
    department: 'Arts & Sciences',
    submittedBy: 'Dr. Ana Reyes',
    dateSubmitted: 'April 10, 2026',
    reason: 'Scanner not detecting documents properly.',
    status: 'Approved',
    statusLabel: 'Approved',
  },
  {
    id: 'req-4',
    title: 'Old Projector',
    requestId: 'REQ-2025-06-134',
    assetName: 'Old Projector',
    assetId: 'AST-2025-06-134',
    requestType: 'Repair',
    department: 'N/A',
    submittedBy: 'Prof. Pedro Garcia',
    dateSubmitted: 'April 09, 2026',
    reason: 'Projector lamp needs replacement and maintenance.',
    status: 'Rejected',
    statusLabel: 'Rejected',
  },
];

const tabs = ['All', 'Pending', 'Completed'] as const;
type RequestTab = typeof tabs[number];

export default function RequestsScreen() {
  const [activeTab, setActiveTab] = useState<RequestTab>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<RequestItem[]>(requests);

  const filteredRequests = useMemo(() => {
    if (activeTab === 'Pending') {
      return items.filter((item) => item.status === 'Pending');
    }
    if (activeTab === 'Completed') {
      return items.filter((item) => item.status !== 'Pending');
    }
    return items;
  }, [activeTab, items]);

  const handleApprove = (id: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, status: 'Approved', statusLabel: 'Approved' as RequestStatus }
          : item,
      ),
    );
  };

  const handleReject = (id: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, status: 'Rejected', statusLabel: 'Rejected' as RequestStatus }
          : item,
      ),
    );
  };

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

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filteredRequests.map((item) => (
          <RequestCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onApprove={() => handleApprove(item.id)}
            onReject={() => handleReject(item.id)}
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
