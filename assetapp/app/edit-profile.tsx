import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Avatar } from '@/components/avatar';
import { button, colors, gradient, radius, shadow, spacing, type } from '@/lib/theme';
import {
  StoredUser,
  fetchLiveUser,
  getStoredUser,
  saveStoredUser,
  updateProfilePhoto,
} from '@/lib/userService';

/**
 * Edit Profile — the account details the user actually owns.
 *
 * The photo is the editable part: name, employee number and department are read
 * from the staff record (`employee_numbers`) and the email is the sign-in
 * identity, so those stay read-only here — the same rule the web follows.
 */
export default function EditProfileScreen() {
  const router = useRouter();

  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load on focus (not just on mount): the screen is reused when the user comes
  // back to it, and the row may have been changed from the web in between.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        try {
          const stored = await getStoredUser();
          if (!stored) {
            router.replace('/login' as any);
            return;
          }
          if (active) setUser(stored);
          // Refresh from the database so the photo shown is the one on the row.
          const live = await fetchLiveUser(stored.id ?? stored.user_id ?? '');
          if (active && live) setUser(live);
        } catch (err) {
          console.warn('Failed to load profile:', err);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [router]),
  );

  const pickPhoto = async (source: 'camera' | 'library') => {
    setError('');
    try {
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Camera permission is required to take a photo.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
        if (!result.canceled) setPhotoUri(result.assets[0].uri);
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Permission to access your photos is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled) setPhotoUri(result.assets[0].uri);
    } catch (err: any) {
      setError(String(err?.message ?? 'Could not open the photo picker.'));
    }
  };

  const handleSave = async () => {
    if (!photoUri || !user) return;
    setSaving(true);
    setError('');
    try {
      const url = await updateProfilePhoto(user.id ?? user.user_id, photoUri);

      // Keep the session copy in step so every other screen shows the new photo
      // without a fresh sign-in.
      const updated: StoredUser = { ...user, profile_photo: url };
      await saveStoredUser(updated);
      setUser(updated);
      setPhotoUri(null);

      Alert.alert('Profile Updated', 'Your profile photo has been saved.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      setError(String(err?.message ?? 'Could not save your new photo. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const employeeNumber =
    (user as any)?.unit_heads_number ||
    (user as any)?.employee_numbers?.Employee_number ||
    (user?.employee_numbers as any)?.Employee_number ||
    '—';

  const details = [
    { icon: 'badge-account-horizontal-outline', label: 'Employee Number', value: String(employeeNumber) },
    { icon: 'email-outline', label: 'Email', value: user?.email ?? '—' },
    { icon: 'shield-account-outline', label: 'Role', value: user?.role ?? '—' },
    { icon: 'office-building-outline', label: 'Department', value: user?.department || '—' },
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.headerSafe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingBody}>
          <ActivityIndicator size="large" color={colors.navy800} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.body}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Photo */}
            <View style={styles.photoCard}>
              <Avatar name={user?.full_name} photo={photoUri ?? user?.profile_photo} size={104} ring />

              <Text style={styles.name} numberOfLines={1}>
                {user?.full_name || 'Unnamed user'}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {user?.role ?? 'User'}
                {user?.department ? ` · ${user.department}` : ''}
              </Text>

              <View style={styles.photoActions}>
                <TouchableOpacity
                  style={styles.photoButton}
                  activeOpacity={0.85}
                  onPress={() => pickPhoto('camera')}
                  disabled={saving}
                >
                  <MaterialCommunityIcons name="camera-outline" size={18} color={colors.navy800} />
                  <Text style={styles.photoButtonText}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.photoButton}
                  activeOpacity={0.85}
                  onPress={() => pickPhoto('library')}
                  disabled={saving}
                >
                  <MaterialCommunityIcons name="image-multiple-outline" size={18} color={colors.navy800} />
                  <Text style={styles.photoButtonText}>Choose File</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.photoHint}>
                {photoUri
                  ? 'New photo selected — press Save Changes to keep it.'
                  : 'Square images look best. JPG or PNG.'}
              </Text>
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons name="alert-circle-outline" size={19} color={colors.danger} />
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            {/* Read-only account details */}
            <Text style={styles.sectionLabel}>Account Details</Text>
            <View style={styles.detailCard}>
              {details.map((row, index) => (
                <View
                  key={row.label}
                  style={[styles.detailRow, index < details.length - 1 && styles.detailDivider]}
                >
                  <View style={styles.detailIcon}>
                    <MaterialCommunityIcons
                      name={row.icon as any}
                      size={18}
                      color={colors.inkMuted}
                    />
                  </View>
                  <View style={styles.detailText}>
                    <Text style={styles.detailLabel}>{row.label}</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {row.value}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="lock-outline" size={15} color={colors.inkFaint} />
                </View>
              ))}
            </View>
            <Text style={styles.noteText}>
              Your name, employee number and department come from your staff record. Ask the Asset
              Management Office to correct those, or your email address.
            </Text>

            {/* Actions */}
            <TouchableOpacity
              style={styles.primaryWrap}
              activeOpacity={0.85}
              onPress={handleSave}
              disabled={!photoUri || saving}
            >
              <LinearGradient
                colors={gradient.gold}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.primaryButton,
                  (!photoUri || saving) && styles.primaryButtonDisabled,
                ]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#3D2E00" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="content-save-outline" size={18} color="#3D2E00" />
                    <Text style={styles.primaryButtonText}>Save Changes</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.8}
              onPress={() => router.back()}
              disabled={saving}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerSafe: {
    flex: 1,
    backgroundColor: colors.navy800,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.navy800,
  },
  backButton: {
    ...button.icon,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerTitle: {
    ...type.screenTitle,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: button.icon.width,
  },
  body: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingBody: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  photoCard: {
    backgroundColor: colors.navy900,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadow.float,
  },
  name: {
    marginTop: spacing.lg,
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  meta: {
    marginTop: 3,
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
  },
  photoActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    width: '100%',
  },
  photoButton: {
    flex: 1,
    ...button.base,
    backgroundColor: colors.surface,
  },
  photoButtonText: {
    ...button.label,
    color: colors.navy800,
    fontSize: 13,
  },
  photoHint: {
    marginTop: spacing.md,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
  },
  sectionLabel: {
    ...type.label,
    color: colors.inkMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginLeft: 2,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...shadow.card,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  detailDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailText: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.inkFaint,
    letterSpacing: 0.4,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 2,
  },
  noteText: {
    ...type.caption,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  primaryWrap: {
    marginTop: spacing.xl,
  },
  primaryButton: {
    ...button.base,
    ...shadow.lifted,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    ...button.label,
    color: '#3D2E00',
  },
  secondaryButton: {
    ...button.base,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    ...button.label,
    color: colors.inkSoft,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  errorBannerText: {
    flex: 1,
    color: colors.dangerInk,
    fontSize: 12.5,
    fontWeight: '500',
  },
});
