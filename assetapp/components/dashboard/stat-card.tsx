import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  backgroundColor?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon = 'database',
  iconColor = '#FFA500',
  backgroundColor = '#F5F5F5',
}: StatCardProps) {
  return (
    <View style={[styles.card, { backgroundColor: '#FFFFFF' }]}>
      <View style={[styles.iconContainer, { backgroundColor: backgroundColor || '#F1F5F9' }]}>
        <MaterialCommunityIcons name={icon as any} size={22} color={iconColor} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 16,
    marginRight: 12,
    minWidth: 132,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#EDF1F7',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  title: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    color: '#3B82F6',
    fontWeight: '600',
  },
});
