// VYRN — Root layout
//
// This is a plain stack, not a tab bar. `app/index.tsx` owns the splash +
// auth redirect (token found → /(tabs), otherwise → /login), and
// `app/(tabs)/_layout.tsx` owns the real bottom tab bar for everything
// inside that group. This file's only job is to stack the top-level
// routes — index, login, register, onboarding, (tabs) — with no header
// and no visible chrome of its own.
//
// Previously this file rendered its own <Tabs> navigator (a stray copy of
// (tabs)/_layout.tsx). Because that Tabs instance didn't declare `login`,
// `register`, `onboarding`, or `(tabs)` as screens, Expo Router fell back
// to auto-generating a default tab bar entry for every top-level file —
// which is what showed up as the plain "HOME / (tabs) / login / register
// / onboarding" bar. A Stack has no such fallback.

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from '../src/theme/colors';

export default function RootLayout() {
  return (
    // Required wrapper for useSafeAreaInsets() to work in any screen below —
    // that's what lets headers ask "how much clearance does THIS phone's
    // notch/status bar/camera cutout actually need" instead of guessing a
    // fixed pixel number that's wrong on most devices. See the header
    // components in src/components/*/ for where insets.top is now used.
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}