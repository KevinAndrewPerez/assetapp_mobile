/**
 * Disposal Records — the Disposal page and Archived Disposal Assets.
 *
 * New on the web in the latest update and ported here: a disposal record is
 * never deleted. Archiving it moves the record off the Disposal page and into
 * the archive, and takes its asset out of the institution's inventory, so the
 * asset stops appearing in the Assets list, the registry, the department views
 * and the maintenance queue — while the record, and the whole history behind
 * it, stays readable.
 *
 * Both shelves are read through `lib/disposalService` (`scope: 'active' |
 * 'archived'`), so the two apps cannot drift on what "archived" means.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { headerTopPadding } from '@/lib/theme';
import { formatStoredDate } from '@/lib/time';
import { getStoredUser, type StoredUser } from '@/lib/userService';
import {
  archiveColumnsReady,
  archiveDisposal,
  fetchArchivedDisposalRecords,
  fetchDisposalRecords,
  type DisposalRecord,
} from '@/lib/disposalService';

const NAVY = '#0C134F';
const NAVY_MID = '#1E3A5F';
const TEXT_MUTED = '#64748B';
const BORDER = '#E2E8F0';
const GREEN = '#059669';

type Shelf = 'active' | 'archived';

const recordName = (user: StoredUser | null): string => {
  const employee = (user as any)?.employee_numbers;
  const row = Array.isArray(employee) ? employee[0] : employee;
  return String(row?.Full_Name ?? user?.full_name ?? user?.email ?? 'Asset Management Office');
};

export default function DisposalRecordsScreen() {
  const router = useRouter();

  const listRef = useRef<ScrollView | null>(null);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [shelf, setShelf] = useState<Shelf>('active');
  const [active, setActive] = useState<DisposalRecord[]>([]);
  const [archived, setArchived] = useState<DisposalRecord[]>([]);
  const [archiveReady, setArchiveReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The record whose archive question is open — asked in the card, not a dialog. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** What the last archive attempt did; stays on screen after the record moves. */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'Admin' || user?.role === 'AssetOfficer';

  // Never calls setState synchronously, so it is safe from a focus effect.
  const load = useCallback(async () => {
    setError(null);
    try {
      const [account, ready] = await Promise.all([getStoredUser(), archiveColumnsReady()]);
      setUser(account);
      setArchiveReady(ready);

      const [activeRows, archivedRows] = await Promise.all([
        fetchDisposalRecords({ scope: 'active' }),
        ready ? fetchArchivedDisposalRecords() : Promise.resolve([] as DisposalRecord[]),
      ]);
      setActive(activeRows);
      setArchived(archivedRows);
    } catch (loadError) {
      setError((loadError as Error)?.message || 'Could not load disposal records.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  /**
   * Show a shelf.
   *
   * Tapping the shelf you are already on refreshes it: a tab that answers a tap
   * with nothing at all reads as a broken button, and the counts on the two tabs
   * are the only thing telling an admin that a record moved. The list also jumps
   * back to the top on every tap — the two shelves hold rows of the same assets,
   * so a switch made from halfway down the list used to look like no change.
   */
  const showShelf = (next: Shelf) => {
    if (next === shelf) onRefresh();
    else setShelf(next);
    listRef.current?.scrollTo({ y: 0, animated: false });
  };

  const labelOf = (record: DisposalRecord): string =>
    record.assetCode && record.assetCode !== 'N/A' ? record.assetCode : `#${record.disposalId}`;

  /**
   * Archive one record.
   *
   * The question and the answer used to be native `Alert` dialogs. A dialog is
   * easy to miss or dismiss by accident, and when that happened the tap looked
   * like it had been ignored — which is exactly what "the button is not working"
   * means from the other side of the screen. Both now live in the card: the
   * question appears where the button was, and the result stays on the screen
   * after the record has moved, so a tap always leaves visible evidence.
   */
  const runArchive = async (record: DisposalRecord) => {
    setConfirmingId(null);
    setResult(null);
    setBusyId(record.disposalId);

    try {
      const outcome = await archiveDisposal({
        record,
        actorId: user?.id ?? null,
        actorName: recordName(user),
      });
      setResult({
        ok: outcome.archived,
        text: outcome.archived
          ? `${labelOf(record)} archived — ${outcome.message}`
          : `Not archived — ${outcome.message}`,
      });
      if (outcome.archived) {
        setShelf('archived');
        await load();
      }
    } catch (archiveError) {
      setResult({
        ok: false,
        text:
          (archiveError as Error)?.message ||
          'The disposal record could not be archived. Nothing was changed.',
      });
      // Whatever went wrong, the reason is at the top of the list.
      listRef.current?.scrollTo({ y: 0, animated: true });
    } finally {
      setBusyId(null);
    }
  };

  const rows = shelf === 'active' ? active : archived;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Disposal Records</Text>
          <Text style={styles.headerSubtitle}>Disposal page &amp; archived assets</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {([
          { key: 'active' as Shelf, label: `Disposal (${active.length})`, icon: 'trash-can-outline' },
          { key: 'archived' as Shelf, label: `Archived (${archived.length})`, icon: 'archive-outline' },
        ]).map((tab) => {
          const selected = shelf === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, selected && styles.tabActive]}
              onPress={() => showShelf(tab.key)}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name={tab.icon as any} size={16} color={selected ? '#FFFFFF' : NAVY_MID} />
              <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        ref={listRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!archiveReady ? (
          <View style={styles.noticeBox}>
            <MaterialCommunityIcons name="information-outline" size={18} color="#92400E" />
            <Text style={styles.noticeText}>
              Archiving is not available yet: the archive migration has not been run on this server. Every
              disposal record still appears on the Disposal page.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#B91C1C" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {result ? (
          <View style={[styles.resultBox, result.ok ? styles.resultOk : styles.resultFail]}>
            <MaterialCommunityIcons
              name={result.ok ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={result.ok ? '#166534' : '#B91C1C'}
            />
            <Text style={[styles.resultText, result.ok ? styles.resultTextOk : styles.resultTextFail]}>
              {result.text}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={NAVY} />
            <Text style={styles.centerText}>Loading disposal records…</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.centerBox}>
            <MaterialCommunityIcons
              name={shelf === 'active' ? 'archive-check-outline' : 'archive-off-outline'}
              size={34}
              color={TEXT_MUTED}
            />
            <Text style={styles.centerText}>
              {shelf === 'active'
                ? 'No disposal records on the Disposal page.'
                : 'Nothing archived yet. Archive a disposal record to move it here and take its asset out of the inventory.'}
            </Text>
          </View>
        ) : (
          rows.map((record) => {
            const busy = busyId === record.disposalId;
            const label = record.assetCode && record.assetCode !== 'N/A' ? record.assetCode : 'N/A';
            // Three states, and only the middle one means "the migration is missing":
            // removed, the asset row was deleted (nothing left to remove), or a live
            // asset row that was never marked removed.
            const inventoryNote = record.inventoryRemoved
              ? 'Removed from inventory'
              : record.assetId
                ? 'Still counted in the inventory — the inventory migration has not been run.'
                : 'The asset record no longer exists, so there is nothing left to remove from the inventory.';
            return (
              <View key={record.disposalId} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{record.assetName || 'Unknown Asset'}</Text>
                    <Text style={styles.cardCode}>{label}</Text>
                  </View>
                  <View style={[styles.chip, record.isArchived ? styles.chipArchived : styles.chipActive]}>
                    <Text style={[styles.chipText, record.isArchived ? styles.chipTextArchived : styles.chipTextActive]}>
                      {record.assetId ? (record.isArchived ? 'Archived' : 'On Disposal page') : 'Asset record removed'}
                    </Text>
                  </View>
                </View>

                <View style={styles.metaGrid}>
                  <Text style={styles.metaLabel}>Reason</Text>
                  <Text style={styles.metaValue} numberOfLines={2}>{record.reason || record.reasonCategory || '—'}</Text>
                  <Text style={styles.metaLabel}>Method</Text>
                  <Text style={styles.metaValue}>{record.method || '—'}</Text>
                  <Text style={styles.metaLabel}>Disposal date</Text>
                  <Text style={styles.metaValue}>{record.disposalDate ? formatStoredDate(record.disposalDate) : '—'}</Text>
                  <Text style={styles.metaLabel}>Custodian</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>{record.previousCustodian || record.requesterName || '—'}</Text>
                  {record.isArchived ? (
                    <>
                      <Text style={styles.metaLabel}>Archived</Text>
                      <Text style={styles.metaValue}>
                        {record.archivedAt ? formatStoredDate(record.archivedAt) : '—'}
                      </Text>
                    </>
                  ) : null}
                </View>

                {record.isArchived ? (
                  <View style={[styles.inventoryRow, record.inventoryRemoved && styles.inventoryRowRemoved]}>
                    <MaterialCommunityIcons
                      name={record.inventoryRemoved ? 'archive-remove-outline' : 'information-outline'}
                      size={16}
                      color={record.inventoryRemoved ? '#B91C1C' : TEXT_MUTED}
                    />
                    <Text style={[styles.inventoryText, record.inventoryRemoved && styles.inventoryTextRemoved]}>
                      {inventoryNote}
                    </Text>
                  </View>
                ) : isAdmin ? (
                  busy ? (
                    <View style={[styles.archiveButton, styles.archiveButtonBusy]}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                  ) : confirmingId === record.disposalId ? (
                    <View style={styles.confirmBox}>
                      <Text style={styles.confirmText}>
                        Archive the disposal record for {label}? It moves to Archived Disposal Assets and its asset
                        leaves the inventory: it stops appearing in the Assets list, the registry and the maintenance
                        queue. Nothing is deleted — the record and the asset history stay readable.
                      </Text>
                      <View style={styles.confirmActions}>
                        <TouchableOpacity
                          style={styles.confirmCancel}
                          onPress={() => setConfirmingId(null)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.confirmCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.confirmGo}
                          onPress={() => runArchive(record)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.confirmGoText}>Archive</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.archiveButton,
                        // A disabled button must not look like a live one: without the
                        // archive columns the tap is ignored, and a green button that
                        // does nothing is what "the button is not working" means.
                        !archiveReady && styles.archiveButtonDisabled,
                      ]}
                      onPress={() => {
                        setResult(null);
                        setConfirmingId(record.disposalId);
                      }}
                      disabled={!archiveReady}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="archive-arrow-down-outline" size={17} color="#FFFFFF" />
                      <Text style={styles.archiveButtonText}>Archive &amp; remove from inventory</Text>
                    </TouchableOpacity>
                  )
                ) : (
                  <Text style={styles.readOnlyHint}>Only the Asset Management Office can archive a disposal record.</Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F7FB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: headerTopPadding,
    backgroundColor: NAVY,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255, 255, 255, 0.7)', marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: NAVY,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  tabActive: { backgroundColor: NAVY_MID },
  tabText: { fontSize: 13, fontWeight: '600', color: NAVY_MID },
  tabTextActive: { color: '#FFFFFF' },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },
  noticeBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noticeText: { flex: 1, fontSize: 12.5, color: '#92400E', lineHeight: 18 },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { flex: 1, fontSize: 12.5, color: '#B91C1C' },
  resultBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  resultOk: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  resultFail: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  resultText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  resultTextOk: { color: '#166534' },
  resultTextFail: { color: '#B91C1C' },
  confirmBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    padding: 12,
    gap: 10,
  },
  confirmText: { fontSize: 12.5, color: '#7C2D12', lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  confirmCancel: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  confirmCancelText: { fontSize: 13, fontWeight: '600', color: '#9A3412' },
  confirmGo: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: 10, backgroundColor: GREEN },
  confirmGoText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  centerBox: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  centerText: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: NAVY },
  cardCode: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipActive: { backgroundColor: '#FEF3C7' },
  chipArchived: { backgroundColor: '#E0E7FF' },
  chipText: { fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: '#92400E' },
  chipTextArchived: { color: '#3730A3' },
  metaGrid: { gap: 4 },
  metaLabel: { fontSize: 11, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  metaValue: { fontSize: 13, color: '#1F2937' },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inventoryRowRemoved: { backgroundColor: '#FEE2E2' },
  inventoryText: { flex: 1, fontSize: 12, color: TEXT_MUTED },
  inventoryTextRemoved: { color: '#B91C1C', fontWeight: '600' },
  archiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 12,
  },
  archiveButtonBusy: { opacity: 0.7 },
  archiveButtonDisabled: { backgroundColor: '#94A3B8' },
  archiveButtonText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
  readOnlyHint: { fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic' },
});
