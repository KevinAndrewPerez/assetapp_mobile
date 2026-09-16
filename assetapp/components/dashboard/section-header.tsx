import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface SectionHeaderProps {
  title: string;
  onViewAll?: () => void;
}

export function SectionHeader({ title, onViewAll }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {onViewAll && (
        <TouchableOpacity onPress={onViewAll} style={styles.button}>
          <Text style={styles.buttonText}>View All</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color="#3B82F6" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 12.5,
    color: '#1E3A5F',
    fontWeight: '700',
    marginRight: 2,
  },
});
