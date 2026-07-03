// VYRN — Badge primitive
//
// A status readout: one small dot (optional) + one short label. Used for
// confidence readouts, streak counters, phase tags — anywhere the app
// needs to state a status in ≤2 words. Not tappable (see Chip for the
// tappable equivalent).
//
// Deliberately borderless by default. An outlined pill with a tinted
// fill reads as a UI "box" competing with the card around it — on a
// premium dark canvas, color + a dot carries the same meaning without
// drawing a shape. `outline` and `solid` still exist for the rare case
// that genuinely needs a contained pill (e.g. a tappable-looking filter).

import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS, SPACING } from '../../theme/spacing';

interface BadgeProps {
  label: string;
  color?: string;
  variant?: 'solid' | 'outline' | 'subtle';
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function Badge({
  label,
  color = COLORS.primaryGreen,
  variant = 'subtle',
  dot = true,
  style,
}: BadgeProps) {
  // 'subtle' (default) — no fill, no border. Just a dot + label sitting
  // directly on the card, the way a status readout should feel.
  if (variant === 'subtle') {
    return (
      <View style={[styles.plainWrap, style]}>
        {dot && <View style={[styles.dot, { backgroundColor: color }]} />}
        <Text style={[styles.plainLabel, { color }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  }

  const isSolid = variant === 'solid';
  const bg = isSolid ? color : 'transparent';
  const textColor = isSolid ? '#000000' : color;

  return (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor: alpha(color, 0.35) }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: isSolid ? '#000000' : color }]} />}
      <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Borderless default — sits flush with the card, no boxed pill.
  plainWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
  },
  plainLabel: {
    fontFamily: FONTS.semibold,
    fontWeight: '600',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Contained pill — only for 'outline' and 'solid'.
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: 5,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: RADIUS.badge,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: FONTS.bold,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
