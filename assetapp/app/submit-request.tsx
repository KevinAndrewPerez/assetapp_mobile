import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  getStoredUser,
  uploadRequestPhoto,
  fetchUserAssets,
  StoredUser,
  UserAsset,
} from '@/lib/userService';
import { supabase } from '@/lib/supabase';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import {
  REPAIR_PRIORITIES,
  RepairPriority,
  submitRepairRequest,
  validateAssetsForRepair,
  repairStatusMessage,
} from '@/lib/repairService';

/**
 * Report a damaged / malfunctioning asset (spec §1–§2).
 *
 * The user picks their asset (QR scan, or search their accountable assets),
 * describes the problem and submits. The request is created as Pending and the
 * Asset Management Office takes over from there; the user only tracks progress.
 */

type PickedAsset = {
  id: string | number;
  code: string;
  name: string;
  category?: string;
  serialNumber?: string;
  lifecycleStatus?: string;
  imageUrl?: string;
};

const DISPOSED_STATUSES = ['disposal', 'disposed'];

const isDisposed = (status?: string) =>
  DISPOSED_STATUSES.includes(String(status ?? '').trim().toLowerCase());

const pad = (n: number) => String(n).padStart(2, '0');

const formatDateInput = (date: Date) =>
  `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;

const parseDateInput = (raw: string): string | null => {
  const match = String(raw ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.getMonth() !== month - 1) return null;
  return iso;
};

const statusTone = (status?: string) => {
  const key = String(status ?? '').trim().toLowerCase();
  if (key === 'disposal' || key === 'disposed') return { bg: '#FEF2F2', color: '#B91C1C' };
  if (key === 'for repair' || key === 'repair') return { bg: '#FEF6E4', color: '#92400E' };
  if (key === 'for replacement' || key === 'replacement') return { bg: '#EDE9FE', color: '#6D28D9' };
  if (key === 'pullout') return { bg: '#EFF6FF', color: '#1D4ED8' };
  return { bg: '#ECFDF5', color: '#15803D' };
};

export default function SubmitRepairRequest() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<PickedAsset[]>([]);
  const [problem, setProblem] = useState('');
  const [description, setDescription] = useState('');
  const [reportedDate, setReportedDate] = useState(formatDateInput(new Date()));
  const [priority, setPriority] = useState<RepairPriority>('Medium');
  const [remarks, setRemarks] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [pickerVisible, setPickerVisible] = useState(false);
  const [myAssets, setMyAssets] = useState<UserAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');

  useEffect(() => {
    const loadUser = async () => {
      const stored = await getStoredUser();
      if (stored) setUser(stored);
    };
    loadUser();
  }, []);

  const loadMyAssets = async (current: StoredUser | null) => {
    if (!current?.id) return;
    try {
      setAssetsLoading(true);
      const assets = await fetchUserAssets(current, 'own');
      setMyAssets(assets);
    } catch (err) {
      console.warn('Failed to load accountable assets:', err);
    } finally {
      setAssetsLoading(false);
    }
  };

  const openPicker = async () => {
    setAssetSearch('');
    setPickerVisible(true);
    if (myAssets.length === 0) await loadMyAssets(user);
  };

  const addAsset = (asset: PickedAsset) => {
    const status = String(asset.lifecycleStatus ?? '');
    if (isDisposed(status)) {
      Alert.alert('Asset not available', `${asset.name} (${asset.code}) is already disposed.`);
      return;
    }
    setSelectedAssets((prev) => {
      if (prev.some((a) => String(a.id) === String(asset.id))) return prev;
      return [...prev, asset];
    });
  };

  const removeAsset = (id: string | number) => {
    setSelectedAssets((prev) => prev.filter((a) => String(a.id) !== String(id)));
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
        .select(
          'id, Asset_code, Asset_name, Category, serial_Number, Lifecycle_Status, user_id, asset_files (Asset_file_ID, file_name, file_path, url)',
        )
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

      const ownerId = String((assetRow as any).user_id ?? '');
      const myId = String(user?.id ?? '');
      if (!myId || ownerId !== myId) {
        Alert.alert(
          'Asset not yours',
          `"${(assetRow as any).Asset_name || (assetRow as any).Asset_code}" is not assigned to you. You can only request repair for assets that belong to you.`,
        );
        return;
      }

      const imageUrl = resolveMediaUrl((assetRow as any).asset_files, 'assets');

      addAsset({
        id: (assetRow as any).id,
        code: String((assetRow as any).Asset_code ?? code),
        name: String((assetRow as any).Asset_name ?? 'Asset'),
        category: (assetRow as any).Category ? String((assetRow as any).Category) : undefined,
        serialNumber: (assetRow as any).serial_Number ? String((assetRow as any).serial_Number) : undefined,
        lifecycleStatus: (assetRow as any).Lifecycle_Status
          ? String((assetRow as any).Lifecycle_Status)
          : undefined,
        imageUrl,
      });
    } catch (err) {
      console.error('Scan validation failed:', err);
      Alert.alert('Error', 'Unable to validate the scanned asset. Please try again.');
    } finally {
      setScannerVisible(false);
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission', 'Camera permission is required to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (uri) setPhotoUri(uri);
    } catch (err) {
      console.warn('Camera failed:', err);
      Alert.alert('Camera unavailable', 'Could not open the camera on this device.');
    }
  };

  const pickFromLibrary = async () => {
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
    if (uri) setPhotoUri(uri);
  };

  const pickPhoto = () => {
    Alert.alert('Attach photo', 'Take a photo of the problem or choose one from your gallery.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
    ]);
  };

  const handleSubmit = async () => {
    if (selectedAssets.length === 0) {
      Alert.alert('Validation error', 'Please add at least one asset that needs repair.');
      return;
    }
    if (!problem.trim()) {
      Alert.alert('Validation error', 'Please state the problem or issue with the asset.');
      return;
    }

    const isoDate = parseDateInput(reportedDate);
    if (!isoDate) {
      Alert.alert('Validation error', 'Enter the date the problem was reported as mm/dd/yyyy.');
      return;
    }

    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again to create the request.');
      return;
    }

    try {
      setSubmitting(true);

      // Lifecycle guard: never file a repair for a disposed asset or a duplicate.
      const check = await validateAssetsForRepair(selectedAssets.map((a) => a.id));
      if (check.blocked.length > 0) {
        Alert.alert(
          'Some assets cannot be submitted',
          check.blocked.map((b) => `• ${b.name} (${b.code}): ${b.reason}`).join('\n'),
        );
        if (check.ok.length === 0) return;
      }

      let file: Awaited<ReturnType<typeof uploadRequestPhoto>> | undefined;
      if (photoUri) {
        try {
          file = await uploadRequestPhoto(photoUri);
        } catch (uploadErr) {
          console.warn('Repair photo upload failed (submitting without it):', uploadErr);
        }
      }

      const result = await submitRepairRequest({
        user: { id: user.id, full_name: user.full_name, email: user.email },
        assetIds: check.ok.map((a) => a.id),
        problem: problem.trim(),
        description: description.trim(),
        priority,
        reportedDate: isoDate,
        remarks: remarks.trim(),
        photo: file ?? null,
        restrictOwnerId: user.id,
      });

      const blockedText =
        result.blocked.length > 0
          ? `\n\nNot submitted:\n${result.blocked.map((b) => `• ${b.name} (${b.code}): ${b.reason}`).join('\n')}`
          : '';

      Alert.alert(
        'Repair request submitted',
        `Request No. ${result.requestRef}\n${result.submitted} asset(s) reported.\n\n${repairStatusMessage('Pending')}${blockedText}`,
      );
      router.back();
    } catch (error: any) {
      console.error('Submit repair request failed:', error);
      Alert.alert('Submission failed', error?.message || 'Unable to create the repair request.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredAssets = useMemo(() => {
    const term = assetSearch.trim().toLowerCase();
    if (!term) return myAssets;
    return myAssets.filter((asset) =>
      [asset.name, asset.barcode, asset.category, asset.serialNumber]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [assetSearch, myAssets]);

  const alreadySelected = (id: string) => selectedAssets.some((a) => String(a.id) === String(id));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.8}>
          <MaterialCommunityIcons name="chevron-left" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Report Repair</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={styles.pageSubtitle}>
        Report a damaged or malfunctioning asset — the Asset Management Office reviews every request.
      </Text>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Step 1 — the asset */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepTitle}>Select the asset</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>
              Asset <Text style={styles.required}>*</Text>
            </Text>

            <View style={styles.assetActionsRow}>
              <TouchableOpacity style={styles.assetAction} activeOpacity={0.85} onPress={openScanner}>
                <MaterialCommunityIcons name="qrcode-scan" size={20} color="#1E3A5F" />
                <Text style={styles.assetActionText}>Scan QR</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.assetAction} activeOpacity={0.85} onPress={openPicker}>
                <MaterialCommunityIcons name="magnify" size={20} color="#1E3A5F" />
                <Text style={styles.assetActionText}>My assets</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldHint}>
              Scan the asset QR code or pick from the assets assigned to you.
            </Text>

            {selectedAssets.length > 0 && (
              <View style={styles.assetList}>
                {selectedAssets.map((asset) => {
                  const tone = statusTone(asset.lifecycleStatus);
                  return (
                    <View key={String(asset.id)} style={styles.assetChip}>
                      {asset.imageUrl ? (
                        <Image source={{ uri: asset.imageUrl }} style={styles.assetChipThumb} resizeMode="cover" />
                      ) : (
                        <View style={[styles.assetChipThumb, styles.assetChipThumbPlaceholder]}>
                          <MaterialCommunityIcons name="cube-outline" size={18} color="#1E3A5F" />
                        </View>
                      )}
                      <View style={styles.assetChipTextWrap}>
                        <Text style={styles.assetChipName} numberOfLines={1}>
                          {asset.name}
                        </Text>
                        <Text style={styles.assetChipCode} numberOfLines={1}>
                          {asset.code}
                        </Text>
                        {asset.lifecycleStatus ? (
                          <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                            <Text style={[styles.statusPillText, { color: tone.color }]}>
                              {asset.lifecycleStatus}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        onPress={() => removeAsset(asset.id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialCommunityIcons name="close-circle" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Step 2 — the problem */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.stepTitle}>Describe the problem</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>
              Problem / Issue <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Laptop does not turn on"
              placeholderTextColor="#94A3B8"
              value={problem}
              onChangeText={setProblem}
            />
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Description of Damage</Text>
            <View style={styles.textAreaWrapper}>
              <TextInput
                style={styles.textArea}
                placeholder="Describe what happened and how the asset is behaving..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                value={description}
                onChangeText={setDescription}
              />
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Date the Problem Was Reported</Text>
            <View style={styles.inputWithIcon}>
              <MaterialCommunityIcons name="calendar" size={20} color="#1E3A5F" />
              <TextInput
                style={styles.inputFlex}
                placeholder="mm/dd/yyyy"
                placeholderTextColor="#94A3B8"
                keyboardType="numbers-and-punctuation"
                value={reportedDate}
                onChangeText={setReportedDate}
              />
            </View>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Priority / Urgency</Text>
            <View style={styles.priorityRow}>
              {REPAIR_PRIORITIES.map((level) => {
                const active = priority === level;
                const tone =
                  level === 'High'
                    ? { bg: '#FEF2F2', border: '#EF4444', text: '#B91C1C' }
                    : level === 'Low'
                      ? { bg: '#ECFDF5', border: '#22C55E', text: '#15803D' }
                      : { bg: '#FEF6E4', border: '#F59E0B', text: '#92400E' };
                return (
                  <TouchableOpacity
                    key={level}
                    style={[
                      styles.priorityChip,
                      {
                        backgroundColor: active ? tone.bg : '#FFFFFF',
                        borderColor: active ? tone.border : '#CBD5E1',
                      },
                    ]}
                    onPress={() => setPriority(level)}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons
                      name={level === 'High' ? 'alert-circle-outline' : 'flag-outline'}
                      size={16}
                      color={active ? tone.text : '#64748B'}
                    />
                    <Text style={[styles.priorityChipText, { color: active ? tone.text : '#475569' }]}>
                      {level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Step 3 — photo & remarks */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.stepTitle}>Photo and remarks</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>
              Photo of the Problem <Text style={styles.optional}>(Optional)</Text>
            </Text>

            {photoUri ? (
              <View style={styles.photoPreviewWrap}>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                <View style={styles.photoPreviewActions}>
                  <TouchableOpacity style={styles.photoActionBtn} onPress={pickPhoto} activeOpacity={0.85}>
                    <MaterialCommunityIcons name="image-outline" size={16} color="#1E3A5F" />
                    <Text style={styles.photoActionText}>Replace</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.photoActionBtn, styles.photoRemoveBtn]}
                    onPress={() => setPhotoUri(null)}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="close" size={16} color="#B91C1C" />
                    <Text style={[styles.photoActionText, { color: '#B91C1C' }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.photoUploadArea} activeOpacity={0.8} onPress={pickPhoto}>
                <MaterialCommunityIcons name="image-plus" size={28} color="#94A3B8" />
                <Text style={styles.photoUploadText}>Add a photo</Text>
                <Text style={styles.photoUploadSubtext}>Take a photo or choose one from your gallery</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>
              Additional Remarks <Text style={styles.optional}>(Optional)</Text>
            </Text>
            <View style={styles.textAreaWrapper}>
              <TextInput
                style={styles.textArea}
                placeholder="Anything else the technician should know..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={remarks}
                onChangeText={setRemarks}
              />
            </View>
          </View>

          <View style={styles.requestorRow}>
            <MaterialCommunityIcons name="account-circle-outline" size={20} color="#64748B" />
            <Text style={styles.requestorLabel}>Requesting as: </Text>
            <Text style={styles.requestorValue}>{user?.full_name || 'You'}</Text>
          </View>

          <View style={styles.noticeCard}>
            <MaterialCommunityIcons name="information-outline" size={18} color="#1D4ED8" />
            <Text style={styles.noticeText}>
              After submission the Asset Management Office evaluates the asset. It is flagged "For Repair" and
              moves back to Active only once the repair is completed and verified.
            </Text>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelButton} activeOpacity={0.8} onPress={() => router.back()}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.createButton}
              activeOpacity={0.9}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.createButtonText}>Submit Request</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Asset picker */}
      <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>My Assets</Text>
            <TouchableOpacity style={styles.pickerClose} onPress={() => setPickerVisible(false)} activeOpacity={0.8}>
              <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchField}>
            <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, code or serial..."
              placeholderTextColor="#94A3B8"
              value={assetSearch}
              onChangeText={setAssetSearch}
            />
          </View>

          {assetsLoading ? (
            <View style={styles.pickerLoading}>
              <ActivityIndicator size="large" color="#1E3A5F" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.pickerList}>
              {filteredAssets.length === 0 ? (
                <View style={styles.pickerEmpty}>
                  <MaterialCommunityIcons name="cube-outline" size={42} color="#CBD5E1" />
                  <Text style={styles.pickerEmptyText}>No assets found</Text>
                </View>
              ) : (
                filteredAssets.map((asset) => {
                  const disposed = isDisposed(asset.status);
                  const selected = alreadySelected(asset.id);
                  const tone = statusTone(asset.status);
                  return (
                    <TouchableOpacity
                      key={String(asset.id)}
                      style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                      activeOpacity={0.85}
                      disabled={disposed}
                      onPress={() =>
                        addAsset({
                          id: asset.id,
                          code: asset.barcode,
                          name: asset.name,
                          category: asset.category,
                          serialNumber: asset.serialNumber,
                          lifecycleStatus: asset.status,
                        })
                      }
                    >
                      <View style={styles.pickerRowText}>
                        <Text style={styles.pickerRowName} numberOfLines={1}>
                          {asset.name}
                        </Text>
                        <Text style={styles.pickerRowCode} numberOfLines={1}>
                          {asset.barcode}
                          {asset.serialNumber ? ` • ${asset.serialNumber}` : ''}
                        </Text>
                        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.statusPillText, { color: tone.color }]}>
                            {asset.status || 'Active'}
                          </Text>
                        </View>
                      </View>
                      <MaterialCommunityIcons
                        name={selected ? 'check-circle' : disposed ? 'close-circle' : 'plus-circle-outline'}
                        size={22}
                        color={selected ? '#16A34A' : disposed ? '#EF4444' : '#1E3A5F'}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* QR scanner */}
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
    backgroundColor: '#F1F5F9',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginHorizontal: 18,
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 18,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 40,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1E3A5F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E3A5F',
  },
  fieldBlock: {
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  required: {
    color: '#EF4444',
  },
  optional: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    fontSize: 15,
    color: '#0F172A',
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  inputFlex: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  assetActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  assetAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#1E3A5F',
    borderRadius: 12,
    height: 48,
  },
  assetActionText: {
    color: '#1E3A5F',
    fontSize: 14,
    fontWeight: '700',
  },
  fieldHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
  },
  assetList: {
    marginTop: 12,
    gap: 10,
  },
  assetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  assetChipThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  assetChipThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  assetChipTextWrap: {
    flex: 1,
    gap: 2,
  },
  assetChipName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  assetChipCode: {
    fontSize: 12,
    color: '#64748B',
  },
  statusPill: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textAreaWrapper: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    minHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textArea: {
    minHeight: 100,
    fontSize: 15,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  priorityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 12,
    height: 46,
  },
  priorityChipText: {
    fontSize: 14,
    fontWeight: '700',
  },
  photoUploadArea: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 16,
    backgroundColor: '#F4F7FB',
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoUploadText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 10,
  },
  photoUploadSubtext: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  photoPreviewWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  photoPreview: {
    width: '100%',
    height: 190,
  },
  photoPreviewActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  photoRemoveBtn: {
    backgroundColor: '#FEF2F2',
  },
  photoActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E3A5F',
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
    marginBottom: 14,
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
  noticeCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  createButton: {
    flex: 1.4,
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
    fontSize: 16,
    fontWeight: '700',
  },
  pickerContainer: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pickerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  pickerClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  pickerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerList: {
    paddingHorizontal: 16,
    paddingBottom: 30,
    gap: 10,
  },
  pickerEmpty: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  pickerEmptyText: {
    fontSize: 15,
    color: '#94A3B8',
    fontWeight: '600',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerRowSelected: {
    borderColor: '#16A34A',
    backgroundColor: '#ECFDF5',
  },
  pickerRowText: {
    flex: 1,
    gap: 3,
  },
  pickerRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  pickerRowCode: {
    fontSize: 12,
    color: '#64748B',
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
