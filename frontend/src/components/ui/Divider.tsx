// VYRN — Divider primitive
//
// One hairline rule for every "separate these two zones inside a card"
// need (vertical between stat columns, horizontal between a card's
// header and its body). Replaces one-off `borderTopWidth: 1` styles
// scattered per screen.
import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { COLORS } from '../../theme/colors';

export default function Divider({
  direction = 'horizontal',
  color = COLORS.cardBorder,
  style,
}: {
  direction?: 'horizontal' | 'vertical';
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        direction === 'horizontal'
          ? { height: 1, width: '100%', backgroundColor: color }
          : { width: 1, height: '100%', backgroundColor: color },
        style,
      ]}
    />
  );
}
