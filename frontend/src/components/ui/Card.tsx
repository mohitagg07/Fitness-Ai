// VYRN — Card primitive
// Entrance motion is opt-in; keep repeated dashboard surfaces responsive.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, ViewStyle, StyleProp, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ELEVATION } from '../../theme/layout';
import PressableScale from './PressableScale';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export type CardVariant = 'flat' | 'elevated' | 'outlined' | 'accent' | 'gradient';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardElevation = 'standard' | 'hero';

const PADDING_MAP: Record<CardPadding, number> = {
  none: 0,
  sm: SPACING.md,
  md: SPACING.lg,
  lg: SPACING.xl,
};

interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  elevation?: CardElevation;
  accentColor?: string;
  accentColorTo?: string;
  onPress?: () => void;
  disabled?: boolean;
  animate?: boolean;
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
  animate = false,
  animationDelay = 0,
  style,
  children,
  testID,
}: CardProps) {
  const pad = PADDING_MAP[padding];
  const isHero = elevation === 'hero';
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.stopAnimation();
    if (!animate || reduceMotion) {
      progress.setValue(1);
      return undefined;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      delay: Math.max(0, animationDelay),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, animationDelay, progress, reduceMotion]);

  const mountStyle = {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };

  const heroShadow: ViewStyle = isHero
    ? { shadowColor: COLORS.primaryGreen, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.08, shadowRadius: 22, elevation: 5 }
    : {};

  const InnerWrapper = onPress ? PressableScale : Animated.View;
  const innerProps = onPress
    ? { onPress, disabled, testID, accessibilityRole: 'button' as const }
    : { testID };

  if (variant === 'gradient') {
    return (
      <Animated.View style={mountStyle}>
        <InnerWrapper {...innerProps} style={[styles.base, { padding: pad, borderWidth: 0 }, ELEVATION.glow(accentColor) as any, style]}>
          <LinearGradient colors={[accentColor, accentColorTo || alpha(accentColor, 0.55)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
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
      ? { backgroundColor: COLORS.card, borderWidth: 1, borderColor: alpha(accentColor, 0.3), borderLeftWidth: 3, borderLeftColor: accentColor }
      : { backgroundColor: COLORS.card, borderWidth: 1, borderColor: isHero ? COLORS.borderLight : COLORS.cardBorder, ...ELEVATION.low, ...heroShadow };

  return (
    <Animated.View style={mountStyle}>
      <InnerWrapper {...innerProps} style={[styles.base, { padding: pad }, variantStyle, style]}>
        {children}
      </InnerWrapper>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: RADIUS.card, overflow: 'hidden' },
});
