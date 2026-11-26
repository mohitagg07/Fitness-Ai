import React, { forwardRef } from 'react';
import {
  TextInput,
  View,
  Text,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Shared accessible dark-theme text input used across VYRN forms. */
const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, containerStyle, style, ...props },
  ref,
) {
  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={COLORS.textMuted}
        selectionColor={COLORS.primaryGreen}
        keyboardAppearance="dark"
        style={[styles.input, error ? styles.inputError : null, style]}
        accessibilityState={{ invalid: Boolean(error) }}
        {...props}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: RADIUS.badge,
    backgroundColor: alpha(COLORS.card, 0.9),
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: 15,
  },
  inputError: { borderColor: COLORS.recoveryLow },
  error: { color: COLORS.recoveryLow, fontSize: 12, marginTop: SPACING.xs },
});

export default Input;
