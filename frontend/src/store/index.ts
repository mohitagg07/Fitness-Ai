/**
 * PulseForge AI — Shared Theme
 * A light, energetic, fitness-forward design language.
 */

export const colors = {
  // Backgrounds
  background: '#F6F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F0F4F8',

  // Borders
  border: '#E6EAF0',
  borderStrong: '#D8DEE8',

  // Text
  textPrimary: '#16202A',
  textSecondary: '#5C6B7A',
  textMuted: '#9AA7B5',
  textOnAccent: '#FFFFFF',

  // Brand
  primary: '#FF6B35',      // energetic coral-orange — primary CTA
  primaryDark: '#E2552A',
  primarySoft: '#FFE8DE',

  secondary: '#2563EB',    // confident blue — accents / badges
  secondarySoft: '#E3ECFF',

  success: '#15A364',
  successSoft: '#DDF6E8',

  warning: '#E5A30B',
  warningSoft: '#FFF3D6',

  danger: '#E5484D',
  dangerSoft: '#FFE5E6',

  // Fatigue scale
  fatigueLow: '#15A364',
  fatigueMid: '#E5A30B',
  fatigueHigh: '#E5484D',
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const shadow = {
  card: {
    shadowColor: '#16202A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  raised: {
    shadowColor: '#16202A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
};

export const typography = {
  heading: { fontWeight: '800' as const, color: colors.textPrimary },
  subheading: { fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontWeight: '400' as const, color: colors.textSecondary },
  label: { fontWeight: '700' as const, color: colors.textMuted, letterSpacing: 1.2 },
};