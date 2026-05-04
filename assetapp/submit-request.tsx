import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getStoredUser, submitUserRequest } from '@/lib/userService';

export default function SubmitRequest() {
  const router = useRouter();
  const [requestType, setRequestType] = useState('');
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!requestType.trim() || !reason.trim()) {
      setError('Request type and reason are required.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const user = await getStoredUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      await submitUserRequest(user, requestType.trim(), assetId.trim(), reason.trim());
      router.replace('/(user-tabs)/my-requests');
    } catch (submitError) {
      console.error('Request submission failed:', submitError);
      setError('Unable to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1a3a5c" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Submit Request</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Request Type *</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter request type"
                value={requestType}
                onChangeText={setRequestType}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Asset QR Code</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter asset ID or code"
                value={assetId}
                onChangeText={setAssetId}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Reason / Notes / Specific Instructions *</Text>
            <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Please describe your concerns, reason for the request..."
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                value={reason}
                onChangeText={setReason}
              />
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={isSubmitting}>
            <LinearGradient
              colors={['#f4b942', '#f8d082']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitGradient}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#1a3a5c" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Request</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.spacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a3a5c',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#1e293b',
  },
  textAreaWrapper: {
    height: 120,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  textArea: {
    height: '100%',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: 12,
  },
  submitButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: '#f4b942',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitGradient: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a3a5c',
  },
  spacer: {
    height: 40,
  },
});
