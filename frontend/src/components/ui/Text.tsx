// VYRN — Text primitive
//
// The ONLY seven text styles in the app: hero, h1, h2, cardTitle, body,
// caption, eyebrow (see theme/typography.ts TEXT_STYLES for the full
// rationale). Every screen renders text through this component instead
// of a raw <Text style={{ fontSize: 17, fontWeight: '600' }}/> — that's
// how "giant serif heading here, bold sans heading there, random 13px
// caption somewhere else" stops happening.

import React from 'react';
import { Text as RNText, StyleProp, TextStyle, TextProps as RNTextProps } from 'react-native';
import { COLORS } from '../../theme/colors';
import { FONTS, TEXT_STYLES, TextVariant } from '../../theme/typography';

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  /** Swaps to the numeric (Space Grotesk, tabular) font family — use for
   * scores, weights, reps, calories, any digit-heavy value. */
  numeric?: boolean;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black';
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}

export default function Text({
  variant = 'body',
  color = COLORS.text,
  numeric = false,
  weight,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  const base = TEXT_STYLES[variant];
  const fontFamily = weight ? FONTS[weight] : numeric ? numericFamilyFor(variant) : base.fontFamily;

  return (
    <RNText
      style={[
        base as TextStyle,
        { color, fontFamily },
        align && { textAlign: align },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

function numericFamilyFor(variant: TextVariant) {
  switch (variant) {
    case 'hero':
      return FONTS.numericBold;
    case 'h1':
    case 'h2':
    case 'cardTitle':
      return FONTS.numericSemibold;
    default:
      return FONTS.numericMedium;
  }
}