import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchUserAssets, fetchUserRequests, getStoredUser, StoredUser } from '@/lib/userService';

export default function UserDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const storedUser = await getStoredUser();
        if (!storedUser) return;
        setUser(storedUser);

        const [userAssets, userRequests] = await Promise.all([
          fetchUserAssets(storedUser),
          fetchUserRequests(storedUser),
        ]);

        setAssets(userAssets);
        setRequests(userRequests);
      } catch (error) {
        console.error('Dashboard load failed:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const lifecycleStatus = useMemo(() => {
    const counts: Record<string, number> = {
      Acquired: 0,
      Active: 0,
      'For Repair': 0,
      'Pulled Out': 0,
      Disposed: 0,
    };

    assets.forEach((asset) => {
      counts[asset.status] = (counts[asset.status] ?? 0) + 1;
    });

    return [
      { label: 'Acquired', count: counts.Acquired, color: '#3B82F6', lightColor: '#EFF6FF' },
      { label: 'Active', count: counts.Active, color: '#10B981', lightColor: '#F0FDF4' },
      { label: 'For Repair', count: counts['For Repair'], color: '#F59E0B', lightColor: '#FFFBEB' },
      { label: 'Pulled Out', count: counts['Pulled Out'], color: '#6366F1', lightColor: '#EEF2FF' },
      { label: 'Disposed', count: counts.Disposed, color: '#EF4444', lightColor: '#FEF2F2' },
    ];
  }, [assets]);

  const recentRequests = useMemo(() => requests.slice(0, 2), [requests]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Dashboard</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f4b942" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Custom Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-badge-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Welcome Card */}
        <LinearGradient
          colors={['#1a3a5c', '#254b7d']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.welcomeCard}
        >
          <Text style={styles.welcomeText}>Welcome, {user?.full_name ?? user?.email ?? 'User'}</Text>
          <Text style={styles.roleText}>
            {user?.role ?? 'Member'}{user?.department ? ` • ${user.department}` : ''}
          </Text>
        </LinearGradient>

        {/* Asset Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.collegeName}>{user?.department ?? 'My Department'}</Text>
              <Text style={styles.unitHead}>{user?.full_name ?? 'Your Name'}{user?.role ? ` - ${user.role}` : ''}</Text>
            </View>
            <View style={styles.totalAssetsContainer}>
              <Text style={styles.totalAssetsValue}>{assets.length}</Text>
              <Text style={styles.totalAssetsLabel}>Total Assets</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarContainer}>
            {lifecycleStatus.map((status) => {
              const width = assets.length > 0 ? `${Math.max(1, Math.round((status.count / assets.length) * 100))}%` : '0%';
              return <View key={status.label} style={[styles.progressSegment, { width, backgroundColor: status.color }]} />;
            })}
          </View>

          {/* Legend */}
          <View style={styles.legendContainer}>
            {lifecycleStatus.map((status) => (
              <View key={status.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: status.color }]} />
                <Text style={styles.legendText}>{status.label}: {status.count}</Text>
              </View>
            ))}

          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <TouchableOpacity 
            style={styles.submitButton}
            onPress={() => router.push('/submit-request' as any)}
          >
            <LinearGradient
              colors={['#f4b942', '#f8d082']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitGradient}
            >
              <MaterialCommunityIcons name="file-document-edit-outline" size={24} color="#1a3a5c" />
              <Text style={styles.submitButtonText}>Submit Request</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Recent Requests */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Requests</Text>
            <TouchableOpacity onPress={() => router.push('/(user-tabs)/my-requests' as any)}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.requestsContainer}>
            {recentRequests.map((request) => (
              <TouchableOpacity key={request.id} style={styles.requestCard}>
                <View style={styles.requestInfo}>
                  <Text style={styles.requestTitle}>{request.title}</Text>
                  <Text style={styles.requestMeta}>{request.requestType} • {request.dateSubmitted}</Text>
                </View>
                <View style={[styles.statusTag, { backgroundColor: request.statusBg }]}>
                  <Text style={[styles.statusTagText, { color: request.statusColor }]}>{request.status}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {recentRequests.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No recent requests yet.</Text>
              </View>
            )}
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
  scrollContent: {
    padding: 16,
  },
  welcomeCard: {
    padding: 24,
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  roleText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  collegeName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a3a5c',
    marginBottom: 2,
  },
  unitHead: {
    fontSize: 12,
    color: '#64748B',
  },
  totalAssetsContainer: {
    alignItems: 'flex-end',
  },
  totalAssetsValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f4b942',
  },
  totalAssetsLabel: {
    fontSize: 10,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressBarContainer: {
    height: 8,
    flexDirection: 'row',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressSegment: {
    height: '100%',
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: 20,
  },
  sectionTitleSmall: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a3a5c',
    marginBottom: 16,
  },
  statusGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusItem: {
    alignItems: 'center',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  statusCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  statusDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a3a5c',
  },
  viewAllText: {
    fontSize: 12,
    color: '#f4b942',
    fontWeight: '600',
  },
  submitButton: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#f4b942',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a3a5c',
  },
  requestsContainer: {
    gap: 12,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  requestInfo: {
    flex: 1,
  },
  requestTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  requestMeta: {
    fontSize: 13,
    color: '#64748B',
  },
  statusTag: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  spacer: {
    height: 20,
  },
});
