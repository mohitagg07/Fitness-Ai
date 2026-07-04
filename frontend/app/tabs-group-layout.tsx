import { useEffect, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { storage } from '../../src/utils/storage';
import { COLORS } from '../../src/theme/colors';
import {
  registerForPushNotificationsAsync,
  attachNotificationResponseHandler,
} from '../../src/utils/pushNotifications';

// ── All tabs hidden from the bottom bar ──
// Every screen below is still a real route reachable via router.push()
// (e.g. from the Quick Start grid, dashboard cards, or notification
// deep links) — it's just not shown as a persistent bottom-nav item.
const ALL_TABS = [
  'index',
  'coach',
  'workout',
  'progress',
  'profile',
  'decisions',
  'simulate',
  'formanalysis',
  'prs',
];

export default function TabsLayout() {
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await storage.getItem('vyrn_token');
      if (!token) {
        router.replace('/login');
        return;
      }
      setAuthChecked(true);
      // Fire-and-forget: registers this device's Expo push token so the
      // nightly scheduler job (backend/services/scheduler.py →
      // job_generate_notifications) can actually push recovery/protein/PR
      // alerts instead of only writing a row the user has to go find.
      // Non-fatal if it fails — see pushNotifications.ts.
      registerForPushNotificationsAsync();
    })();
  }, []);

  // Tap-to-deep-link: a pushed notification's `cta` (e.g. "/workout")
  // routes here on tap, even from a killed/backgrounded app state.
  useEffect(() => {
    const cleanup = attachNotificationResponseHandler();
    return cleanup;
  }, []);

  if (!authChecked) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // No visible items (every screen below uses href: null), so
        // there's nothing left to render in the bar itself.
        tabBarStyle: { display: 'none' },
      }}
    >
      {ALL_TABS.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
