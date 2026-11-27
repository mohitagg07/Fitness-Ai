/**
 * VYRN — Adaptive Performance System
 * A bright, premium performance palette: warm ivory canvas, clean white
 * surfaces, deep forest-green identity and clear semantic data accents.
 * Recovery/strain colors remain distinct so meaning stays legible.
 */
export const COLORS = {
  // Canvas — warm mineral ivory, lifted surfaces and clear separation.
  background:     '#F5F3EA',
  backgroundTop:  '#FBFAF5',
  backgroundBot:  '#EAF0E8',
  card:           '#FFFFFF',
  cardElevated:   '#F1F6EF',
  cardBorder:     '#DDE7DC',
  inputBg:        '#F2F5F0',

  // Text — deep forest ink with legible secondary hierarchy.
  text:           '#1B2B21',
  textSecondary:  '#526458',
  textMuted:      '#738276',
  textDim:        '#929E93',

  // Borders
  border:         '#DCE5DC',
  borderLight:    '#C9D8CB',

  // Semantic states use darker tones that remain legible on light surfaces.
  recoveryHigh:   '#2F855A',
  recoveryMed:    '#A66B18',
  recoveryLow:    '#B94646',

  // Activity / strain / sleep data
  strain:         '#2B7898',
  strainGlow:     '#6F963A',
  sleep:          '#657D91',
  recoveryBlue:   '#347DA0',

  // VYRN brand — confident forest green with a fresh, bright accent system.
  primaryGreen:   '#176B4A',
  primaryBlue:    '#286F91',

  // Coach / intelligence
  coachPurple:    '#7557A6',

  // Semantic
  success: '#2F855A',
  warning: '#A66B18',
  danger:  '#B94646',
  info:    '#286F91',

  // Navigation
  tabActive:   '#176B4A',
  tabInactive: '#7A897E',
  tabBg:       '#FBFCF8',
  tabBorder:   '#DCE5DC',

  // Chat
  userBubble: '#E4EFF5',

  // Achievements
  gold: '#9C6A1B',

  // Nutrition — distinct and readable
  calories: '#B9623A',
  protein:  '#A94E6A',
  carbs:    '#54863C',
  fat:      '#3D779A',
  water:    '#27799E',

  // Shared depth for movement pictogram tiles and 3D detail wells.
  movementTileEnd: '#173B2B',
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
