import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = () => {
    // Simple validation
    if (fullName && email && department && role && password) {
      // For now, just navigate back to login or to the app
      router.replace('/login');
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
                <MaterialIcons name="person-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
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
                <MaterialIcons name="mail-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
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

            {/* Department Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Department</Text>
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons name="office-building-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Select Department"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  value={department}
                  onChangeText={setDepartment}
                />
              </View>
            </View>

            {/* Role Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Role</Text>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="account-circle" size={18} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Select Role"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  value={role}
                  onChangeText={setRole}
                />
              </View>
            </View>

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="lock-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Create a strong password"
                  placeholderTextColor="#rgba(30,41,59,0.5)"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#6B7280" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Register Button */}
            <TouchableOpacity onPress={handleRegister} activeOpacity={0.8} style={styles.registerButtonContainer}>
              <LinearGradient
                colors={['#f4b942', '#f5bc48', '#f5be4e', '#f6c154', '#f6c35a', '#f7c65f', '#f7c864', '#f8cb69', '#f8cd6e']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.registerButton}
              >
                <Text style={styles.registerButtonText}>Register</Text>
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
    height: '100%',
  },
  eyeIcon: {
    marginLeft: 10,
  },
  registerButtonContainer: {
    marginTop: 12,
  },
  registerButton: {
    borderRadius: 24403200,
    height: 45.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 21,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  registerButtonText: {
    color: '#1a3a5c',
    fontSize: 14,
    fontWeight: '600',
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  loginText: {
    color: '#4a5565',
    fontSize: 12.25,
  },
  loginLink: {
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
});
