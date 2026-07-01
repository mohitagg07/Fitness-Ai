// VYRN — Logo component
//
// Brand system matching the VYRN Adaptive Performance System identity:
//   - Lime green (#7CFF00) → Electric blue (#28B8FF) gradient
//   - Three-part V / Y / RN hierarchy: V in white, Y in gradient, RN in white
//   - Checkmark-weight "V" mark inside a gradient ring emblem
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
import Svg, { Defs, LinearGradient, Stop, Path, Circle, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

type LogoSize = 'sm' | 'md' | 'lg' | 'xl';

// Sizes bumped up again for the final balance pass — the badge was
// still reading as a small icon dropped next to text rather than a
// mark with real presence. Wordmark sizes scaled up to match, gaps
// tightened further so the badge and wordmark read as one lockup.
const SIZE_MAP: Record<LogoSize, {
  badge: number;
  wordmark: number;
  gap: number;
}> = {
  sm: { badge: 34, wordmark: 19, gap: 9  },
  md: { badge: 44, wordmark: 24, gap: 10 },
  lg: { badge: 64, wordmark: 32, gap: 12 },
  xl: { badge: 156, wordmark: 42, gap: 16 },
};

export default function Logo({
  size = 'md',
  showWordmark = true,
  showBadge = true,
  vertical = false,
}: {
  size?: LogoSize;
  showWordmark?: boolean;
  showBadge?: boolean;
  vertical?: boolean;
}) {
  const s = SIZE_MAP[size];

  return (
    <View style={[styles.row, vertical && styles.column, { gap: s.gap }]}>
      {showBadge && <LogoBadge size={s.badge} />}
      {showWordmark && (
        <View style={vertical ? styles.wordmarkCenter : undefined}>
          <View style={styles.wordmarkRow}>
            {/* V — white */}
            <Text
              style={[styles.letterWhite, { fontSize: s.wordmark }]}
              allowFontScaling={false}
            >
              V
            </Text>
            {/* Y — gradient green→blue */}
            <GradientY fontSize={s.wordmark} />
            {/* RN — white */}
            <Text
              style={[styles.letterWhite, { fontSize: s.wordmark }]}
              allowFontScaling={false}
            >
              RN
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
// Single-stroke "V" checkmark mark inside a gradient ring — this is the
// one canonical brand mark (matches the reference brand sheet exactly:
// a bold checkmark-weight V, diagonal green→blue fill, thin gradient
// ring outline, small motion flick off the top-right stroke). Every
// screen's header renders this exact SVG at a different size — never a
// re-drawn or re-interpreted version of it.
function LogoBadge({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="vyrnBadgeGrad" x1="10%" y1="10%" x2="90%" y2="90%">
          <Stop offset="0%"   stopColor="#7CFF00" />
          <Stop offset="100%" stopColor="#28B8FF" />
        </LinearGradient>
        <LinearGradient id="vyrnRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%"   stopColor="#7CFF00" />
          <Stop offset="100%" stopColor="#28B8FF" />
        </LinearGradient>
      </Defs>

      {/* Outer ring */}
      <Circle cx="50" cy="50" r="46" fill="none" stroke="url(#vyrnRingGrad)" strokeWidth="2.5" />

      {/* Inner dark circle */}
      <Circle cx="50" cy="50" r="41.5" fill="#0A0A0A" />

      {/* Single bold checkmark-weight "V" stroke, diagonal gradient fill */}
      <Path
        d="M 30 30 L 50 66 L 70 30 L 60 30 L 50 48 L 40 30 Z"
        fill="url(#vyrnBadgeGrad)"
      />
      {/* Motion flick off the top-right stroke tip */}
      <Path
        d="M 66 26 L 74 22 L 71 30 Z"
        fill="#7CFF00"
        opacity="0.85"
      />
    </Svg>
  );
}

// ── Gradient "Y" letter ───────────────────────────────────────────────────────
// React Native Text doesn't support gradient fills — SVG Text does natively.
function GradientY({ fontSize }: { fontSize: number }) {
  const width  = fontSize * 0.72 + 8;
  const height = fontSize * 1.4;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="vyrnYGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor="#7CFF00" />
          <Stop offset="100%" stopColor="#28B8FF" />
        </LinearGradient>
      </Defs>
      <SvgText
        x={width / 2}
        y={height * 0.76}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="800"
        letterSpacing={-0.6}
        fill="url(#vyrnYGrad)"
        fontFamily={FONTS.logo as string}
      >
        Y
      </SvgText>
    </Svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  row:            { flexDirection: 'row', alignItems: 'center' },
  column:         { flexDirection: 'column', alignItems: 'center' },
  wordmarkCenter: { alignItems: 'center' },
  wordmarkRow:    { flexDirection: 'row', alignItems: 'center' },

  letterWhite: {
    color:         COLORS.text,
    fontFamily:    FONTS.logo as string,
    fontWeight:    '800',
    // Tighter than the previous pass — closer kerning reads as a single
    // considered wordmark rather than individually-set placeholder caps.
    letterSpacing: -0.6,
  },
});
