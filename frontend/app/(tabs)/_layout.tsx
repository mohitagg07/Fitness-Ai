import { useEffect, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../../src/utils/storage';
import { profileApi } from '../../src/utils/api';
import { queryClient } from '../../src/lib/queryClient';
import { qk } from '../../src/lib/queryKeys';
import { usePrefetchDashboard } from '../../src/hooks/useDashboardQueries';
import { COLORS, alpha } from '../../src/theme/colors';
import {
  registerForPushNotificationsAsync,
  attachNotificationResponseHandler,
} from '../../src/utils/pushNotifications';

type TabDef = {
  name: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
};

// ── 5-tab nav — Decisions, Simulate, Form AI moved to Dashboard cards ──
// Eight tabs was too many; 4-5 is the mobile-nav sweet spot. The removed
// tabs are still real screens — they're now reachable via the Quick Start
// grid and new dashboard feature cards on the Home tab instead of a
// permanent bottom slot. This frees up visible space and makes the nav
// instantly scannable.
const TABS: TabDef[] = [
  { name: 'index',    title: 'HOME',      icon: 'home-outline',        activeIcon: 'home'        },
  { name: 'coach',   title: 'COACH',     icon: 'flash-outline',       activeIcon: 'flash'       },
  { name: 'workout', title: 'WORKOUT',   icon: 'barbell-outline',     activeIcon: 'barbell'     },
  { name: 'progress', title: 'PROGRESS', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'profile', title: 'PROFILE',   icon: 'person-outline',      activeIcon: 'person'      },
];

// Hidden tabs — still routable via router.push(), just not in the bar
const HIDDEN_TABS = ['decisions', 'simulate', 'formanalysis', 'prs'];

export default function TabsLayout() {
  const [authChecked, setAuthChecked] = useState(false);
  const prefetchDashboard = usePrefetchDashboard();

  useEffect(() => {
    (async () => {
      const token = await storage.getItem('vyrn_token');
      if (!token) {
        router.replace('/login');
        return;
      }
      // Second layer of defense: app/index.tsx already checks
      // onboarding_complete on cold launch, but a push notification can
      // deep-link straight into a route under (tabs) without passing
      // through index.tsx first. Re-checking here means an
      // incomplete-onboarding user can't land on a tab screen that way
      // either.
      //
      // Routed through the same query cache/key as index.tsx's check —
      // if that request already resolved (the common path, since this
      // mounts right after it), this reads straight from cache instead
      // of firing a second identical /profile/me request back-to-back.
      try {
        const data = await queryClient.fetchQuery({
          queryKey: qk.profile.me(),
          queryFn: async () => (await profileApi.getMe()).data,
          staleTime: 60_000,
        });
        if (data && data.onboarding_complete === false) {
          router.replace('/onboarding');
          return;
        }
      } catch {
        // Profile check failing shouldn't block a returning user from
        // their dashboard — fail open here, same as index.tsx.
      }
      setAuthChecked(true);
      // Fire-and-forget: registers this device's Expo push token so the
      // nightly scheduler job (backend/services/scheduler.py →
      // job_generate_notifications) can actually push recovery/protein/PR
      // alerts instead of only writing a row the user has to go find.
      // Non-fatal if it fails — see pushNotifications.ts.
      registerForPushNotificationsAsync();
      // PERF: warm the Home tab's queries the instant the tab bar is
      // ready, rather than waiting for the user to actually tap Home and
      // pay for that round trip on first paint. Cheap and idempotent —
      // React Query de-dupes this against whatever DashboardScreen fires
      // on its own mount a moment later.
      prefetchDashboard();
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 22,
          backgroundColor: alpha('#101010', 0.88),
          borderColor: COLORS.tabBorder,
          borderWidth: 1,
          borderRadius: 26,
          paddingBottom: 12,
          paddingTop: 12,
          height: 76,
          elevation: 12,
          shadowColor: '#000000',
          shadowOpacity: 0.35,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.6,
          marginTop: 4,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, focused }) => (
              <View style={focused ? styles.activeWrap : styles.iconWrap}>
                <Ionicons
                  name={focused ? t.activeIcon : t.icon}
                  size={22}
                  color={color}
                />
                {focused && <View style={[styles.indicator, { backgroundColor: color }]} />}
              </View>
            ),
          }}
        />
      ))}
      {/* Hidden tabs — routable but not visible in the bottom bar */}
      {HIDDEN_TABS.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ href: null }}
        />
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
  iconWrap: { padding: 4, alignItems: 'center' },
  activeWrap: {
    padding: 6,
    backgroundColor: alpha(COLORS.primaryGreen, 0.14),
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.primaryGreen,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  indicator: {
    position: 'absolute',
    bottom: -6,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});