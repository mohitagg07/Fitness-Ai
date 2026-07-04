import { storage } from './storage';
import { queryClient } from '../lib/queryClient';
import { qk } from '../lib/queryKeys';

// Single source of truth for "wipe this device's session." Previously this
// logic was duplicated (and drifting) across api.ts's 401 interceptor,
// store/index.ts's logout(), and the ad-hoc invalid-token branch in
// (tabs)/_layout.tsx — each one deleting the token/user keys but only one
// of them (api.ts) also happened to touch the query cache. That meant a
// device could end up "logged out" (no token) while still holding a
// completely different account's cached /profile/me response, which would
// flash on screen the instant the next login's Dashboard mounted, before
// its own fetch resolved. Every code path that decides a session is over
// now calls this one function so there's exactly one definition of what
// "logged out" clears.
export async function clearAuthData(): Promise<void> {
  await Promise.all([
    storage.deleteItem('vyrn_token'),
    storage.deleteItem('vyrn_user'),
  ]);
  // Drop profile-scoped cache (not the whole client — workout history,
  // etc. isn't inherently sensitive and clearing it would just cause
  // needless re-fetches on the next login) so a fresh login never renders
  // a stale flash of the previous session's identity.
  queryClient.removeQueries({ queryKey: qk.profile.all });
}
