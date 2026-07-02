// VYRN — MetricChip primitive
//
// The small "icon + label + value" tile used inside the AI Readiness Hero
// (Recovery 84% / Sleep 7h42m / Protein 176g / Fatigue Low) and anywhere
// else a screen needs to show one labeled data point without a full ring
// or card. One flat row layout, one column layout — never a bespoke
// per-screen version of the same idea.
import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import Text from './Text';
import { RADIUS } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';

interface MetricChipProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export default function MetricChip({ icon, label, value, color = COLORS.textSecondary, style }: MetricChipProps) {
  return (
    <View style={[styles.wrap, style]}>
      {icon && (
        <View style={[styles.iconWrap, { backgroundColor: alpha(color, 0.14) }]}>
          <Ionicons name={icon} size={ICON_SIZE.sm} color={color} />
        </View>
      )}
      <Text variant="caption" color={COLORS.textMuted} style={styles.label} numberOfLines={1}>{label}</Text>
      <Text variant="body" weight="bold" numeric color={COLORS.text} style={styles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', gap: 4 },
  iconWrap: {
    width: 32, height: 32, borderRadius: RADIUS.badge,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  label: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 9 },
  value: { fontSize: 13 },
});
