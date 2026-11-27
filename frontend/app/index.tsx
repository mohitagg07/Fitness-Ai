import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import { actions } from '../src/store';
import { COLORS } from '../src/theme/colors';

const SECURE_STORAGE_TIMEOUT_MS = 8000;

function readStorageWithTimeout(key: string): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    storage.getItem(key),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Secure storage did not respond in time.')),
        SECURE_STORAGE_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

/**
 * Fast, fail-safe route gate.
 *
 * Only local secure storage is required to select Login vs. the authenticated
 * shell. The backend and query cache must never hold the native app on this
 * screen. A bounded storage read also means an unavailable native storage
 * bridge cannot leave the user staring at an endless spinner.
 */
export default function Index() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loginRequested = useRef(false);

  useEffect(() => {
    let active = true;
    let routed = false;

    const navigate = (path: '/login' | '/(tabs)') => {
      if (!active || routed || loginRequested.current) return;
      routed = true;
      router.replace(path as any);
    };

    const bootstrap = async () => {
      setBootError(null);

      let token: string | null;
      try {
        token = await readStorageWithTimeout('vyrn_token');
      } catch (error) {
        if (active) {
          setBootError(
            error instanceof Error
              ? error.message
              : 'The saved sign-in session could not be read.',
          );
        }
        return;
      }

      if (!active) return;
      if (!token) {
        navigate('/login');
        return;
      }

      // The token is sufficient to enter the shell. A missing or malformed
      // cached identity is recoverable and must not block the first screen.
      let savedUser: any = null;
      try {
        const rawUser = await readStorageWithTimeout('vyrn_user');
        savedUser = rawUser ? JSON.parse(rawUser) : null;
      } catch {
        savedUser = null;
      }

      if (!active) return;
      actions.hydrateAuth(
        savedUser && typeof savedUser === 'object' ? savedUser : { id: null },
        token,
      );
      navigate('/(tabs)');
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, [attempt]);

  if (bootError) {
    return (
      <View style={styles.container}>
        <Text style={styles.brand}>VYRN</Text>
        <Text style={styles.title}>We could not restore your session</Text>
        <Text style={styles.message}>
          Your saved sign-in information is taking too long to load. Retry, or
          continue to Login. Your workout data is not deleted.
        </Text>
        <Text accessibilityRole="text" style={styles.detail}>{bootError}</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry opening VYRN"
          onPress={() => setAttempt((value) => value + 1)}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue to login"
          onPress={() => {
            loginRequested.current = true;
            router.replace('/login');
          }}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Continue to Login</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>VYRN</Text>
      <ActivityIndicator color={COLORS.primaryGreen} size="small" />
      <Text style={styles.loadingText}>Preparing your performance system</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 7,
    marginBottom: 28,
  },
  title: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 14,
  },
  detail: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 22,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 16,
    letterSpacing: 0.3,
  },
  primaryButton: {
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryGreen,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: COLORS.background,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
