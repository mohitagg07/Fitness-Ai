import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { COLORS, recoveryColor, recoveryLabel, alpha } from '../../theme/colors';
import { HEADLINE, SCORE_DISPLAY } from '../../theme/typography';

/**
 * WHOOP-style circular Recovery ring. Score 0-100, color interpolates
 * across the official Green/Yellow/Red Recovery vocabulary, animates in
 * on mount, glows via a soft drop-shadow instead of a hard border.
 */
export default function RecoveryRing({
  score,
  label = 'RECOVERY',
  size = 220,
  strokeWidth = 16,
}: {
  score: number;
  label?: string;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = recoveryColor(score);

  const animated = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animated, {
      toValue: score,
      duration: 1100,
      useNativeDriver: false,
    }).start();
  }, [score]);

  const strokeDashoffset = animated.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View
        style={[
          styles.glow,
          {
            width: size, height: size, borderRadius: size / 2,
            shadowColor: color,
          },
        ]}
      >
        <Svg width={size} height={size}>
          {/* Track */}
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={COLORS.cardElevated}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress */}
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

      <View style={styles.centerContent}>
        <Text style={[styles.score, { color }]}>{Math.round(score)}</Text>
        <Text style={styles.percent}>%</Text>
        <Text style={[styles.label, { color: alpha(color, 0.9) }]}>{label}</Text>
      </View>
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  centerContent: { alignItems: 'center', justifyContent: 'center' },
  score: {
    ...SCORE_DISPLAY,
    fontSize: 56,
    lineHeight: 60,
  },
  percent: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontWeight: '600',
    marginTop: -6,
  },
  label: {
    ...HEADLINE,
    fontSize: 11,
    marginTop: 8,
  },
});
