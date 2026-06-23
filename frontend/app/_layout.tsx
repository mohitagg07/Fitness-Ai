import '../src/bootErrorCatcher';
import { Stack } from 'expo-router';
import { ErrorBoundary } from '../src/components/system/ErrorBoundary';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ErrorBoundary>
  );
}