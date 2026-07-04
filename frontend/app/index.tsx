import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import { profileApi, describeApiError } from '../src/utils/api';
import { clearAuthData } from '../src/utils/auth';
import { queryClient, hydrated } from '../src/lib/queryClient';
import { qk } from '../src/lib/queryKeys';
import AnimatedSplash from '../src/components/splash/AnimatedSplash';
import { COLORS } from '../src/theme/colors';

// ── Boot state machine ───────────────────────────────────────────────────
// Every branch below ends in exactly one of two outcomes:
//   1. `destination` gets set to a route, which navigates once the splash
//      animation has also finished (see maybeNavigate), or
//   2. `phase` becomes 'error', which renders a Retry button instead of an
//      indeterminate spinner.
// There is no branch that falls through without doing one of these two
// things, so the app can never be left sitting on the loading indicator
// forever — a bug in the previous version, which caught a failed
// /profile/me call (including a genuinely expired/invalid token) and
// silently sent the user into /(tabs) anyway, deferring the problem to
// (tabs)/_layout.tsx's own separate re-check.
type Phase =
  | 'hydrating'   // waiting for PersistQueryClientProvider to restore its cache
  | 'validating'  // token found, confirming it against /profile/me
  | 'error';      // network/server error — can't confirm identity right now

export default function Index() {
  const [splashDone, setSplashDone] = useState(false);
  const [phase, setPhase] = useState<Phase>('hydrating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const destinationRef = useRef<string | null>(null);
  const navigatedRef = useRef(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function runBootstrap() {
      setPhase('hydrating');
      setErrorMessage(null);
      destinationRef.current = null;

      // Step 1 — wait for the persisted query cache to finish restoring.
      // Reading/fetchQuery-ing before this resolves races the restore (see
      // the comment on `hydrated` in src/lib/queryClient.ts). This runs in
      // parallel with the splash animation, not after it, so a warm start
      // is still fast.
      await hydrated;
      if (cancelled) return;

      // Step 2 — is there a token at all?
      let token: string | null;
      try {
        token = await storage.getItem('vyrn_token');
      } catch {
        // Can't read secure storage — safest default is "logged out"
        // rather than guessing.
        token = null;
      }
      if (cancelled) return;

      if (!token) {
        destinationRef.current = '/login';
        maybeNavigate();
        return;
      }

      // Step 3 — validate the token against the real backend. This is the
      // only source of truth for "is this session still good" — a token
      // existing in storage doesn't mean the server still honors it.
      setPhase('validating');
      try {
        const data = await queryClient.fetchQuery({
          queryKey: qk.profile.me(),
          queryFn: async () => (await profileApi.getMe()).data,
          staleTime: 60_000,
        });
        if (cancelled) return;
        // Step 4 — validation succeeded: route on onboarding status.
        destinationRef.current = data?.onboarding_complete ? '/(tabs)' : '/onboarding';
        maybeNavigate();
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          // Token is real but no longer valid (expired, revoked, signing
          // key rotated, account deleted, ...). Wipe it so the person
          // isn't stuck in a loop of being silently bounced back here.
          await clearAuthData();
          if (cancelled) return;
          destinationRef.current = '/login';
          maybeNavigate();
          return;
        }
        // Network/timeout/server error — we genuinely don't know whether
        // this session is valid. Don't guess (old behavior defaulted to
        // /(tabs), which could show an authenticated shell for a token
        // that was actually dead). Surface a retry instead.
        setErrorMessage(describeApiError(err).message);
        setPhase('error');
      }
    }

    runBootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

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

  function handleRetry() {
    navigatedRef.current = false;
    setRetryTick((n) => n + 1);
  }

  return (
    <View style={styles.container}>
      {!splashDone ? (
        <AnimatedSplash onFinished={() => setSplashDone(true)} />
      ) : phase === 'error' ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>Couldn't connect</Text>
          <Text style={styles.errorMessage}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryText}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Splash's own exit timer is independent of how long token/profile
        // validation takes (a cold free-tier backend can take 20-50s to
        // wake up) — this keeps something visibly alive on screen for that
        // entire wait instead of a blank frame.
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  errorWrap: { alignItems: 'center', paddingHorizontal: 32 },
  errorTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  errorMessage: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  retryBtn: {
    backgroundColor: COLORS.recoveryHigh,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 36,
  },
  retryText: { color: COLORS.background, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
});
