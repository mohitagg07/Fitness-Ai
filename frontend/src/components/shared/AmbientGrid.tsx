// VYRN — AmbientGrid
//
// Analytics gets "a tiny moving grid" instead of a glow, per the brief —
// the screen is already full of real charts, so the ambient layer here
// stays a near-invisible line grid that drifts, rather than competing
// for attention. One Svg draw, only a translateY animates on the UI
// thread — the lines themselves never re-render.
import React, { useEffect } from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { COLORS, alpha } from '../../theme/colors';

const { width, height } = Dimensions.get('window');
const STEP = 32;

export default function AmbientGrid() {
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.value = withRepeat(withTiming(STEP, { duration: 7000, easing: Easing.linear }), -1, false);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  const rows = Math.ceil(height / STEP) + 2;
  const cols = Math.ceil(width / STEP) + 2;
  const lineColor = alpha(COLORS.strain, 0.06);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap, animatedStyle]}>
      <Svg width={width} height={height + STEP * 2}>
        {Array.from({ length: rows }).map((_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * STEP} x2={width} y2={i * STEP} stroke={lineColor} strokeWidth={1} />
        ))}
        {Array.from({ length: cols }).map((_, i) => (
          <Line key={`v${i}`} x1={i * STEP} y1={0} x2={i * STEP} y2={height + STEP * 2} stroke={lineColor} strokeWidth={1} />
        ))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({ wrap: { overflow: 'hidden' } });
