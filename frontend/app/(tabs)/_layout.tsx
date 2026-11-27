import { useEffect, useState, useRef } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Animated, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../../src/utils/storage';
import { profileApi } from '../../src/utils/api';
import { actions, useStore } from '../../src/store';
import { queryClient, hydrated } from '../../src/lib/queryClient';
import { qk } from '../../src/lib/queryKeys';
import { clearAuthData } from '../../src/utils/auth';
import { usePrefetchDashboard } from '../../src/hooks/useDashboardQueries';
import { useReducedMotion } from '../../src/hooks/useReducedMotion';
import { COLORS, alpha } from '../../src/theme/colors';
import { FONTS } from '../../src/theme/typography';
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

function TabBarIcon({
  tab,
  color,
  focused,
}: {
  tab: TabDef;
  color: string;
  focused: boolean;
}) {
  const scale = useRef(new Animated.Value(focused ? 1.04 : 1)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    scale.stopAnimation();
    if (reduceMotion) {
      scale.setValue(focused ? 1.04 : 1);
      return undefined;
    }
    const animation = Animated.spring(scale, {
      toValue: focused ? 1.05 : 1,
      useNativeDriver: true,
      speed: 26,
      bounciness: 4,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, scale, reduceMotion]);

  const isTrainActive = tab.name === 'workout' && focused;

  return (
    <Animated.View
      style={[
        isTrainActive ? styles.trainActiveIcon : focused ? styles.activeIcon : styles.icon,
        { transform: [{ scale }] },
      ]}
    >
      <Ionicons
        name={focused ? tab.activeIcon : tab.icon}
        size={tab.name === 'workout' ? 22 : 20}
        color={isTrainActive ? COLORS.background : color}
      />
      {focused && <View style={styles.activeIndicator} />}
    </Animated.View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const [authChecked, setAuthChecked] = useState(false);
  const prefetchDashboard = usePrefetchDashboard();
  const authSession = useStore((state) => ({ token: state.token, user: state.user }));

  useEffect(() => {
    let cancelled = false;
    let notificationTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

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
      // app/index.tsx already restores this session into the in-memory store.
      // Reuse it rather than doing a second secure-storage round trip on every
      // cold launch. Direct tab entry still has the native-storage fallback.
      let token: string | null = authSession.token;
      try {
        if (!token) token = await storage.getItem('vyrn_token');
      } catch {
        router.replace('/login');
        return;
      }

      if (cancelled) return;
      if (!token) {
        router.replace('/login');
        return;
      }

      let savedUser: any = authSession.user ?? null;
      if (!savedUser) {
        try {
          const rawUser = await storage.getItem('vyrn_user');
          savedUser = rawUser ? JSON.parse(rawUser) : null;
        } catch {
          savedUser = null;
        }
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

      // Do not race persisted-cache restoration with prefetch/profile writes.
      // The shell is already visible while this resolves, so cold-start UI is
      // not blocked by cache hydration or a sleeping API.
      void hydrated.then(() => {
        if (cancelled) return;
        const restored = queryClient.getQueryData(qk.profile.me()) as any;
        if (restored) {
          const profile = applyProfile(restored);
          if (redirectForOnboarding(profile)) return;
        }
        prefetchDashboard();
        void refreshProfileInBackground();
      });

      // Native notification imports and the permission prompt are not on the
      // first-paint path. Run them only after the opening interactions settle.
      notificationTask = InteractionManager.runAfterInteractions(() => {
        if (!cancelled) void registerForPushNotificationsAsync();
      });
    };

    void bootstrap();
    return () => {
      cancelled = true;
      notificationTask?.cancel();
    };
  }, [prefetchDashboard, authSession.token, authSession.user]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      cleanup = attachNotificationResponseHandler();
    });
    return () => {
      task.cancel();
      cleanup?.();
    };
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
          backgroundColor: COLORS.tabBg,
          borderTopColor: COLORS.tabBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderLeftWidth: 0,
          borderRightWidth: 0,
          borderBottomWidth: 0,
          borderRadius: 0,
          paddingBottom: bottomInset,
          paddingTop: 8,
          height: 66 + bottomInset,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarLabelStyle: {
          fontFamily: FONTS.semibold,
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.15,
          marginTop: 3,
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
              <TabBarIcon tab={tab} color={color} focused={focused} />
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
    width: 42,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeIcon: {
    width: 42,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: alpha(COLORS.primaryGreen, 0.10),
  },
  trainActiveIcon: {
    width: 38,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryGreen,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.tabActive,
  },
});
