// VYRN — Button primitive
//
// Four variants, three sizes. Every tappable action button in the app —
// "Start Push Workout", "Log Set", "Open Coach", "Save Changes", "Log Out"
// — renders through this component so weight, radius, and label case never
// drift screen to screen again.

import React from 'react';
import {
  TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, StyleProp,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ICON_SIZE } from '../../theme/layout';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accentColor?: string; // overrides the green fill/border for primary/secondary/ghost
  style?: StyleProp<ViewStyle>;
}

const SIZE_MAP: Record<ButtonSize, { paddingV: number; paddingH: number; fontSize: number; iconSize: number }> = {
  sm: { paddingV: 8, paddingH: 14, fontSize: 12, iconSize: ICON_SIZE.xs },
  md: { paddingV: 13, paddingH: 20, fontSize: 14, iconSize: ICON_SIZE.sm },
  lg: { paddingV: 17, paddingH: 26, fontSize: 15, iconSize: ICON_SIZE.sm },
};

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  disabled,
  loading,
  fullWidth,
  accentColor = COLORS.primaryGreen,
  style,
}: ButtonProps) {
  const s = SIZE_MAP[size];
  const isDisabled = disabled || loading;

  const textColor =
    variant === 'primary' ? '#000000'
    : variant === 'danger' ? COLORS.text
    : accentColor;

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {icon && iconPosition === 'left' && <Ionicons name={icon} size={s.iconSize} color={textColor} />}
          <Text
            style={[styles.label, { color: textColor, fontSize: s.fontSize }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {icon && iconPosition === 'right' && <Ionicons name={icon} size={s.iconSize} color={textColor} />}
        </>
      )}
    </>
  );

  const shape: ViewStyle = {
    paddingVertical: s.paddingV,
    paddingHorizontal: s.paddingH,
    borderRadius: RADIUS.button,
    opacity: isDisabled ? 0.5 : 1,
    width: fullWidth ? '100%' : undefined,
  };

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[styles.base, shape, style]}
      >
        <LinearGradient
          colors={[accentColor, alpha(accentColor, 0.7)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {content}
      </TouchableOpacity>
    );
  }

  if (variant === 'danger') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[styles.base, shape, { backgroundColor: COLORS.recoveryLow }, style]}
      >
        {content}
      </TouchableOpacity>
    );
  }

  if (variant === 'secondary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.7}
        style={[
          styles.base, shape,
          { backgroundColor: 'transparent', borderWidth: 1, borderColor: alpha(accentColor, 0.5) },
          style,
        ]}
      >
        {content}
      </TouchableOpacity>
    );
  }

  // ghost
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.6}
      style={[styles.base, shape, { backgroundColor: alpha(accentColor, 0.1) }, style]}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs + 2,
  },
  label: {
    fontFamily: FONTS.bold,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
