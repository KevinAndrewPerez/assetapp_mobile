import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  DimensionValue,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchUserAssets, fetchUserRequests, getStoredUser, StoredUser, UserAsset, UserRequest, enrichUserWithEmployeeData } from '@/lib/userService';

export default function UserDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [assets, setAssets] = useState<UserAsset[]>([]);
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [assetScope, setAssetScope] = useState<'own' | 'department'>('own');
  const [scopeLoading, setScopeLoading] = useState(false);

  const isDepartmentHead = (u: StoredUser | null) => {
    if (!u) return false;
    const r = String(u.role ?? 'Employee').trim();
    return r === 'Department Head';
  };

  const resolveEffectiveScope = (u: StoredUser | null, scope: 'own' | 'department'): 'own' | 'department' => {
    return isDepartmentHead(u) ? scope : 'own';
  };

  const initialLoadDone = useRef(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const storedUser = await getStoredUser();
        if (!storedUser) return;

        const enrichedUser = await enrichUserWithEmployeeData(storedUser);
        setUser(enrichedUser);

        const effScope = resolveEffectiveScope(enrichedUser, assetScope);
        const [userAssets, userRequests] = await Promise.all([
          fetchUserAssets(enrichedUser, effScope),
          fetchUserRequests(enrichedUser),
        ]);

        setAssets(userAssets);
        setRequests(userRequests);
      } catch (error) {
        console.error('Dashboard load failed:', error);
      } finally {
        initialLoadDone.current = true;
        setLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialLoadDone.current || !user) return;
    const effScope = resolveEffectiveScope(user, assetScope);
    let cancelled = false;
    (async () => {
      setScopeLoading(true);
      try {
        const nextAssets = await fetchUserAssets(user, effScope);
        if (!cancelled) setAssets(nextAssets);
      } catch (e) {
        console.error('Scope reload failed:', e);
      } finally {
        if (!cancelled) setScopeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetScope, user]);

  const getUserName = (u: StoredUser | null) => {
    if (!u) return '';
    const empNumbers = Array.isArray((u as any)?.employee_numbers)
      ? (u as any).employee_numbers[0]
      : (u as any)?.employee_numbers;
    return (
      empNumbers?.Full_Name ||
      u.full_name ||
      (u as any)?.employeeNumber?.Full_Name ||
      ''
    );
  };

  const getUserDepartment = (u: StoredUser | null) => {
    if (!u) return '';
    const dept = Array.isArray((u as any)?.departments)
      ? (u as any).departments[0]
      : (u as any)?.departments;
    return (
      (u as any)?.departmentName ||
      dept?.Name ||
      u?.department ||
      ''
    );
  };

  const lifecycleStatus = useMemo(() => {
    const counts: Record<string, number> = {
      Acquired: 0,
      Active: 0,
      'For Repair': 0,
      'Pulled Out': 0,
      Disposed: 0,
    };

    assets.forEach((asset) => {
      const rawStatus = String(asset.status || '').trim();
      let mappedStatus = rawStatus;
      if (rawStatus === 'Pullout' || rawStatus === 'Pulled Out' || rawStatus === 'Pull-Out') mappedStatus = 'Pulled Out';
      else if (rawStatus === 'Disposal' || rawStatus === 'Disposed') mappedStatus = 'Disposed';
      else if (rawStatus === 'Acquisition' || rawStatus === 'Acquired' || rawStatus === 'New') mappedStatus = 'Acquired';
      else if (rawStatus === 'Repair' || rawStatus === 'For Repair' || rawStatus === 'Needs Repair') mappedStatus = 'For Repair';
      else if (rawStatus === 'Active' || rawStatus === 'Deployed') mappedStatus = 'Active';
      if (mappedStatus in counts) {
        counts[mappedStatus] = (counts[mappedStatus] ?? 0) + 1;
      } else {
        counts.Acquired = (counts.Acquired ?? 0) + 1;
      }
    });

    return [
      { label: 'Acquired', count: counts.Acquired, color: '#3B82F6', lightColor: '#EFF6FF' },
      { label: 'Active', count: counts.Active, color: '#10B981', lightColor: '#F0FDF4' },
      { label: 'For Repair', count: counts['For Repair'], color: '#F59E0B', lightColor: '#FFFBEB' },
      { label: 'Pulled Out', count: counts['Pulled Out'], color: '#6366F1', lightColor: '#EEF2FF' },
      { label: 'Disposed', count: counts.Disposed, color: '#EF4444', lightColor: '#FEF2F2' },
    ];
  }, [assets]);

  const recentRequests = useMemo(() => {
    return requests.slice(0, 5).map(req => ({
      ...req,
      statusBg: req.status === 'Approved' ? '#F0FDF4' : req.status === 'Pending' ? '#FFFBEB' : '#FEF2F2',
      statusColor: req.status === 'Approved' ? '#10B981' : req.status === 'Pending' ? '#F59E0B' : '#EF4444',
    }));
  }, [requests]);

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <TouchableOpacity style={styles.notificationButton}>
            <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
            <View style={styles.notificationBadge}>
              <Text style={styles.badgeText}>3</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#f4b942" />
          </View>
        </View>
      </View>
    );
  }

  const userName = getUserName(user);
  const userDept = getUserDepartment(user);

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard</Text>
        <TouchableOpacity style={styles.notificationButton}>
          <MaterialCommunityIcons name="bell-outline" size={24} color="#FFFFFF" />
          <View style={styles.notificationBadge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </TouchableOpacity>
      </View>
      <View style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.contentWrapper}>
        {/* Welcome Card */}
        <LinearGradient
          colors={['#18206B', '#0C134F']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.welcomeCard}
        >
          <Text style={styles.nameText}>{userName || 'User'}</Text>
          <Text style={styles.roleText}>
            {userDept || 'No Department'}
            {' | '}
            {isDepartmentHead(user) ? 'Department Head' : 'Employee'}
          </Text>
        </LinearGradient>

        {/* Asset Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.totalAssetsContainerLeft}>
              <Text style={styles.totalAssetsValue}>{assets.length}</Text>
            </View>
            <View style={styles.totalAssetsContainer}>
              {isDepartmentHead(user) ? (
                <View style={styles.scopeToggleWrap}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      if (!scopeLoading) setAssetScope(assetScope === 'own' ? 'department' : 'own');
                    }}
                    style={[
                      styles.scopeToggleBtn,
                      scopeLoading ? styles.scopeToggleBtnLoading : null,
                    ]}
                    disabled={scopeLoading}
                  >
                    <Text style={[
                      styles.totalAssetsLabel,
                      scopeLoading ? styles.scopeToggleTextDim : null,
                    ]}>
                      {assetScope === 'own' ? 'MY ASSETS' : 'ALL ASSETS'}
                    </Text>
                    {scopeLoading ? (
                      <ActivityIndicator size="small" color="#FDB833" style={styles.scopeToggleIcon} />
                    ) : (
                      <MaterialCommunityIcons
                        name="swap-horizontal"
                        size={14}
                        color="#FDB833"
                        style={styles.scopeToggleIcon}
                      />
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.totalAssetsLabel}>MY ASSETS</Text>
              )}
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarWrapper}>
            <View style={styles.progressBarContainer}>
              {lifecycleStatus.map((status) => {
                const count = status.count;
                const total = assets.length;
                const segmentWidth = total > 0 
                  ? (count / total) * 100 
                  : 0;
                
                if (segmentWidth === 0) return null;

                return (
                  <View 
                    key={status.label} 
                    style={[
                      styles.progressSegment, 
                      { width: `${segmentWidth}%` as DimensionValue, backgroundColor: status.color }
                    ]} 
                  />
                );
              })}
            </View>
          </View>

          {/* Legend with Percentages */}
          <View style={styles.legendContainer}>
            {lifecycleStatus.map((status) => {
              const count = status.count;
              const total = assets.length;
              const percentage = total > 0 
                ? Math.round((count / total) * 100) 
                : 0;
              return (
                <View key={status.label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: status.color }]} />
                  <Text style={styles.legendText}>{percentage}%</Text>
                </View>
              );
            })}
          </View>

          <View style={styles.divider} />

          {/* Status Row with Icons */}
          <Text style={styles.sectionTitleSmall}>Asset Lifecycle Status</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.statusScroll}
          >
            {lifecycleStatus.map((status, index) => (
              <React.Fragment key={status.label}>
                <View style={styles.statusItem}>
                  <View style={[styles.statusBadge, { backgroundColor: status.lightColor }]}>
                    <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
                  </View>
                  <Text style={styles.statusCount}>{status.count}</Text>
                </View>
                {index < lifecycleStatus.length - 1 && (
                  <View style={styles.statusConnector} />
                )}
              </React.Fragment>
            ))}
          </ScrollView>
        </View>

        {/* Quick Actions */}
        <View style={[styles.section, { marginTop: 0, paddingTop: 0 }]}>
          <TouchableOpacity 
            style={styles.submitButton}
            onPress={() => router.push('/submit-request' as any)}
          >
            <LinearGradient
              colors={['#FDB833', '#F6AD55']}
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
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#0C134F',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 0,
    paddingTop: 48,
    paddingBottom: 12,
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
  },
  contentWrapper: {
    paddingHorizontal: 16,
    paddingTop: 12,
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
  nameText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  roleText: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
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
    marginBottom: 20,
    gap: 12,
  },
  totalAssetsContainerLeft: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  totalAssetsContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 80,
  },
  totalAssetsValue: {
    fontSize: 40,
    fontWeight: '900',
    color: '#0C134F',
    lineHeight: 44,
  },
  totalAssetsLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  scopeToggleWrap: {
    alignItems: 'flex-end',
  },
  scopeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: 'rgba(253, 184, 51, 0.35)',
  },
  scopeToggleBtnLoading: {
    opacity: 0.85,
  },
  scopeToggleTextDim: {
    opacity: 0.7,
  },
  scopeToggleIcon: {
    marginLeft: 2,
  },
  progressBarWrapper: {
    width: '100%',
    marginBottom: 12,
  },
  progressBarContainer: {
    height: 10,
    flexDirection: 'row',
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    width: '100%',
  },
  progressSegment: {
    height: '100%',
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: '18%',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: 10,
    color: '#1a3a5c',
    fontWeight: '800',
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
  statusScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
  },
  statusItem: {
    alignItems: 'center',
    minWidth: 80,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusCount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
  },
  statusConnector: {
    width: 20,
    height: 1,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 4,
    marginTop: -24,
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
    color: '#FDB833',
    fontWeight: '600',
  },
  submitButton: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#FDB833',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderStyle: 'dashed',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 14,
  },
});
