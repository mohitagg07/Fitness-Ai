import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';

interface AnimatedSplashProps {
  onFinished: () => void;
}

/**
 * Animated entrance sequence:
 *  1. Background is true black instantly (-> avoids a white flash on slow devices)
 *  2. Full brand key-art (runner + wordmark + tagline, baked into one image
 *     asset at assets/splash.png) fades in and settles (700ms). This is the
 *     one and only "opening" graphic — no separate logo/tagline composited
 *     on top of it.
 *  3. Brief hold, then the whole screen fades out and onFinished() fires
 *
 * A previous version chained withDelay(withSequence(...)) with a
 * zero-duration "anchor" step before the fade-out — that extra
 * indirection was fragile on Reanimated v4 and could leave the splash
 * stuck on screen if the callback never fired. This version uses a
 * single withDelay(withTiming(...)) call for the fade-out, PLUS a
 * plain JS setTimeout safety net that calls onFinished regardless of
 * whether the native-thread animation callback ever runs — so the app
 * can never get stuck on the opening screen.
 */
export default function AnimatedSplash({ onFinished }: AnimatedSplashProps) {
  const heroOpacity = useSharedValue(0);
  const heroScale = useSharedValue(1.04);
  const screenOpacity = useSharedValue(1);
  const finishedRef = useRef(false);

  const finishOnce = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished();
  };

  useEffect(() => {
    heroOpacity.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    heroScale.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });

    // Hold on screen, then fade out and hand control back to the navigator.
    screenOpacity.value = withDelay(
      2200,
      withTiming(0, { duration: 380 }, (finished) => {
        if (finished) runOnJS(finishOnce)();
      })
    );

    // Safety net: never let the splash block the app if the animation
    // callback above doesn't fire for any reason (e.g. app backgrounded
    // mid-animation on some Android devices).
    const timer = setTimeout(finishOnce, 3200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ scale: heroScale.value }],
  }));

  const screenStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.value,
  }));

  return (
    <Animated.View style={[styles.container, screenStyle]}>
      <Animated.Image
        source={require('../../../assets/splash.png')}
        style={[styles.hero, heroStyle]}
        resizeMode="cover"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background, // #000000 — true black, per WHOOP
  },
  hero: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
});