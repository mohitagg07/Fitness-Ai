import { useState, useEffect } from 'react';
import { storage } from '../utils/storage';

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
  async logout() {
    await storage.deleteItem('vyrn_token');
    await storage.deleteItem('vyrn_user');
    setState({
      user: null, token: null, profile: null,
      injuries: [], prs: {}, chatHistory: [],
      activeSession: null, cnsFatigue: 0,
    });
  },
  setProfile(profile: any, injuries: any[], prs: any[]) {
    const prMap: Record<string, number> = {};
    prs.forEach((p: any) => { prMap[p.exercise_name] = p.weight_kg; });
    setState({ profile, injuries, prs: prMap });
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
  setCnsFatigue(score: number) { setState({ cnsFatigue: score }); },
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

export function useStore() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender(n => n + 1);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return { ..._state, ...actions };
}
