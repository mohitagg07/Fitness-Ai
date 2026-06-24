/**
 * app/_layout.tsx — Root Stack navigator
 *
 * This is the TOP-LEVEL layout for the entire app.
 * It must be a Stack, not Tabs — Tabs here would wrap every screen
 * (login, onboarding, splash) inside the tab bar, which is wrong.
 *
 * Screen visibility:
 *   - index, login, register, onboarding → no header, no tab bar
 *   - (tabs) group → has its own _layout.tsx that renders the tab bar
 */
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}