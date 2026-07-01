// VYRN — Logo component
//
// Brand system matching the VYRN Adaptive Performance System identity:
//   - Lime green (#7CFF00) → Electric blue (#28B8FF) gradient
//   - Three-part V / Y / RN hierarchy: V in white, Y in gradient, RN in white
//   - Chevron/lightning mark: stylized V-bolt SVG emblem
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
  sm: { badge: 42, wordmark: 20, gap: 6  },
  md: { badge: 58, wordmark: 26, gap: 7  },
  lg: { badge: 76, wordmark: 34, gap: 9  },
  xl: { badge: 188, wordmark: 44, gap: 16 },
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
      {showBadge && (
        <View style={styles.badgeGlow}>
          <LogoBadge size={s.badge} />
        </View>
      )}
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
// Circular emblem with a stylized V-chevron (lightning bolt) mark.
// Matches the visual weight of the VYRN PNG logo.
function LogoBadge({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="vyrnBadgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%"   stopColor="#7CFF00" />
          <Stop offset="100%" stopColor="#28B8FF" />
        </LinearGradient>
        <LinearGradient id="vyrnRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%"   stopColor="#7CFF00" stopOpacity="0.6" />
          <Stop offset="100%" stopColor="#28B8FF" stopOpacity="0.6" />
        </LinearGradient>
      </Defs>

      {/* Outer ring */}
      <Circle cx="50" cy="50" r="46" fill="none" stroke="url(#vyrnRingGrad)" strokeWidth="2.5" />

      {/* Inner dark circle */}
      <Circle cx="50" cy="50" r="42" fill="#0A0A0A" />

      {/* Chevron / V-bolt mark — left arm (green side) */}
      <Path
        d="M 26 28 L 50 68 L 50 52 L 38 28 Z"
        fill="#7CFF00"
        opacity="0.95"
      />
      {/* Chevron / V-bolt mark — right arm (blue side) */}
      <Path
        d="M 74 28 L 50 68 L 50 52 L 62 28 Z"
        fill="#28B8FF"
        opacity="0.95"
      />
      {/* Center overlap blend */}
      <Path
        d="M 44 52 L 50 68 L 56 52 L 50 40 Z"
        fill="url(#vyrnBadgeGrad)"
        opacity="0.9"
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

  // Soft brand-color glow behind the badge so it reads as a considered
  // emblem rather than a flat icon sitting on the black canvas.
  badgeGlow: {
    shadowColor: '#28B8FF',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },

  letterWhite: {
    color:         COLORS.text,
    fontFamily:    FONTS.logo as string,
    fontWeight:    '800',
    // Tighter than the previous pass — closer kerning reads as a single
    // considered wordmark rather than individually-set placeholder caps.
    letterSpacing: -0.6,
  },
});