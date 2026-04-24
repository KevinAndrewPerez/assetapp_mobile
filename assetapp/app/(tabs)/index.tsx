import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { UserCard } from '@/components/dashboard/user-card';
import { StatCard } from '@/components/dashboard/stat-card';
import { ActivityItem } from '@/components/dashboard/activity-item';
import { QuickLink } from '@/components/dashboard/quick-link';
import { SectionHeader } from '@/components/dashboard/section-header';

export default function App() {
  const router = useRouter();

  const stats = [
    {
      title: 'Total Assets',
      value: '545',
      icon: 'database',
      iconColor: '#FDB833',
      backgroundColor: '#FEF9E7',
    },
    {
      title: 'Acquired this year',
      value: '45',
      icon: 'calendar-plus',
      iconColor: '#3B82F6',
      backgroundColor: '#EFF6FF',
      subtitle: 'this year',
    },
    {
      title: 'Active',
      value: '324',
      icon: 'check-circle',
      iconColor: '#10B981',
      backgroundColor: '#F0FDF4',
    },
    {
      title: 'Pending',
      value: '1',
      icon: 'clock',
      iconColor: '#F59E0B',
      backgroundColor: '#FFFBEB',
    },
  ];

  const activities = [
    {
      title: 'New asset registered',
      description: 'Dell Laptop i7-12th Gen\nBarcode: NU-2026-06-001 • College of Engineering • Dr Maria Santos',
      timestamp: '5 mins ago',
      icon: 'plus-circle',
      iconColor: '#3B82F6',
    },
    {
      title: 'Asset transferred',
      description: 'HP Desktop • Transferred to IT Department',
      timestamp: '2 hours ago',
      icon: 'arrow-right-circle',
      iconColor: '#8B5CF6',
    },
    {
      title: 'Maintenance scheduled',
      description: 'Canon Printer • Scheduled for next week',
      timestamp: '1 day ago',
      icon: 'wrench',
      iconColor: '#F59E0B',
    },
  ];

  const quickLinks = [
    {
      title: 'Pending Requests',
      subtitle: 'View pending approvals',
      icon: 'clock-outline',
      backgroundColor: '#1E3A5F',
      iconColor: '#FDB833',
      variant: 'primary' as const,
      onPress: () => router.push('/requests'),
      gradientColors: ['#1E3A5F', '#2C5282'],
      titleColor: '#FDB833',
      subtitleColor: 'rgba(253, 184, 51, 0.7)',
    },
    {
      title: 'Asset Registry',
      subtitle: 'Register new assets',
      icon: 'plus-box',
      backgroundColor: '#FDB833',
      iconColor: '#1E3A5F',
      variant: 'default' as const,
      onPress: () => router.push('/asset-registry'),
      gradientColors: ['#FDB833', '#F6AD55'],
      titleColor: '#1E3A5F',
      subtitleColor: 'rgba(30, 58, 95, 0.7)',
    },
    {
      title: 'Record Disposal',
      subtitle: 'Log disposed assets',
      icon: 'trash-can-outline',
      backgroundColor: '#FFFFFF',
      iconColor: '#EF4444',
      variant: 'danger' as const,
      onPress: () => router.push('/disposal'),
    },
    {
      title: 'Record Pullout',
      subtitle: 'Log pulled out assets',
      icon: 'arrow-up-box',
      backgroundColor: '#FFFFFF',
      iconColor: '#1E3A5F',
      variant: 'secondary' as const,
      onPress: () => router.push('/pullout'),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#1F2937" />
          <View style={styles.notificationBadge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <UserCard
          name="Alex D. Solomon"
          role="Administrator"
          organization="NU Lipa"
          avatarInitials="AS"
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
                subtitle={stat.subtitle}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Recent Activity" onViewAll={() => router.push('/activity-log')} />
          <View style={styles.activityContainer}>
            {activities.map((activity, index) => (
              <ActivityItem
                key={index}
                title={activity.title}
                description={activity.description}
                timestamp={activity.timestamp}
                icon={activity.icon}
                iconColor={activity.iconColor}
              />
            ))}
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
                backgroundColor={link.backgroundColor}
                iconColor={link.iconColor}
                variant={link.variant}
                onPress={link.onPress}
                gradientColors={link.gradientColors}
                titleColor={link.titleColor}
                subtitleColor={link.subtitleColor}
              />
            ))}
          </View>
        </View>

        <View style={styles.spacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
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
    paddingBottom: 20,
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
    paddingHorizontal: 16,
  },
  spacer: {
    height: 80,
  },
});
