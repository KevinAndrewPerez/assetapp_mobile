/**
 * Shared UI kit — the common building blocks (ScreenHeader, Card, Chip,
 * StatusPill, Button, EmptyState, SearchBar, Field) that every screen uses,
 * so spacing/radii/typography stay consistent app-wide.
 */
import React from 'react';
import {
  ActivityIndicator,
  RefreshControlProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadow, type, gradient, tintForStatus } from '@/lib/theme';

/* ------------------------------------------------------------------ */
/* ScreenHeader — navy gradient bar with back button, title, subtitle  */
/* ------------------------------------------------------------------ */

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.headerSafe}>
      <LinearGradient colors={gradient.header} style={styles.headerBar} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        {onBack ? (
          <TouchableOpacity style={styles.headerBtn} activeOpacity={0.75} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtnPlaceholder} />
        )}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ?? <View style={styles.headerBtnPlaceholder} />}
      </LinearGradient>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Card — white rounded surface with soft border + shadow              */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  style,
  onPress,
  activeOpacity = 0.85,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  activeOpacity?: number;
}) {
  if (onPress) {
    return (
      <TouchableOpacity style={[styles.card, style]} activeOpacity={activeOpacity} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* StatusPill — tinted pill from the shared status palette             */
/* ------------------------------------------------------------------ */

export function StatusPill({ status, style }: { status: string; style?: StyleProp<ViewStyle> }) {
  const tint = tintForStatus(status);
  return (
    <View style={[styles.pill, { backgroundColor: tint.bg }, style]}>
      <Text style={[styles.pillText, { color: tint.ink }]} numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Chip — rounded filter chip                                          */
/* ------------------------------------------------------------------ */

export function Chip({
  label,
  active,
  onPress,
  count,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  count?: number;
}) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} activeOpacity={0.75} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {typeof count === 'number' ? <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text> : null}
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Button — primary (navy), gold, soft, or danger                      */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'gold' | 'soft' | 'danger' | 'ghost';

export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  small,
}: {
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const v = variants[variant];
  return (
    <TouchableOpacity
      style={[styles.button, small && styles.buttonSmall, { backgroundColor: v.bg, borderWidth: v.border ? 1 : 0, borderColor: v.border || 'transparent' }, (disabled || loading) && styles.buttonDisabled, style]}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : icon ? (
        <MaterialCommunityIcons name={icon} size={small ? 15 : 17} color={v.fg} />
      ) : null}
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: v.fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const variants: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.navy800, fg: '#FFFFFF' },
  gold: { bg: colors.gold500, fg: '#3D2E00' },
  soft: { bg: colors.surfaceMuted, fg: colors.inkSoft, border: colors.border },
  danger: { bg: colors.dangerBg, fg: colors.dangerInk },
  ghost: { bg: 'transparent', fg: colors.navy800 },
};

/* ------------------------------------------------------------------ */
/* SearchBar — rounded grey input with magnifier + clear               */
/* ------------------------------------------------------------------ */

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search…',
  style,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.searchWrap, style]}>
      <MaterialCommunityIcons name="magnify" size={19} color={colors.inkFaint} />
      <TextInput style={styles.searchInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.inkFaint} returnKeyType="search" />
      {value.length > 0 ? (
        <TouchableOpacity activeOpacity={0.7} onPress={() => onChangeText('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <MaterialCommunityIcons name="close-circle" size={16} color={colors.inkFaint} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState — soft icon + message, optional action                   */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = 'inbox-outline',
  title,
  message,
  action,
  style,
}: {
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  message?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <View style={styles.emptyIconWrap}>
        <MaterialCommunityIcons name={icon} size={26} color={colors.inkFaint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Field — label + value row used in detail grids                      */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  value,
  icon,
  full,
}: {
  label: string;
  value?: React.ReactNode;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  full?: boolean;
}) {
  return (
    <View style={[styles.field, full && styles.fieldFull]}>
      <View style={styles.fieldLabelRow}>
        {icon ? <MaterialCommunityIcons name={icon} size={12} color={colors.inkFaint} /> : null}
        <Text style={styles.fieldLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.fieldValue} numberOfLines={2}>
          {String(value) || '—'}
        </Text>
      ) : (
        value ?? <Text style={styles.fieldValue}>—</Text>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* ListSkeleton — shimmer-free loading placeholder rows                */
/* ------------------------------------------------------------------ */

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonLines}>
            <View style={[styles.skeletonLine, { width: '62%' }]} />
            <View style={[styles.skeletonLine, { width: '40%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* ScreenScroll — content container with the standard padding          */
/* ------------------------------------------------------------------ */

export function ScreenScroll({
  children,
  style,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  // Header
  headerSafe: { backgroundColor: colors.navy800 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 6,
    minHeight: 64,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnPlaceholder: { width: 38 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { ...type.screenTitle },
  headerSubtitle: { ...type.screenSubtitle, marginTop: 1 },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    ...shadow.card,
  },

  // Pill
  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3.5, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  // Chip
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    paddingVertical: 7.5,
  },
  chipActive: { backgroundColor: colors.navy800, borderColor: colors.navy800 },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.inkMuted },
  chipTextActive: { color: '#FFFFFF' },
  chipCount: { fontSize: 11, fontWeight: '700', color: colors.inkFaint, backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  chipCountActive: { color: colors.gold500, backgroundColor: 'rgba(255,255,255,0.16)' },

  // Button
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { fontSize: 13.5, fontWeight: '700' },
  buttonTextSmall: { fontSize: 12.5 },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0 },

  // Empty state
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 28 },
  emptyIconWrap: {
    width: 62,
    height: 62,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.inkSoft, textAlign: 'center' },
  emptyMessage: { fontSize: 12.5, color: colors.inkMuted, textAlign: 'center', marginTop: 5, lineHeight: 18 },
  emptyAction: { marginTop: 16 },

  // Field
  field: { flex: 1, minWidth: '46%' },
  fieldFull: { flexBasis: '100%' },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fieldLabel: { ...type.label, textTransform: 'uppercase' },
  fieldValue: { fontSize: 13.5, fontWeight: '600', color: colors.ink, marginTop: 3 },

  // Skeleton
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 10,
  },
  skeletonIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.surfaceSunken },
  skeletonLines: { flex: 1, gap: 8 },
  skeletonLine: { height: 11, borderRadius: 6, backgroundColor: colors.surfaceSunken },

  // Scroll
  scrollContent: { padding: 16, paddingBottom: 116, gap: 12 },
});
