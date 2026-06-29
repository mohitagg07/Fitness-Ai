/**
 * VYRN — Typography
 *
 * WHOOP's actual brand uses Proxima Nova (words) and DIN Pro (numbers) —
 * both are commercial, licensed fonts we can't legally bundle into this
 * app. Inter and Space Grotesk are the real, free (MIT/OFL) replacements
 * actually wired in below — not a placeholder, these are loaded via
 * @expo-google-fonts and embedded as real font files through the
 * expo-font config plugin (see app.json).
 *
 * - Inter: words — headlines, labels, body text. Closest free equivalent
 *   to Proxima Nova's clean, neutral, highly-legible geometry.
 * - Space Grotesk: numbers — scores, weights, reps, calories. Distinctive
 *   geometric digits with true tabular alignment, closer to DIN Pro's
 *   technical/instrumented feel than a generic system font.
 *
 * IMPORTANT: these fontFamily strings only resolve correctly once
 * useFonts() in app/_layout.tsx has finished loading (see ensureFontsLoaded
 * below). Until then, RN silently falls back to the platform default,
 * which is fine — it's a graceful degradation, not a crash.
 */
import { Platform } from 'react-native';

export const FONTS = {
  // Words — headlines, labels, body text
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',

  // Numbers — scores, weights, reps. Space Grotesk's digits are
  // genuinely distinctive (the zero, in particular) and stay visually
  // aligned in a column, which matters for stacked stats (e.g. PR list).
  numericRegular: 'SpaceGrotesk_400Regular',
  numericMedium: 'SpaceGrotesk_500Medium',
  numericSemibold: 'SpaceGrotesk_600SemiBold',
  numericBold: 'SpaceGrotesk_700Bold',

  // Logo wordmark only. Ethnocentric (the look in the brand reference) is
  // a commercial font we can't bundle — this is a deliberate, restrained
  // system fallback used in exactly one place (the <Logo> component), not
  // a silent substitution pretending to be something else.
  logo: Platform.select({ ios: 'System', android: 'sans-serif-black', default: 'System' }),

  // Legacy aliases — kept so any code still importing FONTS.body /
  // FONTS.numeric (the old shape of this file) doesn't break.
  body: 'Inter_400Regular',
  numeric: 'SpaceGrotesk_500Medium',
};

/**
 * Pass directly to useFonts() in the root layout. Must be loaded before
 * any screen renders text using the FONTS family names above.
 */
export const FONT_ASSETS = {
  Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  Inter_800ExtraBold: require('@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf'),
  Inter_900Black: require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'),
  SpaceGrotesk_400Regular: require('@expo-google-fonts/space-grotesk/400Regular/SpaceGrotesk_400Regular.ttf'),
  SpaceGrotesk_500Medium: require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
  SpaceGrotesk_600SemiBold: require('@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
  SpaceGrotesk_700Bold: require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
};

// WHOOP headline spec: Bold, ALL CAPS, ~10% letter-spacing.
export const HEADLINE = {
  fontFamily: FONTS.bold,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: 1.2, // ~10% of a ~12-13px label
};

// Big numeric score style (e.g. Recovery %, Strain, CNS Fatigue).
export const SCORE_DISPLAY = {
  fontFamily: FONTS.numericBold,
  fontWeight: '800' as const,
  fontVariant: ['tabular-nums'] as const,
};

// Body copy — the default for ordinary sentences and descriptions.
export const BODY = {
  fontFamily: FONTS.regular,
};

// Section/card labels — small, muted, letter-spaced eyebrow text.
export const EYEBROW = {
  fontFamily: FONTS.bold,
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 1.5,
  textTransform: 'uppercase' as const,
};