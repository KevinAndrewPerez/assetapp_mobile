import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getStoredUser, submitUserRequest } from '@/lib/userService';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';

const requestTypes = ['Repair', 'Pullout', 'Disposal', 'Turn Over', 'Approval', 'Replacement', 'Other'] as const;
type RequestType = typeof requestTypes[number];

export default function SubmitRequest() {
  const router = useRouter();
  const [requestType, setRequestType] = useState<RequestType | ''>('');
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [showTypeOptions, setShowTypeOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!requestType) {
      Alert.alert('Validation error', 'Please select a request type.');
      return;
    }

    const requiresAsset = requestType === 'Repair' || requestType === 'Pullout' || requestType === 'Disposal' || requestType === 'Replacement';
    if (requiresAsset && !assetId.trim()) {
      Alert.alert('Validation error', 'Please scan or enter the asset code for this request type.');
      return;
    }

    if (!reason.trim()) {
      Alert.alert('Validation error', 'Please describe your request.');
      return;
    }

    try {
      setSubmitting(true);
      const user = await getStoredUser();
      if (!user) {
        Alert.alert('Not signed in', 'Please sign in again to submit your request.');
        return;
      }

      let resolvedAssetDbId = '';
      const trimmedAssetId = assetId.trim();
      if (trimmedAssetId) {
        const { data: assetRow, error: assetErr } = await supabase
          .from('assets')
          .select('id, Asset_code, Lifecycle_Status')
          .eq('Asset_code', trimmedAssetId)
          .maybeSingle();

        if (assetErr) {
          Alert.alert('Error', 'Unable to validate asset code. Please try again.');
          return;
        }

        if (!assetRow) {
          Alert.alert('Invalid asset code', 'No asset was found for the entered/scanned code.');
          return;
        }

        resolvedAssetDbId = String(assetRow.id ?? '');
        const status = String(assetRow.Lifecycle_Status ?? '');
        if ((requestType === 'Pullout' || requestType === 'Disposal') && status !== 'Active' && status !== 'Acquired') {
          Alert.alert('Not allowed', `Only Active or Acquired assets can be used for ${requestType} requests. Current status: ${status || 'Unknown'}`);
          return;
        }
      }

      await submitUserRequest(user, requestType, resolvedAssetDbId, reason.trim());
      Alert.alert('Request submitted', 'Your request has been submitted successfully.');
      router.back();
    } catch (error) {
      console.error('Submit request failed:', error);
      Alert.alert('Submission failed', 'Unable to submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTypeSelect = (type: RequestType) => {
    setRequestType(type);
    setShowTypeOptions(false);
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Camera Permission', 'Camera permission is required to scan QR codes.');
        return;
      }
    }
    setScanned(false);
    setScannerVisible(true);
  };

  const handleScanned = (value: string) => {
    if (scanned) return;
    setScanned(true);
    const code = String(value ?? '').trim();
    if (!code) {
      setScanned(false);
      Alert.alert('Invalid QR', 'The scanned QR code is empty.');
      return;
    }
    setAssetId(code);
    setScannerVisible(false);
  };

  const clearAssetId = () => {
    setAssetId('');
  };

  const pickPhoto = async () => {
    const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!res.granted) {
      Alert.alert('Permission required', 'Please allow photo library access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });
    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (uri) setSelectedPhotoUri(uri);
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
            <TouchableOpacity
              style={[styles.inputWrapper, styles.selectInput]}
              activeOpacity={0.8}
              onPress={() => setShowTypeOptions((prev) => !prev)}
            >
              <Text style={[styles.input, !requestType ? styles.placeholderText : null]}>
                {requestType || 'Select request type'}
              </Text>
              <MaterialCommunityIcons name={showTypeOptions ? 'chevron-up' : 'chevron-down'} size={20} color="#94A3B8" />
            </TouchableOpacity>
            {showTypeOptions && (
              <View style={styles.optionsContainer}>
                {requestTypes.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={styles.optionItem}
                    onPress={() => handleTypeSelect(type)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.optionText}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Asset QR Code (Optional)</Text>
            <TouchableOpacity
              style={styles.uploadButton}
              activeOpacity={0.8}
              onPress={openScanner}
            >
              <MaterialCommunityIcons name="qrcode-scan" size={20} color="#FFFFFF" />
              <Text style={styles.uploadButtonText}>Scan with camera</Text>
            </TouchableOpacity>

            <View style={styles.orContainer}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or</Text>
              <View style={styles.orLine} />
            </View>

            <View style={[styles.inputWrapper, styles.assetCodeRow]}>
              <TextInput
                style={styles.input}
                placeholder="Enter asset code manually"
                value={assetId}
                onChangeText={setAssetId}
              />
              {!!assetId.trim() && (
                <TouchableOpacity onPress={clearAssetId} style={styles.clearButton} activeOpacity={0.8}>
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.helperText}>Enter the asset code if you know it, or leave blank for a new request.</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Reason / Notes / Specific Instructions *</Text>
            <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Please describe your concerns, reason for the request, or any specific instructions..."
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                value={reason}
                onChangeText={setReason}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Attach Photo <Text style={styles.optional}>(Optional)</Text></Text>
            <TouchableOpacity
              style={styles.photoUploadArea}
              activeOpacity={0.8}
              onPress={pickPhoto}
            >
              <MaterialCommunityIcons name="upload-outline" size={32} color="#94A3B8" />
              <Text style={styles.photoUploadText}>{selectedPhotoUri ? 'Photo selected' : 'Tap to upload'}</Text>
              <Text style={styles.photoUploadSubtext}>{selectedPhotoUri ? 'Attached to this request' : 'PNG, JPG up to 10MB'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
            <LinearGradient
              colors={['#f4b942', '#f8d082']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitGradient}
            >
              <Text style={styles.submitButtonText}>{submitting ? 'Submitting...' : 'Submit Request'}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.spacer} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              style={styles.scannerClose}
              onPress={() => setScannerVisible(false)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Asset QR</Text>
            <View style={{ width: 42 }} />
          </View>

          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleScanned(String(data ?? ''))}
            />
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>Align the QR code inside the frame</Text>
          </View>
        </SafeAreaView>
      </Modal>
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
  optional: {
    fontWeight: '400',
    color: '#94A3B8',
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
  selectInput: {
    justifyContent: 'space-between',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#1e293b',
  },
  placeholderText: {
    color: '#94A3B8',
  },
  uploadButton: {
    backgroundColor: '#1a3a5c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
    gap: 8,
  },
  uploadButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  assetCodeRow: {
    gap: 10,
  },
  clearButton: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    color: '#1a3a5c',
    fontSize: 12,
    fontWeight: '700',
  },
  orContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    gap: 12,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  orText: {
    fontSize: 12,
    color: '#94A3B8',
    textTransform: 'lowercase',
  },
  helperText: {
    marginTop: 8,
    color: '#64748B',
    fontSize: 12,
  },
  optionsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
    overflow: 'hidden',
  },
  optionItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionText: {
    fontSize: 15,
    color: '#1f2937',
  },
  textAreaWrapper: {
    height: 120,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  textArea: {
    height: '100%',
  },
  photoUploadArea: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  photoUploadText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 12,
    marginBottom: 4,
  },
  photoUploadSubtext: {
    fontSize: 12,
    color: '#94A3B8',
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
    height: 24,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scannerHeader: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
  },
  scannerClose: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  cameraWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  scanHint: {
    marginTop: 18,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
  },
});
