// VYRN — Card primitive
//
// Every card in the app — dashboard tiles, coach response cards, PR rows,
// nutrition cards, insight banners — must render through this component.
// Five variants cover every real case we have; if a screen needs a sixth,
// that's a sign the layout problem should be solved with props here, not
// with a new one-off <View style={...}> on that screen.

import React from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ELEVATION } from '../../theme/layout';

export type CardVariant = 'flat' | 'elevated' | 'outlined' | 'accent' | 'gradient';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING_MAP: Record<CardPadding, number> = {
  none: 0,
  sm: SPACING.md,   // 12 — dense rows (PR list, chip rows)
  md: SPACING.lg,   // 16 — default for most cards
  lg: SPACING.xl,   // 24 — hero / primary CTA cards
};

interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  /** Required for 'accent' (left bar / tint) and 'gradient' (fill) variants. */
  accentColor?: string;
  /** Second gradient stop — defaults to accentColor at lower opacity if omitted. */
  accentColorTo?: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}

export default function Card({
  variant = 'flat',
  padding = 'md',
  accentColor = COLORS.primaryGreen,
  accentColorTo,
  onPress,
  disabled,
  style,
  children,
  testID,
}: CardProps) {
  const pad = PADDING_MAP[padding];
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, disabled, activeOpacity: 0.75, testID }
    : { testID };

  if (variant === 'gradient') {
    return (
      <Wrapper {...wrapperProps} style={[styles.base, { padding: pad, borderWidth: 0 }, ELEVATION.glow(accentColor) as any, style]}>
        <LinearGradient
          colors={[accentColor, accentColorTo || alpha(accentColor, 0.55)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </Wrapper>
    );
  }

  const variantStyle: ViewStyle =
    variant === 'elevated'
      ? { backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, ...ELEVATION.low }
      : variant === 'outlined'
      ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.borderLight }
      : variant === 'accent'
      ? {
          backgroundColor: COLORS.card,
          borderWidth: 1,
          borderColor: alpha(accentColor, 0.3),
          borderLeftWidth: 3,
          borderLeftColor: accentColor,
        }
      : { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder }; // flat

  return (
    <Wrapper {...wrapperProps} style={[styles.base, { padding: pad }, variantStyle, style]}>
      {children}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.card,
    overflow: 'hidden',
  },
});
