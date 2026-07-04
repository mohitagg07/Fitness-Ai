// VYRN — Profile data hooks
//
// PERF: ProfileScreen previously ran four sequential/parallel raw API
// calls (profile/me, profile/prs, dashboard/summary, progress/weekly-
// stats) behind a single useEffect+useState fetch, every single time the
// screen mounted — no cache, no de-dup with the identical calls Home
// already makes for the streak/weekly-stats numbers, and a full-screen
// spinner until all four resolved. These hooks put profile/me and
// profile/prs on the shared query cache (instant render from cache on a
// warm return to the tab) and reuse the *same* useMissionSummary /
// useWeeklyStats queries the dashboard already fires — meaning Home and
// Profile now share one in-flight request instead of two.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '../utils/api';
import { qk, STALE } from './queryKeys';

export function useProfileMe() {
  return useQuery({
    queryKey: qk.profile.me(),
    queryFn: async () => (await profileApi.getMe()).data,
    staleTime: STALE.medium,
  });
}

export function useProfilePRs() {
  return useQuery({
    queryKey: qk.profile.prs(),
    queryFn: async () => (await profileApi.getPRs()).data,
    staleTime: STALE.medium,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => profileApi.updateMe(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile.all });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, mimeType }: { uri: string; mimeType: string }) =>
      profileApi.uploadAvatar(uri, mimeType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile.all });
    },
  });
}

export function useAddInjury() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => profileApi.addInjury(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile.all });
    },
  });
}

export function useDeleteInjury() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.deleteInjury(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile.all });
    },
  });
}
