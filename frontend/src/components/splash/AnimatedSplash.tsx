import { useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';
import Logo from '../shared/Logo';

interface AnimatedSplashProps {
  onFinished: () => void;
}

/**
 * Animated entrance sequence:
 *  1. Background fades in instantly (black -> avoids a white flash on slow devices)
 *  2. VYRN badge (Logo's own SVG chevron mark) scales up from 0.85 -> 1 while
 *     fading in (700ms). Previously this slot rendered a separate raster
 *     "hero-splash.png" (a leftover neural-network/brain icon from the old
 *     brand) instead of the real VYRN mark — removed so the badge shown here
 *     is the exact same vector asset used everywhere else in the app, not a
 *     second, disconnected graphic.
 *  3. Wordmark + tagline slide up and fade in, staggered after the badge (400ms, +250ms delay)
 *  4. Brief hold, then the whole screen fades out and onFinished() fires
 *
 * Reanimated v4 note: direct shared-value assignment (`sv.value = x`) is
 * unreliable for UI updates in this version — every transition below is
 * wrapped in withTiming/withSequence rather than assigned bare.
 */
export default function AnimatedSplash({ onFinished }: AnimatedSplashProps) {
  const heroOpacity = useSharedValue(0);
  const heroScale = useSharedValue(0.85);
  const textOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(16);
  const screenOpacity = useSharedValue(1);

  useEffect(() => {
    heroOpacity.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    heroScale.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });

    textOpacity.value = withDelay(450, withTiming(1, { duration: 400 }));
    textTranslateY.value = withDelay(450, withTiming(0, { duration: 400, easing: Easing.out(Easing.quad) }));

    // Hold on screen, then fade out and hand control back to the navigator.
    screenOpacity.value = withDelay(
      2200,
      withSequence(
        withTiming(1, { duration: 0 }), // anchor point so the delay above is honored precisely
        withTiming(0, { duration: 380 }, (finished) => {
          if (finished) runOnJS(onFinished)();
        })
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ scale: heroScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  const screenStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.value,
  }));

  return (
    <Animated.View style={[styles.container, screenStyle]}>
      <Animated.View style={heroStyle}>
        <Logo size="xl" showWordmark={false} />
      </Animated.View>

      <Animated.View style={[styles.textBlock, textStyle]}>
        <Logo size="xl" showBadge={false} />
        <Text style={styles.tagline}>ADAPTIVE PERFORMANCE SYSTEM</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background, // #000000 — true black, per WHOOP
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    marginTop: 28,
    alignItems: 'center',
  },
  tagline: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    letterSpacing: 2.5,
  },
});