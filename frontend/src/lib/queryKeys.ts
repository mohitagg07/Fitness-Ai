// VYRN — centralized query key factory
//
// One place for every queryKey used across the app, so invalidation
// (`queryClient.invalidateQueries({ queryKey: qk.dashboard.all })`) and
// prefetching (`queryClient.prefetchQuery(...)`) always agree on the exact
// key shape — a mismatched key (e.g. one screen using ['weeklyStats'] and
// another ['weekly-stats']) silently creates two disconnected cache
// entries, which is a common and hard-to-spot bug once keys are scattered
// across files.
//
// staleTime is tuned per domain here rather than left at the global
// default, based on how often each kind of data actually changes:
//   - "live" data (active workout session) — effectively always stale
//   - "daily" data (mission brief, recovery score, streaks) — good for
//     a couple of minutes; nothing server-side recomputes it faster
//   - "slow" data (program versions, PR timeline, weekly review) — good
//     for much longer; these only change after a workout/rewrite event
export const STALE = {
  live: 0,
  short: 60_000,       // 1 min
  medium: 5 * 60_000,  // 5 min
  long: 30 * 60_000,   // 30 min
};

export const qk = {
  dashboard: {
    all: ['dashboard'] as const,
    mission: () => [...qk.dashboard.all, 'mission'] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    muscleRecovery: () => [...qk.analytics.all, 'muscle-recovery'] as const,
    weeklyStats: () => [...qk.analytics.all, 'weekly-stats'] as const,
    heatmap: (weeks: number) => [...qk.analytics.all, 'heatmap', weeks] as const,
    muscleBalance: (weeks: number) => [...qk.analytics.all, 'muscle-balance', weeks] as const,
    prTimeline: (limit: number) => [...qk.analytics.all, 'pr-timeline', limit] as const,
  },
  review: {
    all: ['review'] as const,
    weekly: (weeksAgo: number) => [...qk.review.all, 'weekly', weeksAgo] as const,
    monthly: (monthsAgo: number) => [...qk.review.all, 'monthly', monthsAgo] as const,
  },
  program: {
    all: ['program'] as const,
    versions: (limit: number) => [...qk.program.all, 'versions', limit] as const,
    latest: () => [...qk.program.all, 'latest'] as const,
  },
  coachTimeline: {
    all: ['coach-timeline'] as const,
    list: (limit: number) => [...qk.coachTimeline.all, limit] as const,
  },
  consistency: {
    all: ['consistency'] as const,
  },
  profile: {
    all: ['profile'] as const,
    me: () => [...qk.profile.all, 'me'] as const,
    prs: () => [...qk.profile.all, 'prs'] as const,
  },
  workout: {
    all: ['workout'] as const,
    sessions: (limit: number) => [...qk.workout.all, 'sessions', limit] as const,
    history: (limit: number, offset: number) => [...qk.workout.all, 'history', limit, offset] as const,
    sessionDetail: (id: string) => [...qk.workout.all, 'detail', id] as const,
    strengthProgression: (exercise: string, weeks: number) =>
      [...qk.workout.all, 'strength', exercise, weeks] as const,
  },
  nutrition: {
    all: ['nutrition'] as const,
    today: (isTrainingDay: boolean) => [...qk.nutrition.all, 'today', isTrainingDay] as const,
    targets: (isTrainingDay: boolean) => [...qk.nutrition.all, 'targets', isTrainingDay] as const,
    history: (limit: number) => [...qk.nutrition.all, 'history', limit] as const,
    mealPlan: (isTrainingDay: boolean) => [...qk.nutrition.all, 'meal-plan', isTrainingDay] as const,
    groceryList: () => [...qk.nutrition.all, 'grocery-list'] as const,
  },
  decisions: {
    all: ['decisions'] as const,
    list: (limit: number) => [...qk.decisions.all, limit] as const,
    accuracy: () => [...qk.decisions.all, 'accuracy'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (limit: number) => [...qk.notifications.all, limit] as const,
  },
  coach: {
    all: ['coach'] as const,
    memory: () => [...qk.coach.all, 'memory'] as const,
    history: (limit: number) => [...qk.coach.all, 'history', limit] as const,
  },
  bodyWeight: {
    all: ['body-weight'] as const,
    history: (days: number) => [...qk.bodyWeight.all, 'history', days] as const,
  },
};