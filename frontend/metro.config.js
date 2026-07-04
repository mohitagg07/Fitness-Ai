const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ── Force a single physical copy of every @tanstack/query-* package ──────
//
// Symptom this fixes: "No QueryClient set, use QueryClientProvider to set
// one" thrown from a hook that calls useQueryClient() (e.g.
// usePrefetchDashboard), even though PersistQueryClientProvider is clearly
// mounted above it in app/_layout.tsx.
//
// Why pinning conditionNames alone (the previous attempt) wasn't enough:
// that only controls *which build* of a resolved package Metro loads
// (require vs import). It does nothing if there are literally two
// separate `@tanstack/react-query` directories on disk that both satisfy
// Node's module resolution — e.g. one hoisted to frontend/node_modules and
// another nested inside some other package's own node_modules because npm
// couldn't dedupe it (version ranges among @tanstack/react-query-persist-
// client, @tanstack/query-async-storage-persister, and any other consumer
// didn't align exactly). Metro treats each resolved absolute file path as
// a distinct module instance — two directories means two copies of
// `React.createContext()` inside QueryClientProvider.js, so the Provider
// instance app/_layout.tsx renders (built from copy A) is invisible to
// useQueryClient() calls that got resolved against copy B, no matter how
// correctly the component tree is nested.
//
// extraNodeModules is Metro's mechanism for pinning a bare specifier to
// one exact directory for every import site in the bundle, overriding
// whatever the normal node_modules directory walk would have found. That
// collapses every @tanstack/query-* import back down to a single physical
// file per package — one context, everywhere.
const TANSTACK_ROOT = path.resolve(__dirname, 'node_modules', '@tanstack');

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@tanstack/react-query': path.join(TANSTACK_ROOT, 'react-query'),
  '@tanstack/react-query-persist-client': path.join(TANSTACK_ROOT, 'react-query-persist-client'),
  '@tanstack/query-core': path.join(TANSTACK_ROOT, 'query-core'),
  '@tanstack/query-persist-client-core': path.join(TANSTACK_ROOT, 'query-persist-client-core'),
  '@tanstack/query-async-storage-persister': path.join(TANSTACK_ROOT, 'query-async-storage-persister'),
};

// Keep this from the previous pass too — it stops Metro from picking a
// different build (require vs import) per call site for packages that do
// resolve cleanly, which is a milder version of the same class of bug.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['require', 'react-native'];

module.exports = config;
