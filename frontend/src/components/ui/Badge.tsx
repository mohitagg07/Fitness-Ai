// VYRN — Badge primitive
//
// A status pill: one small dot (optional) + one short label. Used for
// "PHASE 1" in the header, "Fresh" under CNS Load, confidence readouts,
// streak counters — anywhere the app needs to state a status in ≤2 words.
// Not tappable (see Chip for the tappable equivalent).

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
  const bg =
    variant === 'solid' ? color
    : variant === 'outline' ? 'transparent'
    : alpha(color, 0.14); // subtle
  const border = variant === 'outline' ? color : alpha(color, 0.3);
  const textColor = variant === 'solid' ? '#000000' : color;

  return (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor: border }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: variant === 'solid' ? '#000000' : color }]} />}
      <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
