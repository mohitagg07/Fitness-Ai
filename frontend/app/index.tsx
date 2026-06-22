/**
 * app/index.tsx — Root entry point
 *
 * Flow:
 *   1. Animated splash (logo)
 *   2a. No token → /login
 *   2b. Token but no onboarding done → /onboarding
 *   2c. Token + onboarded → /(tabs)
 *
 * This guarantees the logo always shows first, onboarding runs exactly
 * once after registration, and authenticated users land straight on tabs.
 */
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import AnimatedSplash from '../src/components/splash/AnimatedSplash';

export default function Index() {
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!splashDone) return;

    (async () => {
      try {
        const token = await storage.getItem('neurofit_token');
        if (!token) {
          router.replace('/login');
          return;
        }

        // Check whether the user has completed onboarding.
        // The flag is written by OnboardingScreen on successful submit.
        const onboarded = await storage.getItem('neurofit_onboarded');
        if (!onboarded) {
          router.replace('/onboarding');
          return;
        }

        router.replace('/(tabs)');
      } catch {
        router.replace('/login');
      }
    })();
  }, [splashDone]);

  return (
    <View style={styles.container}>
      <AnimatedSplash onFinished={() => setSplashDone(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
  },
});