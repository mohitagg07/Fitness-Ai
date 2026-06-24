/**
 * app/index.tsx — Root entry point
 *
 * Flow:
 *   1. Animated splash (logo)
 *   2a. No token → /login
 *   2b. Token present but INVALID (expired/orphaned) → clear storage → /login
 *   2c. Valid token, no onboarding done → /onboarding
 *   2d. Valid token + onboarded → /(tabs)
 *
 * The extra token-verify step (2b) prevents the "I logged in, it worked,
 * but now it just keeps showing the loading screen" symptom caused by a
 * stale token from a previous Supabase project/secret-key rotation sitting
 * in SecureStore and passing the "token exists" check while being rejected
 * by every actual API call.
 */
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import AnimatedSplash from '../src/components/splash/AnimatedSplash';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api';

type VerifyResult = 'valid' | 'orphaned' | 'unreachable';

async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return 'valid';
    // Only treat as truly dead if backend explicitly says so
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string' && body.detail.startsWith('ORPHANED_SESSION')) {
        return 'orphaned';
      }
    } catch {}
    // Any other 401/403 (profile missing, transient error) — let the
    // user in. The route handler will surface the real error if needed.
    return 'valid';
  } catch {
    // Network error or timeout — assume fine, fail-open.
    return 'unreachable';
  }
}

export default function Index() {
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!splashDone) return;
    let settled = false;

    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn('[Index] Auth check timed out after 8s — redirecting to /login');
        router.replace('/login');
      }
    }, 8000);

    (async () => {
      try {
        const token = await storage.getItem('neurofit_token');
        if (settled) return;

        if (!token) {
          settled = true;
          clearTimeout(safetyTimer);
          router.replace('/login');
          return;
        }

        // Verify the token — only wipe storage if backend explicitly says
        // this session is orphaned (user deleted from Supabase, etc.).
        // A plain network error or any other 401 lets the user in; the
        // normal axios 401 interceptor handles genuinely expired tokens.
        const verifyResult = await verifyToken(token);
        if (settled) return;

        if (verifyResult === 'orphaned') {
          await storage.deleteItem('neurofit_token');
          await storage.deleteItem('neurofit_user');
          settled = true;
          clearTimeout(safetyTimer);
          router.replace('/login');
          return;
        }

        const onboarded = await storage.getItem('neurofit_onboarded');
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);

        if (!onboarded) {
          router.replace('/onboarding');
          return;
        }

        router.replace('/(tabs)');
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        console.warn('[Index] Auth check threw an error:', err);
        router.replace('/login');
      }
    })();

    return () => {
      settled = true;
      clearTimeout(safetyTimer);
    };
  }, [splashDone]);

  return (
    <View style={styles.container}>
      <AnimatedSplash onFinished={() => setSplashDone(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});