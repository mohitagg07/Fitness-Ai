/**
 * VYRN Adaptive Performance System — Design System
 * Modeled directly on WHOOP's official Brand & Design Guidelines:
 * https://developer.whoop.com/docs/developing/design-guidelines/
 *
 * Typography: Proxima Nova for words, DIN Pro (tabular) for numbers —
 * we use Inter as the closest free equivalent for words and a
 * monospace-leaning system font for numbers (see theme/typography.ts).
 *
 * Color: pitch-black canvas, three-color Recovery vocabulary
 * (Green/Yellow/Red), Strain Blue, Sleep Blue — exactly as WHOOP
 * defines them, re-themed slightly for VYRN's own accent.
 */

export const COLORS = {
  // ── Canvas ──────────────────────────────────────────────
  background:     '#000000',   // WHOOP "Cod Gray" / pitch black
  backgroundTop:  '#101518',   // WHOOP background gradient start
  backgroundBot:  '#283339',   // WHOOP background gradient end
  card:           '#0D0D0D',
  cardElevated:   '#161616',
  cardBorder:     '#1F1F1F',
  inputBg:        '#161616',

  // ── Text ────────────────────────────────────────────────
  text:           '#FFFFFF',
  textSecondary:  '#9A9A9A',
  textMuted:      '#5C5C5C',
  textDim:        '#3A3A3A',

  // ── Borders ─────────────────────────────────────────────
  border:         '#1F1F1F',
  borderLight:    '#2A2A2A',

  // ── WHOOP Recovery vocabulary — exact official hex values ──
  recoveryHigh:   '#16EC06',   // 67-100%  High Recovery (green)
  recoveryMed:    '#FFDE00',   // 34-66%   Medium Recovery (yellow)
  recoveryLow:    '#FF0026',   // 0-33%    Low Recovery (red)

  // ── WHOOP Strain / Sleep / CTA colors ──────────────────
  strain:         '#0093E7',   // Strain Blue — activity, exertion
  strainGlow:     '#00F19F',   // Teal — CTAs, highlights, positive evals
  sleep:          '#7BA1BB',   // Sleep — muted blue-gray
  recoveryBlue:   '#67AEE6',   // Recovery data without valuation

  // ── VYRN brand accent ──
  primaryGreen:   '#16EC06',   // = recoveryHigh, single source of truth
  primaryBlue:    '#0093E7',   // = strain

  // ── Coach / intelligence accent ──────────────────────────
  // Purple is reserved exclusively for "the coach is thinking" surfaces
  // (Coach Insight tile, confidence signals) so it stays a distinct,
  // legible fourth accent alongside green/blue/yellow rather than
  // another shade competing with the recovery vocabulary above.
  coachPurple:    '#8B5CF6',

  // ── Semantic ────────────────────────────────────────────
  success:  '#16EC06',
  warning:  '#FFDE00',
  danger:   '#FF0026',
  info:     '#0093E7',

  // ── Tab bar ─────────────────────────────────────────────
  tabActive:   '#16EC06',
  tabInactive: '#4A4A4A',
  tabBg:       '#000000',
  tabBorder:   '#1A1A1A',

  // ── Chat ────────────────────────────────────────────────
  userBubble: '#0093E730',

  // ── Macros (kept distinct from Recovery vocabulary on purpose) ──
  calories: '#FF6B35',
  protein:  '#FF0026',
  carbs:    '#16EC06',
  fat:      '#0093E7',
  water:    '#67AEE6',
};

/** Returns the WHOOP-standard Recovery color for a 0-100 score. */
export function recoveryColor(score: number): string {
  if (score >= 67) return COLORS.recoveryHigh;
  if (score >= 34) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

export function recoveryLabel(score: number): string {
  if (score >= 67) return 'HIGH RECOVERY';
  if (score >= 34) return 'MEDIUM RECOVERY';
  return 'LOW RECOVERY';
}

export const alpha = (hex: string, opacity: number): string => {
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
};