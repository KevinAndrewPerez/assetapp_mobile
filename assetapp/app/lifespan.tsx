import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchAssets, AssetSummary } from '@/lib/assetService';
import { resolveActingUserLabel } from '@/lib/actorService';
import {
  EvaluationAction,
  runAssetEvaluation,
  runAssetEvaluationCheck,
} from '@/lib/maintenanceService';
import { getStoredUser } from '@/lib/userService';

const NAVY = '#0C134F';
const GOLD_LIGHT = '#F59E0B';

/** The lifespan evaluation actions available on this screen. */
type LifespanAction = 'return' | 'repair' | 'replacement' | 'disposal' | 'extend';

/** Each screen action maps onto the shared evaluation action of the service. */
const SERVICE_ACTION: Record<LifespanAction, EvaluationAction> = {
  return: 'return_active',
  repair: 'send_repair',
  replacement: 'recommend_replacement',
  disposal: 'proceed_disposal',
  extend: 'extend_lifespan_pullout',
};

/**
 * Only these lifecycle statuses take part in the lifespan evaluation:
 *   • Active       → moved to For Checking (evaluation is required)
 *   • For Checking → already queued, still needs the office's decision
 *   • Pullout      → status never changes; extend the lifespan or dispose
 * A For Repair / For Replacement / Disposal / Acquired asset waits until it is
 * back to Active or Pullout, even when its lifespan has already expired.
 * ("pulled out" is the normalized form of "Pullout" from fetchAssets.)
 */
const EVALUABLE_STATUSES = ['active', 'for checking', 'pullout', 'pulled out'];

const isPulloutStatusKey = (key: string) => key === 'pullout' || key === 'pulled out';

