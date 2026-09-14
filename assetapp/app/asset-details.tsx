import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { AssetDetail, completeMaintenance, fetchAssetDetail } from '../lib/assetService';
import {
  EvaluationAction,
  runAssetEvaluation,
  runAssetEvaluationCheck,
  todayIso,
} from '../lib/maintenanceService';
import { resolveActingUserLabel } from '../lib/actorService';
import { getStoredUser } from '../lib/userService';
import QRViewModal from '../components/QRViewModal';

const NAVY = '#0C134F';
const NAVY_MID = '#1E3A5F';
const BRICK = '#DC2626';
const FOREST = '#059669';
const BRONZE = '#B45309';
const STEEL = '#2563EB';

/** The screen's own actions: the evaluation decisions plus maintenance. */
type PageAction = EvaluationAction | 'maintenance_complete';

const ACTION_TITLES: Record<PageAction, string> = {
  return_active: 'Return Asset to Active',
  send_repair: 'Send Asset for Repair',
  recommend_replacement: 'Recommend Replacement',
  proceed_disposal: 'Proceed with Disposal',
  extend_lifespan_pullout: 'Extend Asset Lifespan',
  maintenance_complete: 'Mark Maintenance Complete',
};

const dayDiff = (iso?: string | null, from = todayIso()) => {
  if (!iso) return null;
  const target = Date.parse(`${String(iso).slice(0, 10)}T00:00:00`);
  const start = Date.parse(`${from}T00:00:00`);
  if (Number.isNaN(target) || Number.isNaN(start)) return null;
  return Math.round((target - start) / 86400000);
};

const formatLong = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return String(iso);
  }
};

