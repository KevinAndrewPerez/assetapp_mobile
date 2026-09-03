import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import { getStoredUser, submitUserRequest, uploadRequestPhoto, StoredUser } from '@/lib/userService';
import { supabase } from '@/lib/supabase';

type ScannedAsset = {
  id: string | number;
  code: string;
  name: string;
  imageUrl?: string;
};

export default function SubmitRequest() {
  const router = useRouter();
  const [selectedAssets, setSelectedAssets] = useState<ScannedAsset[]>([]);
  const [reason, setReason] = useState('');
  const [requestorName, setRequestorName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);

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

  const handleScanned = async (value: string) => {
    if (scanned) return;
    setScanned(true);
    const code = String(value ?? '').trim();
    if (!code) {
      setScanned(false);
      Alert.alert('Invalid QR', 'The scanned QR code is empty.');
      return;
    }

    try {
      const { data: assetRow, error: assetErr } = await supabase
        .from('assets')
        .select('id, Asset_code, Asset_name, user_id, asset_files (Asset_file_ID, file_name, file_path, url)')
        .eq('Asset_code', code)
        .maybeSingle();

      if (assetErr) {
        Alert.alert('Error', 'Unable to validate the scanned asset. Please try again.');
        return;
      }
      if (!assetRow) {
        Alert.alert('Invalid asset', 'No asset was found for the scanned code.');
        return;
      }

      // Only allow requesting assets that are assigned to the logged-in user.
      const user = await getStoredUser();
      const ownerId = String(assetRow.user_id ?? '');
      const myId = String(user?.id ?? '');
      if (!myId || ownerId !== myId) {
        Alert.alert(
          'Asset not yours',
          `"${assetRow.Asset_name || assetRow.Asset_code}" is not assigned to you. You can only request repair for assets that belong to you.`,
        );
        return;
      }

      const file = Array.isArray(assetRow.asset_files) ? assetRow.asset_files[0] : assetRow.asset_files;
      const rawFile = String(file?.url ?? file?.file_path ?? '');
      let imageUrl = '';
      if (rawFile) {
        if (rawFile.startsWith('http://') || rawFile.startsWith('https://')) {
          imageUrl = rawFile;
        } else {
          const clean = rawFile
            .replace(/^\/+/, '')
            .replace(/^storage\/v1\/object\/public\//, '')
            .replace(/^storage\/assets\//, '')
            .replace(/^assets\//, '');
          const { data } = supabase.storage.from('assets').getPublicUrl(clean);
          imageUrl = data?.publicUrl || '';
        }
      }

      setSelectedAssets((prev) => {
        const exists = prev.some((a) => String(a.id) === String(assetRow.id));
        if (exists) return prev;
        return [
          ...prev,
          {
            id: assetRow.id,
            code: String(assetRow.Asset_code ?? code),
            name: String(assetRow.Asset_name ?? 'Asset'),
            imageUrl,
          },
        ];
      });
    } catch (err) {
      console.error('Scan validation failed:', err);
      Alert.alert('Error', 'Unable to validate the scanned asset. Please try again.');
    } finally {
      setScannerVisible(false);
    }
  };

  const removeAsset = (id: string | number) => {
    setSelectedAssets((prev) => prev.filter((a) => String(a.id) !== String(id)));
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
    if (selectedAssets.length === 0) {
      Alert.alert('Validation error', 'Please scan at least one asset QR code before creating the repair request.');
      return;
    }

    if (!reason.trim()) {
      Alert.alert('Validation error', 'Please describe the issue before creating the repair request.');
      return;
    }

    try {
      setSubmitting(true);
      const user: StoredUser | null = await getStoredUser();
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in again to create the request.');
        return;
      }

      const noteText = reason.trim();

      // Upload the attached photo (if any) into the `request_files` bucket so
      // the request carries the picture — never block submission on upload.
      let file: Awaited<ReturnType<typeof uploadRequestPhoto>> | undefined;
      if (selectedPhotoUri) {
        try {
          file = await uploadRequestPhoto(selectedPhotoUri);
        } catch (uploadErr) {
          console.warn('Request photo upload failed (submitting without it):', uploadErr);
        }
      }

      await submitUserRequest(
        user,
        'Repair',
        selectedAssets.map((a) => a.id),
        noteText,
        file ?? null,
      );
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

      <Text style={styles.pageSubtitle}>Log an issue for one or more assets assigned to you</Text>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Assets <Text style={styles.required}>*</Text></Text>
            <TouchableOpacity style={styles.scanField} activeOpacity={0.85} onPress={openScanner}>
              <View style={styles.scanFieldLeft}>
                <MaterialCommunityIcons name="qrcode-scan" size={22} color="#475569" />
                <Text style={[styles.scanFieldText, selectedAssets.length === 0 ? styles.placeholderText : null]}>
                  {selectedAssets.length === 0
                    ? 'Scan asset QR...'
                    : `${selectedAssets.length} asset${selectedAssets.length > 1 ? 's' : ''} selected`}
                </Text>
              </View>
              <MaterialCommunityIcons name="plus-circle-outline" size={22} color="#475569" />
            </TouchableOpacity>
            <Text style={styles.fieldHint}>Scan the QR of each asset you own. Assets that are not assigned to you will be rejected.</Text>

            {selectedAssets.length > 0 && (
              <View style={styles.assetList}>
                {selectedAssets.map((asset) => (
                  <View key={String(asset.id)} style={styles.assetChip}>
                    {asset.imageUrl ? (
                      <Image source={{ uri: asset.imageUrl }} style={styles.assetChipThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.assetChipThumb, styles.assetChipThumbPlaceholder]}>
                        <MaterialCommunityIcons name="cube-outline" size={18} color="#1E3A5F" />
                      </View>
                    )}
                    <View style={styles.assetChipTextWrap}>
                      <Text style={styles.assetChipName} numberOfLines={1}>{asset.name}</Text>
                      <Text style={styles.assetChipCode} numberOfLines={1}>{asset.code}</Text>
                    </View>
                    <TouchableOpacity onPress={() => removeAsset(asset.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <MaterialCommunityIcons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
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

          <View style={styles.requestorRow}>
            <MaterialCommunityIcons name="account-circle-outline" size={20} color="#64748B" />
            <Text style={styles.requestorLabel}>Requesting as: </Text>
            <Text style={styles.requestorValue}>{requestorName || 'You'}</Text>
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
  assetList: {
    marginTop: 10,
    gap: 8,
  },
  assetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  assetChipThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  assetChipThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetChipTextWrap: {
    flex: 1,
  },
  assetChipName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  assetChipCode: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
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
  requestorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
    gap: 6,
  },
  requestorLabel: {
    fontSize: 14,
    color: '#1E3A5F',
    fontWeight: '500',
  },
  requestorValue: {
    fontSize: 14,
    color: '#1E3A5F',
    fontWeight: '700',
    flex: 1,
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