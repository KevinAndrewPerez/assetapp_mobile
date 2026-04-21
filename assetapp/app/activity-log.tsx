import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const activityTags = ['All', 'New Assets', 'Repairs', 'Pull Outs'];

const activities = [
  {
    id: 'activity-1',
    type: 'new-asset',
    title: 'New asset registered',
    assetName: 'Dell Laptop i7-12th Gen',
    timestamp: '5 mins ago',
    icon: 'plus-circle',
    iconColor: '#3B82F6',
    barcode: 'NU-2026-04-001',
    department: 'College of Engineering',
    performedBy: 'Alex D. Solomon',
    note: 'Assigned to Dr. Maria Santos',
    date: 'Apr 16, 2026',
  },
  {
    id: 'activity-2',
    type: 'repair',
    title: 'Repair request approved',
    assetName: 'HP Printer LaserJet Pro M404n',
    timestamp: '1 hour ago',
    icon: 'wrench',
    iconColor: '#F59E0B',
    barcode: 'NU-2024-03-087',
    department: 'Administration',
    requestId: 'REQ-2026-889',
    reason: 'Paper jam and print quality issues',
    performedBy: 'Alex D. Solomon',
    status: 'For Repair',
    date: 'Apr 16, 2026',
  },
  {
    id: 'activity-3',
    type: 'pullout',
    title: 'Asset pulled out',
    assetName: 'Epson Projector EB-X41',
    timestamp: '2 hours ago',
    icon: 'arrow-up-box',
    iconColor: '#6B7280',
    barcode: 'NU-2023-11-234',
    date: 'Apr 16, 2026',
  },
  {
    id: 'activity-4',
    type: 'new-asset',
    title: 'New asset registered',
    assetName: 'Lenovo ThinkCentre M90n',
    timestamp: '3 hours ago',
    icon: 'plus-circle',
    iconColor: '#3B82F6',
    barcode: 'NU-2026-04-005',
    department: 'Finance Department',
    performedBy: 'Alex D. Solomon',
    note: 'Assigned to Prof. Juan Cruz',
    date: 'Apr 15, 2026',
  },
  {
    id: 'activity-5',
    type: 'repair',
    title: 'Repair request submitted',
    assetName: 'Canon Multifunction Printer',
    timestamp: '1 day ago',
    icon: 'wrench',
    iconColor: '#F59E0B',
    barcode: 'NU-2025-02-156',
    department: 'ITSO - IT Services Office',
    requestId: 'REQ-2026-876',
    reason: 'Scanner module not functioning',
    performedBy: 'Dr. Maria Santos',
    status: 'Pending',
    date: 'Apr 15, 2026',
  },
];

export default function ActivityLogScreen() {
  const router = useRouter();
  const [activeTag, setActiveTag] = useState('All');

  const filteredActivities = useMemo(
    () => {
      if (activeTag === 'All') return activities;
      if (activeTag === 'New Assets') return activities.filter((a) => a.type === 'new-asset');
      if (activeTag === 'Repairs') return activities.filter((a) => a.type === 'repair');
      if (activeTag === 'Pull Outs') return activities.filter((a) => a.type === 'pullout');
      return activities;
    },
    [activeTag],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity Log</Text>
        <TouchableOpacity style={styles.notificationButton} activeOpacity={0.8}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagScroll}
        >
          {activityTags.map((tag) => {
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

        {filteredActivities.map((activity) => (
          <View key={activity.id} style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <View
                style={[styles.iconContainer, { backgroundColor: `${activity.iconColor}20` }]}
              >
                <MaterialCommunityIcons
                  name={activity.icon}
                  size={24}
                  color={activity.iconColor}
                />
              </View>
              <View style={styles.activityTitleSection}>
                <Text style={styles.activityTitle}>{activity.title}</Text>
                <Text style={styles.activityAssetName}>{activity.assetName}</Text>
              </View>
              <Text style={styles.timestamp}>{activity.timestamp}</Text>
            </View>

            <View style={styles.activityDetails}>
              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="barcode" size={16} color="#6B7280" />
                <Text style={styles.detailLabel}>Barcode: </Text>
                <Text style={styles.detailValue}>{activity.barcode}</Text>
              </View>

              {activity.department && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="office-building" size={16} color="#6B7280" />
                  <Text style={styles.detailLabel}>Department: </Text>
                  <Text style={styles.detailValue}>{activity.department}</Text>
                </View>
              )}

              {activity.requestId && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="identifier" size={16} color="#6B7280" />
                  <Text style={styles.detailLabel}>Request ID: </Text>
                  <Text style={styles.detailValue}>{activity.requestId}</Text>
                </View>
              )}

              {activity.reason && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="message-text-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailLabel}>Reason: </Text>
                  <Text style={styles.detailValue}>{activity.reason}</Text>
                </View>
              )}

              {activity.performedBy && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="account-circle-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailLabel}>Performed by: </Text>
                  <Text style={styles.performedByName}>{activity.performedBy}</Text>
                </View>
              )}

              {activity.status && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="information-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailLabel}>Status: </Text>
                  <Text style={[styles.detailValue, styles.statusText(activity.status)]}>
                    {activity.status}
                  </Text>
                </View>
              )}

              {activity.note && (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="note-outline" size={16} color="#6B7280" />
                  <Text style={styles.detailLabel}>Note: </Text>
                  <Text style={styles.detailValue}>{activity.note}</Text>
                </View>
              )}

              <View style={styles.detailRow}>
                <MaterialCommunityIcons name="calendar" size={16} color="#6B7280" />
                <Text style={styles.detailValue}>{activity.date}</Text>
              </View>
            </View>
          </View>
        ))}

        {filteredActivities.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No activities found for this filter.</Text>
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
    backgroundColor: '#0F172A',
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  notificationButton: {
    position: 'relative',
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FBBF24',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 12,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  tagScroll: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 10,
    marginBottom: 16,
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
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
  },
  tagLabel: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  tagLabelActive: {
    color: '#0F172A',
  },
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityTitleSection: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  activityAssetName: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  timestamp: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  activityDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  detailValue: {
    fontSize: 13,
    color: '#6B7280',
  },
  performedByName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F59E0B',
  },
  statusText: (status: string) => {
    let textColor = '#6B7280';
    if (status === 'Active') textColor = '#10B981';
    if (status === 'For Repair') textColor = '#F59E0B';
    if (status === 'Pending') textColor = '#EF4444';
    return { color: textColor, fontWeight: '700' };
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
