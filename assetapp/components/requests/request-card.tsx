import React from 'react';
import { Image, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { evaluateAssetLifecycle } from '@/lib/requestService';

export type RequestStatus =
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'Received';
export type RequestType = 'Repair' | 'Pullout' | 'Disposal' | 'Turn Over' | 'Approval' | 'Replacement' | 'Other';

/**
 * A real asset row resolved for a request. Requests often leave `asset_id`
 * NULL and link assets through the per-asset log tables (repairs / pullouts /
 * replacements), so screens resolve and attach these explicitly.
 */
export type LinkedAsset = {
  id?: string | number | null;
  code: string;
  name: string;
  category?: string;
  condition?: string;
  serialNumber?: string;
  location?: string;
  purchasePrice?: string;
  warrantyMonths?: string;
  lifecycleStatus?: string;
  imageUrl?: string;
};

export interface RequestItem {
  id: string;
  title: string;
  requestId: string;
  assetName: string;
  assetId: string;
  requestType: RequestType;
  department: string;
  submittedBy: string;
  dateSubmitted: string;
  reason: string;
  status: RequestStatus;
  statusLabel: string;
  priority?: 'Low' | 'Medium' | 'High';
  completedAt?: string;
  /** Assets actually linked to this request (may be several per request). */
  linkedAssets?: LinkedAsset[];
}

interface RequestCardProps {
  item: RequestItem;
  expanded: boolean;
  onToggle: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onViewDetails?: () => void;
  /** Admin status control: writes the selected status back to Supabase. */
  onStatusChange?: (status: RequestStatus) => void;
}

const STATUS_OPTIONS: RequestStatus[] = [
  'Pending',
  'Approved',
  'In Progress',
  'Completed',
  'Rejected',
  'Cancelled',
];

const statusStyles = {
  Pending: {
    backgroundColor: '#FEF6E4',
    color: '#92400E',
  },
  Approved: {
    backgroundColor: '#ECFDF5',
    color: '#047857',
  },
  Rejected: {
    backgroundColor: '#FEF2F2',
    color: '#B91C1C',
  },
  'In Progress': {
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
  },
  Completed: {
    backgroundColor: '#F5F3FF',
    color: '#6D28D9',
  },
  Cancelled: {
    backgroundColor: '#F1F5F9',
    color: '#475569',
  },
  Received: {
    backgroundColor: '#ECFDF5',
    color: '#047857',
  },
};

const typeStyles = {
  Repair: {
    backgroundColor: '#FCE7F3',
    color: '#BE185D',
  },
  Pullout: {
    backgroundColor: '#E0F2FE',
    color: '#0369A1',
  },
  Disposal: {
    backgroundColor: '#FEF2F2',
    color: '#B91C1C',
  },
  'Turn Over': {
    backgroundColor: '#FEF6E4',
    color: '#92400E',
  },
  Approval: {
    backgroundColor: '#ECFCCB',
    color: '#4D7C0F',
  },
  Replacement: {
    backgroundColor: '#E9D5FF',
    color: '#6D28D9',
  },
  Other: {
    backgroundColor: '#F1F5F9',
    color: '#334155',
  },
};

export function RequestCard({
  item,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onViewDetails,
  onStatusChange,
}: RequestCardProps) {
  const statusStyle = statusStyles[item.status];
  const requestTypeStyle = typeStyles[item.requestType] ?? typeStyles.Approval;

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.8} style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.badgesRow}>
            <View style={[styles.badge, { backgroundColor: requestTypeStyle.backgroundColor }]}> 
              <Text style={[styles.badgeText, { color: requestTypeStyle.color }]}>{item.requestType}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: statusStyle.backgroundColor }]}> 
              <Text style={[styles.badgeText, { color: statusStyle.color }]}>{item.statusLabel}</Text>
            </View>
          </View>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>{`Submitted by: ${item.submittedBy} • ${item.department}`}</Text>
          <Text style={styles.dateText}>{item.dateSubmitted}</Text>
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={28}
          color="#0F172A"
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detailsContainer}>
          <View style={styles.qrContainer}>
            <MaterialCommunityIcons name="qrcode-scan" size={54} color="#F59E0B" />
            <Text style={styles.qrCodeLabel}>{item.requestId}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Request ID</Text>
            <Text style={styles.detailValue}>{item.requestId}</Text>
          </View>
          {item.linkedAssets && item.linkedAssets.length > 0 ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>
                Linked Assets ({item.linkedAssets.length})
              </Text>
              {item.linkedAssets.map((a, i) => {
                const evaluation = evaluateAssetLifecycle(a.lifecycleStatus);
                return (
                  <View key={i} style={styles.linkedAssetRow}>
                    {a.imageUrl ? (
                      <Image source={{ uri: a.imageUrl }} style={styles.linkedAssetThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.linkedAssetThumb, styles.linkedAssetThumbPlaceholder]}>
                        <MaterialCommunityIcons name="cube-outline" size={16} color="#94A3B8" />
                      </View>
                    )}
                    <View style={styles.linkedAssetTextWrap}>
                      <Text style={styles.detailValue} numberOfLines={2}>
                        {a.name}
                        {a.code ? ` — ${a.code}` : ''}
                      </Text>
                      <View style={styles.lifecycleRow}>
                        <View
                          style={[
                            styles.lifecycleChip,
                            {
                              backgroundColor: evaluation.assignable ? '#ECFDF5' : '#FEF6E4',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.lifecycleChipText,
                              { color: evaluation.assignable ? '#047857' : '#92400E' },
                            ]}
                          >
                            {evaluation.statusLabel}
                          </Text>
                        </View>
                        <Text style={styles.lifecycleNote} numberOfLines={3}>
                          {evaluation.assignable ? 'Ready to be assigned' : evaluation.reason}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Asset Name</Text>
                <Text style={styles.detailValue}>{item.assetName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Asset ID</Text>
                <Text style={styles.detailValue}>{item.assetId}</Text>
              </View>
            </>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Request Type</Text>
            <Text style={styles.detailValue}>{item.requestType}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Submitted By</Text>
            <Text style={styles.detailValue}>{item.submittedBy}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Department</Text>
            <Text style={styles.detailValue}>{item.department}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date Submitted</Text>
            <Text style={styles.detailValue}>{item.dateSubmitted}</Text>
          </View>
          <View style={styles.detailRowFull}>
            <Text style={styles.detailLabel}>Reason</Text>
            <Text style={styles.detailValue}>{item.reason}</Text>
          </View>
          <View style={[styles.badge, { alignSelf: 'flex-start', marginBottom: 14, backgroundColor: statusStyle.backgroundColor }]}> 
            <Text style={[styles.badgeText, { color: statusStyle.color }]}>{item.status}</Text>
          </View>

          {item.status === 'Pending' ? (
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionButton, styles.approveButton]} activeOpacity={0.8} onPress={onApprove}>
                <Text style={styles.actionButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.rejectButton]} activeOpacity={0.8} onPress={onReject}>
                <Text style={styles.actionButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {onStatusChange ? (
            <View style={styles.statusPickerWrap}>
              <Text style={styles.statusPickerLabel}>Update status</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.statusPickerRow}
              >
                {STATUS_OPTIONS.map((option) => {
                  const active = item.status === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.statusChip, active && styles.statusChipActive]}
                      onPress={() => !active && onStatusChange(option)}
                      disabled={active}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>
                        {option}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {onViewDetails ? (
            <TouchableOpacity style={styles.viewDetailsButton} activeOpacity={0.8} onPress={onViewDetails}>
              <MaterialCommunityIcons name="text-box-search-outline" size={17} color="#1E3A5F" />
              <Text style={styles.viewDetailsText}>View Full Details</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
  header: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#64748B',
  },
  detailsContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 16,
  },
  qrContainer: {
    backgroundColor: '#F4F7FB',
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  qrCodeLabel: {
    marginTop: 12,
    fontSize: 12,
    color: '#64748B',
    fontWeight: '700',
  },
  detailRow: {
    marginBottom: 12,
  },
  detailRowFull: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  linkedAssetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F4F7FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 8,
    marginTop: 8,
  },
  linkedAssetThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  linkedAssetTextWrap: {
    flex: 1,
  },
  lifecycleRow: {
    marginTop: 6,
  },
  lifecycleChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  lifecycleChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  lifecycleNote: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 15,
    color: '#64748B',
  },
  linkedAssetThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusPickerWrap: {
    marginBottom: 14,
  },
  statusPickerLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 8,
    fontWeight: '600',
  },
  statusPickerRow: {
    gap: 8,
    paddingRight: 8,
  },
  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusChipActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#1E3A5F',
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  statusChipTextActive: {
    color: '#FFFFFF',
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  viewDetailsText: {
    color: '#1E3A5F',
    fontWeight: '700',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#10B981',
  },
  rejectButton: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
