import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { findExistingAssetCodes, registerAsset, uploadAssetPhoto } from '../lib/assetService';
import { describeUploadError, probeStorageUpload, type MediaAsset, type UploadedMedia } from '../lib/mediaUpload';
import QRViewModal from '../components/QRViewModal';
import { searchUsers } from '../lib/userService';
import * as ImagePicker from 'expo-image-picker';
import {
  assetCodeProblem,
  buildAssetCode,
  buildSequentialCodes,
  findDuplicateCodes,
  normalizeAssetCode,
  parseAssetCodeList,
} from '../lib/assetCode';

const NAVY = '#1E3A5F';
const NAVY_DARK = '#0C134F';
const GOLD = '#FBBF24';
const GOLD_SOFT = '#FDF3DC';
const BORDER = '#D8DEE8';
const TEXT_MAIN = '#0F172A';
const TEXT_MUTED = '#64748B';
const DANGER = '#DC2626';
const DANGER_SOFT = '#FEF2F2';

/** Upper bound for one bulk registration run. */
const MAX_BULK = 200;

/** Where the asset code comes from. */
type CodeMode = 'auto' | 'custom';
/** How a bulk run describes several custom codes. */
type BulkCodeStyle = 'list' | 'sequential';

export default function AssetRegistryScreen() {
  const router = useRouter();
  const [assetId, setAssetId] = useState('Not generated');
  const [assetName, setAssetName] = useState('');
  const [category, setCategory] = useState('');
  // Must stay inside the database enum: New | Excellent | Good | Fair | Existing.
  const [condition, setCondition] = useState<'New' | 'Excellent' | 'Good' | 'Fair' | 'Existing' | ''>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [model, setModel] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [supplier, setSupplier] = useState('');
  const [department, setDepartment] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | number | null>(null);
  const [location, setLocation] = useState('');
  const [dateAcquired, setDateAcquired] = useState('');
  // Which calendar is open — `null` when none. The auto-calculated dates can be
  // overridden by hand (the office sometimes holds the official dates).
  const [pickerField, setPickerField] = useState<
    'acquired' | 'lastMaintenance' | 'expiration' | 'nextMaintenance' | null
  >(null);
  const [expirationOverride, setExpirationOverride] = useState('');
  const [nextMaintenanceOverride, setNextMaintenanceOverride] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [warranty, setWarranty] = useState('');
  const [notes, setNotes] = useState('');
  const [lifespanMonths, setLifespanMonths] = useState('');
  const [lastMaintenanceDate, setLastMaintenanceDate] = useState('');
  const [maintenanceInterval, setMaintenanceInterval] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [quantity, setQuantity] = useState('1');
  // Asset code: auto-generated (AST-…) or the client's own existing code.
  const [codeMode, setCodeMode] = useState<CodeMode>('auto');
  const [customCode, setCustomCode] = useState('');
  // Bulk custom codes: one per line, or a sequential prefix/number range.
  const [bulkCodeStyle, setBulkCodeStyle] = useState<BulkCodeStyle>('list');
  const [codeListText, setCodeListText] = useState('');
  const [seqPrefix, setSeqPrefix] = useState('');
  const [seqStart, setSeqStart] = useState('1');
  /** Codes that passed the duplicate check and will be saved on Register. */
  const [plannedCodes, setPlannedCodes] = useState<string[]>([]);
  const [codeErrors, setCodeErrors] = useState<string[]>([]);
  const [checkingCodes, setCheckingCodes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // User Search State
  const [userResults, setUserResults] = useState<any[]>([]);
  const [showUserResults, setShowUserResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Photo State
  // The whole picker asset is kept, not just its URI: the picker's own base64
  // bytes and MIME type are what make the upload survive an Android
  // `content://` URI, so they must not be thrown away at pick time.
  const [selectedImage, setSelectedImage] = useState<MediaAsset | null>(null);
  const [storageCheck, setStorageCheck] = useState<'idle' | 'running'>('idle');

  // QR Modal State
  const [qrModalVisible, setQrModalVisible] = useState(false);

  const handleUserSearch = async (text: string) => {
    setAssignTo(text);
    setSelectedUserId(null); // Reset selection if typing
    if (text.length > 1) {
      setIsSearching(true);
      try {
        const results = await searchUsers(text);
        setUserResults(results);
        setShowUserResults(results.length > 0);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    } else {
      setUserResults([]);
      setShowUserResults(false);
    }
  };

  const selectUser = (user: any) => {
    setAssignTo(`${user.fullName} — ${user.departmentName}`);
    setSelectedUserId(user.id);
    setDepartment(user.departmentName);
    setShowUserResults(false);
  };

  /** The code the QR preview / sticker shows right now. */
  const previewCode =
    plannedCodes[0] ?? (codeMode === 'auto' && assetId !== 'Not generated' ? assetId : '');

  const openQrModal = () => {
    if (previewCode) {
      setQrModalVisible(true);
    }
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Permission to access gallery is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is required to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0]);
    }
  };

  /**
   * Upload a 1×1 test image through the exact path asset photos take, from
   * this phone, and report where it landed or why it could not.
   *
   * Exists because "the photo did not reach Storage" can only be answered on
   * the device that failed — the same upload from a laptop proves nothing.
   */
  const handleStorageCheck = async () => {
    setStorageCheck('running');
    const result = await probeStorageUpload();
    setStorageCheck('idle');
    Alert.alert(
      result.ok ? 'Storage check passed' : 'Storage check failed',
      result.ok
        ? `This phone uploaded a test image and read it back (${result.detail}). Asset photos will be saved.`
        : `${result.detail}\n\nNothing was saved. Send this message to support if it repeats.`,
    );
  };

  const handlePhotoPress = () => {
    Alert.alert('Asset Photo', 'Add a photo from your gallery or take one with the camera.', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const categoryOptions = [
    'Furnitures and Fixtures',
    'General and Office Equipment',
    'Info and Equipment',
    'laboratory Apparatus and equipment',
    'library books',
    'Motor vehicles',
    'P.E Equipment',
    'Low value Asset',
  ];

  const conditionOptions = [
    { label: 'New', icon: 'star-four-points', color: '#10B981' },
    { label: 'Excellent', icon: 'check-decagram', color: '#0EA5E9' },
    { label: 'Good', icon: 'check-circle-outline', color: '#3B82F6' },
    { label: 'Fair', icon: 'alert-outline', color: '#F59E0B' },
    { label: 'Existing', icon: 'history', color: '#8B5CF6' },
  ] as const;

  /** How many assets this run will create. */
  const batchCount = bulkMode
    ? Math.max(1, Math.min(MAX_BULK, parseInt(quantity, 10) || 1))
    : 1;

  /**
   * The codes this registration would use — no database access here, so it can
   * run on every render for the preview and is re-checked before saving.
   */
  const buildPlannedCodes = (): string[] => {
    if (codeMode === 'auto') {
      if (!bulkMode) return assetId && assetId !== 'Not generated' ? [assetId] : [];
      // Bulk auto: each copy needs its own random suffix, so generate the whole
      // list in one pass and never within a render loop.
      const generated: string[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < batchCount; i++) {
        let code = buildAssetCode({ category, name: assetName });
        while (seen.has(code)) code = buildAssetCode({ category, name: assetName });
        seen.add(code);
        generated.push(code);
      }
      return generated;
    }

    if (!bulkMode) {
      return customCode.trim() ? [normalizeAssetCode(customCode)] : [];
    }
    if (bulkCodeStyle === 'list') return parseAssetCodeList(codeListText);
    return buildSequentialCodes(seqPrefix, Number(seqStart) || 1, batchCount);
  };

  /**
   * Validate the current settings and remember the codes to save.
   *
   * Custom codes are checked against `assets.Asset_code` before they are
   * accepted — that is the duplicate guard the client asked for, so two assets
   * can never answer to the same printed code / QR scan.
   */
  const applyPlannedCodes = async (): Promise<
    { ok: true; codes: string[] } | { ok: false; problems: string[] }
  > => {
    const codes = buildPlannedCodes();
    const problems: string[] = [];

    if (codes.length === 0) {
      problems.push(
        codeMode === 'auto'
          ? 'Generate the asset code first.'
          : 'Enter at least one asset code.',
      );
    }
    if (bulkMode && codes.length > 0 && codes.length !== batchCount) {
      problems.push(
        `Bulk mode is set to ${batchCount} asset${batchCount > 1 ? 's' : ''} but ${codes.length} code${
          codes.length > 1 ? 's were' : ' was'
        } provided. Fix the codes or the copy count.`,
      );
    }
    const invalid = codes.filter((code) => assetCodeProblem(code));
    if (invalid.length > 0) {
      const firstProblem = assetCodeProblem(invalid[0]);
      problems.push(`"${invalid[0]}" cannot be used: ${firstProblem}`);
      if (invalid.length > 1) problems.push(`(${invalid.length - 1} more code(s) have the same problem.)`);
    }

    if (problems.length > 0) {
      setPlannedCodes([]);
      setCodeErrors(problems);
      return { ok: false, problems };
    }

    setCheckingCodes(true);
    try {
      const existing = await findExistingAssetCodes(codes);
      const duplicates = findDuplicateCodes(codes, existing);
      if (duplicates.length > 0) {
        const duplicateProblems = [
          `Already used: ${duplicates.join(', ')}.`,
          'Each asset needs its own unique code — enter a different code.',
        ];
        setPlannedCodes([]);
        setCodeErrors(duplicateProblems);
        return { ok: false, problems: duplicateProblems };
      }
      setPlannedCodes(codes);
      setCodeErrors([]);
      return { ok: true, codes };
    } catch (err) {
      const failureProblems = [
        (err as Error).message || 'Could not check the asset codes against the database.',
      ];
      setPlannedCodes([]);
      setCodeErrors(failureProblems);
      return { ok: false, problems: failureProblems };
    } finally {
      setCheckingCodes(false);
    }
  };

  const generateAssetId = async () => {
    // Validate required fields before generating the ID
    if (!assetName || !category || !condition || !assignTo || !location || !dateAcquired) {
      Alert.alert('Required Fields', 'Please fill out all required fields marked with * before generating an ID.');
      return;
    }

    if (codeMode === 'auto' && !bulkMode) {
      const newId = buildAssetCode({ category, name: assetName });
      setAssetId(newId);
      setPlannedCodes([newId]);
      setCodeErrors([]);
      setError(null); // Clear any previous errors
      return;
    }

    const result = await applyPlannedCodes();
    if (!result.ok) {
      Alert.alert('Asset Code Not Accepted', result.problems.join('\n\n'));
      return;
    }
    setError(null);
    if (!bulkMode) setAssetId(result.codes[0]);
    Alert.alert(
      codeMode === 'auto' ? 'Asset Codes Generated' : 'Codes Accepted',
      bulkMode
        ? `${result.codes.length} unique asset code${result.codes.length > 1 ? 's' : ''} ready. Each asset will be saved with its own code and QR sticker.`
        : `Asset code ${result.codes[0]} is free to use. Its QR sticker will encode that code.`,
    );
  };

  const parseDate = (value: string): Date | null => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;
    // A `yyyy-mm-dd` value is read as a local date, never as UTC — otherwise a
    // negative-offset device would render the calendar value a day early.
    const iso = isoToDate(trimmed);
    if (iso) return iso;
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      const [a, b, c] = parts.map(Number);
      if (a && b && c) {
        const d2 = new Date(c, a - 1, b);
        if (!Number.isNaN(d2.getTime())) return d2;
      }
    }
    return null;
  };

  /** yyyy-mm-dd → Date (local midnight), so `setMonth` never drifts a day. */
  const isoToDate = (value: string): Date | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
    if (!match) return null;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const dateToIso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /** Whole months, clamped to the target month's last day (Jan 31 + 1 → Feb 28/29). */
  const addMonths = (dateStr: string, months: number): string => {
    const base = parseDate(dateStr);
    if (!base || !Number.isFinite(months) || months <= 0) return '';
    const targetMonth = base.getMonth() + months;
    const lastDay = new Date(base.getFullYear(), targetMonth + 1, 0).getDate();
    return dateToIso(new Date(base.getFullYear(), targetMonth, Math.min(base.getDate(), lastDay)));
  };

  const formatDateDisplay = (dateStr: string): string => {
    const d = parseDate(dateStr);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  };

  // Auto-calculated values shown in the Lifespan & Maintenance section; an
  // explicit pick wins over the calculation.
  const autoExpirationDate = lifespanMonths ? addMonths(dateAcquired, Number(lifespanMonths)) : '';
  const autoNextMaintenanceDate = maintenanceInterval
    ? addMonths(lastMaintenanceDate || dateAcquired, Number(maintenanceInterval))
    : '';
  const expirationDate = expirationOverride || autoExpirationDate;
  const nextMaintenanceDate = nextMaintenanceOverride || autoNextMaintenanceDate;

  const pickerValue = (): Date => {
    const iso =
      pickerField === 'acquired'
        ? dateAcquired
        : pickerField === 'lastMaintenance'
          ? lastMaintenanceDate
          : pickerField === 'expiration'
            ? expirationDate
            : nextMaintenanceDate;
    return isoToDate(iso) ?? new Date();
  };

  const applyPickedDate = (selected: Date) => {
    const iso = dateToIso(selected);
    if (pickerField === 'acquired') setDateAcquired(iso);
    else if (pickerField === 'lastMaintenance') setLastMaintenanceDate(iso);
    else if (pickerField === 'expiration') setExpirationOverride(iso);
    else if (pickerField === 'nextMaintenance') setNextMaintenanceOverride(iso);
  };

  /** The calendar opens directly under the field it belongs to. */
  const renderDatePicker = (field: NonNullable<typeof pickerField>) => {
    if (pickerField !== field) return null;
    return (
      <View style={styles.datePickerWrap}>
        <DateTimePicker
          value={pickerValue()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onValueChange={(_event, selected) => {
            if (Platform.OS !== 'ios') setPickerField(null);
            if (selected) applyPickedDate(selected);
          }}
          onDismiss={() => setPickerField(null)}
        />
        {Platform.OS === 'ios' ? (
          <TouchableOpacity
            style={styles.datePickerDone}
            activeOpacity={0.85}
            onPress={() => setPickerField(null)}
          >
            <Text style={styles.datePickerDoneText}>Done</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const handleRegisterAsset = async () => {
    if (!assetName || !category || !condition || !location || !selectedUserId) {
      Alert.alert('Missing Information', 'Please fill in all required fields and select a valid user/department');
      return;
    }

    const count = batchCount;

    // Resolve + duplicate-check the codes first: the registration must never
    // start with a code that another asset already uses.
    const codeCheck = await applyPlannedCodes();
    if (!codeCheck.ok) {
      Alert.alert('Asset Code Required', codeCheck.problems.join('\n\n'));
      return;
    }
    const codes = codeCheck.codes;
    if (!bulkMode && codes[0] !== assetId) setAssetId(codes[0]);

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const userJson = await AsyncStorage.getItem('user');
      if (!userJson) throw new Error('User session not found');

      // Upload the photo once; every bulk copy reuses the same picture file.
      // A photo failure must NEVER block the registration: the asset still gets
      // saved so it shows up in Supabase and on the web, and the user is told
      // the photo was skipped — with the real reason, not a generic failure.
      let photo: UploadedMedia | null = null;
      let photoWarning = '';
      if (selectedImage) {
        try {
          photo = await uploadAssetPhoto(bulkMode ? 'BULK' : codes[0], selectedImage);
        } catch (uploadErr) {
          console.warn('Image upload failed:', uploadErr);
          photoWarning =
            'The asset was registered, but the photo was NOT saved: '
            + describeUploadError(uploadErr)
            + ' Tap "Storage check" on this screen to test the upload from this phone.';
        }
      }

      // `codes` already holds one unique, duplicate-checked code per asset —
      // auto-generated or the client's own — and each gets its own record + QR.
      for (const code of codes) {
        await registerAsset({
          assetId: code,
          title: assetName,
          userId: selectedUserId, // Use the ID of the assigned user
          category,
          condition,
          serialNumber,
          model,
          manufacturer,
          supplier,
          department,
          custodian: assignTo.split(' — ')[0],
          location,
          acquisitionDate: dateAcquired,
          purchasePrice: Number(purchasePrice) || undefined,
          warrantyMonths: Number(warranty) || undefined,
          lifespanMonths: Number(lifespanMonths) || undefined,
          lastMaintenanceDate: lastMaintenanceDate || undefined,
          maintenanceInterval: Number(maintenanceInterval) || undefined,
          expirationDate: expirationDate || undefined,
          nextMaintenanceDate: nextMaintenanceDate || undefined,
          notes,
          status: 'Acquired',
          photo,
        });
      }

      Alert.alert(
        'Success',
        `Successfully registered ${count} asset${count > 1 ? 's' : ''}.` +
          (photoWarning ? `\n\n${photoWarning}` : '')
      );
      router.push('/assets');
    } catch (err) {
      Alert.alert('Registration Failed', (err as Error).message || 'Unable to register asset with Supabase.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Asset Registry</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.screenBody} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Basic Information Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="cube-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Basic Information</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Asset Name <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dell Laptop i7-12th Gen"
              placeholderTextColor={TEXT_MUTED}
              value={assetName}
              onChangeText={setAssetName}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Category <Text style={styles.requiredStar}>*</Text>
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {categoryOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.categoryCard,
                    category === option && styles.categoryCardActive,
                  ]}
                  onPress={() => setCategory(option)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.categoryLabel, category === option && styles.categoryLabelActive]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Condition <Text style={styles.requiredStar}>*</Text>
            </Text>
            <View style={styles.conditionRow}>
              {conditionOptions.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.conditionCard,
                    condition === option.label && { borderColor: option.color, backgroundColor: option.color + '10' },
                  ]}
                  onPress={() => setCondition(option.label as any)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={option.icon as any}
                    size={24}
                    color={condition === option.label ? option.color : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.conditionLabel,
                      condition === option.label && { color: option.color, fontWeight: '700' },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Assignment & Location Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="account-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Assignment & Location</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Assign to (Name — Department) <Text style={styles.requiredStar}>*</Text>
            </Text>
            <View style={[styles.inputWrapper, !selectedUserId && assignTo.length > 0 && styles.inputWrapperError]}>
              <MaterialCommunityIcons name="account-search-outline" size={19} color={TEXT_MUTED} style={styles.inputIcon} />
              <TextInput
                style={styles.inputInner}
                placeholder="Search by name or dept"
                value={assignTo}
                onChangeText={handleUserSearch}
                placeholderTextColor={TEXT_MUTED}
              />
              {isSearching && <ActivityIndicator size="small" color={GOLD} style={{ marginRight: 10 }} />}
            </View>

            {showUserResults && (
              <View style={styles.searchResultsContainer}>
                <FlatList
                  data={userResults}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.searchResultItem}
                      onPress={() => selectUser(item)}
                    >
                      <View>
                        <Text style={styles.searchResultName}>{item.fullName}</Text>
                        <Text style={styles.searchResultDept}>{item.departmentName}</Text>
                      </View>
                      <MaterialCommunityIcons name="plus-circle-outline" size={20} color={GOLD} />
                    </TouchableOpacity>
                  )}
                  style={styles.searchResultsList}
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Location <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Room 301, Engineering Building"
              placeholderTextColor={TEXT_MUTED}
              value={location}
              onChangeText={setLocation}
            />
          </View>
        </View>

        {/* Acquisition Details Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="calendar-check-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Acquisition Details</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Date Acquired <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TouchableOpacity
              style={styles.dateInput}
              activeOpacity={0.8}
              onPress={() => setPickerField('acquired')}
              accessibilityRole="button"
              accessibilityLabel="Choose the date the asset was acquired"
            >
              <MaterialCommunityIcons name="calendar" size={20} color={NAVY} />
              <Text
                style={[styles.dateInputField, !dateAcquired && styles.dateInputPlaceholder]}
                numberOfLines={1}
              >
                {dateAcquired ? formatDateDisplay(dateAcquired) : 'mm/dd/yyyy'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={18} color={TEXT_MUTED} />
            </TouchableOpacity>
            <Text style={styles.helperText}>Tap to pick the date from the calendar</Text>
            {renderDatePicker('acquired')}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Purchase Price</Text>
            <View style={styles.priceInputContainer}>
              <Text style={styles.currencySymbol}>₱</Text>
              <TextInput
                style={styles.priceInput}
                placeholder="0.00"
                placeholderTextColor={TEXT_MUTED}
                value={purchasePrice}
                onChangeText={setPurchasePrice}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Warranty (months)</Text>
            <TextInput
              style={styles.input}
              placeholder="12"
              placeholderTextColor={TEXT_MUTED}
              value={warranty}
              onChangeText={setWarranty}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Bulk Register Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="layers-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Bulk Register</Text>
          </View>
          <Text style={styles.bulkHint}>
            Register several copies with the same details. Each copy gets its own unique asset code and QR, so requesting or tracking one copy never affects the others.
          </Text>
          <View style={styles.bulkRow}>
            <TouchableOpacity
              style={[styles.bulkToggle, bulkMode && styles.bulkToggleActive]}
              onPress={() => {
                // The accepted code list belongs to the previous mode, so drop it
                // — Register always re-checks the codes anyway.
                setBulkMode((prev) => !prev);
                setPlannedCodes([]);
                setCodeErrors([]);
              }}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name={bulkMode ? 'toggle-switch' : 'toggle-switch-off-outline'}
                size={28}
                color={bulkMode ? NAVY : '#94A3B8'}
              />
              <Text style={[styles.bulkToggleText, bulkMode && styles.bulkToggleTextActive]}>
                {bulkMode ? 'Bulk mode ON' : 'Bulk mode OFF'}
              </Text>
            </TouchableOpacity>
            {bulkMode && (
              <View style={styles.quantityInputWrap}>
                <Text style={styles.label}>Copies</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5"
                  placeholderTextColor={TEXT_MUTED}
                  value={quantity}
                  onChangeText={(text) => {
                    setQuantity(text);
                    setPlannedCodes([]);
                    setCodeErrors([]);
                  }}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>
        </View>

        {/* Lifespan & Maintenance Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="calendar-heart" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Lifespan & Maintenance</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Lifespan (months)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 60"
              placeholderTextColor={TEXT_MUTED}
              value={lifespanMonths}
              onChangeText={setLifespanMonths}
              keyboardType="numeric"
            />
            <Text style={styles.helperText}>Asset will expire after this many months</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Expiration Date (Auto-Calculated)</Text>
            <TouchableOpacity
              style={[styles.autoCalcInput, styles.autoCalcFull, !expirationDate && styles.autoCalcInputEmpty]}
              activeOpacity={0.8}
              onPress={() => setPickerField('expiration')}
              accessibilityRole="button"
              accessibilityLabel="Choose the expiration date from the calendar"
            >
              <MaterialCommunityIcons name="calendar-clock" size={18} color={NAVY} />
              <Text style={[styles.autoCalcText, !expirationDate && styles.autoCalcPlaceholder]}>
                {expirationDate ? formatDateDisplay(expirationDate) : 'mm/dd/yyyy'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={18} color="#A08B4E" />
            </TouchableOpacity>
            <Text style={styles.helperText}>
              Auto-calculated: Acquisition Date + Lifespan — tap to pick a different date
            </Text>
            {expirationOverride ? (
              <TouchableOpacity
                style={styles.autoResetChip}
                activeOpacity={0.8}
                onPress={() => setExpirationOverride('')}
              >
                <MaterialCommunityIcons name="refresh" size={13} color={NAVY} />
                <Text style={styles.autoResetText}>
                  Reset to auto ({autoExpirationDate ? formatDateDisplay(autoExpirationDate) : 'not set'})
                </Text>
              </TouchableOpacity>
            ) : null}
            {renderDatePicker('expiration')}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Last Maintenance Date (Optional)</Text>
            <TouchableOpacity
              style={styles.dateInput}
              activeOpacity={0.8}
              onPress={() => setPickerField('lastMaintenance')}
              accessibilityRole="button"
              accessibilityLabel="Choose the last maintenance date"
            >
              <MaterialCommunityIcons name="calendar" size={20} color={NAVY} />
              <Text
                style={[styles.dateInputField, !lastMaintenanceDate && styles.dateInputPlaceholder]}
                numberOfLines={1}
              >
                {lastMaintenanceDate ? formatDateDisplay(lastMaintenanceDate) : 'mm/dd/yyyy'}
              </Text>
              {lastMaintenanceDate ? (
                <TouchableOpacity
                  onPress={() => setLastMaintenanceDate('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons name="close-circle" size={17} color={TEXT_MUTED} />
                </TouchableOpacity>
              ) : (
                <MaterialCommunityIcons name="chevron-down" size={18} color={TEXT_MUTED} />
              )}
            </TouchableOpacity>
            <Text style={styles.helperText}>
              Optional — tap to pick from the calendar. If left empty, next maintenance is calculated from the
              registration date
            </Text>
            {renderDatePicker('lastMaintenance')}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Maintenance Interval (months)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 6"
              placeholderTextColor={TEXT_MUTED}
              value={maintenanceInterval}
              onChangeText={setMaintenanceInterval}
              keyboardType="numeric"
            />
            <Text style={styles.helperText}>How often should maintenance be done?</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Next Maintenance Date (Auto-Calculated)</Text>
            <TouchableOpacity
              style={[styles.autoCalcInput, styles.autoCalcFull, !nextMaintenanceDate && styles.autoCalcInputEmpty]}
              activeOpacity={0.8}
              onPress={() => setPickerField('nextMaintenance')}
              accessibilityRole="button"
              accessibilityLabel="Choose the next maintenance date from the calendar"
            >
              <MaterialCommunityIcons name="calendar-refresh" size={18} color={NAVY} />
              <Text style={[styles.autoCalcText, !nextMaintenanceDate && styles.autoCalcPlaceholder]}>
                {nextMaintenanceDate ? formatDateDisplay(nextMaintenanceDate) : 'mm/dd/yyyy'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={18} color="#A08B4E" />
            </TouchableOpacity>
            <Text style={styles.helperText}>
              Auto-calculated: Last Maintenance (or Registration Date) + Interval — tap to pick a different date
            </Text>
            {nextMaintenanceOverride ? (
              <TouchableOpacity
                style={styles.autoResetChip}
                activeOpacity={0.8}
                onPress={() => setNextMaintenanceOverride('')}
              >
                <MaterialCommunityIcons name="refresh" size={13} color={NAVY} />                <Text style={styles.autoResetText}>
                  Reset to auto (
                  {autoNextMaintenanceDate ? formatDateDisplay(autoNextMaintenanceDate) : 'not set'})
                </Text>
              </TouchableOpacity>
            ) : null}
            {renderDatePicker('nextMaintenance')}
          </View>
        </View>

        {/* Additional Information Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="text-box-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Additional Information</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Serial Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. SN-123456"
              placeholderTextColor={TEXT_MUTED}
              value={serialNumber}
              onChangeText={setSerialNumber}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Model</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Inspiron"
              placeholderTextColor={TEXT_MUTED}
              autoCapitalize="words"
              value={model}
              onChangeText={setModel}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Manufacturer</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dell Inc."
              placeholderTextColor={TEXT_MUTED}
              value={manufacturer}
              onChangeText={setManufacturer}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Supplier</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. PC Express"
              placeholderTextColor={TEXT_MUTED}
              value={supplier}
              onChangeText={setSupplier}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Asset Photo</Text>
            <TouchableOpacity
              style={[styles.photoUploadBox, selectedImage && styles.photoUploadBoxActive]}
              onPress={handlePhotoPress}
              activeOpacity={0.8}
            >
              {selectedImage ? (
                <View style={styles.selectedImageContainer}>
                  <Image source={{ uri: selectedImage.uri }} style={styles.selectedImage} />
                  <View style={styles.changePhotoOverlay}>
                    <MaterialCommunityIcons name="camera" size={24} color="#FFFFFF" />
                    <Text style={styles.changePhotoText}>Change Photo</Text>
                  </View>
                </View>
              ) : (
                <>
                  <MaterialCommunityIcons name="image-outline" size={40} color="#94A3B8" />
                  <Text style={styles.photoUploadTitle}>Tap to add a photo</Text>
                  <Text style={styles.photoUploadSubtitle}>Take a new one or pick from your gallery</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.storageCheckLink}
              onPress={handleStorageCheck}
              disabled={storageCheck === 'running'}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={storageCheck === 'running' ? 'timer-sand' : 'cloud-check-outline'}
                size={16}
                color={TEXT_MUTED}
              />
              <Text style={styles.storageCheckLinkText}>
                {storageCheck === 'running' ? 'Testing Supabase Storage…' : 'Storage check'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Additional notes or remarks..."
              placeholderTextColor={TEXT_MUTED}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* Asset Code & QR Section — auto-generated OR the client's own code */}
        <View style={styles.idCardSection}>
          <View style={styles.idCard}>
            <LinearGradient
              colors={[NAVY_DARK, NAVY]}
              style={styles.idCardGradient}
            >
              <View style={styles.idCardHeader}>
                <MaterialCommunityIcons name="qrcode-scan" size={16} color={GOLD} />
                <Text style={styles.idCardTitle}>ASSET CODE & QR STICKER</Text>
              </View>

              {/* Where the code comes from. */}
              <View style={styles.modeRow}>
                {(
                  [
                    { key: 'auto', icon: 'auto-fix', label: 'Auto-generate' },
                    { key: 'custom', icon: 'barcode-scan', label: "Client's code" },
                  ] as const
                ).map((option) => {
                  const active = codeMode === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.modeChip, active && styles.modeChipActive]}
                      activeOpacity={0.85}
                      onPress={() => {
                        setCodeMode(option.key);
                        setPlannedCodes([]);
                        setCodeErrors([]);
                        if (option.key === 'auto') setAssetId('Not generated');
                      }}
                    >
                      <MaterialCommunityIcons
                        name={option.icon as any}
                        size={14}
                        color={active ? NAVY_DARK : 'rgba(255,255,255,0.7)'}
                      />
                      <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.idCardContent}>
                <TouchableOpacity
                  style={styles.qrContainer}
                  onPress={openQrModal}
                  disabled={!previewCode}
                  activeOpacity={0.7}
                >
                  {previewCode ? (
                    <QRCode value={previewCode} size={80} color="black" backgroundColor="white" />
                  ) : (
                    <MaterialCommunityIcons name="qrcode-scan" size={60} color={NAVY} />
                  )}
                </TouchableOpacity>
                <View style={styles.idTextContainer}>
                  <Text style={styles.assetIdLabel}>ASSET CODE</Text>
                  <Text style={styles.assetIdText}>
                    {previewCode || 'Not generated'}
                    {plannedCodes.length > 1 ? `  +${plannedCodes.length - 1} more` : ''}
                  </Text>
                  <Text style={styles.assetIdHint}>
                    {codeMode === 'auto'
                      ? 'Built from the category and asset name (e.g. AST-IE-DL-X7Q2). Bulk copies always get unique codes.'
                      : 'The QR sticker encodes this exact code, so scanning it opens this asset.'}
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* Client's own code — single asset. */}
          {codeMode === 'custom' && !bulkMode ? (
            <View style={styles.customBox}>
              <Text style={styles.label}>
                Existing Asset Code <Text style={styles.requiredStar}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. NUL-ITSO-2024-001"
                placeholderTextColor={TEXT_MUTED}
                value={customCode}
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={(text) => {
                  setCustomCode(text);
                  setPlannedCodes([]);
                  setCodeErrors([]);
                }}
              />
              <Text style={styles.helperText}>
                Type the code already printed on the asset&apos;s sticker. It is checked against every
                registered asset before it is accepted, so no two assets can share a code or QR.
              </Text>
            </View>
          ) : null}

          {/* Client's codes — bulk run. */}
          {codeMode === 'custom' && bulkMode ? (
            <View style={styles.customBox}>
              <View style={styles.modeRowLight}>
                {(
                  [
                    { key: 'list', label: 'One code per line' },
                    { key: 'sequential', label: 'Sequential codes' },
                  ] as const
                ).map((option) => {
                  const active = bulkCodeStyle === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.segmentChip, active && styles.segmentChipActive]}
                      activeOpacity={0.85}
                      onPress={() => {
                        setBulkCodeStyle(option.key);
                        setPlannedCodes([]);
                        setCodeErrors([]);
                      }}
                    >
                      <Text
                        style={[styles.segmentChipText, active && styles.segmentChipTextActive]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {bulkCodeStyle === 'list' ? (
                <>
                  <Text style={styles.label}>Asset codes</Text>
                  <TextInput
                    style={[styles.input, styles.codeListInput]}
                    placeholder={'NUL-ASSET-001\nNUL-ASSET-002\nNUL-ASSET-003'}
                    placeholderTextColor={TEXT_MUTED}
                    value={codeListText}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    multiline
                    textAlignVertical="top"
                    onChangeText={(text) => {
                      setCodeListText(text);
                      setPlannedCodes([]);
                      setCodeErrors([]);
                    }}
                  />
                  <Text style={styles.helperText}>
                    One code per line (commas also work). {batchCount} needed for this batch — each line
                    becomes its own asset record with its own QR sticker.
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.fieldRow}>
                    <View style={styles.fieldRowItem}>
                      <Text style={styles.label}>Code prefix</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. NUL-ASSET-"
                        placeholderTextColor={TEXT_MUTED}
                        value={seqPrefix}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        onChangeText={(text) => {
                          setSeqPrefix(text);
                          setPlannedCodes([]);
                          setCodeErrors([]);
                        }}
                      />
                    </View>
                    <View style={styles.fieldRowItemSmall}>
                      <Text style={styles.label}>Start at</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="1"
                        placeholderTextColor={TEXT_MUTED}
                        value={seqStart}
                        keyboardType="numeric"
                        onChangeText={(text) => {
                          setSeqStart(text);
                          setPlannedCodes([]);
                          setCodeErrors([]);
                        }}
                      />
                    </View>
                  </View>
                  <Text style={styles.helperText}>
                    {batchCount} sequential code{batchCount > 1 ? 's' : ''} will be built from that prefix
                    (e.g. {buildSequentialCodes(seqPrefix || 'NUL-ASSET-', Number(seqStart) || 1, 1)[0] ??
                      'NUL-ASSET-001'}
                    …). Set the copy count above.
                  </Text>
                </>
              )}
            </View>
          ) : null}

          {codeErrors.length > 0 ? (
            <View style={styles.codeErrorBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={DANGER} />
              <View style={styles.codeErrorTextWrap}>
                {codeErrors.map((problem) => (
                  <Text key={problem} style={styles.codeErrorText}>
                    {problem}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {plannedCodes.length > 0 ? (
            <View style={styles.codeListBox}>
              <Text style={styles.codeListTitle}>
                {plannedCodes.length === 1
                  ? 'Code accepted'
                  : `${plannedCodes.length} codes accepted`}
              </Text>
              <View style={styles.codeChipRow}>
                {plannedCodes.slice(0, 6).map((code) => (
                  <View key={code} style={styles.codeChip}>
                    <Text style={styles.codeChipText}>{code}</Text>
                  </View>
                ))}
                {plannedCodes.length > 6 ? (
                  <View style={[styles.codeChip, styles.codeChipMore]}>
                    <Text style={styles.codeChipMoreText}>+{plannedCodes.length - 6}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.regenerateButton, checkingCodes && { opacity: 0.7 }]}
            onPress={generateAssetId}
            disabled={checkingCodes}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name={checkingCodes ? 'progress-clock' : codeMode === 'auto' ? 'refresh' : 'check-decagram'}
              size={18}
              color={NAVY_DARK}
            />
            <Text style={styles.regenerateButtonText}>
              {checkingCodes
                ? 'Checking codes…'
                : codeMode === 'auto'
                  ? bulkMode
                    ? 'Generate Asset Codes'
                    : 'Generate Asset Code'
                  : bulkMode
                    ? 'Check & Use These Codes'
                    : 'Check & Use This Code'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Register Button */}
        <TouchableOpacity
          style={[styles.registerButton, saving && { opacity: 0.7 }]}
          onPress={handleRegisterAsset}
          disabled={saving}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="plus" size={20} color={NAVY_DARK} />
          <Text style={styles.registerButtonText}>
            {saving
              ? 'Registering...'
              : bulkMode
              ? `Register ${Math.max(1, parseInt(quantity, 10) || 1)} Assets`
              : 'Register Asset'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <QRViewModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        value={previewCode}
        title={assetName || 'Asset QR Code'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY_DARK,
  },
  screenBody: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  header: {
    backgroundColor: NAVY_DARK,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerRight: {
    width: 42,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(253, 184, 51, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: NAVY_DARK,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_MAIN,
    marginBottom: 10,
  },
  requiredStar: {
    color: '#EAB308',
    fontWeight: '800',
  },
  // Assign-to search: the wrapper draws the field border, the input inside it
  // must not draw a second one (that used to render as two stacked boxes).
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    height: 50,
  },
  inputWrapperError: {
    borderColor: '#EF4444',
  },
  inputIcon: {
    marginRight: 10,
  },
  inputInner: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 14.5,
    color: TEXT_MAIN,
  },
  input: {
    flex: 1,
    height: 50,
    paddingHorizontal: 14,
    fontSize: 14.5,
    color: TEXT_MAIN,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  inputMultiline: {
    flex: 0,
    height: 110,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  searchResultsContainer: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    maxHeight: 250,
  },
  searchResultsList: {
    padding: 4,
  },
  searchResultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MAIN,
  },
  searchResultDept: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  dateInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    gap: 8,
    height: 50,
  },
  dateInputField: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 14.5,
    color: TEXT_MAIN,
  },
  dateInputPlaceholder: {
    color: TEXT_MUTED,
    fontSize: 14.5,
  },
  datePickerWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    marginBottom: 16,
  },
  datePickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: NAVY,
  },
  datePickerDoneText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  autoResetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  autoResetText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: NAVY,
  },
  priceInputContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    gap: 8,
    height: 50,
  },
  currencySymbol: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },
  priceInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 14.5,
    color: TEXT_MAIN,
  },
  autoCalcInput: {
    backgroundColor: GOLD_SOFT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.55)',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
  },
  autoCalcFull: {
    marginBottom: 4,
  },
  autoCalcText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: NAVY,
  },
  autoCalcPlaceholder: {
    fontWeight: '500',
    color: '#A08B4E',
  },
  autoCalcInputEmpty: {
    opacity: 1,
  },
  helperText: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 8,
    lineHeight: 18,
  },
  photoUploadBox: {
    backgroundColor: '#FAFBFC',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D3DAE4',
    borderStyle: 'dashed',
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoUploadBoxActive: {
    borderColor: GOLD,
    borderStyle: 'solid',
    paddingVertical: 0,
    height: 200,
  },
  storageCheckLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  storageCheckLinkText: {
    fontSize: 13,
    color: TEXT_MUTED,
    textDecorationLine: 'underline',
  },
  selectedImageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  selectedImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  changePhotoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  changePhotoText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  photoUploadTitle: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: NAVY,
  },
  photoUploadSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#94A3B8',
  },

  bulkHint: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 19,
    marginBottom: 12,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  bulkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flex: 1,
  },
  bulkToggleActive: {
    borderColor: NAVY,
    backgroundColor: `${NAVY}0D`,
  },
  bulkToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
  },
  bulkToggleTextActive: {
    color: NAVY,
  },
  quantityInputWrap: {
    flex: 1,
  },
  idCardSection: {
    marginBottom: 18,
    gap: 12,
  },
  idCard: {
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  idCardGradient: {
    padding: 20,
  },
  idCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  idCardTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    opacity: 0.85,
  },
  idCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  modeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  modeChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  modeChipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
  },
  modeChipTextActive: {
    color: NAVY_DARK,
  },
  customBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 6,
  },
  modeRowLight: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  segmentChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#F4F7FB',
  },
  segmentChipActive: {
    backgroundColor: `${NAVY}12`,
    borderColor: NAVY,
  },
  segmentChipText: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  segmentChipTextActive: {
    color: NAVY,
  },
  codeListInput: {
    minHeight: 96,
    paddingTop: 12,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldRowItem: {
    flex: 2,
  },
  fieldRowItemSmall: {
    flex: 1,
  },
  codeErrorBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: DANGER_SOFT,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    padding: 12,
  },
  codeErrorTextWrap: {
    flex: 1,
    gap: 4,
  },
  codeErrorText: {
    color: DANGER,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  codeListBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  codeListTitle: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '800',
  },
  codeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  codeChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  codeChipText: {
    color: '#065F46',
    fontSize: 11,
    fontWeight: '700',
  },
  codeChipMore: {
    justifyContent: 'center',
    borderColor: '#6EE7B7',
  },
  codeChipMoreText: {
    color: '#047857',
    fontSize: 11,
    fontWeight: '800',
  },
  qrContainer: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 14,
  },
  idTextContainer: {
    flex: 1,
  },
  assetIdLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  assetIdText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  assetIdHint: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
  regenerateButton: {
    backgroundColor: GOLD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    gap: 8,
    elevation: 2,
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    height: 48,
  },
  regenerateButtonText: {
    color: NAVY_DARK,
    fontSize: 14,
    fontWeight: '800',
  },
  registerButton: {
    backgroundColor: GOLD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    gap: 8,
    marginBottom: 16,
    elevation: 3,
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    height: 48,
  },
  registerButtonText: {
    color: NAVY_DARK,
    fontSize: 14,
    fontWeight: '800',
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  conditionCard: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 92,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  conditionLabel: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: '500',
    textAlign: 'center',
  },
  categoryRow: {
    gap: 12,
    paddingVertical: 6,
  },
  categoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  categoryCardActive: {
    backgroundColor: NAVY,
    borderColor: NAVY,
  },
  categoryLabel: {
    fontSize: 13,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  categoryLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});