import React, { useEffect, useMemo, useState } from 'react';
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
import QRCode from 'react-native-qrcode-svg';
import { fetchActivityTimeline, LifecycleEvent } from '../lib/assetService';
import QRViewModal from '../components/QRViewModal';

const activityTags = ['All', 'New Assets', 'Repairs', 'Pull Outs'];

export default function ActivityLogScreen() {
  const router = useRouter();
  const [activeTag, setActiveTag] = useState('All');
  const [activities, setActivities] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // QR Modal State
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [selectedQrValue, setSelectedQrValue] = useState('');
  const [selectedQrTitle, setSelectedQrTitle] = useState('');

  const openQrModal = (value: string, title: string) => {
    setSelectedQrValue(value);
    setSelectedQrTitle(title);
    setQrModalVisible(true);
  };

  useEffect(() => {
    const loadActivityTimeline = async () => {
      setLoading(true);
      setError(null);
      try {
        const timeline = await fetchActivityTimeline();
        setActivities(timeline);
      } catch (err) {
        setError((err as Error).message || 'Unable to load activity timeline from Supabase');
      } finally {
        setLoading(false);
      }
    };

    loadActivityTimeline();
  }, []);

  const filteredActivities = useMemo(() => {
    if (activeTag === 'All') return activities;
    if (activeTag === 'New Assets') return activities.filter((a) => a.eventType === 'audit');
    if (activeTag === 'Repairs') return activities.filter((a) => a.eventType === 'repair');
    if (activeTag === 'Pull Outs') return activities.filter((a) => a.eventType === 'disposal');
    return activities;
  }, [activeTag, activities]);

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return ts;
    }
  };

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

        {filteredActivities.map((activity, index) => (
          <View key={`${activity.id}-${index}`} style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: `${activity.iconColor || '#64748B'}20` },
                ]}
              >
                <MaterialCommunityIcons
                  name={(activity.icon as any) || 'bell-outline'}
                  size={24}
                  color={activity.iconColor || '#64748B'}
                />
              </View>
              <View style={styles.activityTitleSection}>
                <Text style={styles.activityTitle} numberOfLines={2}>{activity.title}</Text>
                <Text style={styles.timestamp}>{formatTimestamp(activity.timestamp)}</Text>
              </View>
              {activity.assetId ? (
                <TouchableOpacity 
                  style={styles.qrContainer} 
                  onPress={() => openQrModal(activity.assetId, activity.assetName || activity.title)}
                  activeOpacity={0.7}
                >
                  <QRCode value={activity.assetId} size={40} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.activityDetails}>
              {activity.assetId ? (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="cube-outline" size={16} color="#64748B" />
                  <Text style={styles.detailLabel}>Asset: </Text>
                  <Text style={styles.detailValue}>
                    {activity.assetName ? `${activity.assetName} ` : ''}({activity.assetId})
                  </Text>
                </View>
              ) : null}

              {activity.performedBy ? (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="account-circle-outline" size={16} color="#64748B" />
                  <Text style={styles.detailLabel}>User: </Text>
                  <Text style={styles.detailValue}>{activity.performedBy}</Text>
                </View>
              ) : null}

              {activity.description && activity.description !== activity.title ? (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name={"text-box-outline" as any} size={16} color="#64748B" />
                  <Text style={styles.detailLabel}>Action: </Text>
                  <Text style={styles.detailValue} numberOfLines={2}>{activity.description}</Text>
                </View>
              ) : null}

              {activity.requestId ? (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name={"numeric" as any} size={16} color="#64748B" />
                  <Text style={styles.detailLabel}>Request: </Text>
                  <Text style={styles.detailValue}>#{activity.requestId}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ))}

        {filteredActivities.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No activities found for this filter.</Text>
          </View>
        ) : null}
      </ScrollView>

      <QRViewModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        value={selectedQrValue}
        title={selectedQrTitle}
      />
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
    alignItems: 'flex-start',
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
    gap: 4,
    marginRight: 8,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  qrContainer: {
    padding: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  activityDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  detailValue: {
    flex: 1,
    fontSize: 12,
    color: '#1E293B',
    lineHeight: 18,
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
