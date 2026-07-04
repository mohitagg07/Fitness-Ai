import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../src/components/system/ErrorBoundary';

// SafeAreaProvider MUST wrap the whole app, once, at the root. Several
// screens (CoachScreen, ProfileScreen, DashboardHeader, PRScreen,
// NutritionSearchModal, CoachMemoryModal) call useSafeAreaInsets() —
// without this provider mounted above them, that hook has nothing to
// read from. Depending on the screen/library version this either throws
// outright (ProfileScreen's crash: "property insets doesn't exist") or
// silently renders blank in a production build with no dev error
// overlay to show it (the "all white down there" Coach screen symptom).
export default function RootLayout() {
  return (
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
  );
}