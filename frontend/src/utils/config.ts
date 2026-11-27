/**
 * Single source of truth for the VYRN API URL.
 *
 * The hosted HTTPS API is the safe default for Expo Go and physical phones.
 * Override EXPO_PUBLIC_API_URL in .env when running a local backend.
 */
const DEFAULT_API_BASE = 'https://neurofit-ai-backend.onrender.com/api';

export const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_BASE
).replace(/\/+$/, '');

if (!process.env.EXPO_PUBLIC_API_URL) {
  console.info(
    '[VYRN] EXPO_PUBLIC_API_URL is not set; using the hosted API. ' +
    'Set it in frontend/.env to use a local backend.',
  );
}
