# Consistency Score — what was added

Built directly in response to real user feedback: *"if I could add one feature,
it would be a consistency score instead of endless charts — something that
tells me 'you've been consistent this week' or 'your recovery and nutrition
have slipped, which is probably why progress has stalled.'"*

## New backend

- **`backend/agents/consistency_agent.py`** — the core logic. Computes one
  0–100 score from three weighted pillars (workouts 40%, nutrition 35%,
  recovery 25%) over a rolling 7-day window, plus one plain-English
  headline sentence. Read the file's docstring — the design choices
  (grace period for missed days, no score for brand-new users, naming
  which pillar slipped instead of just showing a number) are explained
  there.
- **`GET /api/progress/consistency`** — standalone endpoint, same shape,
  for use outside the dashboard (e.g. the Progress tab).
- **`mission/today`** now includes a `consistency` block in its response
  using the same agent, so the dashboard gets it for free on every app open.
- **Mood capture wired up**: `workout_sessions.mood` existed in the schema
  but nothing ever wrote to it. `PATCH /sessions/{id}/complete` now accepts
  an optional `mood` param and saves it. It's descriptive only — it never
  affects the consistency score — so skipping it changes nothing.
- **Softer language in weekly/monthly reviews**: replaced "consistency is
  slipping" / "dropped to X%" phrasing with neutral, non-judgmental
  wording. The goal is to stop the app itself from generating the
  shame-spiral copy that makes people quit.

## New frontend

- **`frontend/src/components/dashboard/ConsistencyScoreCard.tsx`** — the
  single number + single sentence card, placed near the top of the
  dashboard (right after "what should I do today"). Shows a pillar
  breakdown underneath for anyone who wants to dig in, but the headline
  is the whole point.
- **`frontend/src/components/workout/MoodPickerModal.tsx`** — one
  optional tap (🔥/🙂/😐/😩) shown right after finishing a workout,
  skippable with zero consequence. This is what actually populates the
  mood field that was previously dead.
- **`WorkoutHUD.tsx`** — wired the mood picker into the finish-workout
  flow (finish → optional mood → summary, same as before).
- **`api.ts`** — added `progressApi.getConsistency()` and passed `mood`
  through `workoutApi.completeSession()`.


## What this doesn't do (on purpose, for now)

- No 2-week trend arrow yet (`trend` field is stubbed as `"unknown"` in
  the agent — wiring up a previous-window comparison is a natural next
  step once this version has been used for a couple of weeks).
- No push notification / streak-freeze mechanic — the grace period lives
  in the scoring math itself, not in a separate "freeze" feature.
- Mood isn't yet factored into the score, only shown as a descriptive
  emoji — intentional, since mood logging is optional and sparse data
  shouldn't move a number people are relying on.
