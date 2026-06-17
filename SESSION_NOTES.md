# FitAI / NeuroFit AI — Backend Repair + Agent Wiring (this session)

## Run this first
**`CRITICAL_RUN_THIS_SQL_FIRST.sql`** in the Supabase SQL Editor. Nothing in
the backend works without it — this creates all 11 tables the code expects
(`profiles`, `injury_profiles`, `workout_plans`, `workout_sessions`,
`exercise_logs`, `personal_records`, `progress_metrics`, `progress_photos`,
`nutrition_logs`, `ai_conversations`, `agent_states`), with RLS policies and
indexes. It's extracted directly from `backend/db/supabase_client.py`'s
`SCHEMA_SQL`, so it's guaranteed to match what the code actually queries.

## What was actually broken and got fixed

**1. Backend routing was completely dead (worst bug).**
`requirements.txt` had `fastapi` and `uvicorn` unpinned. A fresh
`pip install` pulled `fastapi==0.137.1` paired with `starlette==1.3.1`
(Starlette's first 1.x release, days old at install time) — that pairing
silently drops every route registered via `include_router()`. Every endpoint
404'd. Pinned to `fastapi==0.115.6` / `starlette==0.41.3` / `uvicorn==0.34.0`
in `requirements.txt`. Verified: 25 real endpoints now register correctly.

**2. Two Pydantic models didn't match the agents that construct them.**
`ProgressDecision` and `RecoveryDecision` were missing fields
(`stalled`, `suggested_calorie_adjustment`, `action`) that
`progress_agent.py` / `recovery_agent.py` actually pass in — these would
have crashed with a `ValidationError` the first time either agent ran for
real. Fixed, with back-compat properties (`calorie_adjustment`,
`recommend_deload`) in case anything else reads the old names.

**3. `coach.py` called `run_coach()` with the wrong arguments entirely**
(`user_id=`, `message=` instead of `user_message`, `user_id`, `user_profile`,
`agent_state`) — chat would have crashed on every message. Rewritten to
build real context via `get_full_user_context()`, persist the agent's
updated CNS-fatigue state after each turn, and save both sides of the
conversation to `ai_conversations`.

**4. `dashboard.py` and `nutrition.py` were stubs returning hardcoded fake
numbers** (`calories_remaining: 1350` no matter what). Rewired both to
actually call the five decision agents and real database tables.

**5. A bad foreign key.** `ai_conversations.session_id` was constrained to
reference `workout_sessions(id)` — meaning any chat session not tied to a
specific workout would be rejected outright. Removed; it's now a plain
text field.

**6. Two of my own edits disagreed with each other mid-session**
(`OnboardingCreate` vs `ProfileCreate` used different field names for the
same data — `food_allergies` vs `allergies`, `motivation_style` vs
`coach_style`, etc.). Caught and reconciled onto one consistent naming
convention across the schema, the Pydantic models, and every route that
reads them.

## What got built (new code, not bug fixes)

- **`agents/workout_agent.py`** — the "Workout Agent" from your spec.
  Checks the active `workout_plans` schedule against yesterday's actual
  completion; if a planned day was missed, it reschedules today and says
  so explicitly ("You missed Leg day yesterday. Rescheduling it for today").
- **`db/memory_client.py`** — the "Memory Agent" / ChromaDB long-term memory
  store, separate from the existing safety-guardrails collection. Stores
  freeform facts (`"User has knee discomfort"`, `"User trains best in
  evenings"`) scoped per-user, with `remember()` / `recall()` / `recall_all()`
  / `forget()`.
- **Memory wired into the Coach Agent's LangGraph** — a new
  `recall_memory_node` retrieves relevant facts before the LLM call and
  injects them into the system prompt; a lightweight post-response check
  auto-writes new durable facts when the user says something like "I hate
  oats" or mentions a recurring injury, so the loop actually closes instead
  of being a write-only store nobody reads from.
- **Brand assets** — `assets/branding/neurofit-ai-logo.svg` (+ rendered
  `.png`), a recreation of the brain-circuit mark + wordmark from your
  reference image.

## What is NOT done — said plainly, not buried

This was always too large to complete safely in one pass, and that
remains true:

- **No frontend changes at all.** No onboarding slides (the 8-screen flow
  from your spec), no redesigned dashboard UI, no calorie/protein/water
  tank gauges, no glassmorphic HUD styling from your reference images, no
  logo actually placed inside the running app. The logo exists as a file;
  it is not integrated anywhere.
- **Backend has not been run against a real Supabase instance.** Everything
  above was verified by import, byte-compilation, and route-registration
  checks — not by an actual end-to-end request against live data. The SQL
  in `CRITICAL_RUN_THIS_SQL_FIRST.sql` has not been executed.
- **Planner Agent and Safety Agent** (two of the seven agents in your spec)
  were not built. `progress_agent.py`'s guardrails-query plus
  `coach_agent.py`'s guardrails retrieval cover some of "Safety," but
  there's no dedicated standalone agent for either.
- **No premium features** (voice coach, photo meal analysis, barcode
  scanning, smartwatch integration, WhatsApp reminders) — these were
  always listed in your spec as "future," not this pass.

## Suggested next step

Run the SQL file, then actually start the backend
(`uvicorn main:app --reload`) against your real Supabase project and hit
`/api/dashboard/summary` after a real onboarding submission, to catch
anything that only shows up with live data. After that's confirmed
working, the frontend (onboarding + dashboard redesign) is the right next
piece of work — and given its size, doing it in Claude Code rather than
continued back-and-forth here will get you a better result.
