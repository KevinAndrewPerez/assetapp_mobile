import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { fetchAssets, AssetSummary } from '@/lib/assetService';
import { getStoredUser } from '@/lib/userService';

const NAVY = '#0C134F';
const NAVY_MID = '#1E3A5F';
const GOLD = '#FBBF24';
const GOLD_LIGHT = '#F59E0B';

export default function LifespanScreen() {
  const router = useRouter();
  const [assets, setAssets] = useState<(AssetSummary & { expirationDate?: string; lifespanMonths?: number | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetSummary & { expirationDate?: string; lifespanMonths?: number | null } | null>(null);
  const [actionModal, setActionModal] = useState<'return' | 'repair' | 'replacement' | 'disposal' | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendMonths, setExtendMonths] = useState('');
  const [evalNotes, setEvalNotes] = useState('');
  const [disposalChecked, setDisposalChecked] = useState(false);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    try {
      const user = await getStoredUser();
      if (!user) {
        setError('User session not found');
        return;
      }
      const allAssets = await fetchAssets();
      const enriched: typeof assets = allAssets.map(a => {
        // Parse expiration date from various possible column names
        const expRaw = (a as any).expiration_date ?? (a as any).expirationDate ?? (a as any).expiration_date ?? null;
        const lifeRaw = (a as any).lifespan_months ?? (a as any).lifespanMonths ?? null;
        return {
          ...a,
          expirationDate: expRaw ? String(expRaw) : undefined,
          lifespanMonths: lifeRaw != null ? Number(lifeRaw) : undefined,
        };
      });
      setAssets(enriched);
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Unable to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const expiredAssets = assets.filter(a => {
    if (!a.expirationDate) return false;
    return new Date(a.expirationDate) < new Date();
  });

  const activeAssets = assets.filter(a => a.status === 'Active');
  const forCheckingAssets = assets.filter(a => a.status === 'For Checking');

  const formatDate = (d?: string | null) => {
    if (!d) return 'N/A';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'long',
        day: '2-digit',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  };

  const daysExpired = (expDate?: string) => {
    if (!expDate) return 0;
    return Math.floor((new Date().getTime() - new Date(expDate + 'T00:00:00').getTime()) / 86400000);
  };

  const openActionModal = (asset: typeof selectedAsset, action: 'return' | 'repair' | 'replacement' | 'disposal') => {
    setSelectedAsset(asset);
    setActionModal(action);
    setExtending(false);
    setExtendMonths('');
    setEvalNotes('');
    setDisposalChecked(false);
  };

  const handleReturnToActive = async () => {
    if (!selectedAsset) return;
    setProcessing(true);
    try {
      const user = await getStoredUser();
      const now = new Date().toISOString();
      const extensionMonths = extending ? Number(extendMonths) || 0 : 0;
      let newExpiration = selectedAsset.expirationDate;

      if (extending && extensionMonths > 0) {
        const d = new Date(newExpiration || new Date());
        d.setMonth(d.getMonth() + extensionMonths);
        newExpiration = d.toISOString().slice(0, 10);
      }

      const { error: updateError } = await fetchAssets().then(() => {
        // Use supabase directly for the update
        return import('@/lib/supabase').then(({ supabase }) => {
          return supabase
            .from('assets')
            .update({
              Lifecycle_Status: 'Active',
              expiration_date: newExpiration,
              updated_at: now,
            })
            .eq('id', selectedAsset.id);
        });
      });

      if (updateError) throw updateError;

      Alert.alert('Success', `Asset returned to Active status.${extending ? ` Extended by ${extensionMonths} months.` : ''}`);
      setActionModal(null);
      setSelectedAsset(null);
      await load();
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to return asset to active');
    } finally {
      setProcessing(false);
    }
  };

  const handleSendForRepair = async () => {
    if (!selectedAsset) return;
    setProcessing(true);
    try {
      const user = await getStoredUser();
      const now = new Date().toISOString();
      const { error: updateError } = await import('@/lib/supabase').then(({ supabase }) =>
        supabase
          .from('assets')
          .update({
            Lifecycle_Status: 'For Repair',
            updated_at: now,
          })
          .eq('id', selectedAsset.id)
      );
      if (updateError) throw updateError;

      // Log the repair event
      const { error: auditError } = await import('@/lib/supabase').then(({ supabase }) =>
        supabase.from('repairs').insert([{
          Assets_id: selectedAsset.id,
          Repair_Description: evalNotes || 'Sent for repair evaluation',
          Repair_Date: now,
          status: 'Pending',
          created_at: now,
          updated_at: now,
        }])
      );
      if (auditError) console.warn('Audit log failed:', auditError);

      Alert.alert('Success', 'Asset sent for repair. Maintenance evaluation will be scheduled.');
      setActionModal(null);
      setSelectedAsset(null);
      await load();
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to send asset for repair');
    } finally {
      setProcessing(false);
    }
  };

  const handleRecommendReplacement = async () => {
    if (!selectedAsset) return;
    setProcessing(true);
    try {
      const user = await getStoredUser();
      const now = new Date().toISOString();
      const { error: updateError } = await import('@/lib/supabase').then(({ supabase }) =>
        supabase
          .from('assets')
          .update({
            Lifecycle_Status: 'For Replacement',
            updated_at: now,
          })
          .eq('id', selectedAsset.id)
      );
      if (updateError) throw updateError;

      const { error: auditError } = await import('@/lib/supabase').then(({ supabase }) =>
        supabase.from('repairs').insert([{
          Assets_id: selectedAsset.id,
          Repair_Description: evalNotes || 'Replacement recommended',
          Repair_Date: now,
          status: 'Pending',
          created_at: now,
          updated_at: now,
        }])
      );
      if (auditError) console.warn('Audit log failed:', auditError);

      Alert.alert('Success', 'Replacement recommendation submitted. A replacement request will be initiated.');
      setActionModal(null);
      setSelectedAsset(null);
      await load();
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to recommend replacement');
    } finally {
      setProcessing(false);
    }
  };

  const handleProceedWithDisposal = async () => {
    if (!selectedAsset) return;
    if (!disposalChecked) {
      Alert.alert('Confirmation Required', 'Please confirm that this asset should be disposed.');
      return;
    }
    setProcessing(true);
    try {
      const user = await getStoredUser();
      const now = new Date().toISOString();
      const d = new Date();
      const dateOnly = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const { error: updateError } = await import('@/lib/supabase').then(({ supabase }) =>
        supabase
          .from('assets')
          .update({
            Lifecycle_Status: 'Disposal',
            updated_at: now,
          })
          .eq('id', selectedAsset.id)
      );
      if (updateError) throw updateError;

      const { error: disposalError } = await import('@/lib/supabase').then(({ supabase }) =>
        supabase.from('disposals').insert([{
          Asset_id: selectedAsset.id,
          notes: evalNotes || 'Disposed via lifespan evaluation',
          Description: 'Disposal',
          disposal_date: dateOnly,
          disposal_reason: evalNotes || 'End of operational lifespan',
          Approve_by: String(user?.email || user?.full_name || 'Admin'),
          created_at: now,
          updated_at: now,
        }])
      );
      if (disposalError) throw disposalError;

      Alert.alert('Success', 'Asset marked for disposal. The disposal process has been initiated.');
      setActionModal(null);
      setSelectedAsset(null);
      await load();
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to proceed with disposal');
    } finally {
      setProcessing(false);
    }
  };

  const renderAssetCard = (asset: typeof assets[0], index: number) => {
    const isExpired = asset.expirationDate ? new Date(asset.expirationDate) < new Date() : false;
    const days = daysExpired(asset.expirationDate);
    const isForChecking = asset.status === 'For Checking';

    return (
      <View key={asset.id || index} style={styles.assetCard}>
        <View style={styles.assetHeader}>
          <View style={styles.assetTitleRow}>
            <Text style={styles.assetName} numberOfLines={1}>{asset.title}</Text>
            <View style={[
              styles.statusBadge,
              { backgroundColor: isForChecking ? '#FFFBEB' : isExpired ? '#FEF2F2' : '#F0FDF4' }
            ]}>
              <Text style={[
                styles.statusBadgeText,
                { color: isForChecking ? '#F59E0B' : isExpired ? '#EF4444' : '#10B981' }
              ]}>
                {isForChecking ? 'For Checking' : asset.status || 'Active'}
              </Text>
            </View>
          </View>
          <Text style={styles.assetCode}>{asset.assetId}</Text>
        </View>

        <View style={styles.detailGrid}>
          <View style={styles.detailItem}>
            <MaterialCommunityIcons name="calendar-check-outline" size={14} color="#94A3B8" />
            <Text style={styles.detailLabel}>ACQUISITION DATE</Text>
            <Text style={styles.detailValue}>{formatDate(asset.acquisitionDate)}</Text>
          </View>
          <View style={styles.detailItem}>
            <MaterialCommunityIcons name="cash-multiple-outline" size={14} color="#94A3B8" />
            <Text style={styles.detailLabel}>PURCHASE PRICE</Text>
            <Text style={styles.detailValue}>
              {((asset as any).purchase_Price || (asset as any).purchasePrice)
                ? `₱${Number((asset as any).purchase_Price || (asset as any).purchasePrice).toLocaleString('en-PH')}`
                : 'N/A'}
            </Text>
          </View>
          <View style={styles.detailItem}>
            <MaterialCommunityIcons name="barcode-outline" size={14} color="#94A3B8" />
            <Text style={styles.detailLabel}>SERIAL NUMBER</Text>
            <Text style={styles.detailValue}>{asset.serialNumber || 'N/A'}</Text>
          </View>
          <View style={styles.detailItem}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color="#94A3B8" />
            <Text style={styles.detailLabel}>LOCATION</Text>
            <Text style={styles.detailValue}>{asset.location || 'N/A'}</Text>
          </View>
          <View style={styles.detailItem}>
            <MaterialCommunityIcons name="category-outline" size={14} color="#94A3B8" />
            <Text style={styles.detailLabel}>CATEGORY</Text>
            <Text style={styles.detailValue}>{asset.category || 'N/A'}</Text>
          </View>
          <View style={styles.detailItem}>
            <MaterialCommunityIcons name="account-outline" size={14} color="#94A3B8" />
            <Text style={styles.detailLabel}>ASSIGNED TO</Text>
            <Text style={styles.detailValue}>{asset.custodian || 'N/A'}</Text>
          </View>
        </View>

        <View style={[styles.lifecycleBox, { borderLeftColor: isExpired ? '#EF4444' : '#FBBF24' }]}>
          <View style={styles.lifecycleHeader}>
            <MaterialCommunityIcons name="clock-outline" size={16} color={isExpired ? '#EF4444' : '#F59E0B'} />
            <Text style={[styles.lifecycleLabel, { color: isExpired ? '#EF4444' : '#F59E0B' }]}>LIFECYCLE</Text>
          </View>
          <View style={styles.lifecycleGrid}>
            <View style={styles.lifecycleItem}>
              <Text style={styles.lifecycleDetailLabel}>LIFESPAN DURATION</Text>
              <Text style={styles.lifecycleDetailValue}>{asset.lifespanMonths ? `${asset.lifespanMonths} months` : 'N/A'}</Text>
            </View>
            <View style={styles.lifecycleItem}>
              <Text style={styles.lifecycleDetailLabel}>EXPIRATION DATE</Text>
              <Text style={[
                styles.lifecycleDetailValue,
                { color: isExpired ? '#EF4444' : '#1E293B' }
              ]}>
                {formatDate(asset.expirationDate)}
                {isExpired ? `\n(${days} day${days !== 1 ? 's' : ''} expired)` : ''}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.actionButtonsRow}>
          {isForChecking ? (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.returnButton]}
                onPress={() => openActionModal(asset, 'return')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="check-circle" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Return to Active</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.repairButton]}
                onPress={() => openActionModal(asset, 'repair')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="wrench" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Send for Repair</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.replacementButton]}
                onPress={() => openActionModal(asset, 'replacement')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="sync" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Recommend Replacement</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.disposalButton]}
                onPress={() => openActionModal(asset, 'disposal')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="trash-can" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Proceed with Disposal</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.returnButton]}
                onPress={() => openActionModal(asset, 'return')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="check-circle" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Return to Active</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.repairButton]}
                onPress={() => openActionModal(asset, 'repair')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="wrench" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Send for Repair</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.replacementButton]}
                onPress={() => openActionModal(asset, 'replacement')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="sync" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Recommend Replacement</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.disposalButton]}
                onPress={() => openActionModal(asset, 'disposal')}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="trash-can" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Proceed with Disposal</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderActionModal = () => {
    if (!actionModal || !selectedAsset) return null;

    const isExpired = selectedAsset.expirationDate ? new Date(selectedAsset.expirationDate) < new Date() : false;

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {actionModal === 'return' && 'Return Asset to Active'}
              {actionModal === 'repair' && 'Send Asset for Repair'}
              {actionModal === 'replacement' && 'Recommend Replacement'}
              {actionModal === 'disposal' && 'Proceed with Disposal'}
            </Text>
            <TouchableOpacity onPress={() => setActionModal(null)} activeOpacity={0.7}>
              <MaterialCommunityIcons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            {actionModal === 'return' && (
              <>
                <View style={styles.infoBoxGreen}>
                  <Text style={styles.infoBoxText}>
                    Asset will be returned to <Text style={styles.boldGreen}>Active</Text> status and can resume operational use.
                  </Text>
                </View>
                <View style={styles.checkboxRow}>
                  <View style={[styles.checkbox, { borderColor: extending ? '#10B981' : '#CBD5E1' }]}>
                    {extending && <MaterialCommunityIcons name="check-box" size={16} color="#10B981" />}
                  </View>
                  <View style={styles.checkboxLabel}>
                    <Text style={styles.checkboxLabelText}>Extend asset lifespan</Text>
                    <Text style={styles.checkboxSubtext}>Optional: Add additional months to operational lifespan</Text>
                  </View>
                </View>
                {extending && (
                  <View style={styles.extendInputRow}>
                    <TextInput
                      style={styles.extendInput}
                      placeholder="Enter months"
                      placeholderTextColor="#94A3B8"
                      value={extendMonths}
                      onChangeText={setExtendMonths}
                      keyboardType="numeric"
                    />
                    <Text style={styles.extendUnit}>months</Text>
                  </View>
                )}
              </>
            )}

            {actionModal === 'repair' && (
              <>
                <View style={styles.infoBoxGold}>
                  <Text style={styles.infoBoxText}>
                    Asset will transition to <Text style={styles.boldGold}>For Repair</Text> status. Maintenance evaluation and servicing will be scheduled.
                  </Text>
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>ISSUES OR DETERIORATION IDENTIFIED</Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="e.g., Display flickering, keyboard unresponsive, battery not charging, performance degradation"
                    placeholderTextColor="#94A3B8"
                    value={evalNotes}
                    onChangeText={setEvalNotes}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              </>
            )}

            {actionModal === 'replacement' && (
              <>
                <View style={styles.infoBoxBlue}>
                  <Text style={styles.infoBoxText}>
                    Asset will transition to <Text style={styles.boldBlue}>For Replacement</Text> status. A replacement request will be initiated and requires approval.
                  </Text>
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>REASON FOR REPLACEMENT</Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="e.g., Beyond economical repair, frequent failures, obsolete technology, does not meet operational requirements"
                    placeholderTextColor="#94A3B8"
                    value={evalNotes}
                    onChangeText={setEvalNotes}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              </>
            )}

            {actionModal === 'disposal' && (
              <>
                <View style={styles.infoBoxRed}>
                  <MaterialCommunityIcons name="alert-circle" size={20} color="#EF4444" />
                  <View style={styles.warningContent}>
                    <Text style={styles.warningTitle}>Warning: Asset will transition to disposal process.</Text>
                    <Text style={styles.warningText}>This action marks the end of the asset's operational lifespan.</Text>
                  </View>
                </View>
                <View style={styles.checkboxRow}>
                  <View style={[styles.checkbox, { borderColor: disposalChecked ? '#EF4444' : '#CBD5E1' }]}>
                    {disposalChecked && <MaterialCommunityIcons name="check-box" size={16} color="#EF4444" />}
                  </View>
                  <Text style={styles.checkboxLabelText}>I confirm this asset should be disposed</Text>
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>DISPOSAL NOTES (OPTIONAL)</Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="Reason for disposal..."
                    placeholderTextColor="#94A3B8"
                    value={evalNotes}
                    onChangeText={setEvalNotes}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </View>
              </>
            )}
          </View>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnGhost]}
              onPress={() => setActionModal(null)}
              disabled={processing}
            >
              <Text style={styles.modalBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            {actionModal === 'return' && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGreen]}
                onPress={handleReturnToActive}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="check-circle" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnGreenText}>Return to Active</Text>
              </TouchableOpacity>
            )}
            {actionModal === 'repair' && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGold]}
                onPress={handleSendForRepair}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="wrench" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnGoldText}>Send for Repair</Text>
              </TouchableOpacity>
            )}
            {actionModal === 'replacement' && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnBlue]}
                onPress={handleRecommendReplacement}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="sync" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnBlueText}>Recommend Replacement</Text>
              </TouchableOpacity>
            )}
            {actionModal === 'disposal' && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnRed]}
                onPress={handleProceedWithDisposal}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="trash-can" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnRedText}>Proceed with Disposal</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Asset Lifespan</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={NAVY} />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={44} color="#94A3B8" />
            <Text style={styles.emptyTitle}>Couldn&apos;t load assets</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : assets.length === 0 ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="calendar-alert-outline" size={44} color="#94A3B8" />
            <Text style={styles.emptyTitle}>No assets found</Text>
            <Text style={styles.emptyText}>Assets with lifecycle data will appear here.</Text>
          </View>
        ) : (
          <>
            {/* Summary Cards */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: '#F0FDF4' }]}>
                <MaterialCommunityIcons name="check-circle" size={24} color="#10B981" />
                <Text style={styles.summaryValue}>{activeAssets.length}</Text>
                <Text style={styles.summaryLabel}>Active</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#FFFBEB' }]}>
                <MaterialCommunityIcons name="alert" size={24} color="#F59E0B" />
                <Text style={styles.summaryValue}>{forCheckingAssets.length}</Text>
                <Text style={styles.summaryLabel}>For Checking</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#FEF2F2' }]}>
                <MaterialCommunityIcons name="alert-circle" size={24} color="#EF4444" />
                <Text style={styles.summaryValue}>{expiredAssets.length}</Text>
                <Text style={styles.summaryLabel}>Expired</Text>
              </View>
            </View>

            {/* Expired Assets Section */}
            {expiredAssets.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="alert-circle" size={18} color="#EF4444" />
                  <Text style={styles.sectionTitle}>Expired Assets — Evaluation Required</Text>
                </View>
                {expiredAssets.map(asset => renderAssetCard(asset, 0))}
              </View>
            )}

            {/* Active / For Checking Assets */}
            {(activeAssets.length > 0 || forCheckingAssets.length > 0) && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MaterialCommunityIcons name="cog-outline" size={18} color={GOLD} />
                  <Text style={styles.sectionTitle}>Asset Evaluation</Text>
                </View>
                {activeAssets.map(asset => renderAssetCard(asset, 0))}
                {forCheckingAssets.map(asset => renderAssetCard(asset, 0))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {renderActionModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#0C134F',
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 42,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 270,
  },
  retryButton: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: NAVY,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    minHeight: 80,
    justifyContent: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '800',
    color: NAVY,
    marginTop: 6,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: NAVY,
  },
  assetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  assetHeader: {
    marginBottom: 10,
  },
  assetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  assetName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
  },
  assetCode: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: '46%',
    flexShrink: 1,
    backgroundColor: '#F8FAFC',
    padding: 7,
    borderRadius: 8,
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  detailValue: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  lifecycleBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
  },
  lifecycleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  lifecycleLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  lifecycleGrid: {
    gap: 8,
  },
  lifecycleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  lifecycleDetailLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  lifecycleDetailValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
    maxWidth: 120,
    textAlign: 'right',
  },
  actionButtonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    minWidth: '45%',
    maxWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    gap: 4,
  },
  returnButton: {
    backgroundColor: '#10B981',
  },
  repairButton: {
    backgroundColor: GOLD_LIGHT,
  },
  replacementButton: {
    backgroundColor: '#3B82F6',
  },
  disposalButton: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: NAVY,
    flex: 1,
  },
  modalBody: {
    marginBottom: 16,
  },
  infoBoxGreen: {
    backgroundColor: '#EBF5ED',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#B2F2BA',
    marginBottom: 14,
  },
  infoBoxGold: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FCD34D',
    marginBottom: 14,
  },
  infoBoxBlue: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 14,
  },
  infoBoxRed: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  infoBoxText: {
    flex: 1,
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
  },
  boldGreen: {
    fontWeight: '800',
    color: '#10B981',
  },
  boldGold: {
    fontWeight: '800',
    color: GOLD_LIGHT,
  },
  boldBlue: {
    fontWeight: '800',
    color: '#3B82F6',
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxLabel: {
    flex: 1,
  },
  checkboxLabelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  checkboxSubtext: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  extendInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  extendInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
  },
  extendUnit: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  formGroup: {
    marginBottom: 14,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  textArea: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 80,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modalBtnGhost: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalBtnGhostText: {
    color: '#64748B',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBtnGreen: {
    backgroundColor: '#10B981',
  },
  modalBtnGreenText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBtnGold: {
    backgroundColor: GOLD_LIGHT,
  },
  modalBtnGoldText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBtnBlue: {
    backgroundColor: '#3B82F6',
  },
  modalBtnBlueText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBtnRed: {
    backgroundColor: '#EF4444',
  },
  modalBtnRedText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
