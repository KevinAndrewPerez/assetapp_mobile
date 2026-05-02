import React, { useState } from 'react';
import {
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
import { registerAsset } from '../lib/assetService';

export default function AssetRegistryScreen() {
  const router = useRouter();
  const [assetId] = useState('AST-79645262-ZTBA');
  const [assetName, setAssetName] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [model, setModel] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [department, setDepartment] = useState('');
  const [unitHead, setUnitHead] = useState('');
  const [location, setLocation] = useState('');
  const [dateAcquired, setDateAcquired] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [warranty, setWarranty] = useState('');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleRegisterAsset = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await registerAsset({
        assetId,
        title: assetName,
        category,
        condition,
        serialNumber,
        model,
        manufacturer,
        department,
        custodian: unitHead,
        location,
        acquisitionDate: dateAcquired,
        purchasePrice: Number(purchasePrice) || undefined,
        warrantyMonths: Number(warranty) || undefined,
        supplier,
        notes,
        status: 'Acquired',
      });

      setSuccess('Asset registered successfully.');
      router.push('/assets');
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
          <MaterialCommunityIcons name="arrow-left" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Asset Registry</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Auto-Generated Asset ID Section */}
        <View style={styles.idCardSection}>
          <View style={styles.idCard}>
            <View style={styles.idCardHeader}>
              <MaterialCommunityIcons name="lock" size={16} color="#0F172A" />
              <Text style={styles.idCardTitle}>Auto-Generated Asset ID</Text>
            </View>
            <View style={styles.qrContainer}>
              <MaterialCommunityIcons name="qrcode-scan" size={80} color="#0F172A" />
            </View>
            <Text style={styles.assetIdText}>{assetId}</Text>
          </View>

          <TouchableOpacity style={styles.regenerateButton} activeOpacity={0.8}>
            <MaterialCommunityIcons name="refresh" size={18} color="#0F172A" />
            <Text style={styles.regenerateButtonText}>Regenerate ID</Text>
          </TouchableOpacity>
        </View>

        {/* Basic Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basic Information</Text>

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

          <View style={styles.twoColumnRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Category *</Text>
              <TextInput
                style={styles.input}
                placeholder="Category"
                placeholderTextColor="#9CA3AF"
                value={category}
                onChangeText={setCategory}
              />
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
              <Text style={styles.label}>Condition *</Text>
              <TextInput
                style={styles.input}
                placeholder="Condition"
                placeholderTextColor="#9CA3AF"
                value={condition}
                onChangeText={setCondition}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Serial Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. SN1253567/89"
              placeholderTextColor="#9CA3AF"
              value={serialNumber}
              onChangeText={setSerialNumber}
            />
          </View>

          <View style={styles.twoColumnRow}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                style={styles.input}
                placeholder="Model number"
                placeholderTextColor="#9CA3AF"
                value={model}
                onChangeText={setModel}
              />
            </View>
            <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
              <Text style={styles.label}>Manufacturer</Text>
              <TextInput
                style={styles.input}
                placeholder="Brand name"
                placeholderTextColor="#9CA3AF"
                value={manufacturer}
                onChangeText={setManufacturer}
              />
            </View>
          </View>
        </View>

        {/* Assignment & Location Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assignment & Location</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Department *</Text>
            <TextInput
              style={styles.input}
              placeholder="Department"
              placeholderTextColor="#9CA3AF"
              value={department}
              onChangeText={setDepartment}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Unit Head *</Text>
            <TextInput
              style={styles.input}
              placeholder="Name of custodian/unit head"
              placeholderTextColor="#9CA3AF"
              value={unitHead}
              onChangeText={setUnitHead}
            />
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
          <Text style={styles.sectionTitle}>Acquisition Details</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Date Acquired *</Text>
            <TouchableOpacity style={styles.dateInput}>
              <MaterialCommunityIcons name="calendar" size={20} color="#6B7280" />
              <TextInput
                style={styles.dateInputField}
                placeholder="Select date"
                placeholderTextColor="#9CA3AF"
                value={dateAcquired}
                onChangeText={setDateAcquired}
                editable={false}
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

          <View style={styles.formGroup}>
            <Text style={styles.label}>Supplier</Text>
            <TextInput
              style={styles.input}
              placeholder="Supplier/vendor name"
              placeholderTextColor="#9CA3AF"
              value={supplier}
              onChangeText={setSupplier}
            />
          </View>
        </View>

        {/* Additional Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Information</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Asset Photo</Text>
            <TouchableOpacity style={styles.photoUploadBox} activeOpacity={0.8}>
              <MaterialCommunityIcons name="camera-plus" size={40} color="#60A5FA" />
              <Text style={styles.photoUploadTitle}>Click to upload photo</Text>
              <Text style={styles.photoUploadSubtitle}>PNG, JPG up to 10MB</Text>
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

        {/* Register Button */}
        <TouchableOpacity
          style={styles.registerButton}
          onPress={handleRegisterAsset}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="check-circle" size={20} color="#0F172A" />
          <Text style={styles.registerButtonText}>Register Asset</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  idCardSection: {
    marginBottom: 24,
    gap: 12,
  },
  idCard: {
    backgroundColor: '#0F172A',
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
  },
  idCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  idCardTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  qrContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  assetIdText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  regenerateButton: {
    backgroundColor: '#FBBF24',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  regenerateButtonText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16,
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
  input: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
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
    borderRadius: 14,
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
    color: '#374151',
  },
  priceInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  photoUploadBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoUploadTitle: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#3B82F6',
  },
  photoUploadSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#9CA3AF',
  },
  notesInput: {
    borderColor: '#FBBF24',
    borderWidth: 2,
    height: 120,
    paddingTop: 12,
  },
  registerButton: {
    backgroundColor: '#FBBF24',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    marginBottom: 16,
  },
  registerButtonText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
});
