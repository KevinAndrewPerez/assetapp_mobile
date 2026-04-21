import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface QuickLinkProps {
  title: string;
  subtitle: string;
  icon: string;
  backgroundColor: string;
  iconColor: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'default';
}

export function QuickLink({
  title,
  subtitle,
  icon,
  backgroundColor,
  iconColor,
  onPress,
  variant = 'default',
}: QuickLinkProps) {
  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor },
        variant === 'danger' && styles.dangerBorder,
        variant === 'secondary' && styles.secondaryBorder,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <MaterialCommunityIcons name={icon as any} size={28} color={iconColor} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '48%',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    minHeight: 140,
  },
  dangerBorder: {
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  secondaryBorder: {
    borderWidth: 2,
    borderColor: '#1E3A5F',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.6)',
  },
});
