/**
 * VYRN — Layout, elevation & icon tokens
 *
 * The missing piece between spacing.ts (raw numbers) and real screens:
 * this file is the contract every screen header, card stack, and grid
 * must follow so Dashboard / Coach / Workout / Progress / Profile read
 * as one product instead of five. If a screen needs a header, it uses
 * LAYOUT.headerPaddingTop — it does not invent 56, 48, or 60.
 */
import { Platform } from 'react-native';
import { SPACING, RADIUS } from './spacing';

export const LAYOUT = {
  // Screen-level margins — every screen's root ScrollView/View uses this,
  // not ad-hoc paddingHorizontal values (16, 18, 20 were all in use).
  screenMargin: SPACING.lg, // 16

  // Header — status-bar clearance + consistent header block height.
  // Every screen's <Header/> sits at this exact top offset.
  headerPaddingTop: Platform.select({ ios: 54, android: 40, default: 44 }),
  headerPaddingBottom: SPACING.md, // 12
  headerHeight: 56, // logo lockup row height, excludes safe-area padding

  // Vertical rhythm between distinct zones of a screen (hero → stat row →
  // section → section). One value, not a different gap per screen.
  sectionGap: SPACING.xl, // 24

  // Gap between cards stacked within the same section (a group of related
  // tiles). Tighter than sectionGap on purpose — it reads as one cluster.
  cardGap: SPACING.md, // 12

  // Bottom padding so content never sits under the tab bar (66px + margin).
  scrollBottomPad: 100,
};

export const ELEVATION = {
  // Flat card resting on the black canvas — the default for ~90% of cards.
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  // Slightly raised — used for the header bar and sticky/floating pieces.
  low: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  // Reserved for the single primary CTA per screen (Start Workout, Send).
  // Uses the card's own accent color as the glow — passed in by the caller.
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  }),
};

// One icon-sizing scale. An icon inside a Chip is always `xs`, inside a
// Badge always `xs`, inside a section eyebrow always `sm`, inside a card's
// own header always `sm`, a standalone tappable icon (settings, back,
// close) is always `md`, and a hero/empty-state icon is `lg`.
export const ICON_SIZE = {
  xs: 13,
  sm: 16,
  md: 22,
  lg: 28,
};

export { RADIUS };
