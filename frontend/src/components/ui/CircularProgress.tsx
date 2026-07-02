// VYRN — CircularProgress primitive
//
// One ring implementation for every circular-progress use on the app:
// the header Readiness Score, the "This Week" workout ring, and any
// future score dial. Takes a `center` render prop instead of hard-coding
// a score readout, so each call site controls its own center content
// (a number + arrow, a "5/7" fraction, whatever) without forking the SVG.

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { COLORS } from '../../theme/colors';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface CircularProgressProps {
  /** 0–100 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  glow?: boolean;
  center?: React.ReactNode;
}

export default function CircularProgress({
  progress,
  size = 90,
  strokeWidth = 8,
  color = COLORS.primaryGreen,
  trackColor = COLORS.cardElevated,
  glow = true,
  center,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const animated = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animated, {
      toValue: Math.max(0, Math.min(100, progress)),
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const strokeDashoffset = animated.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View
        style={[
          glow && styles.glow,
          { width: size, height: size, borderRadius: size / 2, shadowColor: color },
        ]}
      >
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={trackColor} strokeWidth={strokeWidth} fill="none"
          />
          <AnimatedCircle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            fill="none"
            rotation="-90"
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
      </View>
      {!!center && <View style={styles.center} pointerEvents="none">{center}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
