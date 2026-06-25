/**
 * api.ts — additions to progressApi for food search & nutrition log.
 *
 * Add these to your existing api.ts file (or merge the progressApi block).
 * The food search hits GET /nutrition/search?q=<query>
 * The quick-log hits POST /nutrition/quick-log
 * The manual-log hits POST /nutrition/log (existing)
 */

// ── APPEND / MERGE INTO YOUR EXISTING progressApi EXPORT ──────────────────

// Example of what to add to your progressApi object:
//
// nutritionSearch: (q: string) =>
//   api.get('/nutrition/search', { params: { q, max_results: 8 } }),
//
// quickLog: (food_id: string, grams: number, meal_name?: string) =>
//   api.post('/nutrition/quick-log', null, {
//     params: { food_id, grams, meal_name },
//   }),
//
// getTodayNutrition: (is_training_day = true) =>
//   api.get('/nutrition/today', { params: { is_training_day } }),

// ── FULL UPDATED progressApi (replace existing) ───────────────────────────
import axios from 'axios';
import { router } from 'expo-router';
import { storage } from './storage';
import { API_BASE } from './config';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await storage.getItem('neurofit_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRedirectingToLogin = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401 && !isRedirectingToLogin) {
      isRedirectingToLogin = true;
      await storage.deleteItem('neurofit_token');
      await storage.deleteItem('neurofit_user');
      router.replace('/login');
      setTimeout(() => { isRedirectingToLogin = false; }, 1000);
    }
    return Promise.reject(error);
  }
);

export type ApiErrorKind = 'network' | 'timeout' | 'auth' | 'server' | 'client' | 'unknown';

export function describeApiError(err: any): { kind: ApiErrorKind; message: string } {
  if (err?.code === 'ECONNABORTED') {
    return { kind: 'timeout', message: 'Request timed out. Please try again.' };
  }
  if (!err?.response) {
    return { kind: 'network', message: `Can't reach the server. Check your network.` };
  }
  const status = err.response.status;
  if (status === 401) return { kind: 'auth', message: 'Session expired. Please log in again.' };
  if (status >= 500) return { kind: 'server', message: err.response.data?.detail || 'Server error. Try again.' };
  if (status >= 400) return { kind: 'client', message: err.response.data?.detail || 'Bad request.' };
  return { kind: 'unknown', message: 'Something went wrong.' };
}

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

  // Nutrition
  logNutrition: (data: any) => api.post('/nutrition/log', data),
  getNutritionTargets: (is_training_day = true) =>
    api.get(`/nutrition/targets?is_training_day=${is_training_day}`),
  getNutritionHistory: (limit = 30) =>
    api.get(`/nutrition/history?limit=${limit}`),

  // NEW: food search (FatSecret via backend)
  nutritionSearch: (q: string) =>
    api.get('/nutrition/search', { params: { q, max_results: 8 } }),

  // NEW: one-tap quick-log from search result
  quickLog: (food_id: string, grams: number, meal_name?: string) =>
    api.post('/nutrition/quick-log', null, {
      params: { food_id, grams, ...(meal_name ? { meal_name } : {}) },
    }),

  // NEW: today's totals vs targets in one call
  getTodayNutrition: (is_training_day = true) =>
    api.get('/nutrition/today', { params: { is_training_day } }),
};

export const dashboardApi = {
  getSummary: () => api.get('/dashboard/summary'),
};

export default api;