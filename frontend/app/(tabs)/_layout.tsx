import { useEffect, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../../src/utils/storage';
import { profileApi } from '../../src/utils/api';
import { actions } from '../../src/store';
import { queryClient, hydrated } from '../../src/lib/queryClient';
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

const TABS: TabDef[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'coach', title: 'Coach', icon: 'flash-outline', activeIcon: 'flash' },
  { name: 'workout', title: 'Train', icon: 'barbell-outline', activeIcon: 'barbell' },
  { name: 'progress', title: 'Progress', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'profile', title: 'Profile', icon: 'person-outline', activeIcon: 'person' },
];

const HIDDEN_TABS = ['decisions', 'simulate', 'formanalysis', 'prs'];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const [authChecked, setAuthChecked] = useState(false);
  const prefetchDashboard = usePrefetchDashboard();

  useEffect(() => {
    let cancelled = false;

    const applyProfile = (payload: any) => {
      const profile = payload?.profile ?? payload ?? {};
      actions.setProfile(
        profile,
        Array.isArray(payload?.injuries) ? payload.injuries : [],
        Array.isArray(payload?.personal_records) ? payload.personal_records : []
      );
      return profile;
    };

    const redirectForOnboarding = (profile: any) => {
      if (profile?.onboarding_complete !== false) return false;
      router.replace('/onboarding');
      return true;
    };

    const refreshProfileInBackground = async () => {
      try {
        const response = await profileApi.getMe();
        if (cancelled) return;
        const payload = response.data;
        queryClient.setQueryData(qk.profile.me(), payload);
        const profile = applyProfile(payload);
        redirectForOnboarding(profile);
      } catch (error: any) {
        if (cancelled) return;
        // 401 is handled centrally by api.ts and redirects to Login.
        // 403 is handled here because it can represent a blocked profile.
        if (error?.response?.status === 403) {
          await clearAuthData();
          if (!cancelled) router.replace('/login');
        }
        // Network/timeout errors do not block the app shell. Cached data stays
        // visible and feature screens communicate their own offline state.
      }
    };

    const bootstrap = async () => {
      let token: string | null = null;
      try {
        token = await storage.getItem('vyrn_token');
      } catch {
        router.replace('/login');
        return;
      }

      if (cancelled) return;
      if (!token) {
        router.replace('/login');
        return;
      }

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

      // Use a previously restored profile immediately when it exists. Cache
      // hydration can finish just after this navigator mounts, so subscribe to
      // the hydration promise as well instead of forcing a second screen wait.
      const cachedPayload = queryClient.getQueryData(qk.profile.me()) as any;
      if (cachedPayload) {
        const cachedProfile = applyProfile(cachedPayload);
        if (redirectForOnboarding(cachedProfile)) return;
      }

      setAuthChecked(true);
      void registerForPushNotificationsAsync();
      prefetchDashboard();

      void hydrated.then(() => {
        if (cancelled) return;
        const restored = queryClient.getQueryData(qk.profile.me()) as any;
        if (!restored) return;
        const profile = applyProfile(restored);
        redirectForOnboarding(profile);
      });

      // A live validation still happens on every fresh shell entry, but it no
      // longer gates first paint. The app can render cached data immediately
      // while the backend wakes up or the device changes networks.
      void refreshProfileInBackground();
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [prefetchDashboard]);

  useEffect(() => {
    const cleanup = attachNotificationResponseHandler();
    return cleanup;
  }, []);

  if (!authChecked) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primaryGreen} size="small" />
      </View>
    );
  }

  const bottomInset = Math.max(insets.bottom, 4);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          // Full-width bottom navigation: no floating pill and no exposed
          // side gutters. This aligns the app with native Android geometry.
          marginHorizontal: 0,
          marginBottom: 0,
          backgroundColor: COLORS.background,
          borderTopColor: COLORS.cardBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderLeftWidth: 0,
          borderRightWidth: 0,
          borderBottomWidth: 0,
          borderRadius: 0,
          paddingBottom: bottomInset,
          paddingTop: 7,
          height: 58 + bottomInset,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.1,
          marginTop: 2,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <View style={focused ? styles.activeIcon : styles.icon}>
                <Ionicons
                  name={focused ? tab.activeIcon : tab.icon}
                  size={21}
                  color={color}
                />
                {focused && <View style={styles.activeIndicator} />}
              </View>
            ),
          }}
        />
      ))}
      {HIDDEN_TABS.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  activeIcon: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  activeIndicator: {
    position: 'absolute',
    top: -7,
    width: 16,
    height: 2,
    borderRadius: 2,
    backgroundColor: COLORS.tabActive,
  },
});
