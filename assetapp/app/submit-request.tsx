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
  fetchTransferRecipients,
  getStoredUser,
  TransferRecipient,
  uploadRequestPhoto,
  fetchUserAssets,
  StoredUser,
  UserAsset,
  submitUserRequest,
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
import {
  isRequestableAsset,
  NOT_YOUR_ASSET_MESSAGE,
  notRequestableReason,
  requestTypeMeta,
  RequestTypeMeta,
  REQUEST_TYPE_OUTCOME,
  REQUEST_TYPE_TARGET_STATUS,
} from '@/lib/lifecycle';
import { extractAssetKey } from '@/components/asset-scanner';

/**
 * Submit Request (user side).
 *
 * Mirrors the web's `/user/request-asset`: the requester picks the request type,
 * the asset(s) it applies to, the reason and an optional photo. Repair keeps its
 * richer problem/priority form (it drives the servicing workflow); every other
 * type files a general request the Asset Management Office reviews, and the
 * asset only moves once that request is approved:
 *
 *   Repair       → For Repair   (then back to Active once the repair is verified)
 *   Disposal     → Disposal
 *   Transfer     → stays Active, accountability moves to the chosen custodian
 *   Replacement  → For Replacement
 *   Pullout      → Pullout
 */

type RequestType = 'Repair' | 'Disposal' | 'Transfer' | 'Replacement' | 'Pullout';

type RequestTypeOption = RequestTypeMeta & { type: RequestType; tagline: string };

/** The five request types the web offers, described for a small screen. */
const REQUEST_TYPE_TAGLINES: Record<RequestType, string> = {
  Repair: 'Report a damaged or malfunctioning asset for servicing.',
  Disposal: 'Ask the office to evaluate the asset for disposal.',
  Transfer: 'Hand the asset over to another custodian.',
  Replacement: 'Ask for a replacement unit for this asset.',
  Pullout: 'Return the asset to the Asset Management Office.',
};

const REQUEST_TYPE_ORDER: RequestType[] = ['Repair', 'Disposal', 'Transfer', 'Replacement', 'Pullout'];

const REQUEST_TYPES: RequestTypeOption[] = REQUEST_TYPE_ORDER.map((type) => ({
  type,
  ...requestTypeMeta(type),
  tagline: REQUEST_TYPE_TAGLINES[type],
}));

const NOTE_FIELD: Record<Exclude<RequestType, 'Repair'>, { label: string; placeholder: string }> = {
  Disposal: {
    label: 'Reason for Disposal',
    placeholder: 'e.g. Beyond repair — the unit no longer powers on and parts are unavailable.',
  },
  Transfer: {
    label: 'Reason for Transfer',
    placeholder: 'e.g. Reassigning this unit to the new staff member handling the same duties.',
  },
  Replacement: {
    label: 'Reason for Replacement',
    placeholder: 'e.g. End of useful life — repair is no longer economical.',
  },
  Pullout: {
    label: 'Reason for Pullout',
    placeholder: 'e.g. Item is no longer needed by this office and can be returned to the AMO.',
  },
};

type PickedAsset = {
  id: string | number;
  code: string;
  name: string;
  category?: string;
  serialNumber?: string;
  lifecycleStatus?: string;
  imageUrl?: string;
};

/**
 * What the scan reads from the sticker (a URL, a file path or a plain code are
 * all normalised by `extractAssetKey`), and the columns the ownership + status
 * checks need.
 */
const SCAN_SELECT =
  'id, Asset_code, Asset_name, Category, serial_Number, Lifecycle_Status, user_id, asset_files (Asset_file_ID, file_name, file_path, url)';

const statusTone = (status?: string) => {
  const key = String(status ?? '').trim().toLowerCase();
  if (key === 'disposal' || key === 'disposed') return { bg: '#FEF2F2', color: '#B91C1C' };
  if (key === 'for repair' || key === 'repair') return { bg: '#FEF6E4', color: '#92400E' };
  if (key === 'for replacement' || key === 'replacement') return { bg: '#F5F3FF', color: '#6D28D9' };
  if (key === 'for checking' || key === 'checking') return { bg: '#EFF6FF', color: '#1D4ED8' };
  if (key === 'pullout' || key === 'pulled out') return { bg: '#EFF6FF', color: '#1D4ED8' };
  return { bg: '#ECFDF5', color: '#15803D' };
};

