// Root layout — a Stack (not Tabs) so non-tab routes (login, register,
// onboarding) render outside the tab bar. See SESSION_NOTES.md for the
// history of this exact regression recurring.
//
// Also responsible for loading the real brand fonts (Inter, Space
// Grotesk — see src/theme/typography.ts for why these specific fonts)
// before anything renders, and for catching render-time crashes via
// ErrorBoundary so one broken screen doesn't take down the whole app.
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { COLORS } from '../src/theme/colors';
import { FONT_ASSETS } from '../src/theme/typography';
import { ErrorBoundary } from '../src/components/system/ErrorBoundary';

// Keep the native splash screen visible while fonts load, instead of
// flashing default-font text for a frame and then re-rendering once
// Inter/Space Grotesk are ready — that flash is the kind of thing that
// makes an app feel unpolished even though it's only visible for ~100ms.
SplashScreen.preventAutoHideAsync().catch(() => {
  // No-op if this is called more than once (e.g. fast refresh in dev).
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      // fontError is logged but never blocks the app — a missing/failed
      // font file should degrade to the platform default, not crash
      // startup. This is exactly the kind of failure mode that bit this
      // project before with expo-font version mismatches; we don't want
      // a font problem to ever be a hard app-won't-open bug again.
      if (fontError) {
        console.warn('[RootLayout] Font load error (falling back to system font):', fontError);
      }
      setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!ready) {
    return null; // native splash screen stays visible during this
  }

  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}