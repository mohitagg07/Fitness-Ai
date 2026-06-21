/**
 * NeuroFit AI — Typography
 * Per WHOOP's design guidelines: Proxima Nova for words (we use the
 * system/Inter-style default since Proxima Nova is a licensed font),
 * DIN Pro for numbers (we use a tabular/monospace-leaning system font
 * stack as the closest free equivalent — exact numeral alignment matters
 * more than the exact glyph shapes for a fitness metrics app).
 */
import { Platform } from 'react-native';

export const FONTS = {
  // Words — headlines, labels, body text
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),

  // Numbers — scores, weights, reps. Tabular figures keep digits aligned
  // in a column, which matters for stacked stats (e.g. PR list).
  numeric: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
  }),
};

// WHOOP headline spec: Bold, ALL CAPS, 10% letter-spacing.
export const HEADLINE = {
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: 1.2, // ~10% of a ~12-13px label
};

// Big numeric score style (e.g. Recovery %, Strain, CNS Fatigue).
export const SCORE_DISPLAY = {
  fontWeight: '800' as const,
  fontVariant: ['tabular-nums'] as const,
};
