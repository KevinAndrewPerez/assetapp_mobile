import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  EvaluationAlert,
  MaintenanceAlert,
  fetchAssetsRequiringEvaluation,
  fetchMaintenanceAlerts,
} from '@/lib/assetService';
import { PendingRequestAlert, fetchPendingRequestsForAlerts } from '@/lib/userService';

type AlertKey = 'requests' | 'maintenance' | 'evaluation';

type ChipConfig = {
  key: AlertKey;
  label: string;
  icon: string;
  color: string;
  background: string;
  route: string;
  ctaLabel: string;
};

const CHIPS: ChipConfig[] = [
  {
    key: 'requests',
    label: 'User Requests',
    icon: 'clipboard-text-outline',
    color: '#1D4ED8',
    background: '#EFF6FF',
    route: '/requests',
    ctaLabel: 'Go to Requests',
  },
  {
    key: 'maintenance',
    label: 'Maintenance Due',
    icon: 'wrench',
    color: '#B45309',
    background: '#FFFBEB',
    route: '/maintenance',
    ctaLabel: 'Go to Maintenance',
  },
  {
    key: 'evaluation',
    label: 'For Evaluation',
    icon: 'clock-alert-outline',
    color: '#B91C1C',
    background: '#FEF2F2',
    route: '/lifespan',
    ctaLabel: 'Go to Lifespan',
  },
];

const formatDay = (raw?: string | null) => {
  if (!raw) return 'N/A';
  try {
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return String(raw);
    return d.toLocaleDateString();
  } catch {
    return String(raw);
  }
};

/**
 * The admin dashboard's notification header — mirrors the web's bell dropdown:
 * pending User Requests, assets with maintenance due, and assets whose lifespan
 * has expired and need evaluation.
 */
