import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAsset, uploadAssetPhoto } from '../lib/assetService';
import QRViewModal from '../components/QRViewModal';
import { searchUsers } from '../lib/userService';
import * as ImagePicker from 'expo-image-picker';

const NAVY = '#1E3A5F';
const NAVY_DARK = '#0C134F';
const GOLD = '#FBBF24';

export default function AssetRegistryScreen() {
  const router = useRouter();
  const [assetId, setAssetId] = useState('Not generated');
  const [assetName, setAssetName] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState<'New' | 'Good' | 'Fair' | 'Poor' | ''>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [model, setModel] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [supplier, setSupplier] = useState('');
  const [department, setDepartment] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | number | null>(null);
  const [location, setLocation] = useState('');
  const [dateAcquired, setDateAcquired] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [warranty, setWarranty] = useState('');
  const [notes, setNotes] = useState('');
  const [lifespanMonths, setLifespanMonths] = useState('');
  const [maintenanceInterval, setMaintenanceInterval] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // User Search State
  const [userResults, setUserResults] = useState<any[]>([]);
  const [showUserResults, setShowUserResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Photo State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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

  const openQrModal = () => {
    if (assetId !== 'Not generated') {
      setQrModalVisible(true);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Permission to access gallery is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
    }
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
    { label: 'New', icon: 'sparkles', color: '#10B981' },
    { label: 'Good', icon: 'check-circle-outline', color: '#3B82F6' },
    { label: 'Fair', icon: 'alert-outline', color: '#F59E0B' },
    { label: 'Poor', icon: 'alert-circle-outline', color: '#EF4444' },
  ];

  const buildAssetCode = (): string => {
    const categoryAbbr = (category || 'AST')
      .split(/\s+/)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'AST';
    const nameInitials = (assetName || 'AST')
      .split(/\s+/)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'AST';
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `AST-${categoryAbbr}-${nameInitials}-${randomPart}`;
  };

  const generateAssetId = () => {
    // Validate required fields before generating ID
    if (!assetName || !category || !condition || !assignTo || !location || !dateAcquired) {
      setError('Please fill out all required fields marked with * before generating an ID.');
      return;
    }

    const newId = buildAssetCode();
    setAssetId(newId);
    setError(null); // Clear any previous errors
  };

  const parseDate = (value: string): Date | null => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;
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

  const addMonths = (dateStr: string, months: number): string => {
    const base = parseDate(dateStr);
    if (!base || !Number.isFinite(months) || months <= 0) return '';
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const handleRegisterAsset = async () => {
    if (!assetName || !category || !condition || !location || !selectedUserId) {
      setError('Please fill in all required fields and select a valid user/department');
      return;
    }

    const count = bulkMode ? Math.max(1, parseInt(quantity, 10) || 1) : 1;
    if (!bulkMode && assetId === 'Not generated') {
      setError('You must generate an Asset Code (QR Code) before you can register the asset.');
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const userJson = await AsyncStorage.getItem('user');
      if (!userJson) throw new Error('User session not found');

      // Upload the photo once; every bulk copy reuses the same picture file.
      let imageUrl = undefined;
      if (selectedImage) {
        try {
          imageUrl = await uploadAssetPhoto(bulkMode ? 'BULK' : assetId, selectedImage);
        } catch (uploadErr: any) {
          console.warn('Image upload failed:', uploadErr);
          const errorMsg = uploadErr.message || '';
          if (errorMsg.includes('bucket "assets" not found')) {
            throw new Error('Supabase Storage bucket "assets" not found. Please create it in your Supabase dashboard before uploading photos.');
          }
          throw new Error('Failed to upload asset photo. Please try again.');
        }
      }

      const expirationDate = lifespanMonths
        ? addMonths(dateAcquired, Number(lifespanMonths))
        : undefined;
      const nextMaintenanceDate = maintenanceInterval
        ? addMonths(dateAcquired, Number(maintenanceInterval))
        : undefined;

      // Unique codes within the batch: each copy gets its own code/QR so they
      // stay identifiable even with identical details.
      const codes: string[] = [];
      const used = new Set<string>();
      for (let i = 0; i < count; i++) {
        let code = i === 0 && !bulkMode ? assetId : buildAssetCode();
        while (used.has(code)) code = buildAssetCode();
        used.add(code);
        codes.push(code);
      }

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
          maintenanceInterval: Number(maintenanceInterval) || undefined,
          expirationDate,
          nextMaintenanceDate,
          notes,
          status: 'Acquired',
          imageUrl,
        });
      }

      setSuccess(`Successfully registered ${count} asset${count > 1 ? 's' : ''}.`);
      setTimeout(() => {
        router.push('/assets');
      }, 1500);
    } catch (err) {
      setError((err as Error).message || 'Unable to register asset with Supabase.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Asset Registry</Text>
          <Text style={styles.headerSubtitle}>Register new assets for the university</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error && (
          <View style={styles.errorBanner}>
            <MaterialCommunityIcons name="alert-circle" size={20} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {success && (
          <View style={styles.successBanner}>
            <MaterialCommunityIcons name="check-circle" size={20} color="#10B981" />
            <Text style={styles.successText}>{success}</Text>
          </View>
        )}

        {/* Basic Information Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="cube-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Basic Information</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Asset Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dell Laptop i7-12th Gen"
              placeholderTextColor="#9CA3AF"
              value={assetName}
              onChangeText={setAssetName}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Category *</Text>
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
            <Text style={styles.label}>Condition *</Text>
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
                    color={condition === option.label ? option.color : '#9CA3AF'}
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
            <Text style={styles.label}>Assign to (Name — Department) *</Text>
            <View style={[styles.inputWrapper, !selectedUserId && assignTo.length > 0 && styles.inputWrapperError]}>
              <MaterialCommunityIcons name="account-search-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Type to search users (name or dept)"
                value={assignTo}
                onChangeText={handleUserSearch}
                placeholderTextColor="#94A3B8"
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
            <Text style={styles.label}>Location *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Room 301, Engineering Building"
              placeholderTextColor="#9CA3AF"
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
            <Text style={styles.label}>Date Acquired *</Text>
            <TouchableOpacity style={styles.dateInput}>
              <MaterialCommunityIcons name="calendar" size={20} color="#6B7280" />
              <TextInput
                style={styles.dateInputField}
                placeholder="mm/dd/yyyy"
                placeholderTextColor="#9CA3AF"
                value={dateAcquired}
                onChangeText={setDateAcquired}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.twoColumnRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Purchase Price</Text>
              <View style={styles.priceInputContainer}>
                <Text style={styles.currencySymbol}>₱</Text>
                <TextInput
                  style={styles.priceInput}
                  placeholder="0.00"
                  placeholderTextColor="#9CA3AF"
                  value={purchasePrice}
                  onChangeText={setPurchasePrice}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
              <Text style={styles.label}>Warranty (months)</Text>
              <TextInput
                style={styles.input}
                placeholder="12"
                placeholderTextColor="#9CA3AF"
                value={warranty}
                onChangeText={setWarranty}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.twoColumnRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Lifespan (months)</Text>
              <TextInput
                style={styles.input}
                placeholder="60"
                placeholderTextColor="#9CA3AF"
                value={lifespanMonths}
                onChangeText={setLifespanMonths}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
              <Text style={styles.label}>Maintenance Interval (months)</Text>
              <TextInput
                style={styles.input}
                placeholder="6"
                placeholderTextColor="#9CA3AF"
                value={maintenanceInterval}
                onChangeText={setMaintenanceInterval}
                keyboardType="numeric"
              />
            </View>
          </View>
          {(lifespanMonths || maintenanceInterval) && (
            <Text style={styles.computedHint}>
              Expiration: {lifespanMonths ? addMonths(dateAcquired, Number(lifespanMonths)) || '—' : '—'} · Next maintenance:{' '}
              {maintenanceInterval ? addMonths(dateAcquired, Number(maintenanceInterval)) || '—' : '—'}
            </Text>
          )}
        </View>

        {/* Additional Information Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons name="text-box-outline" size={18} color={GOLD} />
            </View>
            <Text style={styles.sectionTitle}>Additional Information</Text>
          </View>

          <View style={styles.twoColumnRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Serial Number</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter serial number"
                placeholderTextColor="#9CA3AF"
                value={serialNumber}
                onChangeText={setSerialNumber}
              />
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Inspiron 3520"
                placeholderTextColor="#9CA3AF"
                value={model}
                onChangeText={setModel}
              />
            </View>
          </View>

          <View style={styles.twoColumnRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Manufacturer</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Dell Inc."
                placeholderTextColor="#9CA3AF"
                value={manufacturer}
                onChangeText={setManufacturer}
              />
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
              <Text style={styles.label}>Supplier</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. PC Express"
                placeholderTextColor="#9CA3AF"
                value={supplier}
                onChangeText={setSupplier}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Asset Photo</Text>
            <TouchableOpacity
              style={[styles.photoUploadBox, selectedImage && styles.photoUploadBoxActive]}
              onPress={pickImage}
              activeOpacity={0.8}
            >
              {selectedImage ? (
                <View style={styles.selectedImageContainer}>
                  <Image source={{ uri: selectedImage }} style={styles.selectedImage} />
                  <View style={styles.changePhotoOverlay}>
                    <MaterialCommunityIcons name="camera" size={24} color="#FFFFFF" />
                    <Text style={styles.changePhotoText}>Change Photo</Text>
                  </View>
                </View>
              ) : (
                <>
                  <MaterialCommunityIcons name="image-outline" size={40} color="#9CA3AF" />
                  <Text style={styles.photoUploadTitle}>Upload a file or drag and drop</Text>
                  <Text style={styles.photoUploadSubtitle}>PNG, JPG up to 10MB</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Additional notes or remarks..."
              placeholderTextColor="#9CA3AF"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
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
              onPress={() => setBulkMode((prev) => !prev)}
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
                  style={styles.quantityInput}
                  placeholder="e.g. 5"
                  placeholderTextColor="#9CA3AF"
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>
        </View>

        {/* Auto-Generated Asset Code & QR Section */}
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
              <View style={styles.idCardContent}>
                <TouchableOpacity
                  style={styles.qrContainer}
                  onPress={openQrModal}
                  disabled={assetId === 'Not generated'}
                  activeOpacity={0.7}
                >
                  {assetId === 'Not generated' ? (
                    <MaterialCommunityIcons name="qrcode-scan" size={60} color={NAVY} />
                  ) : (
                    <QRCode
                      value={assetId}
                      size={80}
                      color="black"
                      backgroundColor="white"
                    />
                  )}
                </TouchableOpacity>
                <View style={styles.idTextContainer}>
                  <Text style={styles.assetIdLabel}>ASSET CODE</Text>
                  <Text style={styles.assetIdText}>{assetId}</Text>
                  <Text style={styles.assetIdHint}>
                    Built from the category and asset name (e.g. AST-IE-DL-X7Q2). Bulk copies always get unique codes.
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          <TouchableOpacity style={styles.regenerateButton} onPress={generateAssetId} activeOpacity={0.8}>
            <MaterialCommunityIcons name="refresh" size={18} color={NAVY_DARK} />
            <Text style={styles.regenerateButtonText}>Generate Asset Code</Text>
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
        value={assetId}
        title={assetName || 'Asset QR Code'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
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
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${GOLD}22`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: NAVY,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
  },
  inputWrapperError: {
    borderColor: '#EF4444',
    borderWidth: 1.5,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 15,
    color: '#1E293B',
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
    color: '#1E293B',
  },
  searchResultDept: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  twoColumnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 10,
  },
  dateInputField: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  priceInputContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  currencySymbol: {
    fontSize: 14,
    fontWeight: '700',
    color: NAVY,
  },
  priceInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  photoUploadBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
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
    color: '#9CA3AF',
  },
  notesInput: {
    borderColor: '#E2E8F0',
    borderWidth: 1,
    height: 110,
    paddingTop: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
  },
  computedHint: {
    fontSize: 12,
    color: NAVY,
    fontWeight: '600',
    backgroundColor: `${GOLD}1A`,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  bulkHint: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
    marginBottom: 12,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bulkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flex: 1,
  },
  bulkToggleActive: {
    borderColor: NAVY,
    backgroundColor: `${NAVY}0D`,
  },
  bulkToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  bulkToggleTextActive: {
    color: NAVY,
  },
  quantityInputWrap: {
    flex: 1,
  },
  quantityInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1E293B',
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
    paddingVertical: 15,
    borderRadius: 14,
    gap: 8,
    elevation: 2,
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  regenerateButtonText: {
    color: NAVY_DARK,
    fontSize: 15,
    fontWeight: '800',
  },
  registerButton: {
    backgroundColor: GOLD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    marginBottom: 16,
    elevation: 3,
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  registerButtonText: {
    color: NAVY_DARK,
    fontSize: 16,
    fontWeight: '800',
  },
  conditionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  conditionCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  conditionLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    textAlign: 'center',
  },
  categoryRow: {
    gap: 10,
    paddingVertical: 4,
  },
  categoryCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryCardActive: {
    backgroundColor: NAVY,
    borderColor: NAVY,
  },
  categoryLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  categoryLabelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    gap: 8,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  successBanner: {
    backgroundColor: '#F0FDF4',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    gap: 8,
  },
  successText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});