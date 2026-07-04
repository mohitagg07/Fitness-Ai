import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import { profileApi } from '../src/utils/api';
import { queryClient } from '../src/lib/queryClient';
import { qk } from '../src/hooks/queryKeys';
import AnimatedSplash from '../src/components/splash/AnimatedSplash';
import { COLORS } from '../src/theme/colors';

// PERF (startup time): this used to await the token read, then await
// GET /profile/me, and only *after both finished* start the splash-exit
// navigation — and the splash animation itself didn't even start that
// chain until it finished playing (`if (!splashDone) return`). That's
// two serialized delays stacked on top of each other: the full splash
// animation duration, then a full network round trip, before the very
// first real screen appears.
//
// Now the auth/profile check kicks off immediately on mount, in parallel
// with the splash animation — by the time the animation finishes, the
// network call has usually already resolved (or resolved from the
// persisted React Query cache instantly on a warm start), so navigation
// fires the instant both are ready instead of one after the other.
export default function Index() {
  const [splashDone, setSplashDone] = useState(false);
  const destinationRef = useRef<string | null>(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await storage.getItem('vyrn_token');
        if (!token) {
          destinationRef.current = '/login';
          maybeNavigate();
          return;
        }
        try {
          // Routed through the query cache (not a bare axios call) so a
          // warm relaunch can resolve this from the persisted cache
          // written by the last session — often before the splash
          // animation even finishes — while still revalidating in the
          // background for the next screen to read fresh data from.
          const data = await queryClient.fetchQuery({
            queryKey: qk.profile.me(),
            queryFn: async () => (await profileApi.getMe()).data,
            staleTime: 60_000,
          });
          destinationRef.current = data?.onboarding_complete ? '/(tabs)' : '/onboarding';
        } catch {
          // Profile fetch failed (offline, expired token, etc.) — fall
          // back to tabs rather than forcing onboarding on a returning
          // user just because one request failed. (tabs)/_layout.tsx
          // still re-checks the token itself and will bounce to /login
          // if it's actually invalid.
          destinationRef.current = '/(tabs)';
        }
      } catch {
        destinationRef.current = '/login';
      }
      maybeNavigate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function maybeNavigate() {
    if (navigatedRef.current) return;
    if (!splashDone || !destinationRef.current) return;
    navigatedRef.current = true;
    router.replace(destinationRef.current as any);
  }

  useEffect(() => {
    maybeNavigate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splashDone]);

  return (
    <View style={styles.container}>
      <AnimatedSplash onFinished={() => setSplashDone(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Was: flex:1 + alignItems/justifyContent:'center'. Setting alignItems
  // on a column flex container switches its child's cross-axis sizing
  // from the default 'stretch' to content-sized-and-centered — so the
  // flex:1 <AnimatedSplash> below was shrinking to a narrow centered
  // column instead of filling the screen width. AnimatedSplash already
  // centers its own content internally, so this wrapper just needs to
  // be a plain full-bleed flex:1 box.
  //
  // Background was also '#121212' (dark gray) while AnimatedSplash uses
  // true black (#000000) — the mismatch is what made the collapsed box's
  // edges visible as a seam. Matching COLORS.background removes that
  // regardless of the sizing fix, so there's no flash either way.
  container: { flex: 1, backgroundColor: COLORS.background },
});