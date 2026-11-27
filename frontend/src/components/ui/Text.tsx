// VYRN — Text primitive
//
// The canonical VYRN text variants: display, hero, h1, h2, cardTitle, body,
// small, caption and eyebrow (see theme/typography.ts TEXT_STYLES for the full
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

// The single most-instantiated component in the app (every label, number,
// and value renders through here — often hundreds of instances per
// screen). React.memo's default shallow comparison works well for it
// specifically because `children` is almost always a string/number
// literal (a primitive, compared by value) rather than nested JSX, so
// this reliably skips re-render work when an unrelated sibling or parent
// state change doesn't actually touch this particular label's props.
function Text({
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

export default React.memo(Text);