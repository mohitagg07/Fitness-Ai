// VYRN — GlassCard primitive
//
// A lighter-weight glass surface than Card: translucent fill + thin
// border, no forced padding scale. Used for the Quick Tools scroll
// buttons and other small "floating over the black canvas" pieces where
// a full opaque Card reads too heavy. Not a replacement for Card — Card
// is still the default for every real content card on the app.
// (No expo-blur dependency — a layered translucent fill gets the same
// glass look without adding a new native dependency to the project.)
import React from 'react';
import { View, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { COLORS, alpha } from '../../theme/colors';
import { RADIUS } from '../../theme/spacing';

interface GlassCardProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export default function GlassCard({ onPress, style, children }: GlassCardProps) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.75 } : {};
  return (
    <Wrapper {...wrapperProps} style={[styles.wrap, style]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(COLORS.cardElevated, 0.65) }]} />
      {children}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
  },
});
