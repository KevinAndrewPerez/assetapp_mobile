import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { fetchRequestDetail, RequestDetail } from '../lib/userService';
import { STORAGE_BUCKET, supabase } from '../lib/supabase';
import { stripNetworkIdentifiers } from '../lib/auditService';
import { formatStoredTimestamp } from '../lib/time';
import { requestTypeMeta, REQUEST_TYPE_OUTCOME } from '@/lib/lifecycle';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import {
  attachDisposalDocument,
  fetchDisposalDocuments,
  formatDocumentSize,
  pickDisposalDocument,
  removeDisposalDocument,
  type DisposalDocument,
} from '@/lib/disposalDocumentService';
import {
  DISPOSAL_FORM_METHODS,
  StaleDisposalFormError,
  fetchDisposalForm,
  recordedDisposalCount,
  saveDisposalForm,
  type DisposalFormRecord,
  type DisposalFormValues,
} from '@/lib/disposalForm';
import { isOfficeRole } from '@/lib/access';
import NotificationBell from '@/components/notification-bell';
import { headerTopPadding } from '@/lib/theme';
import { friendlyErrorMessage } from '@/lib/errorMessage';

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const todayIsoDay = (): string => isoDay(new Date());

/** `yyyy-mm-dd` → local Date at midnight, for the date picker. */
const parseIsoDay = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const statusColors: Record<string, { bg: string; text: string }> = {
  Pending: { bg: '#FEF6E4', text: '#92400E' },
  Approved: { bg: '#ECFDF5', text: '#047857' },
  Received: { bg: '#ECFDF5', text: '#047857' },
  Completed: { bg: '#ECFDF5', text: '#047857' },
  Rejected: { bg: '#FEF2F2', text: '#B91C1C' },
  Cancelled: { bg: '#F1F5F9', text: '#334155' },
  'In Progress': { bg: '#EFF6FF', text: '#1D4ED8' },
};

