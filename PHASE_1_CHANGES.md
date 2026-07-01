# VYRN — Phase 1 Changes

Scope: files created or modified in this session only. Covers the two
components placed into position (ConfettiBurst, CountUpNumber), the
missing EmptyState component discovered and fixed during audit, and the
three Phase 1 (Critical) items from the polish pass: duplicate Log Set
race condition, retry-safe workout completion, and `useFocusEffect`
refetching on Dashboard/Progress/Decisions.

No backend files were changed in this session. No new dependencies were
added.

---

## Files created

### `frontend/src/components/workout/ConfettiBurst.tsx`
**What it is:** Confetti burst animation for the Workout Complete screen,
built on React Native's own `Animated` API (no new dependency — same
primitive `ScoreRing`/`DashboardSkeleton` already use). ~28 particles with
randomized drift, rotation, and staggered start.
**Why created:** The file existed as loose code pasted into the
conversation with no location. `WorkoutSummaryCard.tsx` already imports it
via `import ConfettiBurst from './ConfettiBurst'`, which fixes the exact
path it needed to live at.

### `frontend/src/components/shared/CountUpNumber.tsx`
**What it is:** Reusable count-up number component (`requestAnimationFrame`
+ cubic ease-out) used for animated stat displays.
**Why created:** Same situation as above — `WorkoutSummaryCard.tsx`
imports it via `import CountUpNumber from '../shared/CountUpNumber'`,
which fixes the required path.

### `frontend/src/components/shared/EmptyState.tsx`
**What it is:** Shared empty-state component: icon, title, body text, and
an optional CTA button (`icon`, `title`, `body`, `actionLabel`, `onAction`
props).
**Why created:** Found during audit — `WorkoutHistoryModal.tsx`,
`PRScreen.tsx`, and `DecisionScreen.tsx` all already import
`EmptyState from '../shared/EmptyState'` and call it with a consistent
prop shape, but the file itself did not exist anywhere in the uploaded
codebase. This was a **build-breaking bug**: those three screens would
crash on import. Built to match the exact prop signature already in use
at all three call sites, styled with existing `COLORS` tokens (no new
hex values), and includes `accessibilityRole`/`accessibilityLabel` on its
action button.

> **Note:** `PRScreen.tsx` itself was not modified or re-verified in this
> session beyond confirming its existing import matches this component's
> props. Recommend a quick smoke-test of the PR screen's empty state
> alongside Workout History and Decisions.

---

## Files modified

### `frontend/src/components/workout/WorkoutHUD.tsx`
**Changes:**
1. Added `isLogging` state. `logSet()` now returns immediately if a
   request is already in flight, instead of allowing concurrent calls.
2. The "LOG SET + START REST" button is now `disabled` while
   `isLogging` is true, dims to 0.5 opacity, and its label switches to
   "LOGGING…". Added `accessibilityRole="button"`, `accessibilityLabel`,
   and `accessibilityState={{ disabled }}`.
