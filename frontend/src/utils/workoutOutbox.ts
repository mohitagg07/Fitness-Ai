import { storage } from './storage';

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
let writeChain: Promise<unknown> = Promise.resolve();

async function readQueue(): Promise<PendingWorkoutSet[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingWorkoutSet =>
      !!item
      && typeof item.sessionId === 'string'
      && typeof item.exercise_name === 'string'
      && typeof item.client_request_id === 'string'
      && Number.isFinite(Number(item.set_number))
      && Number.isFinite(Number(item.weight_kg))
      && Number.isFinite(Number(item.reps))
    );
  } catch {
    return [];
  }
}

async function updateQueue(
  updater: (items: PendingWorkoutSet[]) => PendingWorkoutSet[],
): Promise<PendingWorkoutSet[]> {
  const operation = writeChain.then(async () => {
    const next = updater(await readQueue());
    await storage.setItem(STORAGE_KEY, JSON.stringify(next));
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

export async function enqueueWorkoutSet(
  input: Omit<PendingWorkoutSet, 'queued_at'>,
): Promise<void> {
  await updateQueue((items) => {
    const existing = items.findIndex((item) => item.client_request_id === input.client_request_id);
    const item: PendingWorkoutSet = {
      ...input,
      queued_at: new Date().toISOString(),
    };
    if (existing >= 0) {
      const next = [...items];
      next[existing] = { ...next[existing], ...item };
      return next;
    }
    return [...items, item];
  });
}

export async function removePendingWorkoutSet(clientRequestId: string): Promise<void> {
  await updateQueue((items) => items.filter((item) => item.client_request_id !== clientRequestId));
}
