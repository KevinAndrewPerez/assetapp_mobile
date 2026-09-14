import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { UserCard } from '@/components/dashboard/user-card';
import { StatCard } from '@/components/dashboard/stat-card';
import { ActivityItem } from '@/components/dashboard/activity-item';
import { QuickLink } from '@/components/dashboard/quick-link';
import NotificationBell from '@/components/notification-bell';
import { SectionHeader } from '@/components/dashboard/section-header';
import { fetchActivityTimeline, LifecycleEvent } from '@/lib/assetService';

export default function App() {
  const router = useRouter();
  const [userName, setUserName] = useState('Admin');
  const [stats, setStats] = useState([
    { title: 'Total Assets', value: '0', icon: 'database', iconColor: '#FDB833', backgroundColor: '#FEF9E7' },
    { title: 'Deployed', value: '0', icon: 'check-circle', iconColor: '#10B981', backgroundColor: '#F0FDF4' },
    { title: 'For Repair', value: '0', icon: 'wrench', iconColor: '#F59E0B', backgroundColor: '#FFFBEB' },
    { title: 'Pending Requests', value: '0', icon: 'clock', iconColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  ]);
  const [refreshing, setRefreshing] = useState(false);
  const [activities, setActivities] = useState<LifecycleEvent[]>([]);

  const fetchDashboardData = async () => {
    try {
      const userJson = await AsyncStorage.getItem('user');
      if (userJson) {
        const user = JSON.parse(userJson);
        setUserName(user.employee_numbers?.Full_Name || user.full_name || 'Admin');
      }

      const [assetsRes, deploysRes, repairsRes, requestsRes, timelineRes] = await Promise.all([
        supabase.from('assets').select('id', { count: 'exact' }),
        supabase.from('assets').select('id', { count: 'exact' }).eq('Lifecycle_Status', 'Active'),
        supabase.from('assets').select('id', { count: 'exact' }).eq('Lifecycle_Status', 'For Repair'),
        supabase.from('requests').select('id', { count: 'exact' }).eq('status', 'Pending'),
        fetchActivityTimeline(),
      ]);

      setStats([
        { title: 'Total Assets', value: String(assetsRes.count || 0), icon: 'database', iconColor: '#FDB833', backgroundColor: '#FEF9E7' },
        { title: 'Deployed', value: String(deploysRes.count || 0), icon: 'check-circle', iconColor: '#10B981', backgroundColor: '#F0FDF4' },
        { title: 'For Repair', value: String(repairsRes.count || 0), icon: 'wrench', iconColor: '#F59E0B', backgroundColor: '#FFFBEB' },
        { title: 'Pending Requests', value: String(requestsRes.count || 0), icon: 'clock', iconColor: '#3B82F6', backgroundColor: '#EFF6FF' },
      ]);

      setActivities(timelineRes.slice(0, 5)); // Show only latest 5
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  const quickLinks = [
    {
      title: 'Pending Requests',
      subtitle: 'View pending approvals',
      icon: 'clock-outline',
      onPress: () => router.push('/requests'),
      gradientColors: ['#1E3A5F', '#2C5282'],
      titleColor: '#FDB833',
      subtitleColor: 'rgba(253, 184, 51, 0.7)',
      iconColor: '#FDB833',
    },
    {
      title: 'Asset Registry',
      subtitle: 'Register new assets',
      icon: 'plus-box',
      onPress: () => router.push('/asset-registry'),
      gradientColors: ['#FDB833', '#F59E0B'],
      titleColor: '#1E3A5F',
      subtitleColor: 'rgba(30, 58, 95, 0.7)',
      iconColor: '#1E3A5F',
    },
    {
      title: 'Maintenance',
      subtitle: 'Track due maintenance',
      icon: 'calendar-check',
      onPress: () => router.push('/maintenance'),
      gradientColors: ['#38BDF8', '#0EA5E9'],
      titleColor: '#0C134F',
      subtitleColor: 'rgba(12, 19, 79, 0.6)',
      iconColor: '#0C134F',
    },
    {
      title: 'Record Disposal',
      subtitle: 'Log disposed assets',
      icon: 'trash-can-outline',
      onPress: () => router.push('/disposal'),
      gradientColors: ['#F87171', '#DC2626'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Record Pullout',
      subtitle: 'Log pulled out assets',
      icon: 'arrow-up-box',
      onPress: () => router.push('/pullout'),
      gradientColors: ['#9CA3AF', '#64748B'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Make Repair',
      subtitle: 'Request asset repair',
      icon: 'wrench',
      onPress: () => router.push('/repair'),
      gradientColors: ['#FB923C', '#F59E0B'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Record Replacement',
      subtitle: 'Manage replacement records',
      icon: 'sync',
      onPress: () => router.push('/replacement'),
      gradientColors: ['#A78BFA', '#8B5CF6'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Lifecycle Eval',
      subtitle: 'Asset lifespan & maintenance',
      icon: 'clock-alert',
      onPress: () => router.push('/lifespan'),
      gradientColors: ['#FBBF24', '#F59E0B'],
      titleColor: '#0C134F',
      subtitleColor: 'rgba(12, 19, 79, 0.6)',
      iconColor: '#0C134F',
    },
  ];

  const formatRelativeTime = (ts: string) => {
    try {
      const date = new Date(ts);
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffInSeconds < 60) return 'just now';
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
      return date.toLocaleDateString();
    } catch {
      return ts;
    }
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard</Text>
        <NotificationBell />
      </View>
      <SafeAreaView style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <UserCard
          name={userName}
          role="Administrator"
          organization="NU Lipa"
          avatarInitials={userName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'AD'}
        />

        <View style={styles.section}>
          <SectionHeader title="Overview" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.statsScroll}
            contentContainerStyle={styles.statsContainer}
          >
            {stats.map((stat, index) => (
              <StatCard
                key={index}
                title={stat.title}
                value={stat.value}
                icon={stat.icon}
                iconColor={stat.iconColor}
                backgroundColor={stat.backgroundColor}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Recent Activity" onViewAll={() => router.push('/activity-log')} />
          <View style={styles.activityContainer}>
            {activities.length > 0 ? (
              activities.map((activity, index) => (
                <ActivityItem
                  key={index}
                  title={activity.title}
                  description={activity.assetId ? `Asset: ${activity.assetName} (${activity.assetId})` : activity.description}
                  timestamp={formatRelativeTime(activity.timestamp)}
                  icon={activity.icon}
                  iconColor={activity.iconColor}
                />
              ))
            ) : (
              <Text style={styles.emptyText}>No recent activities</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Quick Links" />
          <View style={styles.quickLinksContainer}>
            {quickLinks.map((link, index) => (
              <QuickLink
                key={index}
                title={link.title}
                subtitle={link.subtitle}
                icon={link.icon}
                onPress={link.onPress}
                gradientColors={link.gradientColors}
                titleColor={link.titleColor}
                subtitleColor={link.subtitleColor}
                iconColor={link.iconColor}
              />
            ))}
          </View>
        </View>

        <View style={styles.spacer} />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 44,
    paddingBottom: 0,
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
  scrollContent: {
    paddingBottom: 100,
    paddingTop: 12,
  },
  section: {
    marginVertical: 8,
  },
  statsScroll: {
    paddingHorizontal: 16,
  },
  statsContainer: {
    paddingRight: 8,
  },
  activityContainer: {
    paddingHorizontal: 16,
  },
  quickLinksContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 6,
  },
  spacer: {
    height: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 10,
    fontSize: 14,
  },
});