export default function SubmitRequest() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [requestType, setRequestType] = useState<RequestType | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<PickedAsset[]>([]);
  const [problem, setProblem] = useState('');
  const [priority, setPriority] = useState<RepairPriority>('Medium');
  const [note, setNote] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [recipient, setRecipient] = useState<TransferRecipient | null>(null);
  const [recipientModalVisible, setRecipientModalVisible] = useState(false);
  const [recipients, setRecipients] = useState<TransferRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');

  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [pickerVisible, setPickerVisible] = useState(false);
  const [myAssets, setMyAssets] = useState<UserAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');

  const isTransfer = requestType === 'Transfer';
  const isRepair = requestType === 'Repair';
  const typeOption = useMemo(
    () => REQUEST_TYPES.find((t) => t.type === requestType) ?? null,
    [requestType],
  );

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
    // Only Active assets can be requested — anything mid-workflow has to finish
    // its own process first (see lib/lifecycle.ts).
    if (!isRequestableAsset(asset.lifecycleStatus)) {
      Alert.alert('Asset not available', `${asset.name} (${asset.code}) — ${notRequestableReason(asset.lifecycleStatus)}`);
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

    // The sticker may hold a bare code, a file path or a full URL — normalise it
    // first so a valid sticker is never rejected as "invalid".
    const key = extractAssetKey(value);
    if (!key) {
      setScanned(false);
      Alert.alert(
        'Invalid QR code',
        "This QR code doesn't carry an asset code. Please scan the sticker on the asset itself.",
      );
      return;
    }

    try {
      const numeric = Number(key);
      const byNumericId = Number.isFinite(numeric) && String(numeric) === key;

      const exact = await supabase
        .from('assets')
        .select(SCAN_SELECT)
        .eq(byNumericId ? 'id' : 'Asset_code', byNumericId ? numeric : key)
        .maybeSingle();

      let assetRow: any = exact.error ? null : exact.data;
      if (!assetRow) {
        // Stickers printed before the code was normalised can differ in casing.
        const loose = await supabase
          .from('assets')
          .select(SCAN_SELECT)
          .ilike('Asset_code', key)
          .maybeSingle();
        if (!loose.error && loose.data) assetRow = loose.data;
      }

      if (!assetRow) {
        Alert.alert(
          'Asset not found',
          'No registered asset matches this QR code. Make sure you are scanning the asset sticker.',
        );
        return;
      }

      const name = String(assetRow.Asset_name ?? 'This asset');
      const code = String(assetRow.Asset_code ?? key);

      // Ownership first: a requester may only file a request for an asset that
      // is accountable to them.
      const ownerId = String(assetRow.user_id ?? '');
      const myId = String(user?.id ?? '');
      if (!myId) {
        Alert.alert('Sign in required', 'Please sign in again to make a request.');
        return;
      }
      if (!ownerId || ownerId !== myId) {
        Alert.alert(NOT_YOUR_ASSET_MESSAGE, `${name} (${code}) is not assigned to you.`);
        return;
      }

      // Then lifecycle: only Active assets can be requested.
      if (!isRequestableAsset(assetRow.Lifecycle_Status)) {
        Alert.alert('Asset not available', `${name} (${code}) — ${notRequestableReason(assetRow.Lifecycle_Status)}`);
        return;
      }

      addAsset({
        id: assetRow.id,
        code,
        name,
        category: assetRow.Category ? String(assetRow.Category) : undefined,
        serialNumber: assetRow.serial_Number ? String(assetRow.serial_Number) : undefined,
        lifecycleStatus: assetRow.Lifecycle_Status ? String(assetRow.Lifecycle_Status) : undefined,
        imageUrl: resolveMediaUrl(assetRow.asset_files, 'assets'),
      });
    } catch (err) {
      console.error('Scan validation failed:', err);
      Alert.alert('Error', 'Unable to validate the scanned asset. Please try again.');
    } finally {
      setScannerVisible(false);
    }
  };

  const openRecipientPicker = async () => {
    setRecipientSearch('');
    setRecipientModalVisible(true);
    if (recipients.length === 0) {
      try {
        setRecipientsLoading(true);
        setRecipients(await fetchTransferRecipients());
      } catch (err) {
        console.warn('Failed to load recipients:', err);
      } finally {
        setRecipientsLoading(false);
      }
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
    if (!requestType) {
      Alert.alert('Validation error', 'Please choose the type of request you are making.');
      return;
    }
    if (selectedAssets.length === 0) {
      Alert.alert('Validation error', 'Please add at least one asset to this request.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again to create the request.');
      return;
    }
    if (isRepair && !problem.trim()) {
      Alert.alert('Validation error', 'Please state the problem or issue with the asset.');
      return;
    }
    if (!isRepair && !note.trim()) {
      Alert.alert('Validation error', `Please give the ${NOTE_FIELD[requestType as Exclude<RequestType, 'Repair'>].label.toLowerCase()}.`);
      return;
    }
    if (isTransfer && !recipient) {
      Alert.alert('Validation error', 'Please choose who the asset is being transferred to.');
      return;
    }

    const assetIds = selectedAssets.map((a) => a.id);

    try {
      setSubmitting(true);

      let file: Awaited<ReturnType<typeof uploadRequestPhoto>> | undefined;
      if (photoUri) {
        try {
          file = await uploadRequestPhoto(photoUri);
        } catch (uploadErr) {
          console.warn('Request photo upload failed (submitting without it):', uploadErr);
        }
      }

      // ── Repair keeps its own workflow (servicing + evaluation) ──────────
      if (isRepair) {
        const check = await validateAssetsForRepair(assetIds);
        if (check.blocked.length > 0) {
          Alert.alert(
            'Some assets cannot be submitted',
            check.blocked.map((b) => `• ${b.name} (${b.code}): ${b.reason}`).join('\n'),
          );
          if (check.ok.length === 0) return;
        }

        const result = await submitRepairRequest({
          user: { id: user.id, full_name: user.full_name, email: user.email },
          assetIds: check.ok.map((a) => a.id),
          problem: problem.trim(),
          priority,
          remarks: remarks.trim(),
          photo: file ?? null,
          restrictOwnerId: user.id,
        });

        const blockedText =
          result.blocked.length > 0
            ? `\n\nNot submitted:\n${result.blocked
                .map((b) => `• ${b.name} (${b.code}): ${b.reason}`)
                .join('\n')}`
            : '';

        Alert.alert(
          'Repair request submitted',
          `Request No. ${result.requestRef}\n${result.submitted} asset(s) reported.\n\n${repairStatusMessage('Pending')}${blockedText}`,
        );
        router.back();
        return;
      }

      // ── Every other type files a general request for the office ─────────
      const created = await submitUserRequest(
        user,
        requestType,
        assetIds,
        note.trim(),
        file ?? null,
        { assignToUserId: isTransfer ? recipient?.id ?? null : null },
      );
      const reference = `REQ-${String((created as any)?.id ?? '')}`;
      const count = assetIds.length;

      Alert.alert(
        `${requestType} request submitted`,
        `Request No. ${reference}\n${count} asset${count === 1 ? '' : 's'} included.\n\n` +
          `${REQUEST_TYPE_OUTCOME[requestType]}\n\nThe Asset Management Office reviews every request.`,
      );
      router.back();
    } catch (error: any) {
      console.error('Submit request failed:', error);
      Alert.alert('Submission failed', error?.message || 'Unable to create the request.');
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

  const filteredRecipients = useMemo(() => {
    const term = recipientSearch.trim().toLowerCase();
    if (!term) return recipients;
    return recipients.filter((r) =>
      [r.fullName, r.email, r.department]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [recipientSearch, recipients]);

  const alreadySelected = (id: string) => selectedAssets.some((a) => String(a.id) === String(id));
  const activeAssetCount = myAssets.filter((a) => isRequestableAsset(a.status)).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.8}>
          <MaterialCommunityIcons name="chevron-left" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Submit Request</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={styles.pageSubtitle}>
        Submit a new asset request (single or bulk) — the Asset Management Office reviews every request.
      </Text>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Step 1 — what kind of request is this? */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepTitle}>Request type</Text>
          </View>

          <View style={styles.typeList}>
            {REQUEST_TYPES.map((option) => {
              const active = requestType === option.type;
              return (
                <TouchableOpacity
                  key={option.type}
                  style={[styles.typeCard, active && styles.typeCardActive]}
                  activeOpacity={0.85}
                  onPress={() => setRequestType(option.type)}
                >
                  <View style={[styles.typeIcon, { backgroundColor: option.tone.bg }]}>
                    <MaterialCommunityIcons
                      name={option.icon as any}
                      size={20}
                      color={active ? '#FFFFFF' : option.tone.fg}
                    />
                  </View>
                  <View style={styles.typeTextWrap}>
                    <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                      {option.label} Request
                    </Text>
                    <Text style={styles.typeTagline} numberOfLines={2}>
                      {option.tagline}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={active ? 'check-circle' : 'circle-outline'}
                    size={20}
                    color={active ? '#16A34A' : '#CBD5E1'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {typeOption ? (
            <View style={styles.outcomeCard}>
              <MaterialCommunityIcons name="information-outline" size={17} color="#1D4ED8" />
              <Text style={styles.outcomeText}>
                {REQUEST_TYPE_OUTCOME[typeOption.type]}
                {REQUEST_TYPE_TARGET_STATUS[typeOption.type] !== 'Active'
                  ? ` (status: ${REQUEST_TYPE_TARGET_STATUS[typeOption.type]})`
                  : ''}
              </Text>
            </View>
          ) : null}

          {/* Step 2 — the asset(s) */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>2</Text>
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
              Scan the asset QR code or pick from the assets assigned to you. Only assets with an Active
              status can be requested.
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

          {/* Transfer only — who receives the asset */}
          {isTransfer ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>
                Transfer to <Text style={styles.required}>*</Text>
              </Text>
              <TouchableOpacity
                style={styles.selectField}
                activeOpacity={0.85}
                onPress={openRecipientPicker}
              >
                <MaterialCommunityIcons
                  name={recipient ? 'account-check-outline' : 'account-search-outline'}
                  size={20}
                  color="#1E3A5F"
                />
                <View style={styles.selectFieldText}>
                  <Text style={recipient ? styles.selectValue : styles.selectPlaceholder} numberOfLines={1}>
                    {recipient ? recipient.fullName || recipient.email : 'Choose the new custodian'}
                  </Text>
                  {recipient ? (
                    <Text style={styles.selectSubValue} numberOfLines={1}>
                      {recipient.department}
                    </Text>
                  ) : null}
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Step 3 — the details */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.stepTitle}>{isRepair ? 'Describe the problem' : 'Reason / details'}</Text>
          </View>

          {isRepair ? (
            <>
              <View style={styles.fieldBlock}>
                <Text style={styles.label}>
                  Problem / Issue <Text style={styles.required}>*</Text>
                </Text>
                <View style={styles.textAreaWrapper}>
                  <TextInput
                    style={styles.textArea}
                    placeholder="What is wrong with the asset? e.g. Laptop does not turn on"
                    placeholderTextColor="#94A3B8"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    value={problem}
                    onChangeText={setProblem}
                  />
                </View>
                <Text style={styles.fieldHint}>
                  The date it is reported is stamped automatically when you submit.
                </Text>
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
                    numberOfLines={3}
                    textAlignVertical="top"
                    value={remarks}
                    onChangeText={setRemarks}
                  />
                </View>
              </View>
            </>
          ) : requestType ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>
                {NOTE_FIELD[requestType as Exclude<RequestType, 'Repair'>].label}{' '}
                <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.textAreaWrapper}>
                <TextInput
                  style={styles.textArea}
                  placeholder={NOTE_FIELD[requestType as Exclude<RequestType, 'Repair'>].placeholder}
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  value={note}
                  onChangeText={setNote}
                />
              </View>
              <Text style={styles.fieldHint}>
                Explain the reason and any specific instructions for the Asset Management Office.
              </Text>
            </View>
          ) : (
            <View style={styles.lockedHintCard}>
              <MaterialCommunityIcons name="cursor-default-click-outline" size={18} color="#64748B" />
              <Text style={styles.lockedHintText}>
                Choose a request type above and the fields for it will appear here.
              </Text>
            </View>
          )}

          {/* Step 4 — photo */}
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>4</Text>
            </View>
            <Text style={styles.stepTitle}>Photo</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>
              Photo / Attachment <Text style={styles.optional}>(Optional)</Text>
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
                <MaterialCommunityIcons name="image-plus" size={26} color="#94A3B8" />
                <Text style={styles.photoUploadText}>Add a photo</Text>
                <Text style={styles.photoUploadSubtext}>Take a new one or choose from your gallery</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.requestorRow}>
            <MaterialCommunityIcons name="account-circle-outline" size={20} color="#64748B" />
            <Text style={styles.requestorLabel}>Requesting as: </Text>
            <Text style={styles.requestorValue} numberOfLines={1}>
              {user?.full_name || 'You'}
            </Text>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelButton} activeOpacity={0.8} onPress={() => router.back()}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.createButton, !requestType && styles.createButtonDisabled]}
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

      {/* Asset picker — Active assets only */}
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

          {!assetsLoading && myAssets.length > 0 ? (
            <Text style={styles.pickerHint}>
              {activeAssetCount} of {myAssets.length} assets can be requested — only Active ones are
              selectable.
            </Text>
          ) : null}

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
                  // Only Active assets can be put into a request; the rest are
                  // shown greyed out so nothing looks like it silently vanished.
                  const unavailable = !isRequestableAsset(asset.status);
                  const selected = alreadySelected(asset.id);
                  const tone = statusTone(asset.status);
                  return (
                    <TouchableOpacity
                      key={String(asset.id)}
                      style={[
                        styles.pickerRow,
                        selected && styles.pickerRowSelected,
                        unavailable && styles.pickerRowDisabled,
                      ]}
                      activeOpacity={0.85}
                      disabled={unavailable}
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
                        <Text
                          style={[styles.pickerRowName, unavailable && styles.pickerRowNameDisabled]}
                          numberOfLines={1}
                        >
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
                        name={selected ? 'check-circle' : unavailable ? 'lock-outline' : 'plus-circle-outline'}
                        size={22}
                        color={selected ? '#16A34A' : unavailable ? '#CBD5E1' : '#1E3A5F'}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Transfer recipient picker */}
      <Modal
        visible={recipientModalVisible}
        animationType="slide"
        onRequestClose={() => setRecipientModalVisible(false)}
      >
        <SafeAreaView style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Transfer To</Text>
            <TouchableOpacity
              style={styles.pickerClose}
              onPress={() => setRecipientModalVisible(false)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchField}>
            <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or department..."
              placeholderTextColor="#94A3B8"
              value={recipientSearch}
              onChangeText={setRecipientSearch}
            />
          </View>

          {recipientsLoading ? (
            <View style={styles.pickerLoading}>
              <ActivityIndicator size="large" color="#1E3A5F" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.pickerList}>
              {filteredRecipients.length === 0 ? (
                <View style={styles.pickerEmpty}>
                  <MaterialCommunityIcons name="account-search-outline" size={42} color="#CBD5E1" />
                  <Text style={styles.pickerEmptyText}>No custodian found</Text>
                </View>
              ) : (
                filteredRecipients.map((person) => {
                  const selected = String(recipient?.id ?? '') === String(person.id);
                  return (
                    <TouchableOpacity
                      key={String(person.id)}
                      style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                      activeOpacity={0.85}
                      onPress={() => {
                        setRecipient(person);
                        setRecipientModalVisible(false);
                      }}
                    >
                      <View style={styles.avatarCircle}>
                        <Text style={styles.avatarInitial}>
                          {(person.fullName || person.email || '?').trim().charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.pickerRowText}>
                        <Text style={styles.pickerRowName} numberOfLines={1}>
                          {person.fullName || person.email}
                        </Text>
                        <Text style={styles.pickerRowCode} numberOfLines={1}>
                          {person.department}
                          {person.email ? ` • ${person.email}` : ''}
                        </Text>
                      </View>
                      <MaterialCommunityIcons
                        name={selected ? 'check-circle' : 'chevron-right'}
                        size={22}
                        color={selected ? '#16A34A' : '#CBD5E1'}
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
            <Text style={styles.scanSubHint}>Only your own Active assets can be requested</Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
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
  typeList: {
    gap: 10,
    marginBottom: 12,
  },
  typeCard: {
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
  typeCardActive: {
    borderColor: '#1E3A5F',
    backgroundColor: '#F8FAFF',
  },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeTextWrap: {
    flex: 1,
    gap: 2,
  },
  typeLabel: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  typeLabelActive: {
    color: '#1E3A5F',
  },
  typeTagline: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  outcomeCard: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  outcomeText: {
    flex: 1,
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 17,
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
    borderRadius: 14,
    height: 48,
  },
  assetActionText: {
    color: '#1E3A5F',
    fontSize: 14,
    fontWeight: '800',
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
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  assetChipThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
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
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 54,
    paddingVertical: 10,
  },
  selectFieldText: {
    flex: 1,
    gap: 2,
  },
  selectValue: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectPlaceholder: {
    fontSize: 14.5,
    color: '#94A3B8',
  },
  selectSubValue: {
    fontSize: 12,
    color: '#64748B',
  },
  textAreaWrapper: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
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
  lockedHintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },
  lockedHintText: {
    flex: 1,
    fontSize: 12.5,
    color: '#64748B',
    lineHeight: 17,
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
    borderWidth: 1,
    borderRadius: 999,
    height: 40,
  },
  priorityChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  photoUploadArea: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingVertical: 24,
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
    borderRadius: 12,
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
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  createButton: {
    flex: 1.4,
    backgroundColor: '#E53935',
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E53935',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  createButtonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  pickerContainer: {
    flex: 1,
    backgroundColor: '#F4F7FB',
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
    width: 42,
    height: 42,
    borderRadius: 14,
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
    height: 50,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  pickerHint: {
    marginHorizontal: 18,
    marginBottom: 8,
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
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
  pickerRowDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#EEF2F7',
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
  pickerRowNameDisabled: {
    color: '#94A3B8',
  },
  pickerRowCode: {
    fontSize: 12,
    color: '#64748B',
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8EEF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E3A5F',
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
  scanSubHint: {
    marginTop: 6,
    color: 'rgba(226,232,240,0.65)',
    fontSize: 12,
  },
});
