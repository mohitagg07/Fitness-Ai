/**
 * VYRN — Shared layout, elevation and icon tokens.
 */
import { Platform } from 'react-native';
import { SPACING, RADIUS } from './spacing';

export const LAYOUT = {
  screenMargin: 20,
  headerPaddingTop: Platform.select({ ios: 54, android: 40, default: 44 }),
  headerPaddingBottom: SPACING.md,
  headerHeight: 52,
  sectionGap: 28,
  cardGap: 14,
  scrollBottomPad: 120,
};

export const ELEVATION = {
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  low: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 3,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  }),
};

export const ICON_SIZE = {
  xs: 13,
  sm: 16,
  md: 21,
  lg: 28,
};

export { RADIUS };
