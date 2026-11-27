import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingWorkoutSet {
  sessionId: string;
  exercise_name: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number;
  client_request_id: string;
  queued_at: string;
}

const STORAGE_KEY = 'vyrn_pending_workout_sets_v1';
const MAX_PENDING_SETS = 500;
let writeChain: Promise<unknown> = Promise.resolve();

function isPendingWorkoutSet(value: unknown): value is PendingWorkoutSet {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.sessionId === 'string'
    && item.sessionId.length > 0
    && typeof item.exercise_name === 'string'
    && item.exercise_name.trim().length > 0
    && Number.isInteger(item.set_number)
    && Number(item.set_number) > 0
    && Number.isFinite(item.weight_kg)
    && Number(item.weight_kg) >= 0
    && Number.isInteger(item.reps)
    && Number(item.reps) > 0
    && (item.rpe === undefined || (Number.isFinite(item.rpe) && Number(item.rpe) >= 1 && Number(item.rpe) <= 10))
    && typeof item.client_request_id === 'string'
    && item.client_request_id.length > 0
    && typeof item.queued_at === 'string';
}

function samePayload(a: PendingWorkoutSet, b: Omit<PendingWorkoutSet, 'queued_at'>): boolean {
  return a.sessionId === b.sessionId
    && a.exercise_name === b.exercise_name
    && a.set_number === b.set_number
    && a.weight_kg === b.weight_kg
    && a.reps === b.reps
    && (a.rpe ?? null) === (b.rpe ?? null);
}

async function readQueue(): Promise<PendingWorkoutSet[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isPendingWorkoutSet)) {
    // Fail closed. Silently replacing a malformed queue with [] would destroy
    // the athlete's only copy of writes that may not have reached the server.
    throw new Error('The saved workout queue could not be read safely. Do not clear app data; retry or contact support.');
  }
  return parsed;
}

async function updateQueue(
  updater: (items: PendingWorkoutSet[]) => PendingWorkoutSet[],
): Promise<PendingWorkoutSet[]> {
  const operation = writeChain.then(async () => {
    const next = updater(await readQueue());
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
  writeChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function getPendingWorkoutSets(sessionId?: string): Promise<PendingWorkoutSet[]> {
  await writeChain;
  const items = await readQueue();
  return sessionId ? items.filter((item) => item.sessionId === sessionId) : items;
}

export async function enqueuePendingWorkoutSet(
  input: Omit<PendingWorkoutSet, 'queued_at'>,
): Promise<void> {
  await updateQueue((items) => {
    const existing = items.find((item) => item.client_request_id === input.client_request_id);
    if (existing) {
      if (!samePayload(existing, input)) {
        throw new Error('This workout set request ID is already queued with different values.');
      }
      return items;
    }
    if (items.length >= MAX_PENDING_SETS) {
      throw new Error('The saved workout queue is full. Connect to the internet and sync before logging more sets.');
    }
    return [...items, { ...input, queued_at: new Date().toISOString() }];
  });
}

export async function removePendingWorkoutSet(clientRequestId: string): Promise<void> {
  await updateQueue((items) => items.filter((item) => item.client_request_id !== clientRequestId));
}
