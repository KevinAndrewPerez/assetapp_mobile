import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

/**
 * The NU TRACE mark: the navy tile with the gold QR glyph.
 *
 * The same artwork is the app's launcher icon (`assets/images/icon.png`, built
 * by `scripts/generate-logo.js`), so the sign-in / register / forgot-password
 * headers and the icon on the user's home screen are always identical. Before
 * this component each screen drew its own approximation with a gradient and a
 * Material icon, and they had already drifted apart.
 */
export function BrandLogo({
  size = 64,
  style,
  elevated = true,
}: {
  size?: number;
  style?: ViewStyle;
  elevated?: boolean;
}) {
  const radius = Math.round(size * 0.28);
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: radius },
        elevated ? styles.elevated : null,
        style,
      ]}
    >
      <Image
        source={require('../assets/images/icon.png')}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="contain"
        accessibilityRole="image"
        accessibilityLabel="NU TRACE logo"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  elevated: {
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
});
