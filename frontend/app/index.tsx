import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';
import { profileApi } from '../src/utils/api';
import AnimatedSplash from '../src/components/splash/AnimatedSplash';
import { COLORS } from '../src/theme/colors';

export default function Index() {
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!splashDone) return;
    (async () => {
      try {
        const token = await storage.getItem('vyrn_token');
        if (!token) {
          router.replace('/login');
          return;
        }
        // A valid token alone doesn't mean onboarding is done — a user
        // can close the app mid-onboarding, or log into the same account
        // on a second device, and still have onboarding_complete: false
        // on their profile. Previously this only checked for a token and
        // always sent straight to /(tabs), so those users landed on an
        // unconfigured dashboard instead of finishing onboarding.
        try {
          const res = await profileApi.getMe();
          router.replace(res.data?.onboarding_complete ? '/(tabs)' : '/onboarding');
        } catch {
          // Profile fetch failed (offline, expired token, etc.) — fall
          // back to tabs rather than forcing onboarding on a returning
          // user just because one request failed. (tabs)/_layout.tsx
          // still re-checks the token itself and will bounce to /login
          // if it's actually invalid.
          router.replace('/(tabs)');
        }
      } catch {
        router.replace('/login');
      }
    })();
  }, [splashDone]);

  return (
    <View style={styles.container}>
      <AnimatedSplash onFinished={() => setSplashDone(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Was: flex:1 + alignItems/justifyContent:'center'. Setting alignItems
  // on a column flex container switches its child's cross-axis sizing
  // from the default 'stretch' to content-sized-and-centered — so the
  // flex:1 <AnimatedSplash> below was shrinking to a narrow centered
  // column instead of filling the screen width. AnimatedSplash already
  // centers its own content internally, so this wrapper just needs to
  // be a plain full-bleed flex:1 box.
  //
  // Background was also '#121212' (dark gray) while AnimatedSplash uses
  // true black (#000000) — the mismatch is what made the collapsed box's
  // edges visible as a seam. Matching COLORS.background removes that
  // regardless of the sizing fix, so there's no flash either way.
  container: { flex: 1, backgroundColor: COLORS.background },
});