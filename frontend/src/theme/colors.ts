// NeuroFit AI — Centralized Color System
// Splash screen already uses these exact values — now everything else does too.

export const COLORS = {
  // Brand
  primaryGreen: '#7ED957',
  primaryBlue:  '#4A9EFF',

  // Backgrounds
  background:   '#0A0A0A',
  card:         '#121212',
  cardBorder:   '#1E1E1E',
  inputBg:      '#1A1A1A',

  // Text
  text:          '#FFFFFF',
  textSecondary: '#A0A0A0',
  textMuted:     '#555555',

  // Borders
  border:        '#1E1E1E',
  borderLight:   '#2A2A2A',

  // Semantic
  success:  '#7ED957',  // = primaryGreen
  info:     '#4A9EFF',  // = primaryBlue
  warning:  '#FF9F0A',
  danger:   '#FF453A',

  // Tab bar
  tabActive:   '#7ED957',
  tabInactive: '#555555',
  tabBg:       '#0A0A0A',
  tabBorder:   '#1E1E1E',

  // Accent for user chat bubble
  userBubble: '#1A3A5F',

  // Macros
  calories: '#FF6B35',
  protein:  '#FF453A',
  carbs:    '#7ED957',
  fat:      '#4A9EFF',
  water:    '#4A9EFF',
};

// Hex with alpha helpers
export const alpha = (hex: string, opacity: number): string => {
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
};
