// VYRN — Button primitive
//
// Four variants, three sizes. Every tappable action button in the app —
// "Start Push Workout", "Log Set", "Open Coach", "Save Changes", "Log Out"
// — renders through this component so weight, radius, and label case never
// drift screen to screen again.
//
// Every button gives a small scale-down on press (0.96, spring back on
// release) on top of the existing opacity dim — the tactile "this is a
// real button" feedback a premium product needs, not just a color change.

import React from 'react';
import {
  Text, StyleSheet, ActivityIndicator, ViewStyle, StyleProp,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ICON_SIZE, ELEVATION } from '../../theme/layout';
import PressableScale from './PressableScale';

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

const SIZE_MAP: Record<ButtonSize, { height: number; paddingH: number; fontSize: number; iconSize: number }> = {
  sm: { height: 42, paddingH: 15, fontSize: 12, iconSize: ICON_SIZE.xs },
  md: { height: 50, paddingH: 20, fontSize: 14, iconSize: ICON_SIZE.sm },
  lg: { height: 58, paddingH: 24, fontSize: 15, iconSize: ICON_SIZE.sm },
};

// Rendered dozens of times per screen (every CTA, card action, and form
// control in the app goes through this one component), so a plain
// function export meant every parent re-render reconciled every Button
// on that screen even when none of its own props changed. React.memo
// with the default shallow-prop check is enough here since all props are
// primitives/callbacks passed directly by callers, not derived inline
// objects that would break the comparison.
function Button({
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
    variant === 'primary' ? COLORS.background
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
    height: s.height,
    paddingHorizontal: s.paddingH,
    borderRadius: RADIUS.button,
    opacity: isDisabled ? 0.5 : 1,
    width: fullWidth ? '100%' : undefined,
  };

  if (variant === 'primary') {
    return (
      <PressableScale
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled }}
        style={[styles.base, shape, ELEVATION.glow(accentColor) as any, style]}
      >
        <LinearGradient
          colors={[accentColor, alpha(accentColor, 0.7)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: RADIUS.button }]}
        />
        {content}
      </PressableScale>
    );
  }

  if (variant === 'danger') {
    return (
      <PressableScale
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled }}
        style={[styles.base, shape, { backgroundColor: COLORS.recoveryLow }, style]}
      >
        {content}
      </PressableScale>
    );
  }

  if (variant === 'secondary') {
    return (
      <PressableScale
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled }}
        style={[
          styles.base, shape,
          { backgroundColor: 'transparent', borderWidth: 1, borderColor: alpha(accentColor, 0.5) },
          style,
        ]}
      >
        {content}
      </PressableScale>
    );
  }

  // ghost
  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.base, shape, { backgroundColor: alpha(accentColor, 0.09) }, style]}
    >
      {content}
    </PressableScale>
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
    letterSpacing: 0.55,
  },
});

export default React.memo(Button);
