// VYRN — ProgressBar primitive
//
// One horizontal fill-bar implementation for every "progress toward a
// target" readout that isn't a ring: weekly consistency (5/7), streak
// milestones (7/14 days), XP-to-next-level, program-health bars. Animates
// its fill on mount/update so progress never just snaps into place.
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../../theme/colors';

interface ProgressBarProps {
  /** 0–100 */
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  style?: any;
}

export default function ProgressBar({
  progress,
  color = COLORS.primaryGreen,
  trackColor = COLORS.cardElevated,
  height = 6,
  style,
}: ProgressBarProps) {
  const animated = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(animated, {
      toValue: Math.max(0, Math.min(100, progress)),
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [progress]);
  const width = animated.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: trackColor }, style]}>
      <Animated.View style={[styles.fill, { width, height, borderRadius: height / 2, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0 },
});
