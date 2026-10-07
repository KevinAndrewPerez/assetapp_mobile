import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { colors, radius, shadow } from '../lib/theme';
import { BrandLogo } from '../components/brand-logo';
import {
  EMPLOYEE_INACTIVE_MESSAGE,
  EMPLOYEE_NOT_FOUND_MESSAGE,
  EmployeeLookup,
  isEmployeeEligible,
  lookupEmployeeByNumber,
  registerUser,
  uploadProfilePhoto,
} from '../lib/userService';
import { describeUploadError, type MediaAsset } from '../lib/mediaUpload';
import {
  PASSWORD_IDENTITY_MESSAGE,
  passwordIsBasedOnIdentity,
} from '../lib/passwordResetService';

/**
 * The five requirements the web register form lists under the password field.
 * They are checked live, and all of them must pass before Sign Up is allowed.
 */
const PASSWORD_RULES: { key: string; label: string; test: (value: string) => boolean }[] = [
  { key: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { key: 'lower', label: 'A lowercase letter (a-z)', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', label: 'An uppercase letter (A-Z)', test: (v) => /[A-Z]/.test(v) },
  { key: 'number', label: 'A number (0-9)', test: (v) => /\d/.test(v) },
  { key: 'symbol', label: 'A symbol such as ! @ # $ %', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const router = useRouter();

  // Employee number -> name + department are resolved from `employee_numbers`,
  // exactly like the web form (the applicant never types their own name).
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [employee, setEmployee] = useState<EmployeeLookup | null>(null);
  const [employeeError, setEmployeeError] = useState('');
  const [checkingEmployee, setCheckingEmployee] = useState(false);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  // The full picker asset: its base64 bytes are what make the upload work even
  // when Android hands back a `content://` URI the file system cannot read.
  const [photoUri, setPhotoUri] = useState<MediaAsset | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  const allPasswordRulesMet = PASSWORD_RULES.every((rule) => rule.test(password));
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  // New on the web in the latest update: the password must not be built out of
  // the person's own details (name words, email address, employee number).
  const passwordUsesIdentity = passwordIsBasedOnIdentity(password, [
    employee?.fullName,
    email,
    employee?.employeeNumber ?? employeeNumber,
  ]);

  const handleEmployeeChange = (value: string) => {
    setEmployeeNumber(value);
    // Any edit invalidates the previous lookup.
    setEmployee(null);
    setEmployeeError('');
    if (generalError) setGeneralError('');
  };

  const verifyEmployee = async (): Promise<EmployeeLookup | null> => {
    const typed = employeeNumber.trim();
    if (!typed) {
      setEmployee(null);
      setEmployeeError('Employee number is required.');
      return null;
    }

    setCheckingEmployee(true);
    try {
      const found = await lookupEmployeeByNumber(typed);

      // The number must be on file AND its employee record active: that is what
      // keeps accounts limited to NU Lipa staff.
      if (found && !isEmployeeEligible(found)) {
        setEmployee(null);
        setEmployeeError(EMPLOYEE_INACTIVE_MESSAGE);
        return null;
      }

      setEmployee(found);
      setEmployeeError(found ? '' : EMPLOYEE_NOT_FOUND_MESSAGE);
      return found;
    } catch {
      setEmployee(null);
      setEmployeeError('Could not verify the employee number. Please try again.');
      return null;
    } finally {
      setCheckingEmployee(false);
    }
  };

  const choosePhoto = async (source: 'camera' | 'library') => {
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
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled) setPhotoUri(result.assets[0]);
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
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled) setPhotoUri(result.assets[0]);
  };

  const handlePhotoPress = () => {
    Alert.alert('Profile Photo', 'Choose a photo from your files or take one with the camera.', [
      { text: 'Take Photo', onPress: () => choosePhoto('camera') },
      { text: 'Choose File', onPress: () => choosePhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleRegister = async () => {
    setGeneralError('');
    setEmailError('');
    setPasswordError('');

    // 1. Employee number must resolve to a real employee record.
    const resolved = employee ?? (await verifyEmployee());
    if (!resolved) return;

    // 2. Email
    if (!email.trim()) {
      setEmailError('Email is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      return;
    }

    // 3. Profile photo (marked required on the web form).
    if (!photoUri) {
      Alert.alert('Profile Photo Required', 'Please add a profile photo before signing up.');
      return;
    }

    // 4. Password + confirmation
    if (!allPasswordRulesMet) {
      setPasswordError('Your password does not meet all the requirements below.');
      return;
    }
    if (passwordUsesIdentity) {
      setPasswordError(PASSWORD_IDENTITY_MESSAGE);
      return;
    }
    if (!passwordsMatch) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // The photo is stored before the account exists: a photo that never
      // reached Storage is reported as an upload problem, not as a signup
      // failure, and the account still gets created below.
      let photoUrl = '';
      try {
        photoUrl = await uploadProfilePhoto(photoUri);
      } catch (uploadErr) {
        console.warn('Profile photo upload failed:', uploadErr);
        setGeneralError(`Signing up without a profile photo — ${describeUploadError(uploadErr)}`);
      }

      const created = await registerUser({
        employeeNumber: resolved.employeeNumber,
        email: email.trim(),
        password,
        profilePhotoUrl: photoUrl || null,
      });

      Alert.alert(
        'Registration Successful',
        `Welcome, ${created.fullName || email.trim()}. You are registered as ${created.role}. Please log in.`,
        [{ text: 'OK', onPress: () => router.replace('/login' as any) }],
      );
    } catch (error: any) {
      const message = String(error?.message ?? 'Unable to create your account.');
      setGeneralError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.wrapper}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerContainer}>
            {/* Shared brand mark (same artwork as the app icon). */}
            <BrandLogo size={64} style={styles.brandMark} />
            <Text style={styles.title}>Activate Your Account</Text>
            <Text style={styles.subtitle}>Register to access NU TRACE</Text>
          </View>

          <View style={styles.formContainer}>
            {generalError ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons name="alert-circle-outline" size={19} color={colors.danger} />
                <Text style={styles.errorBannerText}>{generalError}</Text>
              </View>
            ) : null}

            {/* Employee Number — resolves the employee's name + department */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Employee Number <Text style={styles.required}>*</Text>
              </Text>
              <View style={[styles.inputWrapper, employeeError ? styles.inputError : null]}>
                <MaterialCommunityIcons
                  name="badge-account-horizontal-outline"
                  size={19}
                  color={employeeError ? colors.danger : colors.inkFaint}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your employee number"
                  placeholderTextColor="rgba(30,41,59,0.45)"
                  value={employeeNumber}
                  onChangeText={handleEmployeeChange}
                  onBlur={verifyEmployee}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                />
                {checkingEmployee ? <ActivityIndicator size="small" color={colors.inkFaint} /> : null}
              </View>
              {employeeError ? <Text style={styles.fieldErrorText}>{employeeError}</Text> : null}

              {employee ? (
                <View style={styles.verifiedCard}>
                  <View style={styles.verifiedIcon}>
                    <MaterialCommunityIcons name="check" size={15} color={colors.successInk} />
                  </View>
                  <View style={styles.verifiedText}>
                    <Text style={styles.verifiedName} numberOfLines={1}>
                      {employee.fullName || 'Unnamed employee'}
                    </Text>
                    <Text style={styles.verifiedMeta} numberOfLines={1}>
                      {employee.departmentName || 'No department'} · {employee.employeeNumber}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Email <Text style={styles.required}>*</Text>
              </Text>
              <View style={[styles.inputWrapper, emailError ? styles.inputError : null]}>
                <MaterialCommunityIcons
                  name="email-outline"
                  size={19}
                  color={emailError ? colors.danger : colors.inkFaint}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="juan.delacruz@nu.edu.ph"
                  placeholderTextColor="rgba(30,41,59,0.45)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (emailError) setEmailError('');
                  }}
                />
              </View>
              {emailError ? <Text style={styles.fieldErrorText}>{emailError}</Text> : null}
            </View>

            {/* Profile photo */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Profile Photo <Text style={styles.required}>*</Text>
              </Text>
              <TouchableOpacity
                style={styles.photoPicker}
                activeOpacity={0.85}
                onPress={handlePhotoPress}
                disabled={loading}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri.uri }} style={styles.photoPreview} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <MaterialCommunityIcons name="camera-plus-outline" size={21} color={colors.inkFaint} />
                  </View>
                )}
                <View style={styles.photoTextWrap}>
                  <Text style={styles.photoTitle} numberOfLines={1}>
                    {photoUri ? 'Photo selected' : 'Add a profile photo'}
                  </Text>
                  <Text style={styles.photoHint} numberOfLines={1}>
                    {photoUri ? 'Tap to change or retake' : 'Choose a file or take a picture'}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.inkFaint} />
              </TouchableOpacity>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Password <Text style={styles.required}>*</Text>
              </Text>
              <View style={[styles.inputWrapper, passwordError ? styles.inputError : null]}>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={19}
                  color={passwordError ? colors.danger : colors.inkFaint}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Create a strong password"
                  placeholderTextColor="rgba(30,41,59,0.45)"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (passwordError) setPasswordError('');
                  }}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((value) => !value)}
                  style={styles.eyeIcon}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={19}
                    color={colors.inkMuted}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.rulesWrap}>
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password);
                  return (
                    <View key={rule.key} style={styles.ruleRow}>
                      <MaterialCommunityIcons
                        name={met ? 'check-circle' : 'checkbox-blank-circle-outline'}
                        size={14}
                        color={met ? colors.success : colors.inkFaint}
                      />
                      <Text style={[styles.ruleText, met && styles.ruleTextMet]}>{rule.label}</Text>
                    </View>
                  );
                })}
                {passwordUsesIdentity ? (
                  <View style={styles.ruleRow}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.danger} />
                    <Text style={[styles.ruleText, styles.ruleTextViolated]}>{PASSWORD_IDENTITY_MESSAGE}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Confirm password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Confirm Password <Text style={styles.required}>*</Text>
              </Text>
              <View style={[styles.inputWrapper, !passwordsMatch && confirmPassword.length > 0 ? styles.inputError : null]}>
                <MaterialCommunityIcons
                  name="lock-check-outline"
                  size={19}
                  color={!passwordsMatch && confirmPassword.length > 0 ? colors.danger : colors.inkFaint}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Re-type your password"
                  placeholderTextColor="rgba(30,41,59,0.45)"
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirm((value) => !value)}
                  style={styles.eyeIcon}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialCommunityIcons
                    name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                    size={19}
                    color={colors.inkMuted}
                  />
                </TouchableOpacity>
              </View>
              {!passwordsMatch && confirmPassword.length > 0 ? (
                <Text style={styles.fieldErrorText}>Passwords do not match.</Text>
              ) : null}
              {passwordError ? <Text style={styles.fieldErrorText}>{passwordError}</Text> : null}
            </View>

            {/* Sign Up / Back */}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.primaryButtonWrap}
                activeOpacity={0.85}
                onPress={handleRegister}
                disabled={loading}
              >
                <LinearGradient
                  colors={['#FDB833', '#F0A925']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.primaryButton, loading && styles.buttonDisabled]}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#3D2E00" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sign Up</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.8}
                onPress={() => router.back()}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.loginContainer}>
              <Text style={styles.loginText}>Already registered?</Text>
              <TouchableOpacity onPress={() => router.push('/login' as any)}>
                <Text style={styles.loginLink}>Login</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>National University — Lipa</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  wrapper: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingVertical: 24,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 26,
    marginTop: 6,
  },
  brandMark: {
    marginBottom: 16,
  },
  title: {
    color: colors.navy800,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  subtitle: {
    color: colors.inkMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  formContainer: {
    paddingHorizontal: 21,
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 19,
  },
  label: {
    color: '#364153',
    fontSize: 12.5,
    fontWeight: '600',
    marginBottom: 7,
  },
  required: {
    color: colors.gold600,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 50,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: colors.ink,
    fontSize: 14.5,
  },
  eyeIcon: {
    marginLeft: 10,
  },
  fieldErrorText: {
    color: colors.danger,
    fontSize: 11.5,
    marginTop: 5,
    marginLeft: 2,
  },
  verifiedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    backgroundColor: colors.successBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#C7F0DE',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  verifiedIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedText: {
    flex: 1,
  },
  verifiedName: {
    color: colors.successInk,
    fontSize: 13.5,
    fontWeight: '700',
  },
  verifiedMeta: {
    color: '#0F766E',
    fontSize: 11.5,
    marginTop: 1,
  },
  photoPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  photoPreview: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surfaceSunken,
  },
  photoPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTextWrap: {
    flex: 1,
  },
  photoTitle: {
    color: colors.ink,
    fontSize: 13.5,
    fontWeight: '600',
  },
  photoHint: {
    color: colors.inkMuted,
    fontSize: 11.5,
    marginTop: 1,
  },
  rulesWrap: {
    marginTop: 10,
    gap: 6,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  ruleText: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  ruleTextViolated: {
    color: '#B91C1C',
    flexShrink: 1,
  },
  ruleTextMet: {
    color: colors.successInk,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    marginBottom: 18,
  },
  primaryButtonWrap: {
    flex: 1,
  },
  primaryButton: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    ...shadow.lifted,
  },
  primaryButtonText: {
    color: '#3D2E00',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: '700',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
  },
  loginText: {
    color: colors.inkMuted,
    fontSize: 12.5,
  },
  loginLink: {
    color: colors.gold600,
    fontSize: 13.5,
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    color: colors.dangerInk,
    fontSize: 12.5,
    fontWeight: '500',
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 21,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  footerText: {
    color: colors.inkFaint,
    fontSize: 10.5,
  },
});
