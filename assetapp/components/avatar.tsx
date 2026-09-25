import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';

import { resolveMediaUrl } from '@/lib/mediaUrl';
import { colors, shadow } from '@/lib/theme';

/**
 * One avatar for the whole app: the user's uploaded `profile_photo` when there
 * is one, otherwise their initials on the brand gold tile. Both profile screens
 * and the dashboard card used to draw their own gold initials box, so a photo
 * uploaded from Edit Profile had nowhere to appear.
 */

const initialsOf = (name?: string): string => {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'NA';
  const letters = parts.slice(0, 2).map((part) => part[0]);
  return letters.join('').toUpperCase();
};

export type AvatarProps = {
  name?: string;
  /** Stored reference (Supabase URL, Laravel path or bare object key). */
  photo?: string | null;
  size?: number;
  /** Defaults to a circle; pass a smaller number for the squircle cards. */
  borderRadius?: number;
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ name, photo, size = 80, borderRadius, ring, style }: AvatarProps) {
  const url = photo ? resolveMediaUrl(photo, 'assets') : '';
  const radius = borderRadius ?? size / 2;
  const fontSize = Math.round(size * 0.34);

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
        },
        ring && styles.ring,
        style,
      ]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: size, height: size, borderRadius: radius }}
          resizeMode="cover"
        />
      ) : (
        <Text style={[styles.initials, { fontSize }]} allowFontScaling={false}>
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.gold500,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadow.lifted,
  },
  ring: {
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  initials: {
    fontWeight: '800',
    color: '#3D2E00',
    letterSpacing: 0.5,
  },
});
