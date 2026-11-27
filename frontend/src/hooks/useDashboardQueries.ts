// VYRN — Dashboard data hooks
//
// Independent React Query resources keep the dashboard progressive: cached
// values paint immediately, then each query refreshes in the background.
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  missionApi, dashboardApi, analyticsApi, reviewApi, programApi,
} from '../utils/api';
import api from '../utils/api';
import { qk, STALE } from '../lib/queryKeys';

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

export function useRefreshDashboard() {
  const queryClient = useQueryClient();
  return useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.dashboard.all }),
    queryClient.invalidateQueries({ queryKey: qk.analytics.all }),
    queryClient.invalidateQueries({ queryKey: qk.review.all }),
    queryClient.invalidateQueries({ queryKey: qk.program.all }),
    queryClient.invalidateQueries({ queryKey: qk.coachTimeline.all }),
    queryClient.invalidateQueries({ queryKey: qk.consistency.all }),
  ]), [queryClient]);
}

/** Stable callback so the tab shell's boot effect never re-runs on rerender. */
export function usePrefetchDashboard() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: qk.dashboard.mission(),
      queryFn: fetchMissionSummary,
      staleTime: STALE.short,
    });
    void queryClient.prefetchQuery({
      queryKey: qk.analytics.weeklyStats(),
      queryFn: async () => (await analyticsApi.getWeeklyStats()).data,
      staleTime: STALE.short,
    });
  }, [queryClient]);
}
