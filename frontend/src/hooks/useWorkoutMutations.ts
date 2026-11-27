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
import {
  enqueuePendingWorkoutSet,
  getPendingWorkoutSets,
  removePendingWorkoutSet,
} from '../utils/workoutOutbox';

type PendingSyncResult = { synced: number; remaining: number };

const pendingSyncs = new Map<string, Promise<PendingSyncResult>>();

async function performPendingWorkoutSync(sessionId: string): Promise<PendingSyncResult> {
  const pending = await getPendingWorkoutSets(sessionId);
  let synced = 0;

  // Replay in order. The backend makes each client_request_id idempotent,
  // including the case where the original server response was lost.
  for (const item of pending) {
    const { sessionId: queuedSessionId, queued_at: _queuedAt, ...data } = item;
    try {
      const response = await workoutApi.logSet(queuedSessionId, data);
      await removePendingWorkoutSet(item.client_request_id);
      actions.replaceLogInSession(item, response.data, sessionId);
      synced += 1;
    } catch {
      // Keep this item and later items. The active session must not be closed
      // while an unsynced set remains in the local outbox.
      break;
    }
  }

  return {
    synced,
    remaining: (await getPendingWorkoutSets(sessionId)).length,
  };
}

export function syncPendingWorkoutSets(sessionId: string): Promise<PendingSyncResult> {
  const existing = pendingSyncs.get(sessionId);
  if (existing) return existing;

  const operation = performPendingWorkoutSync(sessionId).finally(() => {
    if (pendingSyncs.get(sessionId) === operation) pendingSyncs.delete(sessionId);
  });
  pendingSyncs.set(sessionId, operation);
  return operation;
}

export interface SetLogInput {
  sessionId: string;
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
  client_request_id: string;
}

export function useLogSet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (log: SetLogInput) => {
      const { sessionId, ...data } = log;
      let persisted: any = null;
      try {
        const response = await workoutApi.logSet(sessionId, data);
        persisted = response.data;
      } catch {
        // onMutate has already committed the full request to AsyncStorage.
        // Keep it visible and retry later instead of rolling the set back.
        return { optimistic: log, persisted: null, pending: true };
      }

      try {
        await removePendingWorkoutSet(log.client_request_id);
        return { optimistic: log, persisted, pending: false };
      } catch {
        // The server may have committed but local cleanup failed. A replay is
        // safe because it reuses the exact same idempotency key.
        return { optimistic: log, persisted, pending: true };
      }
    },
    // Runs synchronously before the network call — this is the entire
    // optimistic-update contract: the store already reflects the logged
    // set by the time this function returns, well before any response.
    onMutate: async (log) => {
      const { sessionId, ...data } = log;
      // Persist first. If local storage fails, do not display a set that
      // neither the server nor the device has accepted responsibility for.
      await enqueuePendingWorkoutSet(log);
      actions.addLogToSession(data);
      return { loggedData: data, sessionId };
    },
    onSuccess: (result) => {
      // A pending result remains in the visible workout log. The later replay
      // replaces it with the authoritative database row.
      if (result.persisted) {
        actions.replaceLogInSession(result.optimistic, result.persisted, result.optimistic.sessionId);
      }
    },
    onError: (_err, _log, context) => {
      // Network failures are returned as pending successes by mutationFn.
      // This rollback is only for an unexpected error after local enqueue.
      actions.removeLogFromSession(context?.loggedData, context?.sessionId);
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

export interface WorkoutFeedbackInput {
  mood?: 'great' | 'good' | 'okay' | 'bad';
  session_effort?: number;
  energy_level?: number;
  pain_status?: 'none' | 'mild' | 'sharp' | 'worsening';
  pain_notes?: string;
  session_notes?: string;
}

export function useCompleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, feedback }: { sessionId: string; feedback?: WorkoutFeedbackInput }) =>
      workoutApi.completeSession(sessionId, feedback),
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