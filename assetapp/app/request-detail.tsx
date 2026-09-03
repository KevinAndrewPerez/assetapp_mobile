import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { fetchRequestDetail, RequestDetail } from '../lib/userService';
import NotificationBell from '@/components/notification-bell';

const statusColors: Record<string, { bg: string; text: string }> = {
  Pending: { bg: '#FEF3C7', text: '#B45309' },
  Approved: { bg: '#DCFCE7', text: '#166534' },
  Received: { bg: '#DCFCE7', text: '#166534' },
  Completed: { bg: '#DCFCE7', text: '#166534' },
  Rejected: { bg: '#FEE2E2', text: '#B91C1C' },
  Cancelled: { bg: '#F3F4F6', text: '#374151' },
  'In Progress': { bg: '#DBEAFE', text: '#1D4ED8' },
};

const typeColors: Record<string, { bg: string; text: string }> = {
  Repair: { bg: '#FCE7F3', text: '#BE185D' },
  Pullout: { bg: '#E0F2FE', text: '#0369A1' },
  Disposal: { bg: '#FEE2E2', text: '#B91C1C' },
  Replacement: { bg: '#E9D5FF', text: '#6D28D9' },
  Transfer: { bg: '#FEF3C7', text: '#B45309' },
};

export default function RequestDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchRequestDetail(String(id ?? ''));
        setDetail(data);
      } catch (err) {
        console.error('Failed to load request detail:', err);
        setDetail(null);
      } finally {
        setLoading(false);
      }
    };
    if (id) load();
  }, [id]);

  const formatDate = (raw?: string) => {
    if (!raw) return 'N/A';
    try {
      return new Date(raw).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return raw;
    }
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request Details</Text>
        <NotificationBell />
      </View>

      <SafeAreaView style={styles.container}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1E3A5F" />
          </View>
        ) : !detail ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="alert-circle-outline" size={56} color="#CBD5E1" />
            <Text style={styles.emptyText}>Request not found.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Top card: type + status + request id + QR */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View
                  style={[
                    styles.typeBadge,
                    { backgroundColor: (typeColors[detail.requestType] ?? typeColors.Transfer).bg },
                  ]}
                >
                  <Text
                    style={[
                      styles.typeBadgeText,
                      { color: (typeColors[detail.requestType] ?? typeColors.Transfer).text },
                    ]}
                  >
                    {detail.requestType} Request
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: (statusColors[detail.status] ?? statusColors.Pending).bg },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      { color: (statusColors[detail.status] ?? statusColors.Pending).text },
                    ]}
                  >
                    {detail.status}
                  </Text>
                </View>
              </View>

              <View style={styles.qrWrap}>
                <View style={styles.qrBox}>
                  <QRCode value={detail.requestId} size={96} backgroundColor="white" />
                </View>
                <Text style={styles.qrLabel}>{detail.requestId}</Text>
              </View>
            </View>

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
                      <Text style={styles.assetName}>{asset.name}</Text>
                      {asset.code ? <Text style={styles.assetCode}>{asset.code}</Text> : null}
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Request information */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Request Information</Text>

              <InfoRow label="Request ID" value={detail.requestId} />
              <InfoRow label="Request Type" value={detail.requestType} />
              <InfoRow label="Submitted By" value={detail.submittedBy} />
              <InfoRow label="Department" value={detail.department || 'N/A'} />
              <InfoRow label="Date Submitted" value={formatDate(detail.dateSubmitted)} />
              {detail.assignTo ? <InfoRow label="Assigned To" value={detail.assignTo} /> : null}
              {detail.attachedFileName ? (
                <InfoRow
                  label="Attached File"
                  value={detail.attachedFileName}
                  icon="paperclip"
                />
              ) : null}

              <View style={styles.reasonBlock}>
                <Text style={styles.reasonLabel}>Reason / Note</Text>
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText}>{detail.reason || 'No reason provided.'}</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon?: string }) {
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
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
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
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  typeBadgeText: { fontSize: 11, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  qrWrap: { alignItems: 'center', marginTop: 16 },
  qrBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 12,
  },
  qrLabel: { marginTop: 10, fontSize: 13, fontWeight: '700', color: '#1E3A5F', letterSpacing: 0.5 },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 14 },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  assetThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#E2E8F0' },
  assetThumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  assetTextWrap: { flex: 1 },
  assetName: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  assetCode: { fontSize: 12, color: '#64748B', marginTop: 3 },
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
  infoValueWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' },
  infoValue: { fontSize: 14, color: '#111827', fontWeight: '700', textAlign: 'right' },
  reasonBlock: { marginTop: 14 },
  reasonLabel: { fontSize: 12, color: '#64748B', fontWeight: '600', textTransform: 'uppercase', marginBottom: 8 },
  reasonBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
  },
  reasonText: { fontSize: 14, color: '#111827', lineHeight: 20 },
});