const peso = (value: number | null) =>
  value === null || value === undefined
    ? '—'
    : `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AssetDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams() as { id: string };
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [action, setAction] = useState<PageAction | null>(null);
  const [notes, setNotes] = useState('');
  const [months, setMonths] = useState('12');
  const [processing, setProcessing] = useState(false);

  const load = useCallback(
    async (transition = false) => {
      if (!id) return;
      try {
        setLoading(true);
        const user = await getStoredUser();

        // Same auto-transition the web's asset-detail route performs on open:
        // an Active asset whose lifespan expired (or whose maintenance is
        // overdue) is moved to For Checking before it is rendered.
        if (transition) {
          try {
            await runAssetEvaluationCheck({ assetId: id, actorId: user?.id ?? null });
          } catch (e) {
            console.warn('Asset evaluation check failed:', e);
          }
        }

        setAsset(await fetchAssetDetail(id));
      } catch (error) {
        console.error('Error loading asset details:', error);
        setAsset(null);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const bootstrap = async () => {
      await load(true);
    };
    bootstrap();
  }, [load]);

  const closeAction = () => {
    setAction(null);
    setNotes('');
    setMonths('12');
  };

  const openAction = (next: PageAction) => {
    setAction(next);
    setNotes('');
    setMonths('12');
  };

  const confirmAction = async () => {
    if (!action || !asset) return;
    setProcessing(true);
    try {
      const actor = await resolveActingUserLabel();
      const trimmed = notes.trim();

      if (action === 'maintenance_complete') {
        const result = await completeMaintenance({
          assetId: asset.id,
          actorId: actor.id,
          actorLabel: actor.label,
          notes: trimmed,
          performedDate: todayIso(),
        });
        closeAction();
        await load();
        Alert.alert(
          'Maintenance completed',
          `Asset preventive maintenance performed and completed.\nLifecycle status is now ${
            result.status
          }.${
            result.nextMaintenanceDate
              ? `\nNext maintenance: ${formatLong(result.nextMaintenanceDate)}`
              : ''
          }`,
        );
        return;
      }

      const result = await runAssetEvaluation({
        assetId: asset.id,
        action,
        notes: trimmed,
        extensionMonths: action === 'extend_lifespan_pullout' ? Number(months) || 0 : Number(months) || 0,
        actorId: actor.id,
        actorLabel: actor.label,
      });

      closeAction();
      await load();

      const messages: Record<EvaluationAction, string> = {
        return_active: 'Asset returned to Active status',
        send_repair: 'Asset sent for repair evaluation',
        recommend_replacement: 'Asset recommended for replacement',
        proceed_disposal: 'Asset marked for disposal',
        extend_lifespan_pullout: 'Lifespan extended. Asset remains in Pullout.',
      };
      Alert.alert(
        'Evaluation saved',
        `${messages[action]}${result.expirationDate ? `\nNew expiration: ${formatLong(result.expirationDate)}` : ''}`,
      );
    } catch (err) {
      Alert.alert('Error', (err as Error).message || 'Failed to update the asset.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={NAVY_MID} />
      </View>
    );
  }

  if (!asset) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Asset Not Found</Text>
        </View>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={64} color="#94A3B8" />
          <Text style={styles.emptyText}>The requested asset could not be found.</Text>
          <TouchableOpacity style={styles.goBackButton} onPress={() => router.back()}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isExpired = !!asset.expirationDate && asset.expirationDate <= todayIso();
  const isPullout = asset.rawStatus.trim().toLowerCase() === 'pullout';
  const expiryDays = dayDiff(asset.expirationDate);
  const nextMaintDays = dayDiff(asset.nextMaintenanceDate);
  const maintenanceOverdue = nextMaintDays !== null && nextMaintDays < 0;
  const maintenanceDueSoon = nextMaintDays !== null && nextMaintDays >= 0 && nextMaintDays <= 14;
  const showLifespan = asset.lifespanMonths !== null || !!asset.expirationDate;
  const showUpkeep = asset.maintenanceInterval !== null || !!asset.nextMaintenanceDate;
  // Same rule as the web: a pulled-out asset whose lifespan expired is handled
  // by the "extend lifespan / dispose" panel, not by the maintenance button.
  const canCompleteMaintenance =
    !!asset.nextMaintenanceDate && !(isExpired && isPullout);

  const statusTone =
    asset.rawStatus.trim().toLowerCase() === 'active'
      ? { bg: '#F0FDF4', fg: FOREST }
      : isPullout
        ? { bg: '#EFF6FF', fg: STEEL }
        : { bg: '#FFFBEB', fg: BRONZE };

  const tile = (
    key: EvaluationAction,
    icon: string,
    title: string,
    subtitle: string,
    tone: string,
  ) => (
    <TouchableOpacity
      key={key}
      style={[styles.actionTile, { borderLeftColor: tone }]}
      activeOpacity={0.85}
      onPress={() => openAction(key)}
    >
      <View style={styles.actionTileText}>
        <Text style={styles.actionTileTitle}>{title}</Text>
        <Text style={styles.actionTileSubtitle}>{subtitle}</Text>
      </View>
      <View style={[styles.actionTileIcon, { backgroundColor: tone }]}>
        <MaterialCommunityIcons name={icon as any} size={18} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Asset Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Registry header band */}
        <View style={styles.headerBand}>
          <Text style={styles.eyebrowGold}>ASSET RECORD</Text>
          <Text style={styles.assetTitle}>{asset.title}</Text>
          <Text style={styles.assetCode}>{asset.assetId}</Text>

          <View style={styles.headerPills}>
            <View style={[styles.statusPill, { backgroundColor: statusTone.bg }]}>
              <MaterialCommunityIcons name="shield-check" size={14} color={statusTone.fg} />
              <Text style={[styles.statusPillText, { color: statusTone.fg }]}>
                {asset.rawStatus || 'Unknown'}
              </Text>
            </View>
            <Text style={styles.assignedTo}>
              Assigned to <Text style={styles.assignedToValue}>{asset.custodian}</Text>
            </Text>
          </View>

          <View style={styles.headerMediaRow}>
            {asset.imageUrl && !photoFailed ? (
              <Image
                source={{ uri: asset.imageUrl }}
                style={styles.assetPhoto}
                resizeMode="cover"
                onError={(event) => {
                  console.warn(
                    '[asset-details] Photo failed:',
                    asset.imageUrl,
                    event.nativeEvent?.error ?? event,
                  );
                  setPhotoFailed(true);
                }}
              />
            ) : (
              <View style={styles.noPhoto}>
                <MaterialCommunityIcons name="image-off-outline" size={26} color="#94A3B8" />
                <Text style={styles.noPhotoText}>No Photo</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.qrStub}
              activeOpacity={0.85}
              onPress={() => setQrModalVisible(true)}
            >
              <Text style={styles.qrStubLabel}>SCAN TO VERIFY</Text>
              <QRCode value={asset.assetId} size={78} backgroundColor="white" />
              <Text style={styles.qrStubHint}>Tap to expand</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.body}>
          {/* Record fields */}
          <View style={styles.fieldGrid}>
            <Field label="Acquisition Date" value={formatLong(asset.acquisitionDate)} />
            <Field label="Purchase Price" value={peso(asset.purchasePrice)} mono />
            <Field label="Serial Number" value={asset.serialNumber || '—'} mono />
            <Field label="Location" value={asset.location || '—'} />
            <Field label="Condition" value={asset.condition || '—'} />
            <Field label="Category" value={asset.category || '—'} />
            <Field label="Department" value={asset.department || '—'} />
            <Field label="Last Updated" value={formatLong(asset.updatedAt)} />
          </View>

          {/* Asset Lifespan */}
          {showLifespan ? (
            <View style={styles.section}>
              <Text style={styles.eyebrow}>LIFECYCLE</Text>
              <Text style={styles.sectionTitle}>Asset Lifespan</Text>
              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.fieldLabel}>LIFESPAN DURATION</Text>
                  <Text style={styles.fieldValue}>
                    {asset.lifespanMonths ? `${asset.lifespanMonths} months` : '—'}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.fieldLabel}>EXPIRATION DATE</Text>
                  <Text
                    style={[
                      styles.fieldValue,
                      { color: isExpired ? BRICK : expiryDays !== null && expiryDays < 90 ? BRONZE : NAVY },
                    ]}
                  >
                    {formatLong(asset.expirationDate)}
                    {isExpired && expiryDays !== null ? (
                      <Text style={styles.fieldNote}> (Expired {Math.abs(expiryDays)} days ago)</Text>
                    ) : expiryDays !== null && expiryDays < 90 ? (
                      <Text style={styles.fieldNote}> ({expiryDays} days remaining)</Text>
                    ) : null}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Maintenance Schedule */}
          {showUpkeep ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.col}>
                  <Text style={styles.eyebrow}>UPKEEP</Text>
                  <Text style={styles.sectionTitle}>Maintenance Schedule</Text>
                </View>
                {maintenanceOverdue ? (
                  <View style={[styles.duePill, { backgroundColor: '#F7E2DF', borderColor: BRICK }]}>
                    <Text style={[styles.duePillText, { color: BRICK }]}>OVERDUE</Text>
                  </View>
                ) : maintenanceDueSoon ? (
                  <View style={[styles.duePill, { backgroundColor: '#F5EAD4', borderColor: BRONZE }]}>
                    <Text style={[styles.duePillText, { color: BRONZE }]}>DUE SOON</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.twoCol}>
                <View style={styles.col}>
                  <Text style={styles.fieldLabel}>MAINTENANCE INTERVAL</Text>
                  <Text style={styles.fieldValue}>
                    {asset.maintenanceInterval ? `${asset.maintenanceInterval} months` : '—'}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.fieldLabel}>LAST MAINTENANCE DATE</Text>
                  <Text style={styles.fieldValue}>{formatLong(asset.lastMaintenanceDate)}</Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.fieldLabel}>NEXT MAINTENANCE DUE</Text>
                  <Text
                    style={[
                      styles.fieldValue,
                      {
                        color: maintenanceOverdue
                          ? BRICK
                          : nextMaintDays !== null && nextMaintDays < 14
                            ? BRONZE
                            : NAVY,
                      },
                    ]}
                  >
                    {formatLong(asset.nextMaintenanceDate)}
                    {nextMaintDays !== null ? (
                      <Text style={styles.fieldNote}>
                        {maintenanceOverdue
                          ? ` (${Math.abs(nextMaintDays)} days overdue)`
                          : nextMaintDays < 14
                            ? ` (${nextMaintDays} days)`
                            : ''}
                      </Text>
                    ) : null}
                  </Text>
                </View>
                <View style={styles.col}>
                  <Text style={styles.fieldLabel}>REPAIR HISTORY</Text>
                  <Text style={styles.fieldValue}>{asset.repairCounts ?? 0} repair(s)</Text>
                </View>
              </View>

              {canCompleteMaintenance ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  activeOpacity={0.85}
                  onPress={() => openAction('maintenance_complete')}
                >
                  <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Mark Maintenance Complete</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* Evaluation panel — shown for an asset past its lifespan */}
          {isExpired ? (
            <View style={styles.evalPanel}>
              <View style={styles.evalPanelHeader}>
                <View style={styles.evalIconBadge}>
                  <MaterialCommunityIcons name="alert-outline" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.evalPanelText}>
                  <Text style={styles.evalPanelTitle}>
                    {isPullout ? 'Expired Pullout Asset' : 'Expired Asset Evaluation'}
                  </Text>
                  <Text style={styles.evalPanelBody}>
                    {isPullout
                      ? 'This pulled-out asset has reached the end of its operational lifespan. You can extend its lifespan or proceed with disposal. Status will remain Pullout.'
                      : 'This asset has reached the end of its operational lifespan and requires evaluation.'}
                  </Text>
                  <Text style={styles.evalPanelHint}>Please select an appropriate action:</Text>
                </View>
              </View>

              {isPullout ? (
                <>
                  {tile(
                    'extend_lifespan_pullout',
                    'calendar-check',
                    'Extend Lifespan',
                    'Keep as Pullout\nAdd months to expiration date',
                    FOREST,
                  )}
                  {tile(
                    'proceed_disposal',
                    'delete-outline',
                    'Proceed with Disposal',
                    'Asset no longer serviceable\nEnd of life disposal process',
                    BRICK,
                  )}
                </>
              ) : (
                <>
                  {tile(
                    'return_active',
                    'check-all',
                    'Return to Active',
                    'Asset is still functional\nOptional lifespan extension',
                    FOREST,
                  )}
                  {tile(
                    'send_repair',
                    'wrench-outline',
                    'Send for Repair',
                    'Asset needs maintenance\nSchedule repair evaluation',
                    BRONZE,
                  )}
                  {tile(
                    'recommend_replacement',
                    'refresh',
                    'Recommend Replacement',
                    'Asset beyond economical repair\nInitiate replacement process',
                    STEEL,
                  )}
                  {tile(
                    'proceed_disposal',
                    'delete-outline',
                    'Proceed with Disposal',
                    'Asset no longer serviceable\nEnd of life disposal process',
                    BRICK,
                  )}
                </>
              )}
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.backToAssets}
            activeOpacity={0.85}
            onPress={() => router.push('/assets-list')}
          >
            <Text style={styles.backToAssetsText}>← Back to assets</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Action modal */}
      <Modal visible={action !== null} transparent animationType="fade" onRequestClose={closeAction}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{action ? ACTION_TITLES[action] : ''}</Text>
              <TouchableOpacity onPress={closeAction} activeOpacity={0.7}>
                <MaterialCommunityIcons name="close" size={22} color={NAVY} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {action === 'maintenance_complete' ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxText}>
                    Reschedules the next maintenance from the configured interval. The asset stays{' '}
                    <Text style={styles.bold}>in review</Text> (For Checking) instead of returning to Active
                    automatically.
                  </Text>
                </View>
              ) : null}

              {action === 'return_active' ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxText}>
                    Asset will be returned to <Text style={styles.bold}>Active</Text> status. Add months below to
                    extend its lifespan at the same time.
                  </Text>
                </View>
              ) : null}

              {action === 'extend_lifespan_pullout' ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxText}>
                    The asset stays in <Text style={styles.bold}>Pullout</Text> status — only the expiration date
                    moves forward, so it can never return to Active from here.
                  </Text>
                </View>
              ) : null}

              {action === 'proceed_disposal' ? (
                <View style={[styles.infoBox, styles.infoBoxDanger]}>
                  <Text style={styles.infoBoxDangerText}>
                    This marks the end of the asset&apos;s operational lifespan. Its record stays in NU TRACE for
                    history and auditing.
                  </Text>
                </View>
              ) : null}

              {action === 'return_active' || action === 'extend_lifespan_pullout' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>
                    {action === 'return_active'
                      ? 'ADDITIONAL LIFESPAN MONTHS'
                      : 'ADDITIONAL LIFESPAN MONTHS *'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={months}
                    onChangeText={setMonths}
                    keyboardType="numeric"
                    placeholder="12"
                    placeholderTextColor="#94A3B8"
                  />
                  <Text style={styles.inputHint}>
                    {action === 'return_active'
                      ? 'Leave 0 to keep the current expiration date.'
                      : 'Between 1 and 120 months, counted from the current expiration date.'}
                  </Text>
                </View>
              ) : null}

              {action !== 'maintenance_complete' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>
                    {action === 'send_repair'
                      ? 'ISSUES OR DETERIORATION IDENTIFIED'
                      : action === 'recommend_replacement'
                        ? 'REASON FOR REPLACEMENT'
                        : action === 'proceed_disposal'
                          ? 'REASON FOR DISPOSAL'
                          : 'NOTES (OPTIONAL)'}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    placeholder={
                      action === 'send_repair'
                        ? 'What is wrong with the asset?'
                        : action === 'recommend_replacement'
                          ? 'Beyond economical repair, obsolete…'
                          : action === 'proceed_disposal'
                            ? 'No longer serviceable'
                            : 'Evaluation notes'
                    }
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              ) : null}
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={closeAction}
                disabled={processing}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={confirmAction}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <QRViewModal
        visible={qrModalVisible}
        onClose={() => setQrModalVisible(false)}
        value={asset.assetId}
        title={asset.title}
      />
    </SafeAreaView>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fieldBox}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.fieldValue, mono ? styles.mono : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: NAVY,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 6,
    marginLeft: -6,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  headerBand: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  eyebrowGold: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#FBBF24',
    marginBottom: 6,
  },
  assetTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  assetCode: {
    fontSize: 13,
    color: 'rgba(253, 184, 51, 0.85)',
    marginTop: 4,
  },
  headerPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  assignedTo: {
    fontSize: 13,
    color: '#C7D2E3',
  },
  assignedToValue: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  headerMediaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginTop: 16,
  },
  assetPhoto: {
    width: 96,
    height: 96,
    borderRadius: 12,
  },
  noPhoto: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  noPhotoText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  qrStub: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  qrStubLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: NAVY_MID,
  },
  qrStubHint: {
    fontSize: 10,
    color: '#64748B',
  },
  body: {
    padding: 20,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  fieldBox: {
    // Full width so long values (asset codes, categories) run to the right edge
    // instead of leaving half the row empty.
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  section: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#94A3B8',
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: NAVY,
    marginBottom: 12,
  },
  twoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  col: {
    width: '48%',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#94A3B8',
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 14,
    fontWeight: '700',
    color: NAVY,
    lineHeight: 20,
  },
  mono: {
    fontVariant: ['tabular-nums'],
  },
  fieldNote: {
    fontSize: 11,
    fontWeight: '500',
  },
  duePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  duePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: FOREST,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  evalPanel: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  evalPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FBF3F0',
    borderWidth: 1,
    borderColor: '#E7C9C1',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  evalIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: BRICK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evalPanelText: {
    flex: 1,
  },
  evalPanelTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#8C2F27',
  },
  evalPanelBody: {
    fontSize: 13,
    color: '#7A4A44',
    marginTop: 4,
    lineHeight: 19,
  },
  evalPanelHint: {
    fontSize: 13,
    color: '#7A4A44',
    marginTop: 8,
    fontWeight: '600',
  },
  actionTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  actionTileText: {
    flex: 1,
  },
  actionTileTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },
  actionTileSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 16,
  },
  actionTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backToAssets: {
    marginTop: 22,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  backToAssetsText: {
    fontSize: 14,
    fontWeight: '700',
    color: NAVY_MID,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: NAVY,
    flex: 1,
  },
  modalBody: {
    gap: 10,
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
  },
  infoBoxText: {
    fontSize: 12.5,
    color: '#1E40AF',
    lineHeight: 18,
  },
  infoBoxDanger: {
    backgroundColor: '#FEF2F2',
  },
  infoBoxDangerText: {
    fontSize: 12.5,
    color: '#B91C1C',
    lineHeight: 18,
  },
  bold: {
    fontWeight: '800',
  },
  formGroup: {
    marginTop: 4,
  },
  formLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#94A3B8',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: NAVY,
  },
  textArea: {
    minHeight: 76,
  },
  inputHint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 6,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    backgroundColor: '#F1F5F9',
  },
  modalBtnGhostText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  modalBtnPrimary: {
    backgroundColor: NAVY_MID,
  },
  modalBtnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  goBackButton: {
    backgroundColor: NAVY_MID,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  goBackText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
