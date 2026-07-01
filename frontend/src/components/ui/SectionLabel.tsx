// VYRN — SectionLabel primitive
//
// The small icon + eyebrow row at the top of nearly every card
// ("TODAY'S DECISION", "COACH INSIGHT", "MISSION FOCUS"...) plus an
// optional right-aligned action link ("Why this plan? >"). Standardizes
// icon size, letter-spacing, and color so this row never has to be
// hand-built per screen again.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { EYEBROW } from '../../theme/typography';
import { SPACING } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';

interface SectionLabelProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function SectionLabel({
  label,
  icon,
  color = COLORS.textSecondary,
  actionLabel,
  onAction,
  style,
}: SectionLabelProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.left}>
        {icon && <Ionicons name={icon} size={ICON_SIZE.sm} color={color} />}
        <Text style={[styles.label, { color }]} numberOfLines={1}>{label}</Text>
      </View>
      {!!actionLabel && !!onAction && (
        <TouchableOpacity onPress={onAction} activeOpacity={0.6} style={styles.action}>
          <Text style={[styles.actionText, { color }]}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={ICON_SIZE.xs} color={color} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm + 2,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs + 2 },
  label: { ...EYEBROW },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionText: { ...EYEBROW, fontSize: 11 },
});
