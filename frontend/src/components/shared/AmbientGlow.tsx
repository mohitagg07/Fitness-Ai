// VYRN — AmbientGlow
//
// The "dynamic backgrounds" layer from the design brief: Recovery gets a
// soft green glow, Workout a slight lime pulse, Coach a purple wash tied
// to "the coach is thinking." Deliberately one absolutely-positioned
// gradient blob, animated only via Reanimated's UI-thread opacity/scale —
// it never touches React state, so it costs nothing extra behind a
// scrolling list, and it never gets louder than ~16% opacity because the
// brief is explicit: "barely visible."
import React, { useEffect } from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, alpha } from '../../theme/colors';

export type AmbientVariant = 'recovery' | 'workout' | 'coach';

interface Props {
  variant: AmbientVariant;
  // 0-100 — only read by the 'recovery' variant, so the glow always
  // matches the same WHOOP red/yellow/green vocabulary used everywhere
  // else, instead of being a fixed color regardless of actual recovery.
  recoveryScore0to100?: number;
}

const { width } = Dimensions.get('window');

function colorFor(variant: AmbientVariant, recoveryScore0to100?: number): string {
  if (variant === 'workout') return COLORS.primaryGreen;
  if (variant === 'coach') return COLORS.coachPurple;
  const score = recoveryScore0to100 ?? 70;
  if (score >= 67) return COLORS.recoveryHigh;
  if (score >= 34) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

export default function AmbientGlow({ variant, recoveryScore0to100 }: Props) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true, // reverse — breathe in, breathe out, never a hard cut
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.10 + pulse.value * 0.06,
    transform: [{ scale: 1 + pulse.value * 0.05 }],
  }));

  const color = colorFor(variant, recoveryScore0to100);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap, animatedStyle]}>
      <LinearGradient
        colors={[alpha(color, 0.35), alpha(color, 0)]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.blob}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  blob: {
    position: 'absolute',
    top: -width * 0.5,
    left: -width * 0.2,
    width: width * 1.4,
    height: width * 1.1,
  },
});
