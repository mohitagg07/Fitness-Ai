import { useEffect, useRef, useState } from 'react';
import { storage } from '../utils/storage';
import { clearAuthData } from '../utils/auth';

let _state = {
  user: null as any,
  token: null as string | null,
  profile: null as any,
  injuries: [] as any[],
  prs: {} as Record<string, number>,
  activeSession: null as any,
  cnsFatigue: 0,
  chatHistory: [] as Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    structured_decision?: any;  // NEW: carry structured card data alongside message
  }>,
};

type State = typeof _state;
const _listeners = new Set<() => void>();

function setState(partial: Partial<State>) {
  _state = { ..._state, ...partial };
  _listeners.forEach(fn => fn());
}

export const actions = {
  async setAuth(user: any, token: string) {
    await storage.setItem('vyrn_token', token);
    await storage.setItem('vyrn_user', JSON.stringify(user));
    setState({ user, token });
  },
  // Restore a previously persisted session into memory on cold app launch.
  // Unlike setAuth(), this does not rewrite SecureStore on every startup.
  hydrateAuth(user: any, token: string) {
    setState({ user, token });
  },
  async logout() {
    // Unregister this device's push token BEFORE clearing the auth token —
    // unregisterPushNotificationsAsync() calls an authenticated endpoint,
    // so it needs the Authorization header the api.ts interceptor still
    // attaches at this point. Otherwise a shared/reset device would keep
    // receiving the previous account's recovery/protein/PR pushes after
    // someone else logs in on it.
    const { unregisterPushNotificationsAsync } = await import('../utils/pushNotifications');
    await unregisterPushNotificationsAsync();

    await clearAuthData();
  },
  resetSessionState() {
    setState({
      user: null,
      token: null,
      profile: null,
      injuries: [],
      prs: {},
      chatHistory: [],
      activeSession: null,
      cnsFatigue: 0,
    });
  },
  setProfile(profile: any, injuries: any[], prs: any[]) {
    const prMap: Record<string, number> = {};
    prs.forEach((p: any) => { prMap[p.exercise_name] = p.weight_kg; });
    setState({ profile, injuries, prs: prMap });
  },
  // Merge-patch the profile in the global store. ProfileScreen previously
  // kept its own local `profile` state entirely separate from this store —
  // so uploading a new avatar or editing your name/goal on the Profile tab
  // never showed up on the Dashboard (or anywhere else reading
  // useStore().profile) until the next full login. Every profile mutation
  // in ProfileScreen now calls this so the whole app stays in sync.
  updateProfile(partial: any) {
    setState({ profile: { ..._state.profile, ...partial } });
  },
  setActiveSession(session: any) { setState({ activeSession: session }); },
  addLogToSession(log: any) {
    if (!_state.activeSession) return;
    setState({
      activeSession: {
        ..._state.activeSession,
        logs: [...(_state.activeSession.logs || []), log],
      },
    });
  },
  // Rollback path for useLogSet's optimistic update (see
  // hooks/useWorkoutMutations.ts) — removes exactly the one optimistic
  // entry a failed request added, identified by exercise+set_number
  // rather than array index, since other logs may have been appended
  // (by other in-flight taps) between the optimistic add and the failure.
  removeLogFromSession(log: any, sessionId?: string) {
    if (!_state.activeSession || !log) return;
    if (sessionId && _state.activeSession.id !== sessionId) return;
    const logs = _state.activeSession.logs || [];
    const idx = logs.findIndex(
      (l: any) => l.exercise_name === log.exercise_name && l.set_number === log.set_number
    );
    if (idx === -1) return;
    const next = [...logs];
    next.splice(idx, 1);
    setState({ activeSession: { ..._state.activeSession, logs: next } });
  },
  replaceLogInSession(optimistic: any, persisted: any, sessionId?: string) {
    if (!_state.activeSession || !optimistic || !persisted) return;
    if (sessionId && _state.activeSession.id !== sessionId) return;
    const logs = [...(_state.activeSession.logs || [])];
    const index = logs.findIndex(
      (log: any) =>
        log.exercise_name === optimistic.exercise_name &&
        log.set_number === optimistic.set_number
    );
    if (index === -1) return;
    logs[index] = persisted;
    setState({
      activeSession: {
        ..._state.activeSession,
        logs,
      },
    });
  },
  setCnsFatigue(score: number) { setState({ cnsFatigue: score }); },
  // Hydrate the server-backed conversation once when Coach opens.
  // Do not overwrite a message typed while the history request was in flight.
  hydrateChatHistory(messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    structured_decision?: any;
  }>) {
    if (_state.chatHistory.length > 0 || messages.length === 0) return;
    setState({ chatHistory: messages });
  },
  addChatMessage(role: 'user' | 'assistant', content: string, structured_decision?: any) {
    setState({
      chatHistory: [..._state.chatHistory, {
        role, content, timestamp: new Date(),
        structured_decision: structured_decision || null,
      }],
    });
  },
  clearChat() { setState({ chatHistory: [] }); },
};

export function useStore(): State & typeof actions;
export function useStore<T>(selector: (s: State & typeof actions) => T): T;
export function useStore(selector?: (s: State & typeof actions) => any) {
  // PERFORMANCE: previously this hook had no selector support — every one
  // of its ~5 call sites (Dashboard, Profile, Coach, Workout, Register)
  // subscribed to the ENTIRE store and force-rendered on every single
  // setState call anywhere in the app, regardless of whether the fields
  // that screen actually reads changed. Concretely: sending a chat message
  // on the Coach tab calls addChatMessage → setState → every listener
  // fires, so DashboardScreen and ProfileScreen (if still mounted by the
  // tab navigator) re-rendered too, even though neither reads chatHistory.
  // Same story for every set logged during a workout (addLogToSession)
  // and every CNS-fatigue update (setCnsFatigue) — all app-wide broadcasts
  // no matter how narrowly a given screen was actually interested.
  //
  // Callers that pass a selector (e.g. `useStore(s => s.profile)`) now only
  // re-render when that selected value actually changes (shallow compare).
  // Callers with no selector keep the old whole-store behavior for
  // backward compatibility, so nothing breaks if a new call site doesn't
  // bother with one — but the four hot-path screens below have been
  // updated to select just what they use.
  const getSnapshot = () => ({ ..._state, ...actions });
  const [, rerender] = useState(0);
  const lastValue = useRef<any>(selector ? selector(getSnapshot()) : undefined);

  useEffect(() => {
    const fn = () => {
      if (!selector) {
        rerender((n) => n + 1);
        return;
      }
      const next = selector(getSnapshot());
      if (!shallowEqual(next, lastValue.current)) {
        lastValue.current = next;
        rerender((n) => n + 1);
      }
    };
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (selector) {
    // Keep the memoized value fresh for renders triggered by *this*
    // component's own state/props rather than a store update.
    lastValue.current = selector(getSnapshot());
    return lastValue.current;
  }
  return getSnapshot();
}

function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}