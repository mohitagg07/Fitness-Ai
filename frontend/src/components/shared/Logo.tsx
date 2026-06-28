// NeuroFit AI — Logo component
//
// Brand system built from the poster's identity:
//   - Green (#16EC06) → Blue (#0093E7) gradient (exact WHOOP accent colors)
//   - Three-part NEURO / FIT / AI hierarchy: NEURO in white, FIT in gradient, AI in blue
//   - Diagonal-cut badge mark: rounded square with one cut corner, dumbbell negative-space
//
// Four sizes cover every use case:
//   sm  → tab bar / inline header
//   md  → screen headers
//   lg  → login screen
//   xl  → splash screen
//
// Props:
//   showBadge   — false for screens that already have a hero visual (splash)
//   showWordmark— hide the text wordmark, badge-only
//   vertical    — stack badge above wordmark (login screen center layout)

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

type LogoSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<LogoSize, {
  badge: number;
  wordmark: number;
  ai: number;
  gap: number;
}> = {
  sm: { badge: 28, wordmark: 15, ai: 8,  gap: 8  },
  md: { badge: 40, wordmark: 20, ai: 10, gap: 10 },
  lg: { badge: 56, wordmark: 28, ai: 13, gap: 12 },
  xl: { badge: 84, wordmark: 38, ai: 16, gap: 16 },
};

export default function Logo({
  size = 'md',
  showWordmark = true,
  showBadge = true,
  vertical = false,
}: {
  size?: LogoSize;
  showWordmark?: boolean;
  /** Hide the badge — for screens that already have a hero visual */
  showBadge?: boolean;
  /** Stack badge above wordmark (login / centered layouts) */
  vertical?: boolean;
}) {
  const s = SIZE_MAP[size];

  return (
    <View style={[styles.row, vertical && styles.column, { gap: s.gap }]}>
      {showBadge && <LogoBadge size={s.badge} />}
      {showWordmark && (
        <View style={vertical ? styles.wordmarkCenter : undefined}>
          <View style={styles.wordmarkRow}>
            <Text
              style={[styles.neuro, { fontSize: s.wordmark }]}
              allowFontScaling={false}
            >
              NEURO
            </Text>
            <GradientFit fontSize={s.wordmark} />
            <Text
              style={[styles.ai, { fontSize: s.ai }]}
              allowFontScaling={false}
            >
              AI
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
// Rounded square with a diagonal-cut bottom-right corner (nods at barbell-plate
// geometry without trying to render a literal barbell at icon size).
// Dumbbell mark is negative-space strokes on the gradient fill.
function LogoBadge({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%"   stopColor={COLORS.recoveryHigh} />
          <Stop offset="100%" stopColor={COLORS.strain} />
        </LinearGradient>
      </Defs>

      {/* Rounded square, bottom-right corner diagonally cut */}
      <Path
        d="M 18 4 H 82 A 14 14 0 0 1 96 18 V 62 L 62 96 H 18 A 14 14 0 0 1 4 82 V 18 A 14 14 0 0 1 18 4 Z"
        fill="url(#badgeGrad)"
      />

      {/* Negative-space dumbbell — horizontal bar + end caps + outer plates */}
      <Path
        d="M 26 50 H 74 M 26 38 V 62 M 74 38 V 62 M 18 42 V 58 M 82 42 V 58"
        stroke={COLORS.background}
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

// ── Gradient "FIT" wordmark ───────────────────────────────────────────────────
// React Native Text doesn't support gradient fills — SVG Text does natively,
// and react-native-svg is already installed. Zero new dependencies.
function GradientFit({ fontSize }: { fontSize: number }) {
  // Generous width estimate so the last letter never clips inside the viewBox
  const width  = 3 * fontSize * 0.72 + 16;
  const height = fontSize * 1.4;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="fitGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={COLORS.recoveryHigh} />
          <Stop offset="100%" stopColor={COLORS.strain} />
        </LinearGradient>
      </Defs>
      <SvgText
        x={width / 2}
        y={height * 0.76}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="800"
        letterSpacing={1}
        fill="url(#fitGrad)"
        fontFamily={FONTS.logo as string}
      >
        FIT
      </SvgText>
    </Svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center' },
  column:        { flexDirection: 'column', alignItems: 'center' },
  wordmarkCenter:{ alignItems: 'center' },
  wordmarkRow:   { flexDirection: 'row', alignItems: 'center' },

  neuro: {
    color:       COLORS.text,
    fontFamily:  FONTS.logo as string,
    fontWeight:  '800',
    letterSpacing: 1,
  },
  ai: {
    color:       COLORS.strain,
    fontFamily:  FONTS.logo as string,
    fontWeight:  '700',
    letterSpacing: 2,
    marginLeft:  4,
    alignSelf:   'flex-end',
    paddingBottom: 2,
  },
});