export default function RequestDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [openingAttachment, setOpeningAttachment] = useState(false);
  const [isOffice, setIsOffice] = useState(false);
  const [actor, setActor] = useState<{ id: string | number | null; label: string }>({ id: null, label: 'Admin' });
  const [documents, setDocuments] = useState<DisposalDocument[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  // The official NU Lipa disposal form: the shared `disposal_forms` row the web
  // prepares, prints, files and finalizes. The phone shows its stage and may
  // save the shared fields; nothing here prints, finalizes or changes a
  // lifecycle status.
  const [form, setForm] = useState<DisposalFormRecord | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);
  // The shared audit trail for this request — the office's decisions and the
  // form/document work, as the web records them.
  const [history, setHistory] = useState<
    { id: string; actionType: string; summary: string; actor: string; createdAt: string }[]
  >([]);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<DisposalFormValues>({
    officeDepartment: '',
    expectedDisposalDate: '',
    methodKey: '',
    remarks: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setLoadError('');
        const data = await fetchRequestDetail(String(id ?? ''));
        setDetail(data);
        if (!data) setLoadError('This request could not be found.');
      } catch (err) {
        console.error('Failed to load request detail:', err);
        setDetail(null);
        setLoadError(
          friendlyErrorMessage(err, 'This request could not be loaded. Please try again.'),
        );
      } finally {
        setLoading(false);
      }
    };
    if (id) load();
  }, [id]);

  // The request's audit trail. Read-only, newest first, and never a reason to
  // fail the screen: a history that cannot be read simply does not render.
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('audit_logs')
          .select(
            'id, action_type, action_description, notes, created_at, users:user_id(employee_numbers(Full_Name), email)',
          )
          .eq('request_id', id as any)
          .order('created_at', { ascending: false })
          .limit(8);
        if (error) {
          setHistory([]);
          return;
        }
        setHistory(
          (data ?? []).map((row: any) => {
            const user = Array.isArray(row?.users) ? row.users[0] : row?.users;
            const employee = Array.isArray(user?.employee_numbers)
              ? user.employee_numbers[0]
              : user?.employee_numbers;
            const notes = stripNetworkIdentifiers(String(row?.notes ?? ''));
            return {
              id: String(row?.id ?? ''),
              actionType: String(row?.action_type ?? 'UPDATE'),
              summary: stripNetworkIdentifiers(String(row?.action_description ?? '')) || notes,
              actor: String(employee?.Full_Name ?? user?.email ?? ''),
              createdAt: String(row?.created_at ?? ''),
            };
          }),
        );
      } catch (error) {
        console.warn('Request history could not be read:', error);
        setHistory([]);
      }
    })();
  }, [id]);

  // Who is looking, for the office-only document actions.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('user');
        const user = raw ? JSON.parse(raw) : null;
        const role = String(user?.role ?? '');
        // Web parity: office authority is the Administrator role (lib/access.ts).
        setIsOffice(isOfficeRole(role));
        setActor({ id: user?.id ?? null, label: String(user?.full_name ?? user?.email ?? 'Administrator') });
      } catch {
        setIsOffice(false);
      }
    })();
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!id) return;
    try {
      setDocuments(await fetchDisposalDocuments(String(id)));
      setDocumentsError(null);
    } catch (error) {
      console.error('Failed to load disposal documents:', error);
      setDocumentsError('The supporting documents could not be loaded.');
    }
  }, [id]);

  const isDisposal = String(detail?.requestType ?? '').toLowerCase() === 'disposal';

  const loadDisposalForm = useCallback(async () => {
    if (!id) return;
    setFormLoading(true);
    try {
      const [loaded, records] = await Promise.all([
        fetchDisposalForm(String(id)),
        recordedDisposalCount(String(id)),
      ]);
      setForm(loaded);
      setRecordedCount(records);
      setFormDraft({
        officeDepartment: loaded?.officeDepartment ?? '',
        expectedDisposalDate: loaded?.expectedDisposalDate ?? '',
        methodKey: loaded?.methodKey ?? '',
        remarks: loaded?.remarks ?? '',
      });
      setFormError(null);
    } catch (error) {
      console.error('Failed to load the official disposal form:', error);
      setFormError('The official disposal form could not be loaded. Pull to refresh or reopen the request.');
    } finally {
      setFormLoading(false);
    }
  }, [id]);

  // Documents and the form's stage are refreshed whenever the screen comes back
  // into focus — the office may have moved the form on the website in between,
  // and the phone must not show a stale stage.
  useFocusEffect(
    useCallback(() => {
      if (!isDisposal) return;
      void loadDisposalForm();
      if (isOffice) void loadDocuments();
    }, [isDisposal, isOffice, loadDocuments, loadDisposalForm]),
  );

  /** Saving is only offered to the office while the form may still change. */
  const canEditForm = Boolean(
    form &&
      form.canEdit &&
      isOffice &&
      detail?.status === 'Approved' &&
      !savingForm,
  );

  const formDirty = Boolean(
    form &&
      form.canEdit &&
      (formDraft.officeDepartment.trim() !== form.officeDepartment.trim() ||
        formDraft.expectedDisposalDate !== form.expectedDisposalDate ||
        formDraft.methodKey !== form.methodKey ||
        formDraft.remarks.trim() !== form.remarks.trim()),
  );

  const handleSaveDisposalForm = async () => {
    if (!form || savingForm) return;
    setSavingForm(true);
    try {
      const saved = await saveDisposalForm({
        requestId: String(id),
        actorId: actor.id,
        values: formDraft,
        expectedUpdatedAt: form.updatedAt,
      });
      setForm(saved);
      setFormDraft({
        officeDepartment: saved.officeDepartment,
        expectedDisposalDate: saved.expectedDisposalDate,
        methodKey: saved.methodKey,
        remarks: saved.remarks,
      });
      Alert.alert(
        'Official form saved',
        'The shared disposal form was updated. The web application shows these values when the form is refreshed.\n\nNo asset was disposed by saving: preparing, printing, filing the signed copy and finalizing stay in the web application.',
      );
    } catch (error) {
      if (error instanceof StaleDisposalFormError) {
        Alert.alert('Someone else saved first', error.message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Reload', onPress: () => void loadDisposalForm() },
        ]);
      } else {
        console.error('Save official disposal form failed:', error);
        Alert.alert(
          'Could not save',
          friendlyErrorMessage(error, 'The official disposal form was not saved. Please try again.'),
        );
      }
    } finally {
      setSavingForm(false);
    }
  };

  const handleAttachDocument = async () => {
    if (attaching) return;
    try {
      const media = await pickDisposalDocument();
      if (!media) return;

      setAttaching(true);
      const result = await attachDisposalDocument({ requestId: String(id), actor, media });
      Alert.alert(result.ok ? 'Document attached' : 'Could not attach', result.message);
      if (result.ok) await loadDocuments();
    } catch (error) {
      console.error('Attach disposal document failed:', error);
      Alert.alert(
        'Attach failed',
        friendlyErrorMessage(error, 'The document could not be attached. Please try again.'),
      );
    } finally {
      setAttaching(false);
    }
  };

  const handleRemoveDocument = (document: DisposalDocument) => {
    const label = document.title || document.fileName || 'this document';
    Alert.alert('Remove document', `Remove “${label}” from this disposal request?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const result = await removeDisposalDocument(document.id, actor);
            Alert.alert(result.ok ? 'Document removed' : 'Not allowed', result.message);
            if (result.ok) await loadDocuments();
          } catch (error) {
            console.error('Remove disposal document failed:', error);
            Alert.alert('Error', 'The document could not be removed.');
          }
        },
      },
    ]);
  };

  /**
   * Open the photo submitted with the request. A short-lived signed URL is
   * asked for first (the bucket is shared and may hold private attachments);
   * the stored public URL is only a fallback for older rows. The file is never
   * re-uploaded here, so reopening the screen cannot duplicate it.
   */
  const openAttachment = async () => {
    if (!detail) return;
    setOpeningAttachment(true);
    try {
      let url = String(detail.attachedFileUrl ?? '').trim();
      const objectKey = String(detail.attachedFilePath ?? '').trim().replace(/^\/+/, '');

      if (objectKey) {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(objectKey, 300);
        if (!error && data?.signedUrl) url = data.signedUrl;
      }

      if (!url) throw new Error('This attachment has no readable file reference.');
      const supported = await Linking.canOpenURL(url).catch(() => false);
      if (!supported) throw new Error('This device cannot open this file type.');
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert(
        'Could not open attachment',
        friendlyErrorMessage(err, 'The attached file is unavailable right now. Please try again.'),
      );
    } finally {
      setOpeningAttachment(false);
    }
  };

  const openDocument = async (document: DisposalDocument) => {
    let url = resolveMediaUrl(document.filePath, 'disposal_documents');
    const objectKey = String(document.filePath ?? '').trim().replace(/^\/+/, '');

    // Prefer a five-minute signed URL over a permanent public one. The stored
    // path is the object key inside the shared `assets` bucket.
    if (objectKey) {
      try {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(objectKey, 300);
        if (!error && data?.signedUrl) url = data.signedUrl;
      } catch {
        // Fall back to the public URL below.
      }
    }

    if (!url) {
      Alert.alert('Unavailable', 'This document has no readable file reference.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Unavailable', 'This device could not open the stored document.');
    }
  };

  // Database timestamps are naive UTC (see lib/time.ts).
  const formatDate = (raw?: string) => (raw ? formatStoredTimestamp(raw, { day: 'numeric' }) : 'N/A');

  const type = requestTypeMeta(detail?.requestType);
  const status = detail ? statusColors[detail.status] ?? statusColors.Pending : statusColors.Pending;
  const currentStep = !detail ? 0 : detail.status === 'Pending' ? 1 : 2;

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request Details</Text>
        <NotificationBell />
      </View>

      {/* Body keeps only the side/bottom insets — the navy header already clears
          the status bar, so its top inset showed up as a light dead strip. */}
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1E3A5F" />
          </View>
        ) : !detail ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="alert-circle-outline" size={56} color="#CBD5E1" />
            <Text style={styles.emptyText}>{loadError || 'Request not found.'}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Hero: type, status, reference */}
            <View style={[styles.heroCard, { borderTopColor: type.tone.fg }]}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroTypeWrap}>
                  <View style={[styles.typeIcon, { backgroundColor: type.tone.bg }]}>
                    <MaterialCommunityIcons name={type.icon as any} size={20} color={type.tone.fg} />
                  </View>
                  <View style={styles.heroTypeText}>
                    <Text style={styles.heroTypeLabel}>{type.label} Request</Text>
                    <Text style={styles.heroRef}>REQ-{detail.id}</Text>
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: status.text }]}>{detail.status}</Text>
                </View>
              </View>

              <View style={styles.qrWrap}>
                <View style={styles.qrBox}>
                  <QRCode value={detail.requestId} size={92} backgroundColor="white" />
                </View>
                <Text style={styles.qrLabel}>{detail.requestId}</Text>
                <Text style={styles.qrHint}>Show this code to the Asset Management Office</Text>
              </View>
            </View>

            {/* Where it is in the process */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Progress</Text>

              <ProgressStep
                title="Submitted"
                caption={formatDate(detail.dateSubmitted)}
                state="done"
              />
              <ProgressStep
                title="Under review"
                caption={
                  detail.status === 'Pending'
                    ? 'Waiting for the Asset Management Office'
                    : 'Reviewed by the Asset Management Office'
                }
                state={currentStep === 1 ? 'current' : 'done'}
              />
              <ProgressStep
                title={detail.status === 'Rejected' ? 'Rejected' : 'Decision'}
                caption={
                  detail.status === 'Pending'
                    ? 'No decision yet'
                    : detail.status === 'Rejected'
                      ? 'This request was rejected — check the reason below'
                      : REQUEST_TYPE_OUTCOME[detail.requestType] ?? 'Approved by the Asset Management Office'
                }
                state={detail.status === 'Pending' ? 'todo' : detail.status === 'Rejected' ? 'rejected' : 'done'}
                last
              />
            </View>

            {/* Approval history: the same audit rows the web's activity log shows. */}
            {history.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Approval History</Text>
                {history.map((entry) => (
                  <View key={entry.id} style={styles.historyRow}>
                    <View style={styles.historyDot} />
                    <View style={styles.historyTextWrap}>
                      <Text style={styles.historyTitle} numberOfLines={2}>
                        {entry.summary || entry.actionType}
                      </Text>
                      <Text style={styles.historyMeta} numberOfLines={1}>
                        {formatStoredTimestamp(entry.createdAt)}
                        {entry.actor ? ` · ${entry.actor}` : ''} · {entry.actionType}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Linked assets (bulk request) */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>
                Linked Assets ({detail.linkedAssets.length})
              </Text>
              {detail.linkedAssets.length === 0 ? (
                <Text style={styles.emptyAssetsText}>No asset is linked to this request.</Text>
              ) : (
                detail.linkedAssets.map((asset, idx) => (
                  <View key={`${asset.id}-${idx}`} style={styles.assetRow}>
                    {asset.imageUrl ? (
                      <Image source={{ uri: asset.imageUrl }} style={styles.assetThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.assetThumb, styles.assetThumbPlaceholder]}>
                        <MaterialCommunityIcons name="cube-outline" size={24} color="#94A3B8" />
                      </View>
                    )}
                    <View style={styles.assetTextWrap}>
                      <Text style={styles.assetName} numberOfLines={1}>
                        {asset.name}
                      </Text>
                      {asset.code ? <Text style={styles.assetCode}>{asset.code}</Text> : null}
                      {asset.lifecycleStatus ? (
                        <Text style={styles.assetLifecycle}>Current status: {asset.lifecycleStatus}</Text>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Request information */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Request Information</Text>

              <InfoRow label="Request ID" value={detail.requestId} />
              <InfoRow label="Request Type" value={`${type.label} Request`} />
              <InfoRow label="Submitted By" value={detail.submittedBy} />
              <InfoRow label="Department" value={detail.department || 'N/A'} />
              <InfoRow label="Date Submitted" value={formatDate(detail.dateSubmitted)} />
              {detail.assignTo ? (
                <InfoRow label="Transfer To" value={detail.assignTo} icon="account-arrow-right-outline" />
              ) : null}
              {detail.attachedFileName ? (
                <TouchableOpacity
                  style={styles.attachmentButton}
                  activeOpacity={0.85}
                  disabled={openingAttachment}
                  onPress={() => void openAttachment()}
                  accessibilityRole="button"
                  accessibilityLabel={`Open attached file ${detail.attachedFileName}`}
                >
                  <MaterialCommunityIcons name="paperclip" size={18} color="#1E3A5F" />
                  <View style={styles.attachmentTextWrap}>
                    <Text style={styles.attachmentLabel}>Attached File</Text>
                    <Text style={styles.attachmentName} numberOfLines={1}>
                      {detail.attachedFileName}
                    </Text>
                  </View>
                  {openingAttachment ? (
                    <ActivityIndicator size="small" color="#1E3A5F" />
                  ) : (
                    <MaterialCommunityIcons name="open-in-new" size={18} color="#1E3A5F" />
                  )}
                </TouchableOpacity>
              ) : null}

              <View style={styles.reasonBlock}>
                <Text style={styles.reasonLabel}>Reason / Note</Text>
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText}>{detail.reason || 'No reason provided.'}</Text>
                </View>
              </View>

              {/* The office's rejection reason lives in requests.admin_remarks —
                  the same column the web shows. */}
              {detail.status === 'Rejected' && detail.adminRemarks ? (
                <View style={styles.reasonBlock}>
                  <Text style={styles.reasonLabel}>Reason for rejection</Text>
                  <View style={[styles.reasonBox, styles.rejectionBox]}>
                    <Text style={styles.reasonText}>{detail.adminRemarks}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* The official NU Lipa disposal form. Approval authorizes its
                preparation; the web application prepares, prints, files the
                signed copy and finalizes. The phone shows the stage and saves
                the shared fields — it never prints, finalizes or disposes. */}
            {isDisposal ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Official Disposal Form</Text>

                {detail.status !== 'Approved' ? (
                  <Text style={styles.docsHint}>
                    {detail.status === 'Rejected'
                      ? 'This disposal request was rejected, so no official form is prepared.'
                      : 'Approving this request authorizes the Asset Management Office to prepare the official NU Lipa disposal form. Until then, no form exists and the asset keeps its current status.'}
                  </Text>
                ) : formLoading ? (
                  <View style={styles.infoLoadingRow}>
                    <ActivityIndicator size="small" color="#1E3A5F" />
                    <Text style={styles.docsHint}>Loading the official form…</Text>
                  </View>
                ) : formError ? (
                  <>
                    <Text style={styles.docsError}>{formError}</Text>
                    <TouchableOpacity
                      style={styles.attachButton}
                      activeOpacity={0.85}
                      onPress={() => void loadDisposalForm()}
                    >
                      <MaterialCommunityIcons name="refresh" size={17} color="#1E3A5F" />
                      <Text style={styles.attachButtonText}>Try again</Text>
                    </TouchableOpacity>
                  </>
                ) : !form ? (
                  <Text style={styles.docsHint}>
                    The official form has not been generated for this request yet. The Asset Management Office
                    prepares it on the Disposal page of the web application; it appears here as soon as it exists.
                    The asset is not disposed of in the meantime.
                  </Text>
                ) : (
                  <>
                    <View style={styles.formStageRow}>
                      <View style={[styles.formStagePill, form.isFinalized && styles.formStagePillDone]}>
                        <Text style={[styles.formStageText, form.isFinalized && styles.formStageTextDone]}>
                          {form.stageLabel}
                        </Text>
                      </View>
                      {/* Only a finalized disposal means "disposed"; legacy open
                          records from the old direct-disposal path must not
                          read as if the asset were already gone. */}
                      {form.isFinalized && recordedCount > 0 ? (
                        <Text style={styles.formRecorded}>
                          {recordedCount} asset record{recordedCount === 1 ? '' : 's'} disposed
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.docsHint}>{form.stageHint}</Text>

                    {form.isFinalized ? (
                      <>
                        <InfoRow
                          label="Disposal finalized"
                          value={form.finalizedAt ? formatStoredTimestamp(form.finalizedAt) : 'Yes'}
                        />
                        <InfoRow
                          label="Date disposed"
                          value={form.actualDisposalDate ? formatDate(form.actualDisposalDate) : 'N/A'}
                        />
                        <InfoRow label="Approved reason" value={form.approvedReason || 'N/A'} />
                        <InfoRow label="Method of disposal" value={form.methodText || 'N/A'} />
                        <InfoRow label="Remarks" value={form.remarks || 'N/A'} />
                        <Text style={styles.docsHint}>
                          The assets are marked Disposed. The form and its signed copy are part of the record now
                          and can no longer be changed.
                        </Text>
                      </>
                    ) : (
                      <>
                        <InfoRow label="Approved reason" value={form.approvedReason || 'N/A'} />
                        <InfoRow
                          label="Prepared"
                          value={form.preparedAt ? formatStoredTimestamp(form.preparedAt) : 'N/A'}
                        />
                        {form.printedAt ? (
                          <InfoRow
                            label="Printed"
                            value={`${formatStoredTimestamp(form.printedAt)} · ${form.printCount} print${
                              form.printCount === 1 ? '' : 's'
                            }`}
                          />
                        ) : null}
                        {form.signedReceivedAt ? (
                          <InfoRow
                            label="Signed copy received"
                            value={formatStoredTimestamp(form.signedReceivedAt)}
                          />
                        ) : null}

                        {canEditForm ? (
                          <>
                            <Text style={styles.fieldLabel}>Office / Department</Text>
                            <TextInput
                              style={styles.infoInput}
                              value={formDraft.officeDepartment}
                              onChangeText={(text) =>
                                setFormDraft((current) => ({ ...current, officeDepartment: text }))
                              }
                              placeholder="The office the asset is disposed from"
                              placeholderTextColor="#94A3B8"
                              maxLength={150}
                            />

                            <Text style={styles.fieldLabel}>Expected date of disposal</Text>
                            <TouchableOpacity
                              style={styles.dateField}
                              activeOpacity={0.85}
                              onPress={() => setDatePickerOpen(true)}
                              accessibilityRole="button"
                              accessibilityLabel="Choose the expected date of disposal"
                            >
                              <MaterialCommunityIcons name="calendar-blank-outline" size={17} color="#64748B" />
                              <Text style={styles.dateFieldText}>
                                {formDraft.expectedDisposalDate
                                  ? formatDate(formDraft.expectedDisposalDate)
                                  : 'Choose a date'}
                              </Text>
                              <MaterialCommunityIcons name="chevron-down" size={18} color="#94A3B8" />
                            </TouchableOpacity>

                            <Text style={styles.fieldLabel}>Method of disposal</Text>
                            <View style={styles.optionWrap}>
                              {DISPOSAL_FORM_METHODS.map((method) => {
                                const active = formDraft.methodKey === method.key;
                                return (
                                  <TouchableOpacity
                                    key={method.key}
                                    style={[styles.optionChip, active && styles.optionChipActive]}
                                    onPress={() =>
                                      setFormDraft((current) => ({ ...current, methodKey: method.key }))
                                    }
                                    activeOpacity={0.8}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                  >
                                    <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
                                      {method.code} — {method.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            <Text style={styles.fieldLabel}>Remarks</Text>
                            <TextInput
                              style={[styles.infoInput, styles.infoInputTall]}
                              value={formDraft.remarks}
                              onChangeText={(text) => setFormDraft((current) => ({ ...current, remarks: text }))}
                              placeholder="Anything the office should note on the preparation record"
                              placeholderTextColor="#94A3B8"
                              multiline
                              maxLength={2000}
                              textAlignVertical="top"
                            />

                            <TouchableOpacity
                              style={[styles.saveInfoButton, !formDirty && styles.saveInfoButtonDisabled]}
                              disabled={!formDirty}
                              activeOpacity={0.85}
                              onPress={() => void handleSaveDisposalForm()}
                            >
                              {savingForm ? (
                                <ActivityIndicator size="small" color="#1E3A5F" />
                              ) : (
                                <>
                                  <MaterialCommunityIcons
                                    name="content-save-outline"
                                    size={17}
                                    color="#1E3A5F"
                                  />
                                  <Text style={styles.saveInfoText}>
                                    {formDirty ? 'Save form details' : 'No changes to save'}
                                  </Text>
                                </>
                              )}
                            </TouchableOpacity>

                            <Text style={styles.docsHint}>
                              Saving updates the shared form the web application reads. It does not mark the form
                              ready, print it, or dispose of anything: the web validates and prints the official
                              copy, then finalizes after the signed copy is filed. Sold-item details (amount, OR
                              no., gate pass) are completed on the web.
                            </Text>
                          </>
                        ) : (
                          <>
                            <InfoRow label="Office / Department" value={form.officeDepartment || 'N/A'} />
                            <InfoRow
                              label="Expected date of disposal"
                              value={
                                form.expectedDisposalDate ? formatDate(form.expectedDisposalDate) : 'Not set yet'
                              }
                            />
                            <InfoRow
                              label="Method of disposal"
                              value={form.methodText || 'Not chosen yet'}
                            />
                            <InfoRow label="Remarks" value={form.remarks || 'N/A'} />
                            {form.canEdit && !isOffice ? (
                              <Text style={styles.docsHint}>
                                Only the Asset Management Office can edit these details. The official form is
                                prepared, printed and finalized in the web application.
                              </Text>
                            ) : null}
                          </>
                        )}

                        <Text style={styles.infoSavedAt}>
                          {form.updatedAt ? `Last saved ${formatStoredTimestamp(form.updatedAt)}` : 'Not saved yet'}
                        </Text>
                      </>
                    )}

                    {datePickerOpen ? (
                      <View>
                        <DateTimePicker
                          value={parseIsoDay(formDraft.expectedDisposalDate || todayIsoDay())}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                          onChange={(event, selected) => {
                            if (Platform.OS !== 'ios') setDatePickerOpen(false);
                            if (event.type === 'dismissed' || !selected) return;
                            setFormDraft((current) => ({ ...current, expectedDisposalDate: isoDay(selected) }));
                          }}
                        />
                        {/* The iOS spinner is inline; it needs a way to close. */}
                        {Platform.OS === 'ios' ? (
                          <TouchableOpacity
                            style={styles.pickerDone}
                            activeOpacity={0.85}
                            onPress={() => setDatePickerOpen(false)}
                          >
                            <Text style={styles.pickerDoneText}>Done</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            {/* Supporting documents: the office keeps inspection reports,
                appraisals and approvals with an approved disposal request. */}
            {isOffice && isDisposal ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Supporting Documents ({documents.length})</Text>

                {detail.status === 'Approved' ? (
                  <Text style={styles.docsHint}>
                    Attach the inspection reports, appraisals or approvals that back this disposal. PDF, JPG, PNG or
                    WEBP up to 5 MB each.
                  </Text>
                ) : (
                  <Text style={styles.docsHint}>
                    Documents can be attached once this disposal request has been approved. It is currently{' '}
                    {detail.status}.
                  </Text>
                )}

                {documentsError ? <Text style={styles.docsError}>{documentsError}</Text> : null}

                {documents.map((document) => (
                  <View key={document.id} style={styles.documentRow}>
                    <TouchableOpacity
                      style={styles.documentOpen}
                      activeOpacity={0.8}
                      onPress={() => openDocument(document)}
                    >
                      <MaterialCommunityIcons
                        name={document.mime.includes('pdf') ? 'file-pdf-box' : 'file-image-outline'}
                        size={26}
                        color="#1D4ED8"
                      />
                      <View style={styles.documentTextWrap}>
                        <Text style={styles.documentName} numberOfLines={1}>
                          {document.title || document.fileName || 'Supporting document'}
                        </Text>
                        <Text style={styles.documentMeta} numberOfLines={1}>
                          {formatDocumentSize(document.fileSize)}
                          {document.createdAt ? ` · ${formatDate(document.createdAt)}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.documentDelete}
                      activeOpacity={0.8}
                      onPress={() => handleRemoveDocument(document)}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={19} color="#B91C1C" />
                    </TouchableOpacity>
                  </View>
                ))}

                {documents.length === 0 && detail.status === 'Approved' ? (
                  <Text style={styles.emptyAssetsText}>No supporting document is attached yet.</Text>
                ) : null}

                {detail.status === 'Approved' ? (
                  <TouchableOpacity
                    style={styles.attachButton}
                    activeOpacity={0.85}
                    onPress={handleAttachDocument}
                    disabled={attaching}
                  >
                    <MaterialCommunityIcons name="paperclip" size={17} color="#1E3A5F" />
                    <Text style={styles.attachButtonText}>
                      {attaching ? 'Attaching…' : 'Attach supporting document'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function ProgressStep({
  title,
  caption,
  state,
  last,
}: {
  title: string;
  caption: string;
  state: 'done' | 'current' | 'todo' | 'rejected';
  last?: boolean;
}) {
  const tone =
    state === 'done'
      ? { dot: '#10B981', ring: '#ECFDF5', icon: 'check' }
      : state === 'current'
        ? { dot: '#F59E0B', ring: '#FFFBEB', icon: 'clock-outline' }
        : state === 'rejected'
          ? { dot: '#EF4444', ring: '#FEF2F2', icon: 'close' }
          : { dot: '#CBD5E1', ring: '#F1F5F9', icon: 'circle-small' };

  return (
    <View style={styles.stepRow}>
      <View style={styles.stepRail}>
        <View style={[styles.stepDot, { backgroundColor: tone.ring }]}>
          <MaterialCommunityIcons name={tone.icon as any} size={14} color={tone.dot} />
        </View>
        {!last ? <View style={[styles.stepLine, { backgroundColor: tone.dot + '40' }]} /> : null}
      </View>
      <View style={styles.stepTextWrap}>
        <Text style={[styles.stepTitle, state === 'todo' && styles.stepTitleMuted]}>{title}</Text>
        <Text style={styles.stepCaption}>{caption}</Text>
      </View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueWrap}>
        {icon ? <MaterialCommunityIcons name={icon as any} size={15} color="#64748B" /> : null}
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#0C134F' },
  container: { flex: 1, backgroundColor: '#F4F7FB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: headerTopPadding,
    paddingBottom: 14,
    backgroundColor: '#0C134F',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', flex: 1, textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { color: '#64748B', fontSize: 15 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    borderTopWidth: 4,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  heroTypeWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTypeText: { flex: 1, gap: 2 },
  heroTypeLabel: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  heroRef: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusBadgeText: { fontSize: 11.5, fontWeight: '800' },
  qrWrap: { alignItems: 'center', marginTop: 16 },
  qrBox: {
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 12,
  },
  qrLabel: { marginTop: 10, fontSize: 13, fontWeight: '800', color: '#1E3A5F', letterSpacing: 0.5 },
  qrHint: { marginTop: 3, fontSize: 11, color: '#94A3B8' },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDF1F7',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 14 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center', width: 26 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, width: 2, marginVertical: 2, borderRadius: 2 },
  stepTextWrap: { flex: 1, paddingBottom: 16 },
  stepTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  stepTitleMuted: { color: '#94A3B8' },
  stepCaption: { fontSize: 12, color: '#64748B', marginTop: 3, lineHeight: 17 },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  assetThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#E2E8F0' },
  assetThumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  assetTextWrap: { flex: 1 },
  assetName: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  assetCode: { fontSize: 12, color: '#64748B', marginTop: 3 },
  assetLifecycle: { fontSize: 11, color: '#94A3B8', marginTop: 3, fontWeight: '600' },
  historyRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1D4ED8', marginTop: 5 },
  historyTextWrap: { flex: 1 },
  historyTitle: { fontSize: 13, fontWeight: '700', color: '#1E293B', lineHeight: 18 },
  historyMeta: { fontSize: 11.5, color: '#94A3B8', marginTop: 3 },
  rejectionBox: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  formStageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  formStagePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FEF6E4',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  formStagePillDone: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  formStageText: { fontSize: 12, fontWeight: '800', color: '#92400E' },
  formStageTextDone: { color: '#047857' },
  formRecorded: { fontSize: 11.5, color: '#047857', fontWeight: '700' },
  emptyAssetsText: { fontSize: 13, color: '#94A3B8' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  infoLabel: { fontSize: 12, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  infoValueWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexWrap: 'wrap',
  },
  infoValue: { fontSize: 14, color: '#0F172A', fontWeight: '700', textAlign: 'right' },
  infoLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
    marginBottom: 8,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  optionChip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  optionChipActive: { backgroundColor: '#0C134F', borderColor: '#0C134F' },
  optionChipText: { fontSize: 12.5, fontWeight: '700', color: '#475569' },
  optionChipTextActive: { color: '#FFFFFF' },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  dateFieldText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  infoInput: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
    marginBottom: 12,
  },
  infoInputTall: { minHeight: 78 },
  saveInfoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#FDB833',
    marginTop: 2,
  },
  saveInfoButtonDisabled: { opacity: 0.5 },
  saveInfoText: { fontSize: 13.5, fontWeight: '800', color: '#1E3A5F' },
  infoSavedAt: {
    marginTop: 12,
    fontSize: 11.5,
    fontWeight: '600',
    color: '#94A3B8',
    textAlign: 'right',
  },
  pickerDone: {
    alignSelf: 'flex-end',
    height: 34,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  pickerDoneText: { fontSize: 13, fontWeight: '800', color: '#1E3A5F' },
  docsHint: { fontSize: 12.5, color: '#64748B', lineHeight: 18, marginBottom: 10 },
  docsError: { fontSize: 12.5, color: '#B91C1C', marginBottom: 8 },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  documentOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  documentTextWrap: { flex: 1 },
  documentName: { fontSize: 13.5, fontWeight: '700', color: '#0F172A' },
  documentMeta: { fontSize: 11.5, color: '#64748B', marginTop: 2 },
  documentDelete: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
  },
  attachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FDB833',
    marginTop: 6,
  },
  attachButtonText: { fontSize: 13.5, fontWeight: '800', color: '#1E3A5F' },
  attachmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  attachmentTextWrap: { flex: 1 },
  attachmentLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  attachmentName: { fontSize: 13, fontWeight: '700', color: '#1E293B', marginTop: 2 },
  reasonBlock: { marginTop: 14 },
  reasonLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  reasonBox: {
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
  },
  reasonText: { fontSize: 14, color: '#0F172A', lineHeight: 20 },
});
