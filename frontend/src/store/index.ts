import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface User {
  id: string;
  email: string;
  full_name?: string;
}

interface ActiveSession {
  id: string;
  day_label: string;
  logs: any[];
}

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;

  // Profile
  profile: any;
  injuries: any[];
  prs: Record<string, number>;
  setProfile: (profile: any, injuries: any[], prs: any[]) => void;

  // Active workout session
  activeSession: ActiveSession | null;
  setActiveSession: (session: ActiveSession | null) => void;
  addLogToSession: (log: any) => void;

  // CNS fatigue
  cnsFatigue: number;
  setCnsFatigue: (score: number) => void;

  // Coach chat
  chatHistory: { role: 'user' | 'assistant'; content: string; timestamp: Date }[];
  addChatMessage: (role: 'user' | 'assistant', content: string) => void;
  clearChat: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  user: null,
  token: null,
  setAuth: async (user, token) => {
    await SecureStore.setItemAsync('fitai_token', token);
    set({ user, token });
  },
  logout: async () => {
    await SecureStore.deleteItemAsync('fitai_token');
    set({ user: null, token: null, profile: null, injuries: [], prs: {} });
  },

  profile: null,
  injuries: [],
  prs: {},
  setProfile: (profile, injuries, prs) => {
    const prMap: Record<string, number> = {};
    prs.forEach((p: any) => { prMap[p.exercise_name] = p.weight_kg; });
    set({ profile, injuries, prs: prMap });
  },

  activeSession: null,
  setActiveSession: (session) => set({ activeSession: session }),
  addLogToSession: (log) => set((state) => ({
    activeSession: state.activeSession
      ? { ...state.activeSession, logs: [...state.activeSession.logs, log] }
      : null,
  })),

  cnsFatigue: 0,
  setCnsFatigue: (score) => set({ cnsFatigue: score }),

  chatHistory: [],
  addChatMessage: (role, content) => set((state) => ({
    chatHistory: [...state.chatHistory, { role, content, timestamp: new Date() }],
  })),
  clearChat: () => set({ chatHistory: [] }),
}));
