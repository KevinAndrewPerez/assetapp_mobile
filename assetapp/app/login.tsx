import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [unitHeadsNumber, setUnitHeadsNumber] = useState('');
  const [emailError, setEmailError] = useState('');
  const [unitHeadsError, setUnitHeadsError] = useState('');
  const [generalError, setGeneralError] = useState('');

  const clearErrors = () => {
    setEmailError('');
    setUnitHeadsError('');
    setGeneralError('');
  };

  const handleLogin = async () => {
    clearErrors();

    if (!email || !unitHeadsNumber) {
      if (!email) setEmailError('Email is required');
      if (!unitHeadsNumber) setUnitHeadsError('Unit Heads Number is required');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('unit_heads_number', unitHeadsNumber)
        .single();

      if (error || !data) {
        setGeneralError('Invalid email or unit heads number');
        return;
      }

      const user = data;

      await AsyncStorage.setItem('user', JSON.stringify(user));

      if (user.role === 'AssetOfficer') {
        router.replace('/(tabs)');
      } else if (user.role === 'Employee') {
        router.replace('/(user-tabs)' as any);
      } else {
        setGeneralError('Unauthorized role');
      }
    } catch (err) {
      setGeneralError('Login failed. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.wrapper}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.headerContainer}>
            <LinearGradient
              colors={['#1a3a5c', 'rgba(26, 58, 92, 0.8)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoContainer}
            >
              <View style={styles.logoBorder}>
                <View style={styles.logoContent} />
              </View>
            </LinearGradient>

            <Text style={styles.title}>Welcome to NU TRACE</Text>
            <Text style={styles.subtitle}>Sign in to manage your assets</Text>
          </View>

          {/* Form Container */}
          <View style={styles.formContainer}>
            {/* Error Message */}
            {generalError ? (
              <View style={styles.errorBanner}>
                <MaterialIcons name="error-outline" size={20} color="#DC2626" />
                <Text style={styles.errorBannerText}>{generalError}</Text>
              </View>
            ) : null}

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={[styles.inputWrapper, emailError ? styles.inputError : null]}>
                <MaterialIcons name="email" size={18} color={emailError ? "#DC2626" : "#9CA3AF"} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, emailError ? styles.inputTextError : null]}
                  placeholder="your.email@nu.edu.ph"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (emailError) setEmailError('');
                  }}
                />
              </View>
              {emailError ? (
                <Text style={styles.fieldErrorText}>{emailError}</Text>
              ) : null}
            </View>

            {/* Unit Heads Number Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Unit Heads Number</Text>
              <View style={[styles.inputWrapper, unitHeadsError ? styles.inputError : null]}>
                <MaterialIcons name="badge" size={18} color={unitHeadsError ? "#DC2626" : "#9CA3AF"} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, unitHeadsError ? styles.inputTextError : null]}
                  placeholder="Enter your unit heads number"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  value={unitHeadsNumber}
                  onChangeText={(text) => {
                    setUnitHeadsNumber(text);
                    if (unitHeadsError) setUnitHeadsError('');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {unitHeadsError ? (
                <Text style={styles.fieldErrorText}>{unitHeadsError}</Text>
              ) : null}
            </View>



            {/* Login Button */}
            <TouchableOpacity onPress={handleLogin} activeOpacity={0.8}>
              <LinearGradient
                colors={['#f4b942', '#f5bc48', '#f5be4e', '#f6c154', '#f6c35a', '#f7c65f', '#f7c864', '#f8cb69', '#f8cd6e']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginButton}
              >
                <Text style={styles.loginButtonText}>Login</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Register Link */}
            <View style={styles.registerContainer}>
              <Text style={styles.registerText}>Don&apos;t have an account?</Text>
              <TouchableOpacity onPress={() => router.push('/register' as any)}>
                <Text style={styles.registerLink}>Register</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Footer */}
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
    marginBottom: 32,
  },
  logoContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  logoBorder: {
    width: 35,
    height: 35,
    borderRadius: 10.5,
    borderWidth: 2.909,
    borderColor: '#f4b942',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContent: {
    width: 0,
    height: 0,
  },
  title: {
    color: '#1a3a5c',
    fontSize: 21,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#4a5565',
    fontSize: 12.25,
    textAlign: 'center',
  },
  formContainer: {
    paddingHorizontal: 21,
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 21,
  },
  label: {
    color: '#364153',
    fontSize: 12.25,
    fontWeight: '500',
    marginBottom: 7,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 14.5,
    borderWidth: 0.727,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    height: 43.455,
  },
  inputIcon: {
    marginRight: 10.5,
  },
  input: {
    flex: 1,
    color: '#1e293b',
    fontSize: 14,
  },
  eyeIcon: {
    marginLeft: 10,
  },
  forgotContainer: {
    alignItems: 'flex-end',
    marginBottom: 21,
  },
  forgotText: {
    color: '#6a7282',
    fontSize: 12.25,
    fontWeight: '500',
  },
  loginButton: {
    borderRadius: 24403200,
    alignItems: 'center',
    justifyContent: 'center',
    height: 45.5,
    marginBottom: 21,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  loginButtonText: {
    color: '#1a3a5c',
    fontSize: 14,
    fontWeight: '600',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  registerText: {
    color: '#4a5565',
    fontSize: 12.25,
  },
  registerLink: {
    color: '#f4b942',
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 21,
    borderTopWidth: 0.727,
    borderTopColor: '#e5e7eb',
  },
  footerText: {
    color: '#99a1af',
    fontSize: 10.5,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  inputError: {
    borderColor: '#DC2626',
    borderWidth: 1,
  },
  inputTextError: {
    color: '#DC2626',
  },
  fieldErrorText: {
    color: '#DC2626',
    fontSize: 11,
    marginTop: 4,
    marginLeft: 2,
  },
});