3. Extracted the workout-completion network call out of the inline
   `Alert.alert` handler into a standalone `completeAndShowSummary()`
   function, guarded by a new `isFinishing` state (same double-submit
   protection as #1).
4. On completion failure, the error alert now offers **Retry** (re-calls
   `completeAndShowSummary()`) instead of only "OK" — no need to go back
   through the destructive "Finish Workout?" confirmation dialog.
5. The "FINISH WORKOUT" button is now `disabled` while `isFinishing` is
   true, reuses the same dimmed-opacity style, label switches to
   "SAVING…", and gained the same three accessibility props as #2.
6. Added one shared style, `logBtnDisabled: { opacity: 0.5 }`, reused by
   both buttons above.

**Why:**
- **Duplicate Log Set race condition (data integrity):** a fast
  double-tap fired `logSet()` twice before the Zustand store updated.
  Both calls read the same `currentSetNum`, so both succeeded — logging
  two sets with an identical set number and silently inflating volume
  and PR calculations for that session.
- **Retry-safe completion:** I checked the backend
  (`PATCH /workouts/sessions/{id}/complete`,
  `backend/api/routes/workouts.py`) and confirmed it is already
  idempotent — no "already completed" guard; it recomputes
  `total_volume_kg`/`duration_minutes`/`calories_burned` from the
  already-persisted `exercise_logs` and upserts PRs safely on every call
  (a second call sees `old_pr == new_best`, so no duplicate PR entries).
  So the only real gap was on the frontend: a failed request previously
  had no direct retry path. Since every set is already persisted
  server-side via the earlier `logSet` calls, nothing is at risk of loss
  by retrying.

**No backend changes were made or required for this fix** — the
idempotency already existed; this was purely a frontend UX gap.

---

### `frontend/src/components/dashboard/DashboardScreen.tsx`
**Changes:**
1. Added `import { useFocusEffect } from '@react-navigation/native'`.
2. Added a `hasFocusedOnce` ref and a `useFocusEffect` block that calls
   the existing `loadData()` on every focus **after** the first (the
   first focus is already covered by the pre-existing mount `useEffect`,
   so it's skipped to avoid a duplicate initial fetch).
3. This refetch is silent — it does not toggle the `loading` state, so
   switching tabs never re-triggers the full-screen skeleton.

**Why:** Dashboard previously only fetched data once on mount. Since
Expo Router keeps tab screens mounted, finishing a workout and switching
back to Dashboard showed the pre-workout recovery score, decision card,
and "Since Yesterday" summary until the user manually pulled to refresh.

---

### `frontend/src/components/progress/ProgressScreen.tsx`
**Changes:** Identical pattern to DashboardScreen:
1. Added `useFocusEffect` and `useRef` to the existing React import line.
2. Added the same `hasFocusedOnce` guard + silent `useFocusEffect` calling
   the existing `loadData()`.

**Why:** Same staleness issue — weight logs, nutrition history, and PRs
logged elsewhere in the app wouldn't appear here until a manual
pull-to-refresh.

---

### `frontend/src/components/decisions/DecisionScreen.tsx`
**Changes:**
1. Added `import { useFocusEffect } from '@react-navigation/native'` and
   `useRef` to the existing React import line.
2. Extracted the existing mount-effect logic (`POST /decisions/save`
   then `loadData()`) into a new shared `saveAndLoad()` function, so the
   behavior isn't duplicated between the mount effect and the new focus
   effect.
3. Added the same `hasFocusedOnce` guard + silent `useFocusEffect`,
   calling `saveAndLoad()`.

**Why:** Same staleness issue, and this screen already had a documented
idempotent "save today's decision" call on mount — reusing it on focus
was the natural fit rather than inventing new logic.

---

## Files audited but intentionally NOT modified

### `frontend/src/components/coach/CoachScreen.tsx`
`useFocusEffect` refetching was on the original priority list for this
screen but was **not implemented**. On inspection, CoachScreen has no
fetch-on-mount data loader — the chat is driven entirely by local
Zustand state (`chatHistory`), populated only via `sendMessage()`. There
is an unused `coachApi.getHistory()` endpoint, but wiring a focus-based
refetch into it would require merging server history with locally
appended optimistic messages, which risks duplicate or out-of-order chat
bubbles — a real regression with an unclear benefit. Flagged rather than
guessed at; needs a decision on desired merge behavior before
implementing.

---

## TODOs

- [ ] Decide on and implement Coach screen data-freshness strategy (see
      above) — not started.
- [ ] Smoke-test `EmptyState.tsx` on all three of its call sites
      (`WorkoutHistoryModal`, `PRScreen`, `DecisionScreen`) — built to
      match their existing prop usage but not visually verified in a
      running app (no Metro/simulator available in this environment).
- [ ] Phase 2 (Premium UI), Phase 3 (Quality), and Phase 4 (Cleanup)
      items from the polish plan are not yet started.

## Migrations required

None. No database schema, API contract, or backend changes were made or
are required for any change in this package.

## Manual steps required

1. **Install/verify `@react-navigation/native` resolves.** It's not a
   direct entry in `package.json` (only `expo-router` is), but it's a
   standard transitive dependency of `expo-router` and is the documented
   way to import `useFocusEffect` in an Expo Router app. This sandbox has
   no network access and no `node_modules`, so this could not be verified
   by an actual install — recommend running `npm install` (or your usual
   install command) and confirming `import { useFocusEffect } from '@react-navigation/native'`
   resolves cleanly, before merging.
2. **No environment variables, config, or build-step changes** are
   required beyond the above.
3. **Recommended smoke test before merge:**
   - Log two sets back-to-back as fast as possible on the Workout screen
     → confirm only one set is recorded per tap.
   - Turn off network mid-"Finish Workout" → confirm the Retry button
     appears and succeeds once network is restored.
   - Complete a workout, switch to Dashboard, Progress, and Decisions
     tabs → confirm each reflects the new data without a manual
     pull-to-refresh, and without a skeleton flash on the switch itself.

## Verification performed this session

No `node_modules`/network access was available in this sandbox, so a
full `tsc`/build could not be run against real type declarations. As a
substitute, the TypeScript compiler was run in a mode that still parses
every file and follows imports for cross-file checking, with "module not
found" noise (caused only by the missing `node_modules`, not by these
changes) filtered out. Every file listed above was diffed against a
pre-change baseline: identical error count and error types before and
after in all cases (only line numbers shifted due to inserted code) — no
new errors introduced by any change in this package.
