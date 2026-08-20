import React, { useEffect, useState } from 'react';
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { getStoredUser, submitUserRequest } from '@/lib/userService';
import { supabase } from '@/lib/supabase';

const priorityOptions = ['Low - Can wait', 'Medium - Should be addressed soon', 'High - Urgent', 'Critical - Immediate action'] as const;

export default function SubmitRequest() {
  const router = useRouter();
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('');
  const [requestorName, setRequestorName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);
  const [showPriorityOptions, setShowPriorityOptions] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      const user = await getStoredUser();
      if (user?.full_name) {
        setRequestorName(user.full_name);
      }
    };
    loadUser();
  }, []);

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

  const handleSubmit = async () => {
    if (!assetId.trim()) {
      Alert.alert('Validation error', 'Please scan the asset QR code before creating the repair request.');
      return;
    }

    if (!reason.trim()) {
      Alert.alert('Validation error', 'Please describe the issue before creating the repair request.');
      return;
    }

    if (!priority.trim()) {
      Alert.alert('Validation error', 'Please select a priority level before creating the repair request.');
      return;
    }

    try {
      setSubmitting(true);
      const user = await getStoredUser();
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in again to create the request.');
        return;
      }

      const trimmedAssetId = assetId.trim();
      const { data: assetRow, error: assetErr } = await supabase
        .from('assets')
        .select('id, Asset_code, Lifecycle_Status')
        .eq('Asset_code', trimmedAssetId)
        .maybeSingle();

      if (assetErr) {
        Alert.alert('Error', 'Unable to validate the scanned asset. Please try again.');
        return;
      }

      if (!assetRow) {
        Alert.alert('Invalid asset', 'No asset was found for the scanned code.');
        return;
      }

      const requestor = requestorName.trim() || user.full_name || 'Unknown User';
      const noteText = `${reason.trim()}\n\nPriority: ${priority}\nRequested by: ${requestor}`;

      await submitUserRequest(user, 'Repair', String(assetRow.id ?? ''), noteText);
      Alert.alert('Request submitted', 'Your repair request has been created successfully.');
      router.back();
    } catch (error) {
      console.error('Submit request failed:', error);
      Alert.alert('Submission failed', 'Unable to create the repair request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.pageTitle}>New Repair Request</Text>
      </View>

      <Text style={styles.pageSubtitle}>Log an issue for an asset that needs attention</Text>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Scan Asset <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity style={styles.scanField} activeOpacity={0.85} onPress={openScanner}>
              <View style={styles.scanFieldLeft}>
                <MaterialCommunityIcons name="qrcode-scan" size={22} color="#475569" />
                <Text style={[styles.scanFieldText, !assetId ? styles.placeholderText : null]}>
                  {assetId ? assetId : 'Scan asset...'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color="#475569" />
            </TouchableOpacity>
            {!assetId && <Text style={styles.fieldHint}>Please scan the asset QR code.</Text>}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Issue Description <Text style={styles.required}>*</Text></Text>
            <View style={styles.textAreaWrapper}>
              <TextInput
                style={styles.textArea}
                placeholder="Describe the issue in detail..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                value={reason}
                onChangeText={setReason}
              />
            </View>
          </View>

          <View style={styles.rowFields}>
            <View style={[styles.fieldBlock, styles.priorityField]}>
              <Text style={styles.label}>Priority <Text style={styles.required}>*</Text></Text>
              <TouchableOpacity style={styles.selectBox} activeOpacity={0.8} onPress={() => setShowPriorityOptions((prev) => !prev)}>
                <Text style={[styles.selectText, !priority ? styles.placeholderText : null]}>
                  {priority || 'Low - Can wait'}
                </Text>
                <MaterialCommunityIcons name={showPriorityOptions ? 'chevron-up' : 'chevron-down'} size={18} color="#475569" />
              </TouchableOpacity>
              {showPriorityOptions && (
                <View style={styles.optionsContainer}>
                  {priorityOptions.map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={styles.optionItem}
                      onPress={() => {
                        setPriority(option);
                        setShowPriorityOptions(false);
                      }}
                    >
                      <Text style={styles.optionText}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.fieldBlock, styles.requestorField]}>
              <Text style={styles.label}>Requested By</Text>
              <TextInput
                style={styles.input}
                placeholder="Name of person requesting repair"
                placeholderTextColor="#94A3B8"
                value={requestorName}
                onChangeText={setRequestorName}
              />
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Attach Photo <Text style={styles.optional}>(Optional)</Text></Text>
            <TouchableOpacity style={styles.photoUploadArea} activeOpacity={0.8} onPress={pickPhoto}>
              <MaterialCommunityIcons name="image-plus" size={28} color="#94A3B8" />
              <Text style={styles.photoUploadText}>{selectedPhotoUri ? 'Photo attached' : 'Click to upload photo'}</Text>
              <Text style={styles.photoUploadSubtext}>{selectedPhotoUri ? 'Attached to this request' : 'PNG, JPG up to 10MB'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelButton} activeOpacity={0.8} onPress={() => router.back()}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.createButton} activeOpacity={0.9} onPress={handleSubmit} disabled={submitting}>
              <Text style={styles.createButtonText}>{submitting ? 'Creating...' : 'Create Request'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <View style={{ width: 42 }} />
            <Text style={styles.scannerTitle}>Scan Asset QR</Text>
            <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerVisible(false)} activeOpacity={0.8}>
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
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
    backgroundColor: '#F3F4F6',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 10,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1F2937',
    letterSpacing: -0.7,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginHorizontal: 18,
    marginBottom: 14,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 36,
  },
  fieldBlock: {
    marginBottom: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  required: {
    color: '#EF4444',
  },
  optional: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  scanField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  scanFieldLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  scanFieldText: {
    fontSize: 16,
    color: '#1F2937',
    flex: 1,
  },
  placeholderText: {
    color: '#94A3B8',
  },
  fieldHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748B',
  },
  textAreaWrapper: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    minHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textArea: {
    minHeight: 110,
    fontSize: 15,
    color: '#1F2937',
    textAlignVertical: 'top',
  },
  rowFields: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  priorityField: {
    flex: 1,
  },
  requestorField: {
    flex: 1,
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  selectText: {
    fontSize: 15,
    color: '#1F2937',
    flex: 1,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#1F2937',
  },
  optionsContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  optionItem: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  optionText: {
    fontSize: 14,
    color: '#1F2937',
  },
  photoUploadArea: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoUploadText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 10,
  },
  photoUploadSubtext: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#1F2937',
    fontSize: 18,
    fontWeight: '700',
  },
  createButton: {
    flex: 1.2,
    backgroundColor: '#E53935',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E53935',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    fontSize: 18,
  },
  cameraWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scanHint: {
    marginTop: 18,
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
});
