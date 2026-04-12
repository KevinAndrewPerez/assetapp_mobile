import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.wrapper}
      >
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoBadge}>NU</Text>
          </View>
          <Text style={styles.title}>NULipa ALMS</Text>
          <Text style={styles.subtitle}>Asset Lifecycle Management System</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sign in to your account</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputRow}>
              <MaterialIcons name="email" size={20} color="#6B7280" />
              <TextInput
                style={styles.input}
                placeholder="Email Address"
                placeholderTextColor="#9CA3AF"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <MaterialIcons name="lock" size={20} color="#6B7280" />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>
          </View>

          <View style={styles.actionsRow}>
            <View style={styles.checkboxPlaceholder} />
            <Text style={styles.actionText}>Remember me</Text>
            <Text style={[styles.actionText, styles.forgotText]}>Forgot password?</Text>
          </View>

          <TouchableOpacity style={styles.button} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>

          <View style={styles.bottomRow}>
            <Text style={styles.bottomText}>Don't have an account?</Text>
            <Text style={styles.registerText}>Register</Text>
          </View>
        </View>

        <View style={styles.demoCard}>
          <Text style={styles.demoTitle}>Demo Credentials</Text>
          <View style={styles.demoRow}>
            <Text style={styles.demoRole}>Admin / ITSO</Text>
            <Text style={styles.demoLabel}>Email: alex.reyes@nulipa.edu.ph</Text>
            <Text style={styles.demoLabel}>Password: Admin@2026</Text>
          </View>
          <View style={styles.demoRow}>
            <Text style={styles.demoRole}>Unit Head</Text>
            <Text style={styles.demoLabel}>Email: maria.santos@nulipa.edu.ph</Text>
            <Text style={styles.demoLabel}>Password: UHead@2026</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  wrapper: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  logoBadge: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '700',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: '#475569',
    fontSize: 14,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  input: {
    flex: 1,
    marginLeft: 10,
    color: '#0F172A',
    fontSize: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  checkboxPlaceholder: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFF',
  },
  actionText: {
    color: '#64748B',
    fontSize: 13,
  },
  forgotText: {
    color: '#1D4ED8',
  },
  button: {
    backgroundColor: '#F59E0B',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginBottom: 16,
  },
  buttonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 16,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  bottomText: {
    color: '#64748B',
    fontSize: 13,
  },
  registerText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  demoCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 18,
  },
  demoTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 12,
  },
  demoRow: {
    marginBottom: 12,
  },
  demoRole: {
    color: '#F8FAFC',
    fontWeight: '700',
    marginBottom: 6,
  },
  demoLabel: {
    color: '#CBD5E1',
    fontSize: 13,
  },
});