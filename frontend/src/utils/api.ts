import axios from 'axios';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { storage } from './storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api';

// "localhost" only resolves correctly in a web browser or the iOS
// Simulator. On a physical device or the Android Emulator it points at
// the device itself, not your dev machine — every request then fails as
// a generic network error, which is the most common cause of the AI
// Coach's "Connection error" message and a silently empty Dashboard.
// This warning makes the misconfiguration visible immediately instead of
// being discovered after debugging several screens.
if (__DEV__ && !process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    '[VYRN] EXPO_PUBLIC_API_URL is not set — falling back to ' +
    `"${API_BASE}". This will NOT work on a physical device or the Android ` +
    'Emulator. Copy frontend/.env.example to frontend/.env and set your ' +
    'machine\'s LAN IP (or 10.0.2.2 for Android Emulator), then restart ' +
    '`expo start --clear`.'
  );
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Use storage wrapper instead of SecureStore directly.
//
// CRITICAL: this key must match exactly what store/index.ts's setAuth()
// writes to ('vyrn_token'/'vyrn_user'), since that's the only
// place a token is ever stored. This file previously read/deleted
// 'fitai_token'/'fitai_user' — a key that nothing in the app ever wrote
// to — meaning storage.getItem() below always returned null, the
// Authorization header was never attached to any outgoing request, and
// every authenticated endpoint failed with 401 "Not authenticated"
// regardless of whether the user had just registered, just logged in, or
// had been using the app for days. Login/onboarding still appeared to
// "work" because the navigation guards in app/index.tsx and
// app/(tabs)/_layout.tsx correctly checked 'vyrn_token' — only the
// actual API calls were broken.
api.interceptors.request.use(async (config) => {
  const token = await storage.getItem('vyrn_token');
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
      // Log the actual server-provided reason before wiping the token, so
      // a forced logout during normal use (e.g. mid-chat) is diagnosable
      // instead of just "it logged me out for no reason." Common causes:
      // ORPHANED_SESSION (the account behind this token no longer exists —
      // e.g. deleted from Supabase Auth while the app still held an old
      // token), "Invalid or expired token" (JWT signature mismatch — most
      // often because the backend's SECRET_KEY changed, which invalidates
      // every previously-issued token at once), or a genuinely expired
      // token (default lifetime is 7 days).
      const reason = error?.response?.data?.detail || '(no detail returned)';
      if (__DEV__) {
        console.warn(`[Auth] Forced logout — server returned 401: ${reason}`);
      }
      isRedirectingToLogin = true;
      await storage.deleteItem('vyrn_token');
      await storage.deleteItem('vyrn_user');
      router.replace('/login');
      // Reset the guard on the next tick so a later, legitimate 401
      // (e.g. after a fresh login that itself expires) isn't ignored.
      setTimeout(() => { isRedirectingToLogin = false; }, 1000);
    }
    return Promise.reject(error);
  }
);

// Classifies an axios/network error into a user-facing message and a
// machine-checkable kind, so screens stop collapsing every possible
// failure (no network, wrong API URL, server 500, auth expiry, validation
// error) into one indistinguishable "Connection error" string. Screens
// should prefer this over writing their own ad-hoc err?.response?.status
// checks, so error handling stays consistent across the app.
export type ApiErrorKind = 'network' | 'timeout' | 'auth' | 'server' | 'client' | 'unknown';

