import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type RequestStatus = 'Pending' | 'Approved' | 'Rejected';
export type RequestType = 'Repair' | 'Pullout' | 'Approval';

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
}

interface RequestCardProps {
  item: RequestItem;
  expanded: boolean;
  onToggle: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

const statusStyles = {
  Pending: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
  },
  Approved: {
    backgroundColor: '#DCFCE7',
    color: '#166534',
  },
  Rejected: {
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
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
  Approval: {
    backgroundColor: '#ECFCCB',
    color: '#4D7C0F',
  },
};

export function RequestCard({ item, expanded, onToggle, onApprove, onReject }: RequestCardProps) {
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
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Asset Name</Text>
            <Text style={styles.detailValue}>{item.assetName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Asset ID</Text>
            <Text style={styles.detailValue}>{item.assetId}</Text>
          </View>
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
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
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
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#6B7280',
  },
  detailsContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 16,
  },
  qrContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  qrCodeLabel: {
    marginTop: 12,
    fontSize: 12,
    color: '#6B7280',
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
    color: '#6B7280',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
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
