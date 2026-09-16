import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface UserProfile {
  full_name: string;
  email: string;
  role: string;
  department: string;
}

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const userJson = await AsyncStorage.getItem('user');
        if (userJson) {
          const user = JSON.parse(userJson);
          setProfile({
            full_name: user.full_name || 'Admin User',
            email: user.email || 'N/A',
            role: user.role || 'Administrator',
            department: user.department || 'Administration',
          });
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, []);

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('user');
      router.replace('/login');
    } catch (error) {
      console.error('Logout Error:', error);
    }
  };

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0F172A" />
        </View>
      </SafeAreaView>
    );
  }

  const settingsOptions = [
    {
      id: 'edit-profile',
      icon: 'pencil',
      label: 'Edit Profile',
      color: '#FBBF24',
    },
    {
      id: 'change-password',
      icon: 'lock',
      label: 'Change Password',
      color: '#F59E0B',
    },
    {
      id: 'notifications',
      icon: 'bell',
      label: 'Notifications',
      color: '#FBBF24',
    },
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.headerSafe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* User Card */}
        <LinearGradient
          colors={['#0C134F', '#1E3A5F']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.userCard}
        >
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{profile.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.userName}>{profile.full_name}</Text>
          <Text style={styles.userRole}>{profile.role}</Text>
          <Text style={styles.userOrganization}>{profile.department}</Text>
        </LinearGradient>

        <View style={styles.accountDetails}>
          <View style={styles.detailRow}>
            <MaterialCommunityIcons name="email" size={18} color="#0F172A" style={styles.detailIcon} />
            <View>
              <Text style={styles.detailLabel}>Email</Text>
              <Text style={styles.detailValue}>{profile.email}</Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <MaterialCommunityIcons name="briefcase" size={18} color="#0F172A" style={styles.detailIcon} />
            <View>
              <Text style={styles.detailLabel}>Role</Text>
              <Text style={styles.detailValue}>{profile.role}</Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <MaterialCommunityIcons name="home-city" size={18} color="#0F172A" style={styles.detailIcon} />
            <View>
              <Text style={styles.detailLabel}>Department</Text>
              <Text style={styles.detailValue}>{profile.department}</Text>
            </View>
          </View>
        </View>

        {/* Settings Section */}
        <View style={styles.settingsSection}>
          <Text style={styles.sectionTitle}>Settings</Text>

          {settingsOptions.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={styles.settingItem}
              activeOpacity={0.7}
              onPress={() => {
                if (option.id === 'notifications') router.push('/notifications');
              }}
            >
              <View style={[styles.settingIconContainer, { backgroundColor: `${option.color}20` }]}>
                <MaterialCommunityIcons name={option.icon as any} size={20} color={option.color} />
              </View>
              <Text style={styles.settingLabel}>{option.label}</Text>
              <MaterialCommunityIcons name="chevron-right" size={24} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="logout" size={20} color="#B91C1C" />
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footerContainer}>
          <Text style={styles.footer}>NU TRACE v1.0.0 • National University Lipa</Text>
        </View>
      </ScrollView>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerSafe: {
    flex: 1,
    backgroundColor: '#0C134F',
  },
  container: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 16,
    backgroundColor: '#0C134F',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 116,
  },
  userCard: {
    borderRadius: 18,
    padding: 26,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#0C134F',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 26,
    backgroundColor: '#FDB833',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F0A925',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#3D2E00',
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  userRole: {
    fontSize: 14,
    color: '#E2E8F0',
    marginBottom: 2,
  },
  userOrganization: {
    fontSize: 13,
    color: '#CBD5E1',
  },
  settingsSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  accountDetails: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailIcon: {
    marginRight: 14,
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: '#F4F7FB',
  },
  settingIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  logoutButton: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 16,
    marginBottom: 24,
    gap: 8,
  },
  logoutButtonText: {
    color: '#B91C1C',
    fontSize: 15,
    fontWeight: '700',
  },
  footerContainer: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: '#94A3B8',
  },
});
