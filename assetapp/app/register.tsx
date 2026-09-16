import { useState, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { registerUser, fetchDepartments } from '../lib/userService';

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [unitHeadsNumber, setUnitHeadsNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setDepartments] = useState<any[]>([]);

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const data = await fetchDepartments();
        setDepartments(data || []);
      } catch (error) {
        console.error('Failed to load departments:', error);
      }
    };
    loadDepartments();
  }, []);

  const handleRegister = async () => {
    if (!fullName || !email || !departmentId || !unitHeadsNumber || !password) {
      Alert.alert('Missing Information', 'Please fill out all fields.');
      return;
    }

    setLoading(true);
    try {
      await registerUser({
        fullName,
        email,
        departmentId,
        unitHeadsNumber,
        password,
        role: 'Employee'
      });
      
      Alert.alert('Success', 'Your account has been created. Please log in.', [
        { text: 'OK', onPress: () => router.replace('/login') }
      ]);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message || 'Unable to create account.');
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
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.headerContainer}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Register to access NU TRACE</Text>
          </View>

          {/* Form Container */}
          <View style={styles.formContainer}>
            {/* Full Name Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="person-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Juan Dela Cruz"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  value={fullName}
                  onChangeText={setFullName}
                />
              </View>
            </View>

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="mail-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="juan.delacruz@nu.edu.ph"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>
            </View>

            {/* Department Picker (Simplified as Input for now but using ID) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Department ID (Refer to database)</Text>
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons name="office-building-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 1"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  keyboardType="numeric"
                  value={departmentId}
                  onChangeText={setDepartmentId}
                />
              </View>
            </View>

            {/* Unit Head Number Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Unit Head Number</Text>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="phone" size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="09XXXXXXXXX"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  keyboardType="phone-pad"
                  value={unitHeadsNumber}
                  onChangeText={setUnitHeadsNumber}
                />
              </View>
            </View>

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="lock-outline" size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Create a strong password"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#64748B" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Register Button */}
            <TouchableOpacity 
              onPress={handleRegister} 
              activeOpacity={0.8} 
              style={styles.registerButtonContainer}
              disabled={loading}
            >
              <LinearGradient
                colors={['#FDB833', '#f5bc48', '#f5be4e', '#f6c154', '#f6c35a', '#f7c65f', '#f7c864', '#f8cb69', '#f8cd6e']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.registerButton, loading && { opacity: 0.7 }]}
              >
                {loading ? (
                  <ActivityIndicator color="#1E3A5F" />
                ) : (
                  <Text style={styles.registerButtonText}>Register</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Login Link */}
            <View style={styles.loginContainer}>
              <Text style={styles.loginText}>Already have an account?</Text>
              <TouchableOpacity onPress={() => router.push('/login' as any)}>
                <Text style={styles.loginLink}>Login</Text>
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
    marginTop: 20,
  },
  title: {
    color: '#1E3A5F',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
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
    backgroundColor: '#F4F7FB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 48,
  },
  inputIcon: {
    marginRight: 10.5,
  },
  input: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    height: '100%',
  },
  eyeIcon: {
    marginLeft: 10,
  },
  registerButtonContainer: {
    marginTop: 12,
  },
  registerButton: {
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 21,
    shadowColor: '#F0A925',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  registerButtonText: {
    color: '#3D2E00',
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  loginText: {
    color: '#64748B',
    fontSize: 13,
  },
  loginLink: {
    color: '#FDB833',
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
});