export default function AlertStrip() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PendingRequestAlert[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceAlert[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationAlert[]>([]);
  const [open, setOpen] = useState<AlertKey | null>(null);

  const load = useCallback(async () => {
    try {
      const [reqRes, maintRes, evalRes] = await Promise.allSettled([
        fetchPendingRequestsForAlerts(),
        fetchMaintenanceAlerts(),
        fetchAssetsRequiringEvaluation(),
      ]);
      setRequests(reqRes.status === 'fulfilled' ? reqRes.value : []);
      setMaintenance(maintRes.status === 'fulfilled' ? maintRes.value : []);
      setEvaluation(evalRes.status === 'fulfilled' ? evalRes.value : []);
      if (reqRes.status === 'rejected') console.warn('Requests alert failed:', reqRes.reason);
      if (maintRes.status === 'rejected') console.warn('Maintenance alert failed:', maintRes.reason);
      if (evalRes.status === 'rejected') console.warn('Evaluation alert failed:', evalRes.reason);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const counts: Record<AlertKey, number> = {
    requests: requests.length,
    maintenance: maintenance.length,
    evaluation: evaluation.length,
  };

  const activeChip = CHIPS.find((c) => c.key === open) ?? null;

  const renderItems = () => {
    if (open === 'requests') {
      if (requests.length === 0) return <EmptyRow label="No pending user requests" />;
      return requests.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemIconWrap}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={18} color="#1D4ED8" />
          </View>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {item.requestType} — {item.requestId}
            </Text>
            <Text style={styles.itemSub} numberOfLines={1}>
              {item.title}
              {item.assetCode ? ` (${item.assetCode})` : ''}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              By {item.submittedBy} • {item.dateSubmitted}
            </Text>
          </View>
          <View style={styles.pendingPill}>
            <Text style={styles.pendingPillText}>Pending</Text>
          </View>
        </View>
      ));
    }

    if (open === 'maintenance') {
      if (maintenance.length === 0) return <EmptyRow label="No maintenance alerts" />;
      return maintenance.map((item) => (
        <View key={String(item.id)} style={styles.itemRow}>
          <View style={[styles.itemIconWrap, { backgroundColor: '#FFFBEB' }]}>
            <MaterialCommunityIcons name="wrench" size={18} color="#B45309" />
          </View>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.itemSub} numberOfLines={1}>
              {item.assetId}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              Due: {formatDay(item.nextMaintenanceDate)}
              {item.custodian ? ` • Accountable: ${item.custodian}` : ''}
            </Text>
          </View>
          <View style={styles.duePill}>
            <Text style={styles.duePillText}>
              {item.daysOverdue > 0 ? `${item.daysOverdue}d overdue` : 'Due'}
            </Text>
          </View>
        </View>
      ));
    }

    if (evaluation.length === 0) return <EmptyRow label="No lifespan expiration alerts" />;
    return evaluation.map((item) => (
      <View key={String(item.id)} style={styles.itemRow}>
        <View style={[styles.itemIconWrap, { backgroundColor: '#FEF2F2' }]}>
          <MaterialCommunityIcons name="clock-alert-outline" size={18} color="#B91C1C" />
        </View>
        <View style={styles.itemBody}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.itemSub} numberOfLines={1}>
            {item.assetId}
          </Text>
          <Text style={styles.itemMeta} numberOfLines={1}>
            Expired: {formatDay(item.expirationDate)} • Status: {item.status ?? 'Unknown'}
          </Text>
          {item.repairCounts != null ? (
            <Text style={styles.itemMeta}>Repair history: {item.repairCounts}</Text>
          ) : null}
        </View>
        <View style={styles.expiredPill}>
          <Text style={styles.expiredPillText}>Evaluate</Text>
        </View>
      </View>
    ));
  };

  return (
    <View>
      <View style={styles.strip}>
        {CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={styles.chip}
            activeOpacity={0.8}
            onPress={() => setOpen(chip.key)}
          >
            <View style={[styles.chipIcon, { backgroundColor: chip.background }]}>
              <MaterialCommunityIcons name={chip.icon as any} size={20} color={chip.color} />
            </View>
            <View style={styles.chipTextWrap}>
              <Text style={styles.chipCount}>
                {loading ? '—' : counts[chip.key]}
              </Text>
              <Text style={styles.chipLabel} numberOfLines={2}>
                {chip.label}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Modal
        visible={open !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                {activeChip ? (
                  <MaterialCommunityIcons
                    name={activeChip.icon as any}
                    size={20}
                    color={activeChip.color}
                  />
                ) : null}
                <Text style={styles.modalTitle}>
                  {open === 'requests'
                    ? 'User Requests'
                    : open === 'maintenance'
                      ? 'Maintenance Due'
                      : 'Assets Requiring Evaluation'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(null)} style={styles.modalClose}>
                <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {open === 'requests'
                ? 'Requests submitted by employees and department heads — pending first'
                : open === 'maintenance'
                  ? 'Assets requiring preventive maintenance — mark complete to reschedule'
                  : 'Expired Active assets move to For Checking; expired Pullout assets keep their status — extend the lifespan or dispose. Assets in any other status wait until they are back to Active or Pullout.'}
            </Text>

            {loading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator color="#1E3A5F" />
              </View>
            ) : (
              <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
                {renderItems()}
              </ScrollView>
            )}

            {activeChip ? (
              <TouchableOpacity
                style={styles.modalCta}
                activeOpacity={0.85}
                onPress={() => {
                  const route = activeChip.route;
                  setOpen(null);
                  router.push(route as any);
                }}
              >
                <Text style={styles.modalCtaText}>{activeChip.ctaLabel}</Text>
                <MaterialCommunityIcons name="arrow-right" size={17} color="#0C134F" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <View style={styles.emptyRow}>
      <MaterialCommunityIcons name="check-circle-outline" size={22} color="#10B981" />
      <Text style={styles.emptyRowText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  chipIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipTextWrap: {
    flex: 1,
  },
  chipCount: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    lineHeight: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    maxHeight: '78%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 6,
    marginBottom: 10,
    lineHeight: 17,
  },
  modalLoading: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  modalList: {
    maxHeight: 340,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemBody: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  itemSub: {
    fontSize: 12,
    color: '#475569',
    marginTop: 1,
  },
  itemMeta: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  pendingPill: {
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  duePill: {
    backgroundColor: '#FFFBEB',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  duePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  expiredPill: {
    backgroundColor: '#FEF2F2',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  expiredPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: 26,
    gap: 8,
  },
  emptyRowText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  modalCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#FBBF24',
  },
  modalCtaText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0C134F',
  },
});
