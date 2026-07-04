// VYRN — lazy route wrapper
//
// PERF (startup time / bundle evaluation): expo-router resolves every
// file under app/ to build its route table, which means route files are
// part of the app's module graph regardless of whether they're visited.
// If a route file directly imports a heavy screen component (chart
// libraries, camera modules, big constant tables) at the top level, that
// screen's entire import chain gets evaluated during initial bundle
// load/parse even though React Navigation won't *render* it until the
// user actually taps into that tab (tabs are already lazy-mounted by
// default).
//
// Wrapping the screen in React.lazy() defers requiring its module (and
// therefore evaluating everything it imports) until the first time this
// component actually renders — i.e. the first time the user navigates
// there. For the four hidden tools tabs (Decisions, Simulate, Form
// Analysis, PRs) and any other non-critical route, that's real startup
// and memory savings on cold launch: their JS doesn't run at all until
// asked for.
import React, { Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { COLORS } from '../../theme/colors';

function RouteFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator color={COLORS.primaryGreen} size="large" />
    </View>
  );
}

export function lazyRoute(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  const LazyComponent = React.lazy(loader);
  return function LazyRouteScreen(props: any) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});