// VYRN — Dashboard data hooks
//
// PERF: this is the core of the "progressive rendering with independent
// queries" requirement. DashboardScreen used to await two sequential
// network calls (mission/dashboard summary, then weekly-stats) behind one
// `loading` boolean before rendering a single pixel of real content — a
// full-screen skeleton no matter how fast any individual card's data
// actually was. Each hook below is independent: React Query fires all of
// them in parallel the moment DashboardScreen mounts, each card renders
// the instant *its own* query resolves (or instantly from persisted cache
// on a warm start) rather than waiting on the slowest one, and each keeps
// its last-good data on screen during a refetch instead of unmounting to
// a spinner.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  missionApi, dashboardApi, analyticsApi, reviewApi, programApi,
} from '../utils/api';
import api from '../utils/api';
import { qk, STALE } from './queryKeys';

// mission/today is the richer payload (proactive_brief, pattern_insights).
// dashboard/summary is the older fallback. Same shape-compatible fields
// used by DashboardScreen previously — this hook keeps that same
// fallback behavior, just inside React Query instead of a hand-rolled
// try/catch in the component.
async function fetchMissionSummary() {
  try {
    const res = await missionApi.getToday();
    return res.data;
  } catch {
    const res = await dashboardApi.getSummary();
    return res.data;
  }
}

export function useMissionSummary() {
  return useQuery({
    queryKey: qk.dashboard.mission(),
    queryFn: fetchMissionSummary,
    staleTime: STALE.short,
  });
}

export function useWeeklyStats() {
  return useQuery({
    queryKey: qk.analytics.weeklyStats(),
    queryFn: async () => (await analyticsApi.getWeeklyStats()).data,
    staleTime: STALE.short,
  });
}

export function usePrTimeline(limit = 20) {
  return useQuery({
    queryKey: qk.analytics.prTimeline(limit),
    queryFn: async () => (await analyticsApi.getPRTimeline(limit)).data,
    staleTime: STALE.medium,
  });
}

export function useWeeklyReview(weeksAgo = 0) {
  return useQuery({
    queryKey: qk.review.weekly(weeksAgo),
    queryFn: async () => (await reviewApi.getWeekly(weeksAgo)).data,
    staleTime: STALE.medium,
  });
}

export function useProgramVersions(limit = 10) {
  return useQuery({
    queryKey: qk.program.versions(limit),
    queryFn: async () => (await programApi.getVersions(limit)).data,
    staleTime: STALE.long,
  });
}

// Timeline card — GET /coach/coach-timeline (kept on the raw `api` client
// since coachApi doesn't expose the /coach-timeline path under a typed
// name that matches its response shape used by TimelineCard).
export function useCoachTimeline(limit = 15) {
  return useQuery({
    queryKey: qk.coachTimeline.list(limit),
    queryFn: async () => (await api.get('/coach/coach-timeline', { params: { limit } })).data,
    staleTime: STALE.short,
  });
}

export function useConsistency(enabled = true) {
  return useQuery({
    queryKey: qk.consistency.all,
    queryFn: async () => (await api.get('/progress/consistency')).data,
    staleTime: STALE.short,
    enabled,
  });
}

// One shared "refresh the whole dashboard" action for pull-to-refresh —
// invalidates every independent query at once so React Query re-runs them
// all in parallel in the background, without unmounting any card (no
// flash back to skeleton — each card just silently swaps in fresh data
// when its own request resolves).
export function useRefreshDashboard() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.dashboard.all }),
    queryClient.invalidateQueries({ queryKey: qk.analytics.all }),
    queryClient.invalidateQueries({ queryKey: qk.review.all }),
    queryClient.invalidateQueries({ queryKey: qk.program.all }),
    queryClient.invalidateQueries({ queryKey: qk.coachTimeline.all }),
    queryClient.invalidateQueries({ queryKey: qk.consistency.all }),
  ]);
}

// ── Prefetch helpers ─────────────────────────────────────────────────────
// Called from app/(tabs)/_layout.tsx on tab press (before navigation
// completes) and from QuickToolsCard on press-in, so the destination
// screen's primary query is already resolved (or in flight) by the time
// its component mounts — this is what "preload high-priority data during
// navigation" means in practice: shaving the full round-trip off of
// perceived navigation latency, not just showing a nicer skeleton.
export function usePrefetchDashboard() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.prefetchQuery({ queryKey: qk.dashboard.mission(), queryFn: fetchMissionSummary, staleTime: STALE.short });
    queryClient.prefetchQuery({ queryKey: qk.analytics.weeklyStats(), queryFn: async () => (await analyticsApi.getWeeklyStats()).data, staleTime: STALE.short });
  };
}