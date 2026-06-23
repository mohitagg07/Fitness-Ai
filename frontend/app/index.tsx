import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import AnimatedSplash from '../src/components/splash/AnimatedSplash';

/**
 * App entry point — flow:
 *   1. Show animated splash (logo)
 *   2. Check if user has a token
 *      a. No token  → /login  (login or register)
 *      b. Token but no onboarding_complete → /onboarding
 *      c. Token + onboarded → /(tabs)  (main app)
 *
 * The onboarding check uses the locally-cached profile flag so it works
 * offline (no network round-trip on every cold start).
 */
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
        // Check onboarding status from cached profile
        const rawProfile = await storage.getItem('neurofit_profile');
        if (rawProfile) {
          try {
            const p = JSON.parse(rawProfile);
            if (!p.onboarding_complete) {
              router.replace('/onboarding');
              return;
            }
          } catch {}
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
  container: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
});
