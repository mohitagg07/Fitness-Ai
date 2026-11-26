import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { COLORS } from '../../src/theme/colors';

function readRedirectParams(url: string | null): URLSearchParams {
  if (!url) return new URLSearchParams();
  const [beforeHash, hash = ''] = url.split('#', 2);
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  return new URLSearchParams([query, hash].filter(Boolean).join('&'));
}

export default function AuthCallbackScreen() {
  // Supabase verifies the one-time email token before redirecting here.
  // The URL fragment may contain Supabase session tokens; VYRN deliberately
  // does not persist them because the backend uses its own signed API session.
  const incomingUrl = Linking.useURL();

  const result = useMemo(() => {
    const params = readRedirectParams(incomingUrl);
    const error = params.get('error_description') || params.get('error');
    const isSignupConfirmation =
      params.get('type') === 'signup' ||
      params.has('access_token') ||
      params.has('code');

    if (error) {
      return {
        success: false,
        title: 'Confirmation link could not be completed',
        message: error.replace(/\+/g, ' '),
      };
    }
    if (isSignupConfirmation) {
      return {
        success: true,
        title: 'Email confirmed',
        message: 'Your email address has been verified. Sign in with your email and password to continue.',
      };
    }
    return {
      success: false,
      title: 'Return to VYRN',
      message: 'Open the confirmation link from your email on this device. If the link has expired, request a new confirmation email.',
    };
  }, [incomingUrl]);

  return (
    <View style={styles.container}>
      <View style={styles.mark}>
        {result.success ? (
          <Text style={styles.check}>✓</Text>
        ) : (
          <ActivityIndicator size="large" color={COLORS.primaryGreen} />
        )}
      </View>
      <Text style={styles.brand}>VYRN</Text>
      <Text style={styles.title}>{result.title}</Text>
      <Text style={styles.message}>{result.message}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.button}
        onPress={() => router.replace('/login')}
      >
        <Text style={styles.buttonText}>CONTINUE TO SIGN IN</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 24,
  },
  check: { color: COLORS.primaryGreen, fontSize: 34, fontWeight: '800' },
  brand: {
    color: COLORS.primaryGreen,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 4,
    marginBottom: 18,
  },
  title: {
    color: COLORS.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 30,
  },
  button: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: COLORS.primaryGreen,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: COLORS.background,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
