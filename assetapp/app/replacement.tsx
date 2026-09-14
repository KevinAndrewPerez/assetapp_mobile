import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/notification-bell';
import {
  createAndLinkReplacementAsset,
  fetchReplacementRecords,
  linkReplacementAsset,
  markReplacementReceived,
  ReplacementRecord,
} from '@/lib/assetService';
import { getStoredUser } from '@/lib/userService';

const filterTabs = ['All', 'Approved', 'Received'] as const;
type FilterTab = typeof filterTabs[number];

export default function ReplacementModule() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<ReplacementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [acting, setActing] = useState(false);

  // QR scanner for linking a new asset to a specific replacement.
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanTargetId, setScanTargetId] = useState<string | null>(null);
  const [scanTargetOldCode, setScanTargetOldCode] = useState('');

  // "Create & Link New Asset" flow (web parity): a chooser between scanning an
  // existing asset's QR or registering a brand-new asset, then the form.
  const [linkModalFor, setLinkModalFor] = useState<ReplacementRecord | null>(null);
  const [registerFormFor, setRegisterFormFor] = useState<ReplacementRecord | null>(null);
  const [savingNewAsset, setSavingNewAsset] = useState(false);

  // Register-form fields (prefilled from the old asset / web defaults).
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newCondition, setNewCondition] = useState('New');
  const [newLocation, setNewLocation] = useState('');
  const [newSerial, setNewSerial] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newAcquired, setNewAcquired] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [newWarranty, setNewWarranty] = useState('12');
  const [newLifespan, setNewLifespan] = useState('');
  const [newMaintInterval, setNewMaintInterval] = useState('');
  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);
  const [qrPreviewVisible, setQrPreviewVisible] = useState(false);

  /** Preview the QR of the generated code before creating the asset. */
  const openQrPreview = (code: string) => {
    if (!code.trim()) {
      Alert.alert('No code yet', 'Generate an asset code first.');
      return;
    }
    setQrPreviewVisible(true);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const records = await fetchReplacementRecords();
      setItems(records);
    } catch (error) {
      console.error('Failed to fetch replacement records:', error);
      Alert.alert('Error', 'Failed to load replacement records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      await fetchData();
    };
    bootstrap();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const counts = useMemo(() => ({
    All: items.length,
    Approved: items.filter((item) => item.status === 'Approved').length,
    Received: items.filter((item) => item.status === 'Received').length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchesTab = activeFilter === 'All' || item.status === activeFilter;
      const matchesSearch = normalizedQuery.length === 0 || [
        item.oldAsset.code,
        item.oldAsset.name,
        item.newAsset?.code,
        item.newAsset?.name,
        item.requestedBy,
        item.status,
      ].join(' ').toLowerCase().includes(normalizedQuery);
      return matchesTab && matchesSearch;
    });
  }, [activeFilter, items, searchQuery]);

  const openScanner = async (record: ReplacementRecord) => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Camera Permission', 'Camera permission is required to scan QR codes.');
        return;
      }
    }
    setScanTargetId(record.replacementId);
    setScanTargetOldCode(record.oldAsset.code);
    setScanned(false);
    setScannerVisible(true);
  };

  /** Web-style random code: AST-XXXXXXXX-XXXX. */
  const generateAssetCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const pick = (n: number) =>
      Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `AST-${pick(8)}-${pick(4)}`;
  };

  const openRegisterForm = (record: ReplacementRecord) => {
    setNewCode(generateAssetCode());
    setNewName(record.oldAsset.name === 'No asset linked' ? '' : record.oldAsset.name);
    setNewCategory('');
    setNewCondition('New');
    setNewLocation('');
    setNewSerial('');
    setNewPrice('');
    setNewAcquired(new Date().toISOString().slice(0, 10));
    setNewSupplier('');
    setNewWarranty('12');
    setNewLifespan('');
    setNewMaintInterval('');
    setNewPhotoUri(null);
    setRegisterFormFor(record);
  };

  const pickNewPhoto = () => {
    Alert.alert('Asset Photo', 'Add a photo from your gallery or take one with the camera.', [
      { text: 'Take Photo', onPress: takeNewPhoto },
      { text: 'Choose from Library', onPress: chooseNewFromLibrary },
      { text: 'Remove Photo', style: 'destructive', onPress: () => setNewPhotoUri(null) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const chooseNewFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Permission to access gallery is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled) setNewPhotoUri(result.assets[0].uri);
  };

  const takeNewPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is required to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled) setNewPhotoUri(result.assets[0].uri);
  };

  const handleCreateAndLink = async () => {
    if (!registerFormFor || savingNewAsset) return;
    if (!newCode.trim()) {
      Alert.alert('Asset code required', 'Generate or enter an asset code first.');
      return;
    }
    if (!newName.trim()) {
      Alert.alert('Asset name required', 'Enter the name of the new asset.');
      return;
    }

    setSavingNewAsset(true);
    try {
      const user = await getStoredUser();
      const result = await createAndLinkReplacementAsset({
        replacementId: registerFormFor.replacementId,
        requestId: registerFormFor.requestId,
        oldAssetId: registerFormFor.oldAsset.id,
        assetCode: newCode.trim(),
        title: newName.trim(),
        category: newCategory.trim() || undefined,
        serialNumber: newSerial.trim() || undefined,
        location: newLocation.trim() || undefined,
        acquisitionDate: newAcquired || undefined,
        purchasePrice: Number(newPrice) || undefined,
        supplier: newSupplier.trim() || undefined,
        warrantyMonths: Number(newWarranty) || undefined,
        lifespanMonths: Number(newLifespan) || undefined,
        maintenanceInterval: Number(newMaintInterval) || undefined,
        photoUri: newPhotoUri,
        actorId: user?.id ?? null,
      });

      Alert.alert(
        'Asset Created & Linked',
        `${result.assetCode} is now the replacement asset and is ready for pickup.` +
          (result.photoWarning ? `\n\nNote: the photo was not saved — ${result.photoWarning}` : ''),
      );
      setRegisterFormFor(null);
      await fetchData();
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        Alert.alert('Code already used', 'That asset code already exists. Tap the refresh icon to generate a new one.');
      } else {
        Alert.alert('Create failed', msg || 'Unable to create and link the new asset.');
      }
    } finally {
      setSavingNewAsset(false);
    }
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
        .select('id, Asset_code, Asset_name')
        .eq('Asset_code', code)
        .maybeSingle();

      if (assetErr) throw assetErr;
      if (!assetRow) {
        Alert.alert('Invalid asset', 'No asset was found for the scanned code.');
        return;
      }

      const user = await getStoredUser();
      setActing(true);
      await linkReplacementAsset(scanTargetId!, assetRow.id, user?.id ?? null);
      Alert.alert(
        'Asset linked',
        `"${assetRow.Asset_name || assetRow.Asset_code}" is now the replacement asset.`,
      );
      setScannerVisible(false);
      await fetchData();
    } catch (err) {
      console.error('Failed to link replacement asset:', err);
      Alert.alert('Link failed', (err as Error).message || 'Unable to link the replacement asset.');
    } finally {
      setActing(false);
      setScanned(false);
    }
  };

  const handleMarkReceived = async (record: ReplacementRecord) => {
    try {
      const user = await getStoredUser();
      setActing(true);
      await markReplacementReceived(record.replacementId, user?.id ?? null);
      Alert.alert('Received', 'Replacement marked as received. New asset is Active; old asset is Pullout.');
      await fetchData();
    } catch (err) {
      console.error('Failed to mark replacement received:', err);
      Alert.alert('Error', (err as Error).message || 'Unable to update the replacement status.');
    } finally {
      setActing(false);
    }
  };

  const statusStyle = (status: string) =>
    status === 'Received'
      ? { backgroundColor: '#DCFCE7', color: '#166534' }
      : { backgroundColor: '#DBEAFE', color: '#1D4ED8' };

  if (loading && items.length === 0) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Replacement Records</Text>
          <View style={styles.headerSpacer} />
        </View>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1E3A5F" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Replacement Records</Text>
        <View style={styles.headerSpacer} />
      </View>

      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.searchBarWrap}>
            <View style={styles.searchBar}>
              <MaterialCommunityIcons name="magnify" size={18} color="#64748B" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                placeholder="Search replacements..."
                placeholderTextColor="#94A3B8"
              />
            </View>
            <NotificationBell color="#1E293B" />
            <TouchableOpacity style={styles.avatarButton} activeOpacity={0.8}>
              <Text style={styles.avatarText}>A</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterContent}
            style={styles.filterScroll}
          >
            {filterTabs.map((tab) => {
              const isActive = tab === activeFilter;
              return (
                <TouchableOpacity
                  key={tab}
                  activeOpacity={0.8}
                  onPress={() => setActiveFilter(tab)}
                  style={[styles.filterButton, isActive && styles.filterButtonActive]}
                >
                  <Text style={[styles.filterLabel, isActive && styles.filterLabelActive]}>
                    {tab} ({counts[tab]})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.listContainer}>
            {filteredItems.length > 0 ? filteredItems.map((item) => {
              const isExpanded = expandedId === item.replacementId;
              const st = statusStyle(item.status);
              const canReceive = item.status === 'Approved';
              return (
                <View key={item.replacementId} style={styles.recordCard}>
                  <TouchableOpacity
                    style={styles.recordHeader}
                    activeOpacity={0.8}
                    onPress={() => setExpandedId(isExpanded ? null : item.replacementId)}
                  >
                    <View style={styles.assetSummary}>
                      <View style={styles.assetIconWrap}>
                        <MaterialCommunityIcons name="sync" size={26} color="#2563EB" />
                      </View>
                      <View style={styles.assetTextWrap}>
                        <Text style={styles.assetName}>{item.oldAsset.name}</Text>
                        <Text style={styles.assetCode}>{item.oldAsset.code}</Text>
                        <Text style={styles.requestorText}>Requested by: {item.requestedBy}</Text>
                        <View style={[styles.statusPill, { backgroundColor: st.backgroundColor }]}>
                          <Text style={[styles.statusText, { color: st.color }]}>{item.status}</Text>
                        </View>
                      </View>
                    </View>
                    <MaterialCommunityIcons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={24}
                      color="#0F172A"
                    />
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.expandedDetails}>
                      <View style={styles.detailGrid}>
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>Old asset</Text>
                          <Text style={styles.detailValue}>{item.oldAsset.code}</Text>
                          <Text style={styles.detailSubValue}>{item.oldAsset.name}</Text>
                        </View>
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>New asset</Text>
                          {item.newAsset ? (
                            <>
                              <Text style={styles.detailValue}>{item.newAsset.code}</Text>
                              <Text style={styles.detailSubValue}>{item.newAsset.name}</Text>
                            </>
                          ) : (
                            <Text style={styles.detailSubValue}>No new asset linked yet</Text>
                          )}
                        </View>
                      </View>

                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Requested by</Text>
                        <Text style={styles.detailValue}>{item.requestedBy}</Text>
                      </View>
                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Date</Text>
                        <Text style={styles.detailValue}>{item.createdAt}</Text>
                      </View>
                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Reason</Text>
                        <View style={styles.notesBox}>
                          <Text style={styles.notesText}>{item.reason}</Text>
                        </View>
                      </View>

                      {canReceive && (
                        <View style={styles.actionButtons}>
                          <TouchableOpacity
                            style={[styles.linkButton, acting && { opacity: 0.6 }]}
                            activeOpacity={0.85}
                            disabled={acting}
                            onPress={() => setLinkModalFor(item)}
                          >
                            <MaterialCommunityIcons name="qrcode-scan" size={18} color="#FFFFFF" />
                            <Text style={styles.linkButtonText}>
                              {item.newAsset ? 'Change Replacement Asset' : 'Link Replacement Asset'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.receiveButton, (!item.newAsset || acting) && { opacity: 0.45 }]}
                            activeOpacity={0.85}
                            disabled={!item.newAsset || acting}
                            onPress={() => handleMarkReceived(item)}
                          >
                            <MaterialCommunityIcons name="check-circle-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.receiveButtonText}>Mark Received</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {item.status === 'Received' && (
                        <View style={styles.receivedNote}>
                          <MaterialCommunityIcons name="check-circle" size={16} color="#166534" />
                          <Text style={styles.receivedNoteText}>Replacement received — new asset Active, old asset Pullout.</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            }) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="inbox-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyStateText}>No replacement records found</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Choose how to link: scan an existing asset's QR or register a new one (web parity). */}
      <Modal visible={!!linkModalFor} transparent animationType="fade" onRequestClose={() => setLinkModalFor(null)}>
        <View style={styles.chooserOverlay}>
          <View style={styles.chooserCard}>
            <Text style={styles.chooserTitle}>Link Replacement Asset</Text>
            <Text style={styles.chooserSubtitle}>
              Replacing {linkModalFor?.oldAsset.code || 'the old asset'} — pick how you want to add the new asset.
            </Text>

            <TouchableOpacity
              style={styles.chooserOption}
              activeOpacity={0.8}
              onPress={() => {
                const record = linkModalFor;
                setLinkModalFor(null);
                if (record) openScanner(record);
              }}
            >
              <View style={[styles.chooserIcon, { backgroundColor: '#DBEAFE' }]}>
                <MaterialCommunityIcons name="qrcode-scan" size={24} color="#1D4ED8" />
              </View>
              <View style={styles.chooserOptionTextWrap}>
                <Text style={styles.chooserOptionTitle}>Scan a QR Code</Text>
                <Text style={styles.chooserOptionDesc}>
                  The replacement asset is already registered — scan its QR to link it.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chooserOption}
              activeOpacity={0.8}
              onPress={() => {
                const record = linkModalFor;
                setLinkModalFor(null);
                if (record) openRegisterForm(record);
              }}
            >
              <View style={[styles.chooserIcon, { backgroundColor: '#FEF3C7' }]}>
                <MaterialCommunityIcons name="package-variant-closed-plus" size={24} color="#B45309" />
              </View>
              <View style={styles.chooserOptionTextWrap}>
                <Text style={styles.chooserOptionTitle}>Register a New Asset</Text>
                <Text style={styles.chooserOptionDesc}>
                  Create the replacement asset now — prefilled from the old asset, with an auto-generated code and QR.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.chooserCancel} activeOpacity={0.8} onPress={() => setLinkModalFor(null)}>
              <Text style={styles.chooserCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create & Link New Asset form (mirrors the web modal, owner = requester). */}
      <Modal visible={!!registerFormFor} animationType="slide" onRequestClose={() => setRegisterFormFor(null)}>
        <SafeAreaView style={styles.regScreen}>
          <View style={styles.regHeader}>
            <TouchableOpacity style={styles.regBack} onPress={() => setRegisterFormFor(null)} activeOpacity={0.8}>
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.regHeaderCenter}>
              <Text style={styles.regTitle}>Create &amp; Link New Asset</Text>
              <Text style={styles.regSubtitle}>Prefilled from {registerFormFor?.oldAsset.code} — edit as needed</Text>
            </View>
            <TouchableOpacity
              style={styles.regBack}
              activeOpacity={0.8}
              onPress={() => setNewCode(generateAssetCode())}
            >
              <MaterialCommunityIcons name="refresh" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.regBody} showsVerticalScrollIndicator={false}>
            <View style={styles.codeCard}>
              <Text style={styles.codeCardLabel}>NEW ASSET CODE (AUTO)</Text>
              <Text style={styles.codeCardValue}>{newCode || '—'}</Text>
              <TouchableOpacity style={styles.qrButton} activeOpacity={0.85} onPress={() => openQrPreview(newCode)}>
                <MaterialCommunityIcons name="qrcode" size={18} color="#0F172A" />
                <Text style={styles.qrButtonText}>Generate QR Code</Text>
              </TouchableOpacity>
              <Text style={styles.codeCardHint}>Fill in the fields below, then create the asset.</Text>
            </View>

            <Text style={styles.regLabel}>Asset Name *</Text>
            <TextInput style={styles.regInput} value={newName} onChangeText={setNewName} placeholder="e.g., Office Chair" placeholderTextColor="#94A3B8" />

            <View style={styles.regRow}>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Category</Text>
                <TextInput style={styles.regInput} value={newCategory} onChangeText={setNewCategory} placeholder="Category" placeholderTextColor="#94A3B8" />
              </View>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Condition</Text>
                <TextInput style={styles.regInput} value={newCondition} onChangeText={setNewCondition} placeholderTextColor="#94A3B8" editable={false} />
              </View>
            </View>

            <View style={styles.regRow}>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Location</Text>
                <TextInput style={styles.regInput} value={newLocation} onChangeText={setNewLocation} placeholder="Room / area" placeholderTextColor="#94A3B8" />
              </View>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Serial Number</Text>
                <TextInput style={styles.regInput} value={newSerial} onChangeText={setNewSerial} placeholder="Serial #" placeholderTextColor="#94A3B8" />
              </View>
            </View>

            <View style={styles.regRow}>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Purchase Price</Text>
                <TextInput style={styles.regInput} value={newPrice} onChangeText={setNewPrice} placeholder="0.00" keyboardType="decimal-pad" placeholderTextColor="#94A3B8" />
              </View>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Acquisition Date</Text>
                <TextInput style={styles.regInput} value={newAcquired} onChangeText={setNewAcquired} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" />
              </View>
            </View>

            <View style={styles.regRow}>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Supplier</Text>
                <TextInput style={styles.regInput} value={newSupplier} onChangeText={setNewSupplier} placeholder="Supplier" placeholderTextColor="#94A3B8" />
              </View>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Warranty (months)</Text>
                <TextInput style={styles.regInput} value={newWarranty} onChangeText={setNewWarranty} keyboardType="number-pad" placeholderTextColor="#94A3B8" />
              </View>
            </View>

            <View style={styles.regRow}>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Lifespan (months)</Text>
                <TextInput style={styles.regInput} value={newLifespan} onChangeText={setNewLifespan} keyboardType="number-pad" placeholderTextColor="#94A3B8" />
              </View>
              <View style={styles.regCol}>
                <Text style={styles.regLabel}>Maintenance Interval (months)</Text>
                <TextInput style={styles.regInput} value={newMaintInterval} onChangeText={setNewMaintInterval} keyboardType="number-pad" placeholderTextColor="#94A3B8" />
              </View>
            </View>

            <Text style={styles.regLabel}>Asset Photo</Text>
            <TouchableOpacity style={[styles.photoBox, newPhotoUri && styles.photoBoxActive]} activeOpacity={0.8} onPress={pickNewPhoto}>
              {newPhotoUri ? (
                <Image source={{ uri: newPhotoUri }} style={styles.photoPreview} />
              ) : (
                <>
                  <MaterialCommunityIcons name="image-plus" size={30} color="#B45309" />
                  <Text style={styles.photoBoxTitle}>Take a photo or choose from gallery</Text>
                  <Text style={styles.photoBoxHint}>PNG, JPG up to 10MB</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.regNotice}>
              <MaterialCommunityIcons name="information-outline" size={16} color="#92400E" />
              <Text style={styles.regNoticeText}>
                The requester ({registerFormFor?.requestedBy || 'the user'}) automatically becomes the owner — no user
                picker needed. The asset is created as Acquired and becomes Active when marked Received.
              </Text>
            </View>

            <View style={styles.regFooter}>
              <TouchableOpacity style={styles.regCancelBtn} activeOpacity={0.8} onPress={() => setRegisterFormFor(null)} disabled={savingNewAsset}>
                <Text style={styles.regCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.regSaveBtn, savingNewAsset && { opacity: 0.6 }]} activeOpacity={0.85} onPress={handleCreateAndLink} disabled={savingNewAsset}>
                {savingNewAsset ? (
                  <ActivityIndicator size="small" color="#0F172A" />
                ) : (
                  <MaterialCommunityIcons name="plus" size={18} color="#0F172A" />
                )}
                <Text style={styles.regSaveText}>Create &amp; Link Asset</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* QR preview for the generated asset code. */}
      <Modal visible={qrPreviewVisible} transparent animationType="fade" onRequestClose={() => setQrPreviewVisible(false)}>
        <View style={styles.chooserOverlay}>
          <View style={styles.qrPreviewCard}>
            <Text style={styles.chooserTitle}>Asset QR Code</Text>
            <View style={styles.qrPreviewBox}>
              <QRCode value={newCode} size={180} />
            </View>
            <Text style={styles.qrPreviewCode}>{newCode}</Text>
            <TouchableOpacity style={styles.chooserCancel} activeOpacity={0.8} onPress={() => setQrPreviewVisible(false)}>
              <Text style={styles.chooserCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* QR scanner for linking a new replacement asset */}
      <Modal visible={scannerVisible} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <View style={{ width: 42 }} />
            <Text style={styles.scannerTitle}>Scan Replacement Asset QR</Text>
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
            <Text style={styles.scanHint}>
              Scan the QR of the asset replacing {scanTargetOldCode || 'the old asset'}
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#1E3A5F' },
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 14,
    backgroundColor: '#1E3A5F',
  },
  backButton: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  headerSpacer: { width: 32 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: 24 },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A' },
  avatarButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0EA5E9', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '700' },
  filterScroll: { backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  filterContent: { gap: 8, paddingHorizontal: 18, paddingVertical: 12 },
  filterButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#E2E8F0', borderWidth: 1, borderColor: '#CBD5E1' },
  filterButtonActive: { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  filterLabel: { fontSize: 13, fontWeight: '600', color: '#475569' },
  filterLabelActive: { color: '#FFFFFF' },
  listContainer: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 30 },
  recordCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assetSummary: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  assetIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#DBEAFE', justifyContent: 'center', alignItems: 'center' },
  assetTextWrap: { flex: 1 },
  assetName: { fontSize: 15, fontWeight: '700', color: '#0F172A', lineHeight: 20 },
  assetCode: { fontSize: 12, color: '#64748B', marginTop: 2 },
  requestorText: { fontSize: 12, color: '#475569', marginTop: 2 },
  statusPill: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700' },
  expandedDetails: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 14 },
  detailGrid: { flexDirection: 'row', gap: 12 },
  detailBlock: { flex: 1 },
  detailSection: { gap: 5 },
  detailLabel: { fontSize: 12, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  detailValue: { fontSize: 14, color: '#111827', fontWeight: '700', marginTop: 4 },
  detailSubValue: { fontSize: 12, color: '#64748B', marginTop: 3 },
  notesBox: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12 },
  notesText: { fontSize: 14, color: '#111827', lineHeight: 20 },
  actionButtons: { gap: 10, marginTop: 4 },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1E3A5F',
    borderRadius: 12,
    paddingVertical: 13,
  },
  linkButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  receiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 13,
  },
  receiveButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  receivedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 10,
  },
  receivedNoteText: { color: '#166534', fontSize: 12, fontWeight: '600', flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42 },
  emptyStateText: { marginTop: 12, color: '#94A3B8', fontSize: 16, fontWeight: '600' },
  chooserOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  chooserCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  chooserTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  chooserSubtitle: { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 16, lineHeight: 18 },
  chooserOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: '#F8FAFC',
  },
  chooserIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chooserOptionTextWrap: { flex: 1 },
  chooserOptionTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  chooserOptionDesc: { fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 16 },
  chooserCancel: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  chooserCancelText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  qrPreviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  qrPreviewBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
  },
  qrPreviewCode: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginTop: 12, letterSpacing: 0.5 },
  regScreen: { flex: 1, backgroundColor: '#F8FAFC' },
  regHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  regBack: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  regHeaderCenter: { flex: 1, alignItems: 'center' },
  regTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  regSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  regBody: { padding: 16, paddingBottom: 40 },
  codeCard: {
    backgroundColor: '#FEF6E4',
    borderWidth: 1,
    borderColor: '#F3E3BB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  codeCardLabel: { fontSize: 11, fontWeight: '700', color: '#A16207', letterSpacing: 0.6 },
  codeCardValue: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginTop: 4, letterSpacing: 0.5 },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FBBF24',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
  },
  qrButtonText: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  codeCardHint: { fontSize: 12, color: '#A16207', textAlign: 'center', marginTop: 8 },
  regLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, marginTop: 4 },
  regInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 12,
  },
  regRow: { flexDirection: 'row', gap: 10 },
  regCol: { flex: 1 },
  photoBox: {
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 26,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    minHeight: 130,
  },
  photoBoxActive: { borderStyle: 'solid', borderColor: '#FBBF24', paddingVertical: 0 },
  photoPreview: { width: '100%', height: 180 },
  photoBoxTitle: { fontSize: 13, fontWeight: '700', color: '#334155', marginTop: 8 },
  photoBoxHint: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  regNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF6E4',
    borderWidth: 1,
    borderColor: '#F3E3BB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  regNoticeText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17 },
  regFooter: { flexDirection: 'row', gap: 10 },
  regCancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  regCancelText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  regSaveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#FBBF24',
  },
  regSaveText: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  scannerContainer: { flex: 1, backgroundColor: '#0F172A' },
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
  scannerTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  cameraWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scanHint: { marginTop: 18, color: '#E2E8F0', fontSize: 14, fontWeight: '600' },
});