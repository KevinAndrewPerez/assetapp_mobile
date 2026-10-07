import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { headerTopPadding } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { UserCard } from '@/components/dashboard/user-card';
import { StatCard } from '@/components/dashboard/stat-card';
import { ActivityItem } from '@/components/dashboard/activity-item';
import { QuickLink } from '@/components/dashboard/quick-link';
import NotificationBell from '@/components/notification-bell';
import { AssetScanButton } from '@/components/asset-scanner';
import { SectionHeader } from '@/components/dashboard/section-header';
import { fetchActivityTimeline, LifecycleEvent } from '@/lib/assetService';
import { parseStoredTimestamp } from '@/lib/time';

export default function App() {
  const router = useRouter();
  const [userName, setUserName] = useState('Admin');
  const [userPhoto, setUserPhoto] = useState('');
  const [stats, setStats] = useState([
    { title: 'Total Assets', value: '0', icon: 'database', iconColor: '#FDB833', backgroundColor: '#FEF9E7' },
    { title: 'Deployed', value: '0', icon: 'check-circle', iconColor: '#10B981', backgroundColor: '#ECFDF5' },
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
        setUserPhoto(user.profile_photo || '');
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
        { title: 'Deployed', value: String(deploysRes.count || 0), icon: 'check-circle', iconColor: '#10B981', backgroundColor: '#ECFDF5' },
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
      gradientColors: ['#0C134F', '#1E3A5F'],
      titleColor: '#FDB833',
      subtitleColor: 'rgba(253, 184, 51, 0.7)',
      iconColor: '#FDB833',
    },
    {
      title: 'Asset Registry',
      subtitle: 'Register new assets',
      icon: 'plus-box',
      onPress: () => router.push('/asset-registry'),
      gradientColors: ['#FDB833', '#F0A925'],
      titleColor: '#1E3A5F',
      subtitleColor: 'rgba(30, 58, 95, 0.7)',
      iconColor: '#1E3A5F',
    },
    {
      title: 'Transfer',
      subtitle: 'Employee relocation',
      icon: 'swap-horizontal',
      onPress: () => router.push('/transfer' as any),
      gradientColors: ['#0EA5E9', '#0369A1'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.75)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Maintenance',
      subtitle: 'Track due maintenance',
      icon: 'calendar-check',
      onPress: () => router.push('/maintenance'),
      gradientColors: ['#3B82F6', '#1D4ED8'],
      titleColor: '#0C134F',
      subtitleColor: 'rgba(12, 19, 79, 0.6)',
      iconColor: '#0C134F',
    },
    {
      title: 'Record Disposal',
      subtitle: 'Log disposed assets',
      icon: 'trash-can-outline',
      onPress: () => router.push('/disposal'),
      gradientColors: ['#EF4444', '#B91C1C'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Disposal Records',
      subtitle: 'Archive & inventory removal',
      icon: 'archive-arrow-down-outline',
      onPress: () => router.push('/archived-disposals' as any),
      gradientColors: ['#0F766E', '#115E59'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Record Pullout',
      subtitle: 'Log pulled out assets',
      icon: 'arrow-up-box',
      onPress: () => router.push('/pullout'),
      gradientColors: ['#64748B', '#334155'],
      titleColor: '#FFFFFF',
      subtitleColor: 'rgba(255, 255, 255, 0.7)',
      iconColor: '#FFFFFF',
    },
    {
      title: 'Make Repair',
      subtitle: 'Request asset repair',
      icon: 'wrench',
      onPress: () => router.push('/repair'),
      gradientColors: ['#FBBF24', '#F59E0B'],
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
      // Database timestamps are naive UTC — `parseStoredTimestamp` reads them
      // that way so "3h ago" is really three hours ago.
      const date = parseStoredTimestamp(ts);
      if (!date) return ts;
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffInSeconds < 60) return 'just now';
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    } catch {
      return ts;
    }
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <View style={styles.headerIntro}>
          <Text style={styles.headerGreeting}>Welcome back,</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{userName}</Text>
        </View>
        <View style={styles.headerActions}>
          <AssetScanButton />
          <NotificationBell />
        </View>
      </View>
      {/* The header already clears the status bar, so the body is a plain view:
          a SafeAreaView here would paint its top inset as a dead strip of page
          background right under the navy header. */}
      <View style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <UserCard
          name={userName}
          role="Administrator"
          organization="NU Lipa"
          avatarInitials={userName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'AD'}
          photo={userPhoto}
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

      </ScrollView>
      </View>
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
    backgroundColor: '#F4F7FB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    // Clears the real status-bar inset instead of a hard-coded 44px, which left
    // the greeting under the clock on phones with a tall inset.
    paddingTop: headerTopPadding,
    paddingBottom: 14,
    backgroundColor: '#0C134F',
  },
  headerIntro: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  // The scan button and the three notification icons each carry their own 42px
  // tap target now, so the gap only has to add a little breathing room.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  headerGreeting: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.66)',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  scrollContent: {
    // Clearance for the floating tab bar (74pt bar + home indicator).
    paddingBottom: 112,
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
    // Equal-height cards within each row (see QuickLink).
    alignItems: 'stretch',
    paddingHorizontal: 16,
    // Even 12px gaps between rows; the leftover width (space-between) keeps the
    // column gap visually the same.
    rowGap: 12,
  },
  emptyText: {
    textAlign: 'center',
    color: '#94A3B8',
    marginTop: 10,
    fontSize: 14,
  },
});
