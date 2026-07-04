import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ErrorBoundary } from '../src/components/system/ErrorBoundary';
import { queryClient, asyncStoragePersister } from '../src/lib/queryClient';

// SafeAreaProvider MUST wrap the whole app, once, at the root. Several
// screens (CoachScreen, ProfileScreen, DashboardHeader, PRScreen,
// NutritionSearchModal, CoachMemoryModal) call useSafeAreaInsets() —
// without this provider mounted above them, that hook has nothing to
// read from. Depending on the screen/library version this either throws
// outright (ProfileScreen's crash: "property insets doesn't exist") or
// silently renders blank in a production build with no dev error
// overlay to show it (the "all white down there" Coach screen symptom).
//
// PersistQueryClientProvider wraps the whole tree in the shared
// TanStack Query client (src/lib/queryClient.ts) and restores its
// AsyncStorage-persisted cache asynchronously in the background.
// Deliberately NOT gated behind a "cache restored" loading screen: the
// provider renders children immediately with an empty cache, and any
// screen mid-mount when the persisted cache finishes hydrating (usually
// well under 100ms) just has its queries silently resolve from that
// cache the moment it lands, instead of the whole app blocking on a
// disk read before showing anything. This is what makes a warm relaunch
// show the previous session's dashboard/coach data almost instantly
// instead of a blank skeleton while the network request completes.
export default function RootLayout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        // Anything cached longer ago than this is more likely stale/wrong
        // than useful — discard rather than show a week-old dashboard.
        maxAge: 24 * 60 * 60 * 1000,
        // Chat history / large per-session payloads shouldn't be written
        // to the persisted blob — keep it to the read-mostly dashboard,
        // analytics, and profile data this pass is optimizing.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            const key = query.queryKey[0];
            return key !== 'coach' && key !== 'workout';
          },
        },
      }}
    >
      <SafeAreaProvider>
        <ErrorBoundary>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="register" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </ErrorBoundary>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}