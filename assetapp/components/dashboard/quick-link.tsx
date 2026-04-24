import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface QuickLinkProps {
  title: string;
  subtitle: string;
  icon: string;
  backgroundColor: string;
  iconColor: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'default';
  gradientColors?: string[];
  titleColor?: string;
  subtitleColor?: string;
}

export function QuickLink({
  title,
  subtitle,
  icon,
  backgroundColor,
  iconColor,
  onPress,
  variant = 'default',
  gradientColors,
  titleColor,
  subtitleColor,
}: QuickLinkProps) {
  const content = (
    <>
      <MaterialCommunityIcons name={icon as any} size={28} color={iconColor} />
      <Text style={[styles.title, titleColor ? { color: titleColor } : null]}>{title}</Text>
      <Text style={[styles.subtitle, subtitleColor ? { color: subtitleColor } : null]}>{subtitle}</Text>
    </>
  );

  const containerStyles = [
    styles.container,
    variant === 'danger' && styles.dangerBorder,
    variant === 'secondary' && styles.secondaryBorder,
  ];

  return (
    <TouchableOpacity
      style={styles.touchable}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {gradientColors && gradientColors.length >= 2 ? (
        <LinearGradient
          colors={gradientColors as any}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={containerStyles as any}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[containerStyles, { backgroundColor }] as any}>
          {content}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    width: '48%',
    marginBottom: 12,
  },
  container: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
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
