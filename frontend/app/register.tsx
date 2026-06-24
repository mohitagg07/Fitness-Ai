/**
 * /register is no longer used — registration is handled by the combined
 * LoginScreen at /login (tap "SIGN UP" to toggle). This file redirects
 * any stale deep-links to /login so nothing 404s.
 */
import { Redirect } from 'expo-router';
export default function RegisterRedirect() {
  return <Redirect href="/login" />;
}