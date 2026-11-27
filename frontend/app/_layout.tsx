import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';

import {
  asyncStoragePersister,
  markHydrationComplete,
  queryClient,
} from '../src/lib/queryClient';
import { COLORS } from '../src/theme/colors';
import { FONT_ASSETS } from '../src/theme/typography';
import { ErrorBoundary } from '../src/components/system/ErrorBoundary';

const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * The root navigator owns the app-wide providers and route tree.
 * Font loading runs in parallel with the first render: native/system fonts
 * are used for the first frame and the bundled brand typeface replaces them
 * as soon as it is ready. Typography must never hold navigation hostage.
 */
export default function RootLayout() {
  const [, fontError] = useFonts(FONT_ASSETS);

  if (fontError && __DEV__) {
    console.warn('[VYRN] Custom fonts failed to load; using platform fonts.', fontError);
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: QUERY_CACHE_MAX_AGE,
        buster: 'vyrn-query-cache-v1',
      }}
      onSuccess={markHydrationComplete}
      onError={markHydrationComplete}
    >
      <ErrorBoundary>
        <StatusBar style="dark" backgroundColor={COLORS.background} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: COLORS.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="auth/callback" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ErrorBoundary>
    </PersistQueryClientProvider>
  );
}
