// VYRN — CountUpNumber
//
// Was: requestAnimationFrame + setState on every tick — that re-renders
// the parent card on every single frame, entirely on the JS thread. On a
// mid-range Android phone, with 2-3 of these mounted at once (Momentum,
// Milestone, WorkoutSummary), that's exactly the kind of thing that reads
// as "smooth on the demo iPhone, janky on the phone people actually own."
//
// Now: the number itself is animated on the UI thread via Reanimated and
// written straight into a native TextInput's `text` prop — React never
// re-renders while it's counting up, there's no JS/UI-thread round trip
// per frame, and it costs nothing extra when several are on screen together.
import React, { useEffect } from 'react';
import { TextInput, TextStyle, StyleSheet } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// Manual thousands-separator formatting — deliberately avoids
// toLocaleString/Intl, which isn't reliably available inside the
// Reanimated worklet runtime across devices.
function formatWorklet(num: number, decimals: number): string {
  'worklet';
  const negative = num < 0;
  const fixed = Math.abs(num).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  let grouped = '';
  for (let i = 0; i < intPart.length; i++) {
    const posFromEnd = intPart.length - i;
    grouped += intPart[i];
    if (posFromEnd > 1 && posFromEnd % 3 === 1) grouped += ',';
  }
  return (negative ? '-' : '') + grouped + (decPart ? '.' + decPart : '');
}

export default function CountUpNumber({
  value, duration = 900, style, suffix = '', decimals = 0,
}: {
  value: number; duration?: number; style?: TextStyle | TextStyle[]; suffix?: string; decimals?: number;
}) {
  const animated = useSharedValue(0);

  useEffect(() => {
    animated.value = withTiming(value, { duration, easing: Easing.out(Easing.cubic) });
  }, [value, duration]);

  const animatedProps = useAnimatedProps(() => {
    return { text: `${formatWorklet(animated.value, decimals)}${suffix}` } as any;
  });

  return (
    <AnimatedTextInput
      underlineColorAndroid="transparent"
      editable={false}
      pointerEvents="none"
      caretHidden
      showSoftInputOnFocus={false}
      accessibilityRole="text"
      // Matches the shared value's actual starting point (0), not the
      // target — setting this to the final value would flash the
      // finished number for one frame before the count-up takes over.
      defaultValue={`${formatWorklet(0, decimals)}${suffix}`}
      style={[styles.base, style]}
      animatedProps={animatedProps}
    />
  );
}

const styles = StyleSheet.create({
  // Strip TextInput's native chrome so it reads as plain Text.
  base: {
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
});

export { CountUpNumber };
