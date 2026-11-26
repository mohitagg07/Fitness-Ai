/**
 * VYRN — Adaptive Performance System
 * A calm, premium performance palette: deep forest surfaces, warm mineral
 * text, and a restrained mineral-lime brand accent. Recovery/strain colors
 * remain semantically distinct so data meaning is never sacrificed for style.
 */
export const COLORS = {
  // Canvas
  background:     '#08110C',
  backgroundTop:  '#0D1911',
  backgroundBot:  '#122018',
  card:           '#101B14',
  cardElevated:   '#17241B',
  cardBorder:     '#26362B',
  inputBg:        '#0C1710',

  // Text — warm, high-contrast neutrals
  text:           '#F3F5EC',
  textSecondary:  '#B2BCAE',
  textMuted:      '#829080',
  textDim:        '#596957',

  // Borders
  border:         '#25352A',
  borderLight:    '#35483A',

  // Recovery vocabulary — preserved as semantic state colors
  recoveryHigh:   '#91C978',
  recoveryMed:    '#E4BD69',
  recoveryLow:    '#E17A73',

  // Activity / strain / sleep data
  strain:         '#78B5D8',
  strainGlow:     '#B9DE72',
  sleep:          '#8CA9B7',
  recoveryBlue:   '#82B9D7',

  // VYRN brand — mineral lime, softer than the previous neon green
  primaryGreen:   '#B9DE72',
  primaryBlue:    '#78B5D8',

  // Coach / intelligence
  coachPurple:    '#B29AE6',

  // Semantic
  success: '#91C978',
  warning: '#E4BD69',
  danger:  '#E17A73',
  info:    '#78B5D8',

  // Navigation
  tabActive:   '#C4E783',
  tabInactive: '#829080',
  tabBg:       '#101B14',
  tabBorder:   '#2A3B2F',

  // Chat
  userBubble: '#78B5D822',

  // Achievements
  gold: '#E6B96B',

  // Nutrition — distinct and readable
  calories: '#E69A70',
  protein:  '#D28D9D',
  carbs:    '#A8CF83',
  fat:      '#83B4D8',
  water:    '#82B9D7',
};

/** Returns the semantic recovery color for a 0–100 score. */
export function recoveryColor(score: number): string {
  if (score >= 67) return COLORS.recoveryHigh;
  if (score >= 34) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

export function recoveryLabel(score: number): string {
  if (score >= 67) return 'HIGH RECOVERY';
  if (score >= 34) return 'MODERATE RECOVERY';
  return 'LOW RECOVERY';
}

export const alpha = (hex: string, opacity: number): string => {
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
};
