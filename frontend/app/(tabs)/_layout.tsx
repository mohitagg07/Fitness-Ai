import { useEffect, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../../src/utils/storage';
import { profileApi } from '../../src/utils/api';
import { actions } from '../../src/store';
import { queryClient } from '../../src/lib/queryClient';
import { qk } from '../../src/lib/queryKeys';
import { clearAuthData } from '../../src/utils/auth';
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
  { name: 'index',    title: 'Home',      icon: 'home-outline',        activeIcon: 'home'        },
  { name: 'coach',   title: 'Coach',     icon: 'flash-outline',       activeIcon: 'flash'       },
  { name: 'workout', title: 'Train',     icon: 'barbell-outline',     activeIcon: 'barbell'     },
  { name: 'progress', title: 'Progress', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'profile', title: 'Profile',   icon: 'person-outline',      activeIcon: 'person'      },
];

// Hidden tabs — still routable via router.push(), just not in the bar
const HIDDEN_TABS = ['decisions', 'simulate', 'formanalysis', 'prs'];

export default function TabsLayout() {
  const [authChecked, setAuthChecked] = useState(false);
  const prefetchDashboard = usePrefetchDashboard();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // This is a defensive re-check, not the primary auth gate — the
      // authoritative validation against /profile/me happens once in
      // app/index.tsx's boot state machine. This exists only because this
      // route is reachable *without* passing through index.tsx first: a
      // deep link from a push notification (see attachNotificationResponseHandler
      // below) or a restored native navigation state can land here
      // directly. Every branch here still resolves to a single outcome —
      // it never leaves `authChecked` false forever.
      let token: string | null = null;
      try {
        token = await storage.getItem('vyrn_token');
      } catch {
        router.replace('/');
        return;
      }
      if (cancelled) return;
      if (!token) {
        router.replace('/login');
        return;
      }

      // Restore the persisted identity immediately; profile data can be
      // hydrated from the query cache while the network check runs.
      let savedUser: any = null;
      try {
        const rawUser = await storage.getItem('vyrn_user');
        savedUser = rawUser ? JSON.parse(rawUser) : null;
      } catch {
        savedUser = null;
      }
      if (cancelled) return;
      actions.hydrateAuth(
        savedUser && typeof savedUser === 'object' ? savedUser : { id: null },
        token
      );

      const cachedPayload = queryClient.getQueryData(qk.profile.me()) as any;
      if (cachedPayload) {
        const cachedProfile = cachedPayload?.profile ?? cachedPayload ?? {};
        actions.setProfile(
          cachedProfile,
          Array.isArray(cachedPayload?.injuries) ? cachedPayload.injuries : [],
          Array.isArray(cachedPayload?.personal_records) ? cachedPayload.personal_records : []
        );
      }

      try {
        const res = await profileApi.getMe();
        if (cancelled) return;
        const payload = res.data;
        const profile = payload?.profile ?? payload ?? {};
        if (profile?.onboarding_complete !== true) {
          router.replace('/onboarding');
          return;
        }
        actions.setProfile(
          profile,
          Array.isArray(payload?.injuries) ? payload.injuries : [],
          Array.isArray(payload?.personal_records) ? payload.personal_records : []
        );
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          // Token invalid — clear it (token + user + cached profile data)
          // and redirect to login rather than letting a dead session sit
          // behind the tab bar.
          await clearAuthData();
          if (cancelled) return;
          router.replace('/login');
          return;
        }
        // Network error / slow backend — retain the persisted identity and
        // cached profile if available. The dashboard will show its explicit
        // offline/error state rather than an endless auth spinner.
      }

      setAuthChecked(true);
      registerForPushNotificationsAsync();
      prefetchDashboard();
    })();

    return () => {
      cancelled = true;
    };
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
          left: 18,
          right: 18,
          bottom: 14,
          backgroundColor: alpha(COLORS.cardElevated, 0.97),
          borderColor: COLORS.tabBorder,
          borderWidth: 1,
          borderRadius: 22,
          paddingBottom: 8,
          paddingTop: 8,
          height: 70,
          elevation: 8,
          shadowColor: '#000000',
          shadowOpacity: 0.24,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        },
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.15,
          marginTop: 3,
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
    backgroundColor: alpha(COLORS.primaryGreen, 0.12),
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.primaryGreen,
    shadowOpacity: 0.16,
    shadowRadius: 6,
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