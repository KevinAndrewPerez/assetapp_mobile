import React, { useState } from 'react';
import {
  ActivityIndicator,
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

import { button, colors, gradient, radius, shadow, spacing } from '@/lib/theme';
import { BrandLogo } from '@/components/brand-logo';
import {
  EMAIL_PATTERN,
  NO_ACCOUNT_MESSAGE,
  PASSWORD_RULES,
  completePasswordReset,
  findAccountByEmail,
  openWebPasswordReset,
  sendResetCode,
  verifyResetCode,
} from '@/lib/passwordResetService';

type Step = 'email' | 'code' | 'password';

/**
 * Forgot Password — mirror of the web flow: confirm the address, receive a
 * single-use 6-digit code, then set a new password. The code is generated and
 * mailed by the NU TRACE website (it holds the mail credentials) and verified
 * here against the shared `password_resets` row.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const allRulesMet = PASSWORD_RULES.every((rule) => rule.test(password));
  const passwordsMatch = password.length > 0 && password === confirm;

  const handleSendCode = async () => {
    const address = email.trim();
    setError('');
    setNotice('');

    if (!address) {
      setError('Please enter the email address you registered with.');
      return;
    }
    if (!EMAIL_PATTERN.test(address)) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      // Same gate the web applies before it sends anything.
      const account = await findAccountByEmail(address);
      if (!account) {
        setError(NO_ACCOUNT_MESSAGE);
        return;
      }

      await sendResetCode(account.email);
      setEmail(account.email);
      setCode('');
      setStep('code');
      setNotice(`A 6-digit verification code has been sent to ${account.email}. It expires in 15 minutes.`);
    } catch (err: any) {
      setError(String(err?.message ?? 'Could not send the verification code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setNotice('');
    await handleSendCode();
  };

  const handleVerify = async () => {
    setError('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }

    setBusy(true);
    try {
      await verifyResetCode(email, code.trim());
      setNotice('');
      setStep('password');
    } catch (err: any) {
      setError(String(err?.message ?? 'Could not verify the code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setError('');
    if (!allRulesMet) {
      setError('Your password does not meet all the requirements below.');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await completePasswordReset(email, code.trim(), password, confirm);
      setNotice('');
      setStep('email');
      // Send them back to sign in with the new password.
      router.replace('/login' as any);
    } catch (err: any) {
      setError(String(err?.message ?? 'Password reset failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const openWebsite = async () => {
    try {
      await openWebPasswordReset();
    } catch {
      setError('Could not open the NU TRACE website on this device.');
    }
  };

  const headerTitle =
    step === 'email' ? 'Forgot Password?' : step === 'code' ? 'Check Your Email' : 'Create a New Password';

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
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()} activeOpacity={0.7}>
            <MaterialCommunityIcons name="arrow-left" size={18} color={colors.navy800} />
            <Text style={styles.backLinkText}>Back to Login</Text>
          </TouchableOpacity>

          <View style={styles.headerContainer}>
            {/* Shared brand mark (same artwork as the app icon). */}
            <BrandLogo size={64} style={styles.brandMark} />
            <Text style={styles.title}>{headerTitle}</Text>
            <Text style={styles.subtitle}>
              {step === 'email'
                ? 'Enter the email address you used to register and we will send you a one-time 6-digit verification code.'
                : step === 'code'
                  ? `We sent a 6-digit code to ${email}. Enter it below to continue.`
                  : `Choose a new password for ${email}.`}
            </Text>
          </View>

          <View style={styles.formContainer}>
            {error ? (
              <View style={styles.errorBanner}>
                <MaterialCommunityIcons name="alert-circle-outline" size={19} color={colors.danger} />
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            {notice && !error ? (
              <View style={styles.noticeBanner}>
                <MaterialCommunityIcons name="information-outline" size={19} color={colors.infoInk} />
                <Text style={styles.noticeBannerText}>{notice}</Text>
              </View>
            ) : null}

            {step === 'email' ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>University Email</Text>
                  <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
                    <MaterialCommunityIcons
                      name="email-outline"
                      size={19}
                      color={error ? colors.danger : colors.inkFaint}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="you@nu-lipa.edu.ph"
                      placeholderTextColor="rgba(30,41,59,0.45)"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={email}
                      onChangeText={(text) => {
                        setEmail(text);
                        if (error) setError('');
                      }}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.primaryWrap}
                  activeOpacity={0.85}
                  onPress={handleSendCode}
                  disabled={busy}
                >
                  <LinearGradient
                    colors={gradient.gold}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#3D2E00" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="send-outline" size={18} color="#3D2E00" />
                        <Text style={styles.primaryButtonText}>Send Verification Code</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            ) : null}

            {step === 'code' ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Verification Code</Text>
                  <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
                    <MaterialCommunityIcons
                      name="shield-key-outline"
                      size={19}
                      color={error ? colors.danger : colors.inkFaint}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, styles.codeInput]}
                      placeholder="••••••"
                      placeholderTextColor="rgba(30,41,59,0.4)"
                      keyboardType="number-pad"
                      maxLength={6}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={code}
                      onChangeText={(text) => {
                        setCode(text.replace(/\D/g, '').slice(0, 6));
                        if (error) setError('');
                      }}
                    />
                  </View>
                  <Text style={styles.hintText}>
                    The code is valid for 15 minutes and can only be used once.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.primaryWrap}
                  activeOpacity={0.85}
                  onPress={handleVerify}
                  disabled={busy}
                >
                  <LinearGradient
                    colors={gradient.gold}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#3D2E00" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="check-decagram-outline" size={18} color="#3D2E00" />
                        <Text style={styles.primaryButtonText}>Verify Code</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <View style={styles.inlineActions}>
                  <TouchableOpacity onPress={handleResend} disabled={busy} activeOpacity={0.7}>
                    <Text style={styles.linkText}>Resend code</Text>
                  </TouchableOpacity>
                  <Text style={styles.linkDivider}>•</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setStep('email');
                      setCode('');
                      setError('');
                      setNotice('');
                    }}
                    disabled={busy}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.linkText}>Use a different email</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {step === 'password' ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>New Password</Text>
                  <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
                    <MaterialCommunityIcons
                      name="lock-outline"
                      size={19}
                      color={error ? colors.danger : colors.inkFaint}
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
                        if (error) setError('');
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
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Confirm Password</Text>
                  <View
                    style={[
                      styles.inputWrapper,
                      !passwordsMatch && confirm.length > 0 ? styles.inputError : null,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="lock-check-outline"
                      size={19}
                      color={!passwordsMatch && confirm.length > 0 ? colors.danger : colors.inkFaint}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Re-enter your new password"
                      placeholderTextColor="rgba(30,41,59,0.45)"
                      secureTextEntry={!showConfirm}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={confirm}
                      onChangeText={setConfirm}
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
                  {!passwordsMatch && confirm.length > 0 ? (
                    <Text style={styles.fieldErrorText}>Passwords do not match.</Text>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.primaryWrap}
                  activeOpacity={0.85}
                  onPress={handleReset}
                  disabled={busy}
                >
                  <LinearGradient
                    colors={gradient.gold}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#3D2E00" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="content-save-check-outline" size={18} color="#3D2E00" />
                        <Text style={styles.primaryButtonText}>Update Password</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            ) : null}

            {/* The website can always finish the job if a code never arrives. */}
            <TouchableOpacity style={styles.websiteButton} onPress={openWebsite} activeOpacity={0.8}>
              <MaterialCommunityIcons name="open-in-new" size={16} color={colors.inkMuted} />
              <Text style={styles.websiteButtonText}>Open the NU TRACE website instead</Text>
            </TouchableOpacity>
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
    backgroundColor: colors.surface,
  },
  wrapper: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingVertical: spacing.xl,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginLeft: spacing.xl,
    marginBottom: spacing.lg,
  },
  backLinkText: {
    color: colors.navy800,
    fontSize: 13.5,
    fontWeight: '700',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  brandMark: {
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.navy800,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.inkMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  formContainer: {
    paddingHorizontal: spacing.xl,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  label: {
    color: '#364153',
    fontSize: 12.5,
    fontWeight: '600',
    marginBottom: 7,
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
  codeInput: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 8,
  },
  eyeIcon: {
    marginLeft: 10,
  },
  hintText: {
    color: colors.inkFaint,
    fontSize: 11.5,
    marginTop: 6,
  },
  fieldErrorText: {
    color: colors.danger,
    fontSize: 11.5,
    marginTop: 5,
    marginLeft: 2,
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
  ruleTextMet: {
    color: colors.successInk,
    fontWeight: '600',
  },
  primaryWrap: {
    marginBottom: spacing.lg,
  },
  primaryButton: {
    ...button.base,
    ...shadow.lifted,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    ...button.label,
    color: '#3D2E00',
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: spacing.lg,
  },
  linkText: {
    color: colors.gold600,
    fontSize: 13,
    fontWeight: '700',
  },
  linkDivider: {
    color: colors.inkFaint,
    fontSize: 13,
  },
  websiteButton: {
    ...button.compact,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'stretch',
  },
  websiteButtonText: {
    ...button.compactLabel,
    color: colors.inkMuted,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  errorBannerText: {
    color: colors.dangerInk,
    fontSize: 12.5,
    fontWeight: '500',
    flex: 1,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.infoBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  noticeBannerText: {
    color: colors.infoInk,
    fontSize: 12.5,
    fontWeight: '600',
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: spacing.xl,
  },
  footerText: {
    color: colors.inkFaint,
    fontSize: 10.5,
  },
});
