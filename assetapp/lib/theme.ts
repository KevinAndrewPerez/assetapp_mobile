/**
 * NUTrace mobile design tokens — single source of truth for the app's look.
 * The palette is the existing navy + gold brand; these tokens systematize
 * surfaces, radii, shadows and type so every screen feels like one product.
 */
import { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  // Brand
  navy900: '#0C134F', // deepest — tab bar, scanner
  navy800: '#1E3A5F', // primary — headers, primary buttons
  navy700: '#27496F', // pressed state
  gold500: '#FDB833', // brand accent — active tab, highlights
  gold600: '#F0A925', // pressed accent

  // Surfaces
  bg: '#F4F7FB', // screen background
  surface: '#FFFFFF', // cards
  surfaceMuted: '#F8FAFC', // inset sections
  surfaceSunken: '#F1F5F9', // locked/disabled fields
  border: '#E2E8F0',
  borderSoft: '#EDF1F7',

  // Text
  ink: '#0F172A',
  inkSoft: '#334155',
  inkMuted: '#64748B',
  inkFaint: '#94A3B8',

  // Semantic (soft-tinted pairs used for pills, chips, buttons)
  success: '#10B981', successBg: '#ECFDF5', successInk: '#047857',
  warning: '#F59E0B', warningBg: '#FFFBEB', warningInk: '#B45309',
  danger: '#EF4444', dangerBg: '#FEF2F2', dangerInk: '#B91C1C',
  info: '#3B82F6', infoBg: '#EFF6FF', infoInk: '#1D4ED8',
  gold: '#FBBF24', goldBg: '#FEF6E4', goldInk: '#92400E',
  violet: '#8B5CF6', violetBg: '#F5F3FF', violetInk: '#6D28D9',
} as const;

/** One status → tinted pill mapping shared by every screen. */
export const statusTint: Record<string, { bg: string; ink: string }> = {
  Active: { bg: colors.successBg, ink: colors.successInk },
  Acquired: { bg: colors.violetBg, ink: colors.violetInk },
  'For Checking': { bg: colors.goldBg, ink: colors.goldInk },
  'For Repair': { bg: colors.warningBg, ink: colors.warningInk },
  Repairing: { bg: colors.warningBg, ink: colors.warningInk },
  'For Replacement': { bg: colors.infoBg, ink: colors.infoInk },
  'For Disposal': { bg: colors.dangerBg, ink: colors.dangerInk },
  Disposal: { bg: colors.dangerBg, ink: colors.dangerInk },
  Pullout: { bg: colors.infoBg, ink: colors.infoInk },
  'Pulled Out': { bg: colors.infoBg, ink: colors.infoInk },
  Approved: { bg: colors.successBg, ink: colors.successInk },
  Pending: { bg: colors.goldBg, ink: colors.goldInk },
  Rejected: { bg: colors.dangerBg, ink: colors.dangerInk },
  Cancelled: { bg: colors.surfaceSunken, ink: colors.inkMuted },
  Received: { bg: colors.successBg, ink: colors.successInk },
  Completed: { bg: colors.violetBg, ink: colors.violetInk },
  'In Progress': { bg: colors.infoBg, ink: colors.infoInk },
  Expired: { bg: colors.dangerBg, ink: colors.dangerInk },
  'Beyond Repair': { bg: colors.dangerBg, ink: colors.dangerInk },
  New: { bg: colors.successBg, ink: colors.successInk },
  Good: { bg: colors.successBg, ink: colors.successInk },
  Fair: { bg: colors.goldBg, ink: colors.goldInk },
  Poor: { bg: colors.dangerBg, ink: colors.dangerInk },
  Damaged: { bg: colors.dangerBg, ink: colors.dangerInk },
};

export function tintForStatus(status: string | null | undefined): { bg: string; ink: string } {
  if (!status) return { bg: colors.surfaceSunken, ink: colors.inkMuted };
  return (
    statusTint[status] ??
    statusTint[status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()] ?? {
      bg: colors.surfaceSunken,
      ink: colors.inkMuted,
    }
  );
}

export const radius = { xs: 8, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const shadow = {
  /** Default card elevation — subtle, border-assisted. */
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,
  /** Raised elements — floating tab bar, modals. */
  float: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 10,
  } as ViewStyle,
  /** Hover-y accent for pressed/hero cards. */
  lifted: {
    shadowColor: '#1E3A5F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  } as ViewStyle,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const gradient = {
  header: ['#1E3A5F', '#16324F'] as [string, string],
  hero: ['#0C134F', '#1E3A5F'] as [string, string],
  gold: ['#FDB833', '#F0A925'] as [string, string],
};

export const type = {
  screenTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2 } as TextStyle,
  screenSubtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.78)' } as TextStyle,
  cardTitle: { fontSize: 15.5, fontWeight: '700', color: colors.ink } as TextStyle,
  body: { fontSize: 13.5, color: colors.inkSoft } as TextStyle,
  label: { fontSize: 11, fontWeight: '700', color: colors.inkFaint, letterSpacing: 0.8 } as TextStyle,
  caption: { fontSize: 12, color: colors.inkMuted } as TextStyle,
} as const;
