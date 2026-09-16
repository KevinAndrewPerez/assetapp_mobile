import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface QuickLinkProps {
  title: string;
  subtitle: string;
  icon: string;
  iconColor: string;
  onPress?: () => void;
  gradientColors?: string[];
  titleColor?: string;
  subtitleColor?: string;
}

export function QuickLink({
  title,
  subtitle,
  icon,
  iconColor,
  onPress,
  gradientColors,
  titleColor,
  subtitleColor,
}: QuickLinkProps) {
  const content = (
    <>
      <View style={styles.iconContainer}>
        <MaterialCommunityIcons name={icon as any} size={30} color={iconColor} />
      </View>
      <Text style={[styles.title, titleColor ? { color: titleColor } : null]}>{title}</Text>
      <Text style={[styles.subtitle, subtitleColor ? { color: subtitleColor } : null]}>{subtitle}</Text>
    </>
  );

  return (
    <TouchableOpacity
      style={styles.touchable}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {gradientColors && gradientColors.length >= 2 ? (
        <LinearGradient
          colors={gradientColors as any}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.container}
          pointerEvents="box-none"
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
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
    padding: 14,
    borderRadius: 16,
    justifyContent: 'flex-start',
    alignItems: 'center',
    minHeight: 124,
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    lineHeight: 14,
  },
});
