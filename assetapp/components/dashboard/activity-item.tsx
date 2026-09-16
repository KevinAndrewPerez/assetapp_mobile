import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface ActivityItemProps {
  title: string;
  description: string;
  timestamp: string;
  icon?: string;
  iconColor?: string;
}

export function ActivityItem({
  title,
  description,
  timestamp,
  icon = 'plus-circle',
  iconColor = '#3B82F6',
}: ActivityItemProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.iconWrapper, { backgroundColor: `${iconColor}20` }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={iconColor} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
      </View>
      <Text style={styles.timestamp}>{timestamp}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF1F7',
    alignItems: 'flex-start',
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 2,
  },
  description: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  timestamp: {
    fontSize: 11,
    color: '#94A3B8',
    marginLeft: 8,
  },
});
