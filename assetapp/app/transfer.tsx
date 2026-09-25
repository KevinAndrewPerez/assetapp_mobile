import React, { useCallback, useMemo, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { headerTopPadding } from '@/lib/theme';
import { getStoredUser } from '@/lib/userService';
import { formatStoredDate } from '@/lib/time';
import {
  executeEmployeeTransfer,
  fetchEmployeeAssignedAssets,
  fetchTransferEmployees,
  fetchTransferHistory,
  TRANSFER_REASONS,
  TRANSFER_STATUS_META,
  TransferAsset,
  TransferEmployee,
  TransferRecord,
} from '@/lib/transferService';

const NAVY = '#0C134F';
const NAVY_MID = '#1E3A5F';
const GOLD = '#FBBF24';
const TEXT_MUTED = '#64748B';
const BORDER = '#E2E8F0';

type Step = 'list' | 'assets' | 'receiver' | 'confirm';
type Tab = 'employees' | 'history';

export default function TransferScreen() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('employees');
  const [step, setStep] = useState<Step>('list');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [employees, setEmployees] = useState<TransferEmployee[]>([]);
  const [history, setHistory] = useState<TransferRecord[]>([]);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');

  // --- transfer draft -------------------------------------------------------
  const [source, setSource] = useState<TransferEmployee | null>(null);
  const [sourceAssets, setSourceAssets] = useState<TransferAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [receiverSearch, setReceiverSearch] = useState('');
  const [receiver, setReceiver] = useState<TransferEmployee | null>(null);
  const [reason, setReason] = useState<string>(TRANSFER_REASONS[0]);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const [detailRecord, setDetailRecord] = useState<TransferRecord | null>(null);

  // Note: `load` never calls setState synchronously, so it is safe to call from
  // the mount effect (the spinner state is already `true` on first paint).
  const load = useCallback(async () => {
    try {
      const [people, transfers] = await Promise.all([
        fetchTransferEmployees(),
        fetchTransferHistory(),
      ]);
      setEmployees(people);
      setHistory(transfers);
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Unable to load the transfer data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the screen regains focus (it stays mounted as a stack route),
  // so a transfer done in another session shows up with the right statuses.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const departments = useMemo(() => {
    const names = Array.from(new Set(employees.map((e) => e.department).filter(Boolean)));
    return ['All', ...names.sort((a, b) => a.localeCompare(b))];
  }, [employees]);

  const visibleEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (departmentFilter !== 'All' && employee.department !== departmentFilter) return false;
      if (!needle) return true;
      return [employee.name, employee.employeeNumber, employee.department, employee.role, employee.email]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [employees, search, departmentFilter]);

  /** Receiving-employee candidates: everyone except the one giving the assets. */
  const receiverCandidates = useMemo(() => {
    const needle = receiverSearch.trim().toLowerCase();
    return employees
      .filter((employee) => String(employee.id) !== String(source?.id ?? ''))
      .filter((employee) =>
        !needle
          ? true
          : [employee.name, employee.employeeNumber, employee.department, employee.role]
              .join(' ')
              .toLowerCase()
              .includes(needle),
      );
  }, [employees, receiverSearch, source]);

  const resetDraft = () => {
    setSource(null);
    setSourceAssets([]);
    setSelectedAssetIds([]);
    setReceiver(null);
    setReceiverSearch('');
    setReason(TRANSFER_REASONS[0]);
    setReasonOpen(false);
    setNotes('');
    setStep('list');
  };

  /**
   * Open an employee: load what is actually assigned to them right now. This is
   * the "View Assets" / "Transfer Assets" step — the admin sees exactly what
   * would move before anything is written.
   */
  const openEmployee = async (employee: TransferEmployee) => {
    setSource(employee);
    setReceiver(null);
    setNotes('');
    setReason(TRANSFER_REASONS[0]);
    setAssetsLoading(true);
    setStep('assets');
    try {
      const assets = await fetchEmployeeAssignedAssets(employee.id);
      setSourceAssets(assets);
      setSelectedAssetIds(assets.map((asset) => asset.id));
    } catch (err) {
      Alert.alert('Could not load assets', (err as Error).message || 'Please try again.');
      setSourceAssets([]);
      setSelectedAssetIds([]);
    } finally {
      setAssetsLoading(false);
    }
  };

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );
  };

  const confirmTransfer = async () => {
    if (!source || !receiver || selectedAssetIds.length === 0) return;
    setBusy(true);
    try {
      const actor = await getStoredUser();
      const result = await executeEmployeeTransfer({
        fromUserId: source.id,
        fromName: source.name,
        toUserId: receiver.id,
        toName: receiver.name,
        assetIds: selectedAssetIds,
        reason,
        notes,
        actorId: actor?.id ?? null,
        actorName: actor?.full_name ?? actor?.email ?? null,
      });

      Alert.alert(
        'Transfer Completed',
        `${result.assetCount} asset${result.assetCount > 1 ? 's' : ''} moved from ${source.name} to ${receiver.name}.\n\nReference: ${result.reference}\nReason: ${reason}`,
      );
      resetDraft();
      setTab('history');
      await load();
    } catch (err) {
      Alert.alert('Transfer Failed', (err as Error).message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const renderStatusChip = (employee: TransferEmployee) => {
    const meta = TRANSFER_STATUS_META[employee.status];
    return (
      <View style={[styles.statusChip, { backgroundColor: meta.tone.bg, borderColor: meta.tone.fg }]}>
        <Text style={[styles.statusChipText, { color: meta.tone.fg }]}>
          {meta.emoji} {meta.label}
        </Text>
      </View>
    );
  };

  const renderEmployeeCard = (employee: TransferEmployee) => (
    <View key={employee.id} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {employee.name
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part.charAt(0).toUpperCase())
              .join('')}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>
            {employee.name}
          </Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {employee.role}
            {employee.department ? ` • ${employee.department}` : ''}
          </Text>
          {employee.employeeNumber ? (
            <Text style={styles.cardMeta}>Employee No. {employee.employeeNumber}</Text>
          ) : null}
        </View>
        {renderStatusChip(employee)}
      </View>

      <View style={styles.countRow}>
        <MaterialCommunityIcons name="laptop" size={15} color={NAVY_MID} />
        <Text style={styles.countText}>
          {employee.assetCount} assigned asset{employee.assetCount === 1 ? '' : 's'}
        </Text>
        {employee.status === 'REASSIGNED' && employee.lastTransferTo ? (
          <Text style={styles.countNote} numberOfLines={1}>
            → {employee.lastTransferTo}
          </Text>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionGhost]}
          activeOpacity={0.85}
          onPress={() => openEmployee(employee)}
        >
          <MaterialCommunityIcons name="eye-outline" size={16} color={NAVY} />
          <Text style={styles.actionGhostText}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionGold, employee.assetCount === 0 && styles.actionDisabled]}
          activeOpacity={0.85}
          disabled={employee.assetCount === 0}
          onPress={() => openEmployee(employee)}
        >
          <MaterialCommunityIcons name="swap-horizontal" size={16} color={NAVY} />
          <Text style={styles.actionGoldText}>Transfer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ---------------------------------------------------------------- steps --
  const renderAssetStep = () => {
    if (!source) return null;
    const allSelected = sourceAssets.length > 0 && selectedAssetIds.length === sourceAssets.length;
    return (
      <>
        <View style={styles.stepHeader}>
          <Text style={styles.stepEyebrow}>EMPLOYEE TRANSFER</Text>
          <Text style={styles.stepTitle}>{source.name}</Text>
          <Text style={styles.stepSub}>
            {source.role}
            {source.department ? ` • ${source.department}` : ''}
          </Text>
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{sourceAssets.length}</Text>
            <Text style={styles.metricLabel}>ASSIGNED ASSETS</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{selectedAssetIds.length}</Text>
            <Text style={styles.metricLabel}>SELECTED</Text>
          </View>
        </View>

        <View style={styles.alertBox}>
          <MaterialCommunityIcons name="information-outline" size={16} color="#1D4ED8" />
          <Text style={styles.alertText}>
            {TRANSFER_STATUS_META[source.status].emoji} {TRANSFER_STATUS_META[source.status].label} —{' '}
            {TRANSFER_STATUS_META[source.status].detail}
          </Text>
        </View>

        {assetsLoading ? (
          <ActivityIndicator size="large" color={NAVY} style={{ marginTop: 24 }} />
        ) : sourceAssets.length === 0 ? (
          <View style={styles.emptyBox}>
            <MaterialCommunityIcons name="laptop-off" size={40} color="#94A3B8" />
            <Text style={styles.emptyTitle}>No assigned assets</Text>
            <Text style={styles.emptyText}>
              This employee currently holds no assets, so there is nothing to transfer.
            </Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.selectAllRow}
              activeOpacity={0.8}
              onPress={() =>
                setSelectedAssetIds(allSelected ? [] : sourceAssets.map((asset) => asset.id))
              }
            >
              <MaterialCommunityIcons
                name={allSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={20}
                color={NAVY}
              />
              <Text style={styles.selectAllText}>
                {allSelected ? 'Clear selection' : 'Select all assets'}
              </Text>
            </TouchableOpacity>

            {sourceAssets.map((asset) => {
              const checked = selectedAssetIds.includes(asset.id);
              return (
                <TouchableOpacity
                  key={asset.id}
                  style={[styles.assetRow, checked && styles.assetRowChecked]}
                  activeOpacity={0.85}
                  onPress={() => toggleAsset(asset.id)}
                >
                  <MaterialCommunityIcons
                    name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={20}
                    color={checked ? '#047857' : '#94A3B8'}
                  />
                  <View style={styles.assetInfo}>
                    <Text style={styles.assetName} numberOfLines={1}>
                      {asset.name}
                    </Text>
                    <Text style={styles.assetCode} numberOfLines={1}>
                      {asset.code}
                      {asset.category ? ` • ${asset.category}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.assetStatus} numberOfLines={1}>
                    {asset.status}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        <View style={styles.footerRow}>
          <TouchableOpacity
            style={[styles.footerButton, styles.footerGhost]}
            activeOpacity={0.85}
            onPress={resetDraft}
          >
            <Text style={styles.footerGhostText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.footerButton,
              styles.footerGold,
              (selectedAssetIds.length === 0 || assetsLoading) && styles.actionDisabled,
            ]}
            activeOpacity={0.85}
            disabled={selectedAssetIds.length === 0 || assetsLoading}
            onPress={() => setStep('receiver')}
          >
            <MaterialCommunityIcons name="swap-horizontal-bold" size={17} color={NAVY} />
            <Text style={styles.footerGoldText}>Transfer Assets</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const renderReceiverStep = () => {
    if (!source) return null;
    return (
      <>
        <View style={styles.stepHeader}>
          <Text style={styles.stepEyebrow}>TRANSFER ASSETS</Text>
          <Text style={styles.stepTitle}>Choose the receiving employee</Text>
        </View>

        <View style={styles.summaryBox}>
          <View style={styles.summaryColumn}>
            <Text style={styles.summaryLabel}>FROM</Text>
            <Text style={styles.summaryName}>{source.name}</Text>
            <Text style={styles.summaryMeta}>{source.department || '—'}</Text>
          </View>
          <View style={styles.summaryColumn}>
            <Text style={styles.summaryLabel}>ASSETS</Text>
            <Text style={styles.summaryName}>{selectedAssetIds.length}</Text>
            <Text style={styles.summaryMeta}>selected</Text>
          </View>
          <View style={styles.summaryColumn}>
            <Text style={styles.summaryLabel}>TO</Text>
            <Text style={styles.summaryName}>{receiver ? receiver.name : '—'}</Text>
            <Text style={styles.summaryMeta}>{receiver ? receiver.department || '—' : 'not chosen'}</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>TRANSFER TO</Text>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="account-search-outline" size={18} color={TEXT_MUTED} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search employee…"
            placeholderTextColor="#94A3B8"
            value={receiverSearch}
            onChangeText={setReceiverSearch}
          />
        </View>

        {receiverCandidates.slice(0, 30).map((employee) => {
          const active = String(receiver?.id) === String(employee.id);
          return (
            <TouchableOpacity
              key={employee.id}
              style={[styles.receiverRow, active && styles.receiverRowActive]}
              activeOpacity={0.85}
              onPress={() => setReceiver(employee)}
            >
              <MaterialCommunityIcons
                name={active ? 'radiobox-marked' : 'radiobox-blank'}
                size={20}
                color={active ? '#047857' : '#94A3B8'}
              />
              <View style={styles.assetInfo}>
                <Text style={styles.assetName} numberOfLines={1}>
                  {employee.name}
                </Text>
                <Text style={styles.assetCode} numberOfLines={1}>
                  {employee.role}
                  {employee.department ? ` • ${employee.department}` : ''}
                </Text>
              </View>
              <Text style={styles.assetStatus}>{employee.assetCount} asset(s)</Text>
            </TouchableOpacity>
          );
        })}

        <Text style={styles.fieldLabel}>REASON</Text>
        <TouchableOpacity
          style={styles.dropdown}
          activeOpacity={0.85}
          onPress={() => setReasonOpen((prev) => !prev)}
        >
          <Text style={styles.dropdownText}>{reason}</Text>
          <MaterialCommunityIcons name={reasonOpen ? 'chevron-up' : 'chevron-down'} size={20} color={TEXT_MUTED} />
        </TouchableOpacity>
        {reasonOpen ? (
          <View style={styles.dropdownList}>
            {TRANSFER_REASONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={styles.dropdownItem}
                activeOpacity={0.85}
                onPress={() => {
                  setReason(option);
                  setReasonOpen(false);
                }}
              >
                <Text
                  style={[styles.dropdownItemText, option === reason && styles.dropdownItemTextActive]}
                >
                  {option}
                </Text>
                {option === reason ? (
                  <MaterialCommunityIcons name="check" size={18} color="#047857" />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>NOTES (OPTIONAL)</Text>
        <TextInput
          style={styles.textArea}
          placeholder="e.g. Juan was relocated to SABM; Maria takes over the IT Staff position."
          placeholderTextColor="#94A3B8"
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.footerRow}>
          <TouchableOpacity
            style={[styles.footerButton, styles.footerGhost]}
            activeOpacity={0.85}
            onPress={() => setStep('assets')}
          >
            <Text style={styles.footerGhostText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerButton, styles.footerGold, !receiver && styles.actionDisabled]}
            activeOpacity={0.85}
            disabled={!receiver}
            onPress={() => setStep('confirm')}
          >
            <Text style={styles.footerGoldText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const renderConfirmStep = () => {
    if (!source || !receiver) return null;
    return (
      <>
        <View style={styles.stepHeader}>
          <Text style={styles.stepEyebrow}>CONFIRM ASSET TRANSFER</Text>
          <Text style={styles.stepTitle}>Please review before saving</Text>
        </View>

        <View style={styles.confirmCard}>
          <Text style={styles.summaryLabel}>FROM</Text>
          <Text style={styles.confirmName}>{source.name}</Text>
          <Text style={styles.summaryMeta}>
            {source.role}
            {source.department ? ` • ${source.department}` : ''}
          </Text>

          <MaterialCommunityIcons name="arrow-down" size={26} color={GOLD} style={styles.confirmArrow} />

          <Text style={styles.summaryLabel}>TO</Text>
          <Text style={styles.confirmName}>{receiver.name}</Text>
          <Text style={styles.summaryMeta}>
            {receiver.role}
            {receiver.department ? ` • ${receiver.department}` : ''}
          </Text>

          <View style={styles.confirmDivider} />

          <Text style={styles.confirmCount}>
            {selectedAssetIds.length} ASSET{selectedAssetIds.length > 1 ? 'S' : ''} WILL BE TRANSFERRED
          </Text>
          <Text style={styles.confirmReason}>Reason: {reason}</Text>
          {notes ? <Text style={styles.confirmReason}>Notes: {notes}</Text> : null}
        </View>

        <View style={styles.warningBox}>
          <MaterialCommunityIcons name="alert-outline" size={18} color="#B45309" />
          <Text style={styles.warningText}>
            The selected employee will become responsible for these assets. Asset codes, QR
            stickers, acquisition details and every repair / maintenance / replacement record stay
            exactly as they are — only the accountable employee changes.
          </Text>
        </View>

        <View style={styles.footerRow}>
          <TouchableOpacity
            style={[styles.footerButton, styles.footerGhost]}
            activeOpacity={0.85}
            disabled={busy}
            onPress={() => setStep('receiver')}
          >
            <Text style={styles.footerGhostText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerButton, styles.footerGold, busy && styles.actionDisabled]}
            activeOpacity={0.85}
            disabled={busy}
            onPress={confirmTransfer}
          >
            {busy ? (
              <ActivityIndicator size="small" color={NAVY} />
            ) : (
              <MaterialCommunityIcons name="check-decagram" size={17} color={NAVY} />
            )}
            <Text style={styles.footerGoldText}>{busy ? 'Transferring…' : 'Confirm Transfer'}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const renderHistory = () => {
    if (history.length === 0) {
      return (
        <View style={styles.emptyBox}>
          <MaterialCommunityIcons name="history" size={40} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No transfers yet</Text>
          <Text style={styles.emptyText}>
            Completed employee relocations appear here with their assets and reason.
          </Text>
        </View>
      );
    }
    return history.map((record) => (
      <View key={record.id} style={styles.card}>
        <View style={styles.historyHeader}>
          <MaterialCommunityIcons name="swap-horizontal" size={18} color={NAVY} />
          <Text style={styles.historyRef}>{record.reference}</Text>
          <View style={styles.historyStatus}>
            <Text style={styles.historyStatusText}>{record.status}</Text>
          </View>
        </View>
        <Text style={styles.historyFlow} numberOfLines={1}>
          {record.fromName} → {record.toName}
        </Text>
        <Text style={styles.historyMeta}>
          {record.assetCount} asset{record.assetCount === 1 ? '' : 's'} • {record.reason} •{' '}
          {formatStoredDate(record.createdAt)}
        </Text>
        <Text style={styles.historyMeta} numberOfLines={1}>
          Transferred by: {record.transferredBy}
        </Text>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionGhost, styles.historyButton]}
          activeOpacity={0.85}
          onPress={() => setDetailRecord(record)}
        >
          <MaterialCommunityIcons name="file-document-outline" size={16} color={NAVY} />
          <Text style={styles.actionGhostText}>View Details</Text>
        </TouchableOpacity>
      </View>
    ));
  };

  // ------------------------------------------------------------------ view --
  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.8}
          onPress={() => {
            if (step !== 'list') resetDraft();
            else router.back();
          }}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transfer</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.screenBody}
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
            <Text style={styles.emptyTitle}>Couldn&apos;t load transfers</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              activeOpacity={0.8}
              onPress={async () => {
                setLoading(true);
                await load();
              }}
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : step === 'assets' ? (
          renderAssetStep()
        ) : step === 'receiver' ? (
          renderReceiverStep()
        ) : step === 'confirm' ? (
          renderConfirmStep()
        ) : (
          <>
            <View style={styles.tabRow}>
              {(
                [
                  { key: 'employees', label: 'Employees', icon: 'account-group-outline' },
                  { key: 'history', label: 'Transfer History', icon: 'history' },
                ] as const
              ).map((option) => {
                const active = tab === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.tabChip, active && styles.tabChipActive]}
                    activeOpacity={0.85}
                    onPress={() => setTab(option.key)}
                  >
                    <MaterialCommunityIcons
                      name={option.icon as any}
                      size={15}
                      color={active ? NAVY : TEXT_MUTED}
                    />
                    <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {tab === 'employees' ? (
              <>
                <View style={styles.searchWrap}>
                  <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search employee, number or department…"
                    placeholderTextColor="#94A3B8"
                    value={search}
                    onChangeText={setSearch}
                  />
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {departments.map((name) => {
                    const active = departmentFilter === name;
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[styles.filterChip, active && styles.filterChipActive]}
                        activeOpacity={0.85}
                        onPress={() => setDepartmentFilter(name)}
                      >
                        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={styles.countLine}>
                  {visibleEmployees.length} employee{visibleEmployees.length === 1 ? '' : 's'} •{' '}
                  {employees.reduce((total, employee) => total + employee.assetCount, 0)} assigned
                  assets
                </Text>

                {visibleEmployees.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <MaterialCommunityIcons name="account-off-outline" size={40} color="#94A3B8" />
                    <Text style={styles.emptyTitle}>No employee found</Text>
                    <Text style={styles.emptyText}>Try another name or department.</Text>
                  </View>
                ) : (
                  visibleEmployees.map(renderEmployeeCard)
                )}
              </>
            ) : (
              renderHistory()
            )}
          </>
        )}
      </ScrollView>

      {/* History detail sheet */}
      {detailRecord ? (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transfer {detailRecord.reference}</Text>
              <TouchableOpacity onPress={() => setDetailRecord(null)} activeOpacity={0.7}>
                <MaterialCommunityIcons name="close" size={24} color={NAVY} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {[
                ['Previous Employee', detailRecord.fromName],
                ['New Employee', detailRecord.toName],
                ['Reason', detailRecord.reason],
                ['Assets', String(detailRecord.assetCount)],
                ['Date', formatStoredDate(detailRecord.createdAt)],
                ['Transferred By', detailRecord.transferredBy],
                ['Status', detailRecord.status],
              ].map(([label, value]) => (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </View>
              ))}
              {detailRecord.notes ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Notes</Text>
                  <Text style={styles.detailValue}>{detailRecord.notes}</Text>
                </View>
              ) : null}
              <Text style={styles.detailSectionTitle}>ASSETS</Text>
              {detailRecord.assetIds.length === 0 ? (
                <Text style={styles.emptyText}>No assets linked to this transfer.</Text>
              ) : (
                detailRecord.assetIds.map((assetId) => (
                  <View key={assetId} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Asset ID</Text>
                    <Text style={styles.detailValue}>#{assetId}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalClose}
              activeOpacity={0.85}
              onPress={() => setDetailRecord(null)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },
  screenBody: { flex: 1, backgroundColor: '#F4F7FB' },
  header: {
    backgroundColor: NAVY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: headerTopPadding,
    paddingBottom: 16,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', flex: 1, textAlign: 'center' },
  headerSpacer: { width: 42 },
  content: { padding: 16, paddingBottom: 48, flexGrow: 1 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },

  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tabChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
  },
  tabChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  tabChipText: { color: TEXT_MUTED, fontSize: 13, fontWeight: '700' },
  tabChipTextActive: { color: NAVY },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1E293B' },
  filterRow: { paddingVertical: 6, gap: 8, paddingRight: 12 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: NAVY_MID, borderColor: NAVY_MID },
  filterChipText: { color: '#334155', fontSize: 12.5, fontWeight: '600' },
  filterChipTextActive: { color: '#FFFFFF' },
  countLine: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: `${NAVY_MID}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: NAVY, fontSize: 15, fontWeight: '800' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  cardSub: { fontSize: 12.5, color: TEXT_MUTED, marginTop: 1 },
  cardMeta: { fontSize: 11.5, color: '#94A3B8', marginTop: 1 },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 132,
  },
  statusChipText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  countText: { fontSize: 12.5, fontWeight: '700', color: NAVY_MID },
  countNote: { flex: 1, fontSize: 11.5, color: '#94A3B8', textAlign: 'right' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 12,
  },
  actionGhost: { backgroundColor: '#F4F7FB', borderWidth: 1, borderColor: BORDER },
  actionGhostText: { color: NAVY, fontSize: 13, fontWeight: '800' },
  actionGold: { backgroundColor: GOLD },
  actionGoldText: { color: NAVY, fontSize: 13, fontWeight: '800' },
  actionDisabled: { opacity: 0.45 },

  stepHeader: { marginBottom: 14 },
  stepEyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1, color: GOLD },
  stepTitle: { fontSize: 19, fontWeight: '800', color: NAVY, marginTop: 4 },
  stepSub: { fontSize: 13, color: TEXT_MUTED, marginTop: 2 },
  metricRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  metricBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    paddingVertical: 12,
    alignItems: 'center',
  },
  metricValue: { fontSize: 20, fontWeight: '800', color: NAVY },
  metricLabel: { fontSize: 9.5, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginTop: 2 },
  alertBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  alertText: { flex: 1, fontSize: 12, color: '#1D4ED8', fontWeight: '600', lineHeight: 17 },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  selectAllText: { fontSize: 13, fontWeight: '700', color: NAVY },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 12,
    marginBottom: 8,
  },
  assetRowChecked: { borderColor: '#A7F3D0', backgroundColor: '#F6FEFB' },
  assetInfo: { flex: 1 },
  assetName: { fontSize: 13.5, fontWeight: '700', color: '#1E293B' },
  assetCode: { fontSize: 11.5, color: TEXT_MUTED, marginTop: 1 },
  assetStatus: { fontSize: 10.5, fontWeight: '700', color: '#94A3B8', maxWidth: 78, textAlign: 'right' },

  footerRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  footerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 14,
  },
  footerGhost: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER },
  footerGhostText: { color: TEXT_MUTED, fontSize: 14, fontWeight: '800' },
  footerGold: { backgroundColor: GOLD, flex: 1.4 },
  footerGoldText: { color: NAVY, fontSize: 14, fontWeight: '800' },

  summaryBox: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  summaryColumn: { flex: 1 },
  summaryLabel: { fontSize: 9.5, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.6 },
  summaryName: { fontSize: 13.5, fontWeight: '800', color: NAVY, marginTop: 3 },
  summaryMeta: { fontSize: 11.5, color: TEXT_MUTED, marginTop: 1 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 7,
  },
  receiverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 12,
    marginBottom: 8,
  },
  receiverRowActive: { borderColor: '#A7F3D0', backgroundColor: '#F6FEFB' },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    height: 50,
  },
  dropdownText: { fontSize: 14, color: '#1E293B', fontWeight: '600' },
  dropdownList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 8,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemText: { fontSize: 14, color: '#334155', fontWeight: '600' },
  dropdownItemTextActive: { color: '#047857', fontWeight: '800' },
  textArea: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingTop: 12,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 96,
  },

  confirmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 18,
    marginBottom: 14,
  },
  confirmName: { fontSize: 16, fontWeight: '800', color: NAVY, marginTop: 3 },
  confirmArrow: { alignSelf: 'center', marginVertical: 10 },
  confirmDivider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 14 },
  confirmCount: { fontSize: 14, fontWeight: '800', color: NAVY, letterSpacing: 0.4 },
  confirmReason: { fontSize: 12.5, color: TEXT_MUTED, marginTop: 6 },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 14,
    padding: 12,
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600', lineHeight: 17 },

  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  historyRef: { flex: 1, fontSize: 14, fontWeight: '800', color: NAVY },
  historyStatus: {
    backgroundColor: '#ECFDF5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  historyStatusText: { fontSize: 10, fontWeight: '800', color: '#047857' },
  historyFlow: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  historyMeta: { fontSize: 11.5, color: TEXT_MUTED, marginTop: 3 },
  historyButton: { marginTop: 12 },

  emptyBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155' },
  emptyText: {
    fontSize: 12.5,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: NAVY,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: NAVY, flex: 1 },
  detailRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  detailLabel: { fontSize: 10.5, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.4 },
  detailValue: { fontSize: 13.5, fontWeight: '600', color: '#1E293B', marginTop: 2 },
  detailSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 4,
  },
  modalClose: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalCloseText: { color: NAVY, fontSize: 14, fontWeight: '800' },
});
