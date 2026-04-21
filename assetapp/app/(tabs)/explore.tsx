import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DepartmentCard } from '@/components/dashboard/department-card';

const departments = [
  {
    id: 'engineering',
    name: 'College of Engineering',
    head: 'Dr. Maria Santos',
    email: 'maria.santos@nu.edu.ph',
    totalAssets: 61,
    stats: [
      { label: 'Acquired', value: 5, percent: '7.6%', color: '#2563EB' },
      { label: 'Active', value: 45, percent: '68.2%', color: '#10B981' },
      { label: 'For Repair', value: 3, percent: '4.5%', color: '#F59E0B' },
      { label: 'Pulled Out', value: 1, percent: '1.5%', color: '#6B7280' },
      { label: 'Disposed', value: 12, percent: '18.2%', color: '#EF4444' },
    ],
  },
  {
    id: 'business',
    name: 'College of Business Administration',
    head: 'Prof. Pedro Garcia',
    email: 'pedro.garcia@nu.edu.ph',
    totalAssets: 50,
    stats: [
      { label: 'Acquired', value: 8, percent: '16.0%', color: '#2563EB' },
      { label: 'Active', value: 30, percent: '60.0%', color: '#10B981' },
      { label: 'For Repair', value: 4, percent: '8.0%', color: '#F59E0B' },
      { label: 'Pulled Out', value: 2, percent: '4.0%', color: '#6B7280' },
      { label: 'Disposed', value: 6, percent: '12.0%', color: '#EF4444' },
    ],
  },
  {
    id: 'arts',
    name: 'College of Arts & Sciences',
    head: 'Dr. Ana Reyes',
    email: 'ana.reyes@nu.edu.ph',
    totalAssets: 73,
    stats: [
      { label: 'Acquired', value: 12, percent: '16.4%', color: '#2563EB' },
      { label: 'Active', value: 49, percent: '67.1%', color: '#10B981' },
      { label: 'For Repair', value: 5, percent: '6.8%', color: '#F59E0B' },
      { label: 'Pulled Out', value: 2, percent: '2.7%', color: '#6B7280' },
      { label: 'Disposed', value: 5, percent: '6.8%', color: '#EF4444' },
    ],
  },
  {
    id: 'itso',
    name: 'ITSO - IT Services Office',
    head: 'Mr. Mark Lopez',
    email: 'mark.lopez@nu.edu.ph',
    totalAssets: 91,
    stats: [
      { label: 'Acquired', value: 10, percent: '11.0%', color: '#2563EB' },
      { label: 'Active', value: 68, percent: '74.7%', color: '#10B981' },
      { label: 'For Repair', value: 6, percent: '6.6%', color: '#F59E0B' },
      { label: 'Pulled Out', value: 3, percent: '3.3%', color: '#6B7280' },
      { label: 'Disposed', value: 4, percent: '4.4%', color: '#EF4444' },
    ],
  },
  {
    id: 'administration',
    name: 'Administration',
    head: 'Ms. Lisa Tan',
    email: 'lisa.tan@nu.edu.ph',
    totalAssets: 38,
    stats: [
      { label: 'Acquired', value: 4, percent: '10.5%', color: '#2563EB' },
      { label: 'Active', value: 27, percent: '71.1%', color: '#10B981' },
      { label: 'For Repair', value: 3, percent: '7.9%', color: '#F59E0B' },
      { label: 'Pulled Out', value: 1, percent: '2.6%', color: '#6B7280' },
      { label: 'Disposed', value: 3, percent: '7.9%', color: '#EF4444' },
    ],
  },
  {
    id: 'finance',
    name: 'Finance Department',
    head: 'Prof. Juan Cruz',
    email: 'juan.cruz@nu.edu.ph',
    totalAssets: 42,
    stats: [
      { label: 'Acquired', value: 7, percent: '16.7%', color: '#2563EB' },
      { label: 'Active', value: 28, percent: '66.7%', color: '#10B981' },
      { label: 'For Repair', value: 2, percent: '4.8%', color: '#F59E0B' },
      { label: 'Pulled Out', value: 1, percent: '2.4%', color: '#6B7280' },
      { label: 'Disposed', value: 4, percent: '9.5%', color: '#EF4444' },
    ],
  },
];

export default function AssetsScreen() {
  const [expandedId, setExpandedId] = useState<string | null>('engineering');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Assets & Custodianship</Text>
        <View style={styles.notificationBadge}>
          <Text style={styles.notificationBadgeText}>3</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {departments.map((department) => (
          <DepartmentCard
            key={department.id}
            department={department}
            expanded={expandedId === department.id}
            onToggle={() => setExpandedId(expandedId === department.id ? null : department.id)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#0F172A',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
    flex: 1,
  },
  notificationBadge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#0F172A',
    fontWeight: '700',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
});