export default function LifespanScreen() {
  const router = useRouter();
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetSummary | null>(null);
  const [actionModal, setActionModal] = useState<LifespanAction | null>(null);
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

      // Lifespan monitor (web parity): an expired **Active** asset moves to
      // "For Checking" so it cannot be handed out before evaluation. Pullout
      // assets are never touched here — they keep their status until the office
      // extends the lifespan or disposes of them.
      try {
        await runAssetEvaluationCheck({ actorId: user.id ?? null });
      } catch (transitionErr) {
        console.warn('Lifespan auto-transition failed:', transitionErr);
      }

      // fetchAssets now carries expirationDate / lifespanMonths / purchasePrice
      // directly on every row (they used to be dropped, which left this queue
      // permanently empty).
      setAssets(await fetchAssets());
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Unable to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      await load();
    };
    bootstrap();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  const statusKey = (asset: { status?: string | null }) =>
    String(asset.status ?? '').trim().toLowerCase();

  /** Expired to the same day-granularity the dashboard counters use. */
  const isExpired = (asset: { expirationDate?: string | null }) =>
    !!asset.expirationDate && String(asset.expirationDate).slice(0, 10) <= todayIso;

  /** The evaluation queue: expired assets in an evaluable lifecycle status. */
  const evaluationAssets = assets.filter(
    (asset) => isExpired(asset) && EVALUABLE_STATUSES.includes(statusKey(asset)),
  );
  const forCheckingInQueue = evaluationAssets.filter((asset) => statusKey(asset) === 'for checking');
  const pulloutInQueue = evaluationAssets.filter((asset) => isPulloutStatusKey(statusKey(asset)));

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

  const daysExpired = (expDate?: string | null) => {
    if (!expDate) return 0;
    return Math.floor((new Date().getTime() - new Date(expDate + 'T00:00:00').getTime()) / 86400000);
  };

  const openActionModal = (asset: typeof selectedAsset, action: LifespanAction) => {
    setSelectedAsset(asset);
    setActionModal(action);
    setExtending(false);
    setExtendMonths('');
    setEvalNotes('');
    setDisposalChecked(false);
  };

  /**
   * Every decision on this screen runs through the shared evaluation service, so
   * the mobile follows exactly the same rules as the web admin's evaluate
   * endpoint: a pulled-out asset keeps Pullout and can only have its lifespan
   * extended or be disposed of, while everything else takes a full evaluation
   * decision (return to active, repair, replacement or disposal).
   */
  const runDecision = async (decision: LifespanAction) => {
    if (!selectedAsset || processing) return;

    const months = decision === 'return' || decision === 'extend' ? Number(extendMonths) || 0 : 0;
    if (decision === 'extend' && months < 1) {
      Alert.alert('Months required', 'Enter at least 1 month to extend the lifespan by.');
      return;
    }
    if (decision === 'disposal' && !disposalChecked) {
      Alert.alert('Confirmation Required', 'Please confirm that this asset should be disposed.');
      return;
    }

    setProcessing(true);
    try {
      const actor = await resolveActingUserLabel();
      const result = await runAssetEvaluation({
        assetId: selectedAsset.id,
        action: SERVICE_ACTION[decision],
        notes: evalNotes,
        // `return` may extend the lifespan, `extend` must.
        extensionMonths: decision === 'return' ? (extending ? months : 0) : months,
        actorId: actor.id,
        actorLabel: actor.label,
      });

      const messages: Record<LifespanAction, string> = {
        return: `Asset returned to Active status.${
          extending && months > 0 ? ` Lifespan extended by ${months} months.` : ''
        }`,
        repair: 'Asset sent for repair. A pending repair record was created.',
        replacement:
          'Replacement recommendation submitted. A replacement record was created for this asset.',
        disposal: 'Asset marked for disposal. The disposal process has been initiated.',
        extend: `Lifespan extended to ${formatDate(
          result.expirationDate ?? null,
        )}.\nThe asset remains in Pullout status.`,
      };

      Alert.alert('Success', messages[decision]);
      setActionModal(null);
      setSelectedAsset(null);
      await load();
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to update the asset');
    } finally {
      setProcessing(false);
    }
  };

  const renderAssetCard = (asset: typeof assets[0], index: number) => {
    const days = daysExpired(asset.expirationDate);
    const expired = isExpired(asset);
    const key = statusKey(asset);
    const isForChecking = key === 'for checking';
    const isPullout = isPulloutStatusKey(key);
    const statusLabel = isForChecking
      ? 'For Checking'
      : isPullout
        ? 'Pulled Out'
        : asset.status || (expired ? 'Expired' : 'Active');
    const statusTone = isForChecking
      ? { bg: '#FFFBEB', fg: '#B45309' }
      : isPullout
        ? { bg: '#EFF6FF', fg: '#0369A1' }
        : expired
          ? { bg: '#FEF2F2', fg: '#B91C1C' }
          : { bg: '#ECFDF5', fg: '#047857' };
    const detailCell = (label: string, value: string) => (
      <View style={styles.detailCell} key={label}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue} numberOfLines={2}>{value || 'N/A'}</Text>
      </View>
    );

    return (
      <View key={asset.id || index} style={styles.assetCard}>
        <View style={styles.assetTitleRow}>
          <View style={styles.assetTitleBlock}>
            <Text style={styles.assetName} numberOfLines={1}>{asset.title}</Text>
            <Text style={styles.assetCode} numberOfLines={1}>{asset.assetId}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusTone.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusTone.fg }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.detailGrid}>
          {detailCell('Acquired', formatDate(asset.acquisitionDate))}
          {detailCell(
            'Purchase Price',
            asset.purchasePrice != null ? `₱${Number(asset.purchasePrice).toLocaleString('en-PH')}` : '',
          )}
          {detailCell('Serial No.', asset.serialNumber || '')}
          {detailCell('Location', asset.location || '')}
          {detailCell('Category', asset.category || '')}
          {detailCell('Assigned To', asset.custodian || '')}
        </View>

        <View style={[styles.lifecycleBox, expired ? styles.lifecycleBoxExpired : null]}>
          <View style={styles.lifecycleRow}>
            <Text style={styles.lifecycleLabel}>Lifespan</Text>
            <Text style={styles.lifecycleValue}>
              {asset.lifespanMonths ? `${asset.lifespanMonths} months` : 'N/A'}
            </Text>
          </View>
          <View style={styles.lifecycleRow}>
            <Text style={styles.lifecycleLabel}>Expires</Text>
            <Text style={[styles.lifecycleValue, expired ? styles.lifecycleValueExpired : null]}>
              {formatDate(asset.expirationDate)}
            </Text>
          </View>
          {expired ? (
            <Text style={styles.lifecycleOverdue}>
              Expired {days} day{days !== 1 ? 's' : ''} ago — evaluation required
            </Text>
          ) : null}
        </View>

        {isPullout ? (
          <>
            <View style={styles.pulloutNotice}>
              <MaterialCommunityIcons name="information-outline" size={15} color="#0369A1" />
              <Text style={styles.pulloutNoticeText}>
                Stays in Pullout — extend its lifespan or dispose of it. It cannot return to Active from here.
              </Text>
            </View>
            <View style={styles.actionGrid}>
              <TouchableOpacity
                style={[styles.actionChip, styles.extendChip]}
                onPress={() => openActionModal(asset, 'extend')}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="calendar-plus" size={17} color="#0369A1" />
                <Text style={styles.extendChipText}>Extend Lifespan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionChip, styles.disposalChip]}
                onPress={() => openActionModal(asset, 'disposal')}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={17} color="#B91C1C" />
                <Text style={styles.disposalChipText}>Dispose</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.actionGrid}>
            <TouchableOpacity
              style={[styles.actionChip, styles.returnChip]}
              onPress={() => openActionModal(asset, 'return')}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="check-circle-outline" size={17} color="#047857" />
              <Text style={styles.returnChipText}>Return to Active</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, styles.repairChip]}
              onPress={() => openActionModal(asset, 'repair')}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="wrench-outline" size={17} color="#B45309" />
              <Text style={styles.repairChipText}>Send for Repair</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, styles.replacementChip]}
              onPress={() => openActionModal(asset, 'replacement')}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="sync" size={17} color="#1D4ED8" />
              <Text style={styles.replacementChipText}>Replacement</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionChip, styles.disposalChip]}
              onPress={() => openActionModal(asset, 'disposal')}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={17} color="#B91C1C" />
              <Text style={styles.disposalChipText}>Disposal</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderActionModal = () => {
    if (!actionModal || !selectedAsset) return null;

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {actionModal === 'return' && 'Return Asset to Active'}
              {actionModal === 'repair' && 'Send Asset for Repair'}
              {actionModal === 'replacement' && 'Recommend Replacement'}
              {actionModal === 'disposal' && 'Proceed with Disposal'}
              {actionModal === 'extend' && 'Extend Asset Lifespan'}
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
                    {extending && <MaterialCommunityIcons name="checkbox-marked" size={16} color="#10B981" />}
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
                    <Text style={styles.warningText}>This action marks the end of the asset&apos;s operational lifespan.</Text>
                  </View>
                </View>
                <View style={styles.checkboxRow}>
                  <View style={[styles.checkbox, { borderColor: disposalChecked ? '#EF4444' : '#CBD5E1' }]}>
                    {disposalChecked && <MaterialCommunityIcons name="checkbox-marked" size={16} color="#EF4444" />}
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

            {actionModal === 'extend' && (
              <>
                <View style={styles.infoBoxBlue}>
                  <Text style={styles.infoBoxText}>
                    The asset was pulled out, so it stays in <Text style={styles.boldBlue}>Pullout</Text> status. Only the
                    expiration date moves forward, and it can never return to Active from here.
                  </Text>
                </View>
                {selectedAsset.expirationDate ? (
                  <Text style={styles.currentExpiry}>
                    Current expiration date: {formatDate(selectedAsset.expirationDate)}
                  </Text>
                ) : null}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>ADDITIONAL LIFESPAN MONTHS *</Text>
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
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>NOTES (OPTIONAL)</Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="Why is the lifespan being extended?"
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
                onPress={() => runDecision('return')}
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
                onPress={() => runDecision('repair')}
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
                onPress={() => runDecision('replacement')}
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
                onPress={() => runDecision('disposal')}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="trash-can" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnRedText}>Proceed with Disposal</Text>
              </TouchableOpacity>
            )}
            {actionModal === 'extend' && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnBlue]}
                onPress={() => runDecision('extend')}
                disabled={processing}
              >
                {processing ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="calendar-plus" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.modalBtnBlueText}>Extend Lifespan</Text>
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
        ) : evaluationAssets.length === 0 ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="calendar-check-outline" size={44} color="#10B981" />
            <Text style={styles.emptyTitle}>Nothing to evaluate</Text>
            <Text style={styles.emptyText}>
              Assets show up here once an Active or Pullout asset passes its expected lifespan. Assets in another
              status wait until they are back to Active or Pullout.
            </Text>
          </View>
        ) : (
          <>
            {/* Summary Cards */}
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <View style={[styles.summaryIcon, { backgroundColor: '#FEF2F2' }]}>
                  <MaterialCommunityIcons name="clock-alert-outline" size={19} color="#EF4444" />
                </View>
                <Text style={styles.summaryValue}>{evaluationAssets.length}</Text>
                <Text style={styles.summaryLabel}>To Evaluate</Text>
              </View>
              <View style={styles.summaryCard}>
                <View style={[styles.summaryIcon, { backgroundColor: '#FFFBEB' }]}>
                  <MaterialCommunityIcons name="alert" size={19} color="#F59E0B" />
                </View>
                <Text style={styles.summaryValue}>{forCheckingInQueue.length}</Text>
                <Text style={styles.summaryLabel}>For Checking</Text>
              </View>
              <View style={styles.summaryCard}>
                <View style={[styles.summaryIcon, { backgroundColor: '#EFF6FF' }]}>
                  <MaterialCommunityIcons name="arrow-up-box" size={19} color="#0EA5E9" />
                </View>
                <Text style={styles.summaryValue}>{pulloutInQueue.length}</Text>
                <Text style={styles.summaryLabel}>Pullout</Text>
              </View>
            </View>

            {/* Lifespan evaluation queue */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="alert-circle" size={18} color="#EF4444" />
                <Text style={styles.sectionTitle}>Lifespan Requiring Evaluation</Text>
              </View>
              <Text style={styles.sectionHint}>
                Expired Active assets move to For Checking automatically. Pulled-out assets stay in Pullout — extend
                the lifespan or dispose of them.
              </Text>
              {evaluationAssets.map(asset => renderAssetCard(asset, 0))}
            </View>
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
    backgroundColor: '#F4F7FB',
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
    fontSize: 19,
    fontWeight: '800',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    paddingVertical: 14,
    alignItems: 'center',
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: NAVY,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
    textAlign: 'center',
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
  sectionHint: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 12,
  },
  assetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0C134F',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  assetTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  assetTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  assetCode: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  detailCell: {
    flexGrow: 1,
    flexBasis: '46%',
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
    lineHeight: 18,
  },
  lifecycleBox: {
    backgroundColor: '#F4F7FB',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 4,
  },
  lifecycleBoxExpired: {
    backgroundColor: '#FEF2F2',
  },
  lifecycleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  lifecycleLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lifecycleValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'right',
    flexShrink: 1,
  },
  lifecycleValueExpired: {
    color: '#DC2626',
  },
  lifecycleOverdue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#DC2626',
    marginTop: 2,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionChip: {
    flexGrow: 1,
    flexBasis: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  returnChip: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  returnChipText: {
    color: '#047857',
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  repairChip: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  repairChipText: {
    color: '#B45309',
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  replacementChip: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  replacementChipText: {
    color: '#1D4ED8',
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  disposalChip: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  disposalChipText: {
    color: '#B91C1C',
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  extendChip: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  extendChipText: {
    color: '#0369A1',
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  pulloutNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 10,
  },
  pulloutNoticeText: {
    flex: 1,
    fontSize: 12,
    color: '#0369A1',
    lineHeight: 16,
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
    backgroundColor: '#F4F7FB',
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
  currentExpiry: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 12,
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
    backgroundColor: '#F4F7FB',
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
    backgroundColor: '#F4F7FB',
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