export function describeApiError(err: any): { kind: ApiErrorKind; message: string } {
  if (err?.code === 'ECONNABORTED') {
    return {
      kind: 'timeout',
      message: 'The request took too long. The server may be slow or unreachable — please try again.',
    };
  }
  if (!err?.response) {
    // axios sets no `response` when the request never reached a server at
    // all — wrong host/port, device has no network, or CORS rejection.
    return {
      kind: 'network',
      message: `Can't reach the server at ${API_BASE}. Check your network connection and that the backend is running and reachable from this device.`,
    };
  }
  const status = err.response.status;
  if (status === 401) {
    return { kind: 'auth', message: 'Your session has expired. Please log in again.' };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      message: err.response.data?.detail || 'The server hit an error processing this request. Please try again shortly.',
    };
  }
  if (status >= 400) {
    return {
      kind: 'client',
      message: err.response.data?.detail || 'That request could not be completed. Please check your input and try again.',
    };
  }
  return { kind: 'unknown', message: 'Something unexpected happened. Please try again.' };
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
  uploadAvatar: async (uri: string, mimeType: string) => {
    const form = new FormData();
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `avatar.${ext}`;

    if (Platform.OS === 'web') {
      // On web, `uri` is a blob:/data: URL string from expo-image-picker,
      // not a native file path. The DOM's real FormData.append() requires
      // an actual Blob/File object — appending a plain {uri, name, type}
      // object here gets silently coerced to the string "[object Object]"
      // as a text field, not a file part. FastAPI's UploadFile then sees a
      // field with no filename/content-type and rejects it with 422
      // Unprocessable Entity on every single upload. We have to resolve
      // the blob URL to real bytes first and append that.
      const blob = await (await fetch(uri)).blob();
      form.append('file', blob, filename);
    } else {
      // React Native's FormData polyfill (iOS/Android) DOES accept this
      // {uri, name, type} shape and turns it into a real multipart file
      // part — this is not a bug on native, only on web.
      form.append('file', {
        uri,
        name: filename,
        type: mimeType,
      } as any);
    }

    // IMPORTANT: do NOT set Content-Type here. Both RN's networking layer
    // and the browser need to generate the multipart boundary themselves
    // (e.g. "multipart/form-data; boundary=..."). Setting a bare
    // 'multipart/form-data' header with no boundary makes the server
    // unable to parse the body into parts at all — FastAPI then sees no
    // 'file' field and returns 422 regardless of the image being valid.
    return api.post('/profile/avatar', form, {
      headers: { 'Content-Type': undefined },
    });
  },
};

