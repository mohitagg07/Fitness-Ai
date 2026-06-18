import { useEffect } from 'react';
import { View, Image, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

const { width: SCREEN_W } = Dimensions.get('window');
const HERO_SIZE = Math.min(SCREEN_W * 0.78, 360);

interface AnimatedSplashProps {
  onFinished: () => void;
}

/**
 * Animated entrance sequence:
 *  1. Background fades in instantly (black -> avoids a white flash on slow devices)
 *  2. Hero image scales up from 0.85 -> 1 while fading in (700ms)
 *  3. Wordmark + tagline slide up and fade in, staggered after the image (400ms, +250ms delay)
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
        <Image
          source={require('../../../assets/hero-splash.png')}
          style={styles.hero}
          resizeMode="cover"
        />
      </Animated.View>

      <Animated.View style={[styles.textBlock, textStyle]}>
        <Text style={styles.wordmark}>
          NEURO<Text style={styles.wordmarkFit}>FIT</Text>
          <Text style={styles.wordmarkAi}> AI</Text>
        </Text>
        <Text style={styles.tagline}>AI GYM SPOTTER. NEVER LIFT ALONE.</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    width: HERO_SIZE,
    height: HERO_SIZE,
    borderRadius: 24,
  },
  textBlock: {
    marginTop: 28,
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: '#E8ECEF',
    letterSpacing: 1,
  },
  wordmarkFit: {
    color: '#7ED957',
  },
  wordmarkAi: {
    color: '#4A9EFF',
  },
  tagline: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '500',
    color: '#9AA5B1',
    letterSpacing: 2.5,
  },
});
