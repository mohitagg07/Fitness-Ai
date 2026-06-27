/**
 * app/_layout.tsx — Root layout
 *
 * Wraps the entire app in a Stack navigator. Each screen manages its
 * own headers (headerShown: false everywhere — screens handle their
 * own chrome). The tab area lives at /(tabs) and has its own nested
 * layout at app/(tabs)/_layout.tsx.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
