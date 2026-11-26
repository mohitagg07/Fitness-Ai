import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import {
  asyncStoragePersister,
  markHydrationComplete,
  queryClient,
} from '../src/lib/queryClient';
import { COLORS } from '../src/theme/colors';
import { ErrorBoundary } from '../src/components/system/ErrorBoundary';

const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * The root navigator owns app-wide providers and top-level routes.
 *
 * Keep the tab navigator in app/(tabs)/_layout.tsx. Putting Tabs here
 * shadows the login/onboarding stack and creates an invalid route tree.
 * PersistQueryClientProvider must also wrap every route because dashboard
 * and workout hooks call useQuery/useQueryClient during navigation.
 */
export default function RootLayout() {
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
        <StatusBar style="light" backgroundColor={COLORS.background} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: COLORS.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ErrorBoundary>
    </PersistQueryClientProvider>
  );
}
