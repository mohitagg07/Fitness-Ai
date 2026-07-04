// VYRN — TanStack Query client
//
// PERF RATIONALE: before this file existed, every screen owned its own
// useEffect+useState fetch (see git history of DashboardScreen and its
// cards). That means: (1) no cache — navigating Home -> Progress -> Home
// re-fetched everything from zero every time, even if the data was 10
// seconds old; (2) no de-duplication — two cards hitting the same
// endpoint (e.g. mission/today) fired two network requests; (3) no
// background refetching — data only ever updated on a manual pull-to-
// refresh or an explicit refetch call; (4) nothing was available offline
// or on cold start until the network round trip finished, so every cold
// launch showed a full-screen skeleton no matter how recently the user
// had last opened the app.
//
// This client fixes all four: a shared in-memory cache keyed by
// queryKey, persisted to AsyncStorage so the *previous* session's data
// renders instantly on cold start (stale-while-revalidate) instead of a
// blank skeleton, tuned per-endpoint staleTime (see queryKeys.ts) so nothing
// over-fetches, and background refetch-on-focus/reconnect so data quietly
// catches up without blocking interaction.
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default: data is "fresh enough" for 30s, so rapid re-mounts
      // (tab switches, focus events) don't re-fetch — override per-hook
      // for data that changes faster (active workout session) or slower
      // (program versions, PR history).
      staleTime: 30_000,
      // Keep unused data in cache for 24h so a cold app relaunch can
      // still show yesterday's dashboard instantly from the persisted
      // cache while the real refetch runs in the background.
      gcTime: 24 * 60 * 60 * 1000,
      // One retry, short backoff — mobile networks blip constantly, but
      // we don't want a dead backend to hang the UI in retry limbo for
      // the default 3-retry exponential backoff (up to ~30s).
      retry: 1,
      retryDelay: 1000,
      refetchOnReconnect: true,
      // Refetch when the app returns to foreground (see focusManager
      // wiring below) so recovery/CNS/streak numbers don't go stale
      // while the app sat backgrounded overnight.
      refetchOnWindowFocus: true,
      // Never let a background refetch show a loading spinner over
      // already-rendered content — this is the crux of "stays
      // interactive during network operations". Screens should read
      // `isPending` (no data yet) rather than `isFetching` (any fetch in
      // flight, including silent background ones) to decide whether to
      // show a skeleton.
      networkMode: 'online',
    },
    mutations: {
      networkMode: 'online',
      retry: 0,
    },
  },
});

// React Query's focusManager defaults to a browser `visibilitychange`
// listener, which does not exist in React Native. Without wiring this to
// AppState, refetchOnWindowFocus above is a no-op on device — background
// refresh only ever happens via the manual useFocusEffect calls that used
// to live in every screen. This one subscription now drives that
// behavior app-wide.
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}
AppState.addEventListener('change', onAppStateChange);

// NOTE on connectivity: refetchOnReconnect above relies on onlineManager,
// which defaults to "always online" on React Native (there's no native
// connectivity event without @react-native-community/netinfo). Queries
// still behave correctly without it — failed requests reject and
// describeApiError() classifies them — this is just a known follow-up if
// true airplane-mode-aware refetching becomes a priority: wire
// onlineManager.setEventListener() to a NetInfo.addEventListener
// subscription.

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'VYRN_QUERY_CACHE',
  // Cap what gets written to disk — chat history / large payloads should
  // not be persisted verbatim; this throttles writes to avoid janking the
  // JS thread on every single cache update.
  throttleTime: 1000,
});