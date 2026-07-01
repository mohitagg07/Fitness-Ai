// Brand mark component
//
// Renders the app's badge logo image everywhere in the product — a single
// canonical image asset, never a redrawn/re-interpreted version of it.
// The old text wordmark has been removed; the badge is the only mark.
//
// Four sizes cover every use case:
//   sm  → tab bar / inline header
//   md  → screen headers
//   lg  → login screen
//   xl  → splash screen
//
// Props:
//   showBadge    — kept for backwards compatibility; set false to render nothing
//   showWordmark — no-op, kept only so existing call sites don't need edits
//   vertical     — stack layout (unused now that there's no wordmark, kept for compatibility)

import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

type LogoSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<LogoSize, number> = {
  sm: 34,
  md: 44,
  lg: 96,
  xl: 176,
};

export default function Logo({
  size = 'md',
  showBadge = true,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showWordmark,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vertical,
}: {
  size?: LogoSize;
  showWordmark?: boolean;
  showBadge?: boolean;
  vertical?: boolean;
}) {
  if (!showBadge) return null;

  const s = SIZE_MAP[size];

  return (
    <View style={styles.row}>
      <Image
        source={require('../../../assets/branding/logo-mark.png')}
        style={{ width: s, height: s }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
