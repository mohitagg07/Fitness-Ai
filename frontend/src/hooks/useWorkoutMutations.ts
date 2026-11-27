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

type PendingSyncResult = {
  synced: number;
  remaining: number;
  blocked: boolean;
  status?: number;
  errorMessage?: string;
};

function getHttpStatus(error: any): number | undefined {
  const status = Number(error?.response?.status);
  return Number.isInteger(status) && status >= 400 ? status : undefined;
}

function isPermanentClientError(status?: number): boolean {
  return status !== undefined
    && status >= 400
    && status < 500
    && ![408, 425, 429].includes(status);
}

function getApiErrorMessage(error: any): string | undefined {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => typeof item?.msg === 'string' ? item.msg : null)
      .filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  const message = error?.response?.data?.message || error?.message;
  return typeof message === 'string' && message.trim() ? message : undefined;
}

const pendingSyncs = new Map<string, Promise<PendingSyncResult>>();

async function performPendingWorkoutSync(sessionId: string): Promise<PendingSyncResult> {
  const pending = await getPendingWorkoutSets(sessionId);
  let synced = 0;
  let blocked = false;
  let status: number | undefined;
  let errorMessage: string | undefined;

  // Replay in order. The backend makes each client_request_id idempotent,
  // including the case where the original server response was lost.
  for (const item of pending) {
    const data = {
      exercise_name: item.exercise_name,
      set_number: item.set_number,
      weight_kg: item.weight_kg,
      reps: item.reps,
      ...(item.rpe !== undefined ? { rpe: item.rpe } : {}),
      client_request_id: item.client_request_id,
    };
    try {
      const response = await workoutApi.logSet(item.sessionId, data);
      await removePendingWorkoutSet(item.client_request_id);
      actions.replaceLogInSession(item, response.data, sessionId);
      synced += 1;
    } catch (error) {
      // Retain the item on every failure. A deterministic 4xx response is
      // not an offline condition, however: surface it instead of presenting
      // it as a routine network retry (e.g. a completed or invalid session).
      status = getHttpStatus(error);
      blocked = isPermanentClientError(status);
      errorMessage = getApiErrorMessage(error);
      break;
    }
  }

  return {
    synced,
    remaining: (await getPendingWorkoutSets(sessionId)).length,
    blocked,
    ...(status !== undefined ? { status } : {}),
    ...(errorMessage ? { errorMessage } : {}),
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
      } catch (error) {
        // The full request is already durable in AsyncStorage. Keep it visible
        // on transient failures, but flag deterministic 4xx rejections so the
        // UI does not describe a server-side rejection as an offline write.
        const status = getHttpStatus(error);
        return {
          optimistic: log,
          persisted: null,
          pending: true,
          blocked: isPermanentClientError(status),
          ...(status !== undefined ? { status } : {}),
          ...(getApiErrorMessage(error) ? { errorMessage: getApiErrorMessage(error) } : {}),
        };
      }

      try {
        await removePendingWorkoutSet(log.client_request_id);
        return { optimistic: log, persisted, pending: false, blocked: false, errorMessage: undefined };
      } catch {
        // The server may have committed but local cleanup failed. A replay is
        // safe because it reuses the exact same idempotency key.
        return { optimistic: log, persisted, pending: true, blocked: false, errorMessage: undefined };
      }
    },
    // Persist the write before the network call, then update the store.
    // The AsyncStorage write is the durability boundary for offline logging.
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