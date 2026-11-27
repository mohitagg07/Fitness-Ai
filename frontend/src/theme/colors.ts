/**
 * VYRN — Quiet Performance visual system.
 *
 * A near-black mineral canvas gives training data depth. Acid-lime is reserved
 * for actions and positive readiness; ultraviolet and ice-blue are secondary
 * intelligence signals, never competing for the same visual priority.
 */
export const COLORS = {
  // Deep ink canvas and layered graphite surfaces.
  background:     '#080B11',
  backgroundTop:  '#101722',
  backgroundBot:  '#080D14',
  card:           '#111823',
  cardElevated:   '#182230',
  cardBorder:     '#293747',
  inputBg:        '#0D141E',

  // Warm, high-contrast type with restrained secondary hierarchy.
  text:           '#F4F5EF',
  textSecondary:  '#B3BECA',
  textMuted:      '#7F8D9C',
  textDim:        '#596878',

  // Borders carry structure without looking like wireframes.
  border:         '#263342',
  borderLight:    '#35475A',

  // Recovery semantics: lime / amber / coral.
  recoveryHigh:   '#CFFF66',
  recoveryMed:    '#FFC66D',
  recoveryLow:    '#FF7487',

  // Performance / recovery data families.
  strain:         '#69D5F5',
  strainGlow:     '#D7FF55',
  sleep:          '#B5A2FF',
  recoveryBlue:   '#70BFFF',

  // VYRN action accent — luminous, not radioactive.
  primaryGreen:   '#D0FF55',
  primaryBlue:    '#69D5F5',

  // Intelligence is deliberately violet, distinct from performance.
  coachPurple:    '#B7A0FF',

  // Semantic aliases.
  success: '#CFFF66',
  warning: '#FFC66D',
  danger:  '#FF7487',
  info:    '#69D5F5',

  // Floating bottom navigation.
  tabActive:   '#D0FF55',
  tabInactive: '#778596',
  tabBg:       '#0B111A',
  tabBorder:   '#202C3A',

  // Chat.
  userBubble: '#1C2A3A',

  // Achievements.
  gold: '#EBC977',

  // Nutrition data — distinct hues that stay readable on graphite.
  calories: '#FF9C78',
  protein:  '#F08CB6',
  carbs:    '#D0FF55',
  fat:      '#72C9F4',
  water:    '#62D0F4',

  // Movement visual wells.
  movementTileEnd: '#09131C',
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
