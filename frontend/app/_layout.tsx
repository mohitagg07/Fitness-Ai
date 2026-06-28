// Root layout — FIXED: was incorrectly a Tabs layout causing double tab bar.
// Should be a Stack that lets expo-router handle (tabs)/ group naturally.
import { Stack } from 'expo-router';
import { COLORS } from '../src/theme/colors';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
