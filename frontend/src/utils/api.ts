import axios from 'axios';
import { router } from 'expo-router';
import { storage } from './storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Use storage wrapper instead of SecureStore directly
api.interceptors.request.use(async (config) => {
  const token = await storage.getItem('fitai_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single source of truth for "the session is no longer valid." Without
// this, every screen had to handle 401s on its own — which is how you end
// up with the login screen getting pushed on top of the tab navigator
// instead of replacing it, leaving the tab bar visible underneath.
let isRedirectingToLogin = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401 && !isRedirectingToLogin) {
      isRedirectingToLogin = true;
      await storage.deleteItem('fitai_token');
      await storage.deleteItem('fitai_user');
      router.replace('/login');
      // Reset the guard on the next tick so a later, legitimate 401
      // (e.g. after a fresh login that itself expires) isn't ignored.
      setTimeout(() => { isRedirectingToLogin = false; }, 1000);
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: (data: { email: string; password: string; full_name: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
};

export const profileApi = {
  getMe: () => api.get('/profile/me'),
  updateMe: (data: any) => api.put('/profile/me', data),
  onboard: (data: any) => api.post('/profile/onboard', data),
  addInjury: (data: any) => api.post('/profile/injuries', data),
  deleteInjury: (id: string) => api.delete(`/profile/injuries/${id}`),
  upsertPR: (data: any) => api.post('/profile/prs', data),
  getPRs: () => api.get('/profile/prs'),
};

export const coachApi = {
  chat: (content: string, session_id?: string) =>
    api.post('/coach/chat', { content, session_id }),
  getHistory: (limit = 20) => api.get(`/coach/history?limit=${limit}`),
};

export const workoutApi = {
  createSession: (data: any) => api.post('/workouts/sessions', data),
  getSessions: (limit = 10) => api.get(`/workouts/sessions?limit=${limit}`),
  completeSession: (id: string, cns_fatigue?: number) =>
    api.patch(`/workouts/sessions/${id}/complete`, null, {
      params: { cns_fatigue_after: cns_fatigue },
    }),
  logSet: (sessionId: string, data: any) =>
    api.post(`/workouts/sessions/${sessionId}/logs`, data),
  getSessionLogs: (sessionId: string) =>
    api.get(`/workouts/sessions/${sessionId}/logs`),
};

export const progressApi = {
  logMetrics: (data: any) => api.post('/progress/metrics', data),
  getMetrics: (limit = 30) => api.get(`/progress/metrics?limit=${limit}`),
  logNutrition: (data: any) => api.post('/nutrition/log', data),
  getNutritionTargets: (is_training_day = true) =>
    api.get(`/nutrition/targets?is_training_day=${is_training_day}`),
  getNutritionHistory: (limit = 30) =>
    api.get(`/nutrition/history?limit=${limit}`),
};

export default api;