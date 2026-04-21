import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

interface LifecycleStat {
  label: string;
  value: number;
  percent: string;
  color: string;
}

interface Department {
  id: string;
  name: string;
  head: string;
  email: string;
  totalAssets: number;
  stats: LifecycleStat[];
}

interface DepartmentCardProps {
  department: Department;
  expanded: boolean;
  onToggle: () => void;
}

export function DepartmentCard({ department, expanded, onToggle }: DepartmentCardProps) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.8}>
        <View style={styles.headerText}>
          <Text style={styles.departmentName}>{department.name}</Text>
          <View style={styles.row}>  
            <MaterialCommunityIcons name="account-circle-outline" size={14} color="#6B7280" />
            <Text style={styles.metaText}>{department.head}</Text>
          </View>
          <View style={styles.row}>
            <MaterialCommunityIcons name="cube-outline" size={14} color="#6B7280" />
            <Text style={styles.metaText}>Total Assets: {department.totalAssets}</Text>
          </View>
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={28}
          color="#374151"
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>Department Head</Text>
            <TouchableOpacity style={styles.editButton} activeOpacity={0.7}>
              <MaterialCommunityIcons name="pencil" size={16} color="#1F2937" />
            </TouchableOpacity>
          </View>
          <Text style={styles.headName}>{department.head}</Text>
          <Text style={styles.headEmail}>{department.email}</Text>

          <Text style={styles.distributionLabel}>Asset lifecycle distribution</Text>
          <View style={styles.progressBarBackground}>
            {department.stats.map((item, index) => (
              <View
                key={item.label}
                style={[
                  styles.progressSegment,
                  { flex: Number(item.percent.replace('%', '')), backgroundColor: item.color },
                ]}
              />
            ))}
          </View>

          <View style={styles.statsGrid}>
            {department.stats.map((item) => (
              <View key={item.label} style={styles.statBox}>
                <Text style={styles.statLabel}>{item.label}</Text>
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statPercent}>{item.percent}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.viewButton} activeOpacity={0.8} onPress={() => router.push(`/assets?department=${department.id}`)}>
            <Text style={styles.viewButtonText}>View All Assets</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  departmentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  metaText: {
    fontSize: 13,
    color: '#6B7280',
  },
  expandedContent: {
    marginTop: 16,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  headEmail: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 18,
  },
  distributionLabel: {
    marginBottom: 10,
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressBarBackground: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#E5E7EB',
  },
  progressSegment: {
    height: '100%',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  statBox: {
    width: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  statPercent: {
    fontSize: 12,
    color: '#6B7280',
  },
  viewButton: {
    marginTop: 8,
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
