import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const REQUESTS = [
  {
    id: '1',
    title: 'HP Printer LaserJet Pro',
    type: 'Repair',
    typeColor: '#F59E0B',
    typeBg: '#FFFBEB',
    status: 'Pending',
    statusColor: '#F59E0B',
    statusBg: '#FFFBEB',
    reason: 'Printer not printing properly',
    date: '2024-04-12',
    barcode: 'NU-2024-03-007',
  },
  {
    id: '2',
    title: 'Old Desktop PC i3',
    type: 'Disposal',
    typeColor: '#EF4444',
    typeBg: '#FEF2F2',
    status: 'Approved',
    statusColor: '#10B981',
    statusBg: '#F0FDF4',
    reason: 'Outdated and no longer needed',
    date: '2024-04-10',
    barcode: 'NU-2015-02-143',
  },
  {
    id: '3',
    title: 'Canon Scanner DR-C225',
    type: 'Repair',
    typeColor: '#F59E0B',
    typeBg: '#FFFBEB',
    status: 'Approved',
    statusColor: '#10B981',
    statusBg: '#F0FDF4',
    reason: 'Scanner not detecting documents',
    date: '2024-04-05',
    barcode: 'NU-2024-01-056',
  },
  {
    id: '4',
    title: 'Old Projector SVGA',
    type: 'Replacement',
    typeColor: '#8B5CF6',
    typeBg: '#F5F3FF',
    status: 'Rejected',
    statusColor: '#EF4444',
    statusBg: '#FEF2F2',
    reason: 'Replaced with new model',
    date: '2024-04-01',
    barcode: 'NU-2025-05-334',
  },
];

export default function MyRequests() {
  const [activeTab, setActiveTab] = useState('All');

  const filteredRequests = activeTab === 'All' 
    ? REQUESTS 
    : REQUESTS.filter(r => r.status === activeTab);

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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {filteredRequests.map((request) => (
          <View key={request.id} style={styles.requestCard}>
            <View style={styles.cardHeader}>
              <View style={styles.titleContainer}>
                <Text style={styles.requestTitle}>{request.title}</Text>
                <View style={styles.badgeContainer}>
                  <View style={[styles.badge, { backgroundColor: request.typeBg }]}>
                    <Text style={[styles.badgeText, { color: request.typeColor }]}>{request.type}</Text>
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
                Date: <Text style={styles.dateText}>{request.date}</Text>
              </Text>
            </View>
          </View>
        ))}
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
  spacer: {
    height: 20,
  },
});
