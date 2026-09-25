import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Avatar } from '@/components/avatar';
import { getStoredUser, fetchLiveUser, signOutMobile, StoredUser } from '@/lib/userService';
import { headerTopPadding } from '@/lib/theme';

export default function UserProfile() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Reload on focus so a photo saved in Edit Profile shows up immediately.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const loadProfile = async () => {
        setLoading(true);
        try {
          const stored = await getStoredUser();
          if (!stored) {
            router.replace('/login');
            return;
          }
          const liveUser = await fetchLiveUser(stored.id ?? stored.user_id ?? '');
          if (active) setUser(liveUser ?? stored);
        } catch (error) {
          console.error('Failed to load profile:', error);
          const stored = await getStoredUser();
          if (active) setUser(stored);
        } finally {
          if (active) setLoading(false);
        }
      };

      loadProfile();
      return () => {
        active = false;
      };
    }, [router]),
  );

  // Records the sign-out in the audit trail, then clears the stored session.
  const handleLogout = async () => {
    try {
      await signOutMobile();
      router.replace('/login');
    } catch (error) {
      console.error('Logout Error:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
        <View style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FDB833" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>
      <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Avatar name={user?.full_name} photo={(user as any)?.profile_photo} size={88} ring />
          </View>
          <Text style={styles.userName}>{user?.full_name ?? 'Unknown User'}</Text>
          <Text style={styles.userRole}>{user?.role ?? 'User'}</Text>
          <Text style={styles.userCollege}>{user?.department ?? 'No department assigned'}</Text>
          <Text style={styles.userEmail}>{user?.email ?? ''}</Text>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.settingsContainer}>
            {[
              { title: 'Edit Profile', icon: 'account-edit-outline', color: '#FDB833' },
              { title: 'Notifications', icon: 'bell-outline', color: '#FDB833' },
            ].map((item, index, list) => (
              <TouchableOpacity
                key={item.title}
                style={[
                  styles.settingsItem,
                  index < list.length - 1 && styles.settingsDivider,
                ]}
                onPress={() => {
                  if (item.title === 'Edit Profile') router.push('/edit-profile' as any);
                  if (item.title === 'Notifications') router.push('/notifications');
                }}
              >
                <View style={styles.settingsItemLeft}>
                  <View style={[styles.iconBg, { backgroundColor: '#FFFBEB' }]}> 
                    <MaterialCommunityIcons name={item.icon as any} size={22} color={item.color} />
                  </View>
                  <Text style={styles.settingsItemText}>{item.title}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#CBD5E1" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={20} color="#B91C1C" style={styles.logoutIcon} />
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>NU TRACE v1.0.0 • National University Lipa</Text>
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
    backgroundColor: '#0C134F',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 0,
    paddingTop: headerTopPadding,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 112,
  },
  profileCard: {
    backgroundColor: '#0C134F',
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  userRole: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 2,
  },
  userCollege: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
  },
  userEmail: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  settingsSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 12,
    marginLeft: 4,
  },
  settingsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingsDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  settingsItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  logoutButton: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginBottom: 32,
    height: 48,
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutButtonText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '800',
  },
  footer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  footerText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
