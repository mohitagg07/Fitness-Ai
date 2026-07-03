// VYRN — Card primitive
//
// Every card in the app — dashboard tiles, coach response cards, PR rows,
// nutrition cards, insight banners — must render through this component.
// Five variants cover every real case we have; if a screen needs a sixth,
// that's a sign the layout problem should be solved with props here, not
// with a new one-off <View style={...}> on that screen.
//
// Two elevation levels: 'standard' (the default — nearly every card) and
// 'hero' (the one primary surface per screen, e.g. AI Readiness). Hero
// gets a slightly brighter border and a deeper, softer shadow so it reads
// as "the main thing" without needing a louder color or a bigger badge.
//
// Every card also fades + rises into place on mount (250–400ms, eased) —
// subtle enough to disappear on repeat visits, present enough that the
// screen never just "pops" into existence. Pass animate={false} to opt
// out (e.g. a card inside a frequently-re-rendering list row).

import React, { useEffect, useRef } from 'react';
import { Animated, TouchableOpacity, StyleSheet, ViewStyle, StyleProp, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ELEVATION } from '../../theme/layout';

export type CardVariant = 'flat' | 'elevated' | 'outlined' | 'accent' | 'gradient';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardElevation = 'standard' | 'hero';

const PADDING_MAP: Record<CardPadding, number> = {
  none: 0,
  sm: SPACING.md,   // 12 — dense rows (PR list, chip rows)
  md: SPACING.xl,   // 24 — default for every card, per spec
  lg: SPACING.xl,   // 24 — hero / primary CTA cards
};

interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  /** 'hero' = the single primary surface on a screen (deeper shadow, brighter edge). */
  elevation?: CardElevation;
  /** Required for 'accent' (left bar / tint) and 'gradient' (fill) variants. */
  accentColor?: string;
  /** Second gradient stop — defaults to accentColor at lower opacity if omitted. */
  accentColorTo?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Fade + rise on mount. Default true; set false inside fast-refreshing lists. */
  animate?: boolean;
  /** Stagger multiple cards fading in one after another (ms). */
  animationDelay?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}

export default function Card({
  variant = 'flat',
  padding = 'md',
  elevation = 'standard',
  accentColor = COLORS.primaryGreen,
  accentColorTo,
  onPress,
  disabled,
  animate = true,
  animationDelay = 0,
  style,
  children,
  testID,
}: CardProps) {
  const pad = PADDING_MAP[padding];
  const isHero = elevation === 'hero';

  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 380,
      delay: animationDelay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mountStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
      },
    ],
  };

  const heroShadow: ViewStyle = isHero
    ? {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.32,
        shadowRadius: 24,
        elevation: 10,
      }
    : {};

  const InnerWrapper = onPress ? TouchableOpacity : Animated.View;
  const innerProps = onPress
    ? { onPress, disabled, activeOpacity: 0.75, testID }
    : { testID };

  if (variant === 'gradient') {
    return (
      <Animated.View style={mountStyle}>
        <InnerWrapper {...innerProps} style={[styles.base, { padding: pad, borderWidth: 0 }, ELEVATION.glow(accentColor) as any, style]}>
          <LinearGradient
            colors={[accentColor, accentColorTo || alpha(accentColor, 0.55)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {children}
        </InnerWrapper>
      </Animated.View>
    );
  }

  const variantStyle: ViewStyle =
    variant === 'elevated'
      ? { backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: isHero ? COLORS.borderLight : COLORS.border, ...ELEVATION.low, ...heroShadow }
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
      : { backgroundColor: COLORS.card, borderWidth: 1, borderColor: isHero ? COLORS.borderLight : COLORS.cardBorder, ...ELEVATION.low, ...heroShadow }; // flat

  return (
    <Animated.View style={mountStyle}>
      <InnerWrapper {...innerProps} style={[styles.base, { padding: pad }, variantStyle, style]}>
        {children}
      </InnerWrapper>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.card,
    overflow: 'hidden',
  },
});