export const coachApi = {
  chat: (content: string, session_id?: string) =>
    api.post('/coach/chat', { content, session_id }),
  getHistory: (limit = 20) => api.get(`/coach/history?limit=${limit}`),
  regenerateWorkout: () => api.post('/coach/regenerate-workout'),
  // Coach Memory panel — real profile/injury/freeform-memory data the
  // coach actually uses on every turn (see GET /coach/memory docstring).
  getMemory: () => api.get('/coach/memory'),
  // Chronological feed of PRs, AI decisions, and program rewrites.
  getTimeline: (limit = 15) => api.get('/coach/coach-timeline', { params: { limit } }),
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
  // Returns weekly best weight for a given exercise (last N weeks)
  getStrengthProgression: (exercise: string, weeks = 8) =>
    api.get('/workouts/strength-progression', { params: { exercise, weeks } }),
  // Completed-session history list (date, volume, exercise count) + detail
  getHistory: (limit = 20, offset = 0) =>
    api.get('/workouts/history', { params: { limit, offset } }),
  getSessionDetail: (sessionId: string) =>
    api.get(`/workouts/sessions/${sessionId}/detail`),
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

// Was entirely missing — the backend has had a working FatSecret-backed
// /api/nutrition/search, /quick-log, and /today since this file was last
// touched, but nothing in the frontend could ever call them. Any nutrition
// search UI built against `progressApi`/`nutritionApi` calls that didn't
// exist would throw a plain JS TypeError ("X is not a function") at the
// moment the search input changed — in dev that crashes straight to the
// red error screen, which matches "the app crashes while searching."
export const nutritionApi = {
  // q must be >=2 chars — the backend 400s otherwise. Debounce the caller
  // side; this function itself does no debouncing.
  searchFood: (q: string, maxResults = 8) =>
    api.get('/nutrition/search', { params: { q, max_results: maxResults } }),

  // One-tap log: backend fetches the exact macros for `food_id` itself and
  // scales them to `grams`, so the frontend never has to carry/compute
  // macro numbers for a search result.
  quickLog: (food_id: string, grams: number, meal_name?: string) =>
    api.post('/nutrition/quick-log', null, {
      params: { food_id, grams, meal_name },
    }),

  // Single-call "today" dashboard: consumed + targets + remaining + % for
  // every macro, plus today's logged meals — avoids re-deriving any of
  // this client-side from /targets + /history separately.
  getToday: (is_training_day = true) =>
    api.get('/nutrition/today', { params: { is_training_day } }),
};

// Was previously missing entirely — DashboardScreen had no way to call
// GET /api/dashboard/summary, the one endpoint that actually assembles
// mission text, recovery score, AI recommendations, and remaining (not
// just target) calories/protein/water in a single response.
export const dashboardApi = {
  getSummary: () => api.get('/dashboard/summary', { params: { local_hour: new Date().getHours() } }),
};

// Mission API — richer endpoint with proactive AI brief + pattern insights
// Use this instead of dashboardApi.getSummary when you need the full
// Coach Brain output (pattern_insights, proactive_brief, reasoning_steps).
export const missionApi = {
  getToday: () => api.get('/mission/today'),
};

export default api;
// Memory API — "What my coach knows" card, manual remember/forget
export const memoryApi = {
  getAll: () => api.get('/memory'),
  add: (fact: string, category = 'general') =>
    api.post('/memory', { fact, category }),
  delete: (factId: string) => api.delete(`/memory/${factId}`),
};

// Weekly AI Review — GET /api/review/weekly
// Monthly AI Review — GET /api/review/monthly (progress + strengths +
// weaknesses + an actual rewritten program, per the roadmap)
export const reviewApi = {
  getWeekly: (weeksAgo = 0) =>
    api.get('/review/weekly', { params: { weeks_ago: weeksAgo } }),
  getMonthly: (monthsAgo = 0, triggerRewrite = true) =>
    api.get('/review/monthly', { params: { months_ago: monthsAgo, trigger_rewrite: triggerRewrite } }),
};

// Pattern insights — already embedded in /api/mission/today as pattern_insights[]
// Proactive brief — already embedded in /api/mission/today as proactive_brief{}

// Decision History — GET /api/decisions (real persisted ai_decisions rows),
// POST /api/decisions/save (idempotent per-day), accuracy stat, outcome marking.
export const decisionsApi = {
  list: (limit = 20) => api.get('/decisions/', { params: { limit } }),
  saveToday: () => api.post('/decisions/save'),
  setOutcome: (decisionId: string, outcome: 'correct' | 'incorrect' | 'partial', note?: string) =>
    api.post(`/decisions/${decisionId}/outcome`, { outcome, outcome_note: note }),
  getAccuracy: () => api.get('/decisions/accuracy'),
};

// Analytics — real chart data computed server-side from exercise_logs /
// workout_sessions / personal_records. No client-side mock generation.
export const analyticsApi = {
  getHeatmap: (weeks = 8) => api.get('/progress/heatmap', { params: { weeks } }),
  getMuscleBalance: (weeks = 4) => api.get('/progress/muscle-balance', { params: { weeks } }),
  getPRTimeline: (limit = 20) => api.get('/progress/pr-timeline', { params: { limit } }),
  getWeeklyStats: () => api.get('/progress/weekly-stats'),
};

// Body Weight — dedicated weight-only read/write over progress_metrics.
export const bodyWeightApi = {
  log: (weight_kg: number, recorded_date?: string, notes?: string) =>
    api.post('/bodyweight/log', { weight_kg, recorded_date, notes }),
  getHistory: (days = 90) => api.get('/bodyweight/history', { params: { days } }),
  deleteEntry: (entryId: string) => api.delete(`/bodyweight/${entryId}`),
};

// Notifications — intelligent, data-grounded notification center.
export const notificationsApi = {
  list: (limit = 20) => api.get('/notifications/', { params: { limit } }),
  generate: () => api.post('/notifications/generate'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};

// Workout History — Hevy/Strong-style session history + full set detail.
export const workoutHistoryApi = {
  list: (limit = 20, offset = 0) =>
    api.get('/workouts/history', { params: { limit, offset } }),
  getDetail: (sessionId: string) =>
    api.get(`/workouts/sessions/${sessionId}/detail`),
};

// Program Evolution — version history + on-demand adaptive rewrite.
export const programApi = {
  getVersions: (limit = 10) => api.get('/program/versions', { params: { limit } }),
  getLatest: () => api.get('/program/latest'),
  triggerRewrite: () => api.post('/program/rewrite'),
};

// Admin — manual trigger for the nightly background job suite (pattern
// detection, memory cleanup, weekly review, morning brief, notifications).
export const adminApi = {
  runJobsNow: () => api.post('/admin/run-jobs-now'),
};