import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import { actions } from '../src/store';
import { COLORS } from '../src/theme/colors';

/**
 * Fast route gate.
 *
 * The old entry screen held the native app behind a 2.6s animated splash and
 * then waited for query hydration plus a live /profile/me request. The tab
 * navigator repeated that profile request before it rendered. On a sleeping
 * backend this made a returning user stare at an animation/spinner while the
 * app did no useful work.
 *
 * This screen now does only the work required to choose a safe route:
 * restore the secure token and the lightweight identity, then hand off to the
 * authenticated shell. The shell renders immediately and validates the
 * profile in the background. Expired sessions are still rejected by the
 * shared API interceptor; incomplete onboarding is redirected when the
 * background profile check resolves.
 */
export default function Index() {
  useEffect(() => {
    let active = true;
    let routed = false;

    const navigate = (path: '/login' | '/(tabs)') => {
      if (!active || routed) return;
      routed = true;
      router.replace(path as any);
    };

    const bootstrap = async () => {
      let token: string | null = null;
      try {
        token = await storage.getItem('vyrn_token');
      } catch {
        // A token that cannot be read must not be treated as authenticated.
      }

      if (!active) return;
      if (!token) {
        navigate('/login');
        return;
      }

      let savedUser: any = null;
      try {
        const rawUser = await storage.getItem('vyrn_user');
        savedUser = rawUser ? JSON.parse(rawUser) : null;
      } catch {
        savedUser = null;
      }

      if (!active) return;
      actions.hydrateAuth(
        savedUser && typeof savedUser === 'object' ? savedUser : { id: null },
        token
      );
      navigate('/(tabs)');
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  // This state should only be visible for the brief secure-storage read.
  // The native splash remains responsible for the true cold-start handoff.
  return (
    <View style={styles.container}>
      <ActivityIndicator color={COLORS.primaryGreen} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
