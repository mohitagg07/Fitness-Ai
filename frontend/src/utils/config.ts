/**
 * config.ts — single source of truth for the backend API URL.
 *
 * Set EXPO_PUBLIC_API_URL in your environment (or in eas.json under
 * the relevant build profile's "env") to your deployed backend, e.g.
 * https://your-app.up.railway.app/api
 *
 * If this isn't set, the app falls back to localhost, which only
 * ever works in a simulator/emulator running on the same machine as
 * the backend — it will NOT work on a real device, on another
 * network, or in a built APK/IPA. We log a loud warning so this
 * doesn't fail silently again.
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api';

if (!process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    '[config] EXPO_PUBLIC_API_URL is not set — falling back to ' +
      API_BASE +
      '. This will NOT work on a physical device or in a built app. ' +
      'Set EXPO_PUBLIC_API_URL in your eas.json build profile or .env file.',
  );
}
