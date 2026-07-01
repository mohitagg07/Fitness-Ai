// VYRN — Chip primitive
//
// The tappable counterpart to Badge: coach suggestion chips, equipment
// picker tags, progress tab filters, food-preference options. Anything
// the user can select/toggle/tap-to-send is a Chip, never a raw
// TouchableOpacity + custom pill styling on the screen itself.

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';

interface ChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function Chip({
  label,
  icon,
  selected = false,
  onPress,
  color = COLORS.primaryGreen,
  disabled,
  style,
}: ChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.wrap,
        {
          backgroundColor: selected ? alpha(color, 0.16) : COLORS.cardElevated,
          borderColor: selected ? color : COLORS.border,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={ICON_SIZE.xs} color={selected ? color : COLORS.textSecondary} />}
      <Text style={[styles.label, { color: selected ? color : COLORS.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingVertical: 9,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.badge + 4,
    borderWidth: 1,
  },
  label: {
    fontFamily: FONTS.medium,
    fontWeight: '600',
    fontSize: 13,
  },
});
