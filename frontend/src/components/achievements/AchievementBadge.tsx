// VYRN — AchievementBadge
//
// The hexagon icon used to represent an unlocked achievement, shared by
// the permanent dashboard AchievementCard and the fullscreen
// AchievementCelebration modal so the same "trophy shape" never gets
// redrawn twice with slightly different geometry.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';

interface AchievementBadgeProps {
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  size?: number;
}

// Regular hexagon points for a given size, pointy-top orientation.
function hexPoints(size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

export default function AchievementBadge({
  icon = 'flame',
  color = COLORS.gold,
  size = 72,
}: AchievementBadgeProps) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Polygon
          points={hexPoints(size)}
          fill={alpha(color, 0.14)}
          stroke={color}
          strokeWidth={2}
        />
      </Svg>
      <Ionicons name={icon} size={size * 0.42} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
