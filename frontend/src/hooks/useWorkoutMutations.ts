// VYRN — Workout mutations (optimistic)
//
// PERF: WorkoutHUD.logSet() previously did
//   await workoutApi.logSet(...) -> addLogToSession(...) -> haptics -> rest timer
// i.e. every tap of "Log Set" blocked the UI update (the set appearing in
// the session log, the rest timer starting, the haptic firing) on a full
// network round trip. On a mid-range Android phone on mobile data that's
// routinely 300-800ms of a mid-set tap doing *nothing* visible — exactly
// the kind of dead-feeling interaction this pass is meant to remove.
//
// useLogSet below flips the order: the local state update happens
// synchronously in onMutate (before the request is even sent), the
// request fires in the background, and only a *failure* touches the UI
// again (rolling back the optimistic log + surfacing an alert). Success
// is silent — the user already saw their set logged the instant they
// tapped.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workoutApi } from '../utils/api';
import { actions } from '../store';
import { qk } from '../lib/queryKeys';

export interface SetLogInput {
  sessionId: string;
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
}

export function useLogSet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (log: SetLogInput) => {
      const { sessionId, ...data } = log;
      await workoutApi.logSet(sessionId, data);
      return log;
    },
    // Runs synchronously before the network call — this is the entire
    // optimistic-update contract: the store already reflects the logged
    // set by the time this function returns, well before any response.
    onMutate: async (log) => {
      const { sessionId, ...data } = log;
      actions.addLogToSession(data);
      // Return the log so onError can identify/roll back exactly this
      // entry (not just "the last one", in case of rapid double-taps
      // across different sets before either request settles).
      return { loggedData: data };
    },
    onError: (_err, _log, context) => {
      // Roll back only the optimistic entry this mutation added — a
      // second in-flight logSet's optimistic entry (or a real
      // server-confirmed one) must survive this rollback untouched.
      actions.removeLogFromSession(context?.loggedData);
    },
    onSettled: () => {
      // Background-refresh the numbers that a logged set can move —
      // weekly volume, PR timeline — without blocking or re-showing a
      // spinner over the workout screen itself.
      queryClient.invalidateQueries({ queryKey: qk.analytics.weeklyStats() });
      queryClient.invalidateQueries({ queryKey: qk.analytics.all });
    },
  });
}

export function useCompleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, cnsFatigue, mood }: { sessionId: string; cnsFatigue?: number; mood?: string }) =>
      workoutApi.completeSession(sessionId, cnsFatigue, mood),
    onSuccess: () => {
      // A completed session changes recovery/streak numbers on the
      // dashboard and this week's stats — invalidate rather than
      // optimistically guess those derived server-side values.
      queryClient.invalidateQueries({ queryKey: qk.dashboard.all });
      queryClient.invalidateQueries({ queryKey: qk.analytics.all });
      queryClient.invalidateQueries({ queryKey: qk.workout.all });
    },
  });
}