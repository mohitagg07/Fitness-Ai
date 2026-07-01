/**
 * VYRN — Spacing & Radius scale
 *
 * Formalizes the 4pt grid that was already implicit across the app
 * (most padding/margin/gap values were already 4, 8, 12, 16, 24...,
 * just spelled out as raw numbers in every file). Screens should pull
 * from here instead of writing new magic numbers, the same way colors
 * come from theme/colors.ts.
 */

export const SPACING = {
  xs: 4,   // icon-to-label gaps, tight inline spacing
  sm: 8,   // gaps within a row, small badge padding
  md: 12,  // gap between stacked cards, comfortable inner gaps
  lg: 16,  // card padding, screen-edge margins
  xl: 24,  // section padding, gaps between distinct zones
  xxl: 32, // rare — generous breathing room (empty/error states)
};

export const RADIUS = {
  badge: 8,    // small pills/badges (phase badge, rescheduled tag)
  button: 12,  // buttons and CTAs
  card: 16,    // all cards — one radius for every card on a screen
};