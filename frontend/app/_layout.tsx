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
import { COLORS } from '../src/theme/colors';

export default function RootLayout() {
  return (
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
  );
}