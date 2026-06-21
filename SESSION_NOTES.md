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

---

# Round — Fixed the actual `/api/coach/chat` 500 (this session)

You reported `/api/coach/chat` returning a 500, with a Groq key you'd
already confirmed works elsewhere. It does — the 500 wasn't coming from
Groq at all.

## Root cause

`db/chroma_client.py` and `db/memory_client.py` both used chromadb's
`DefaultEmbeddingFunction`, which **lazily downloads an ~80MB ONNX model
from an S3 bucket the first time it's actually used** — and that first
use happens *inside* the request path of `/api/coach/chat`, via
`retrieve_guardrails_node`'s call to `query_guardrails()`. That call had
**no error handling at all**. If the download is slow, interrupted, or
the connection to that specific S3 endpoint is flaky (which it can be on
some networks/regions/proxies), chromadb raises a `ValueError` ("does
not match expected SHA256 hash") — and since this happens *before*
`build_workout_node` ever calls Groq, the request 500s with no LLM call
having been made at all. This is also what the
`Failed to send telemetry event ... capture() takes 1 positional
argument but 3 were given` noise in your logs was — a side effect of
chromadb's default-embedding-function code path, specifically; it's
gone now that this is removed.

(The `42P01 relation "supabase_migrations.schema_migrations" does not
exist` line in what you pasted is unrelated to this — that's Supabase
CLI migration-tooling output, not anything this app queries. It looks
like terminal output from a different command got captured alongside
the server log.)

## Fix

Added `db/local_embeddings.py` — a small, fully local, dependency-free
embedding function (hashed bag-of-words with a hand-tuned domain synonym
map, since the guardrail set is a fixed ~12-document list, not an
open-ended corpus). No network calls, no model download, ever. Wired
into both `chroma_client.py` and `memory_client.py` in place of
`DefaultEmbeddingFunction`.

Also, since this wasn't just "make it not crash":
- `query_guardrails()` is now wrapped in a try/except — any failure
  (this one or anything else) returns an empty guardrail list instead of
  raising, so a guardrails-layer problem degrades response quality
  rather than breaking the whole chat endpoint. `build_workout_node`
  already handles an empty guardrails list fine.
- **Self-healing for anyone who already ran the app before this fix:**
  your existing `chroma_store` (if you have one) was built with the old
  384-dimension embeddings. Switching embedding functions on a
  collection that already has vectors at a different dimensionality
  raises `InvalidArgumentError("Collection expecting embedding with
  dimension of 384, got 256")`. `get_guardrail_collection()` now detects
  exactly that error on startup and automatically deletes + rebuilds +
  re-seeds the guardrails collection — no manual `rm -rf chroma_store`
  needed. (The separate user-memory collection is NOT auto-rebuilt the
  same way, since it holds real per-user data instead of a fixed seedable
  set — if you hit the same dimension error there, `remember()` now logs
  a clear message telling you exactly what to delete.)

Verified end-to-end with a mocked Groq response: parse → fatigue eval →
guardrails retrieval → memory recall → LLM call → reply, all complete
with zero network calls for the guardrails/memory layer. Retrieval
quality spot-checked across several phrasings (e.g. "I deadlifted
100kg, my lower back feels tight" correctly surfaces the
spinal/deadlift-compression rule, not a random unrelated one).

## A pattern worth flagging directly

This is the second time in a row that several specific things have come
back after being fixed: the stale `backend/backend/` duplicate folder,
the root `app/_layout.tsx` being a `<Tabs>` navigator instead of a
`<Stack>` (same bug, different exact code each time — it's being
regenerated, not reverted), `expo-font` missing from `package.json`,
`axios` pinned back to a vulnerable version, the four placeholder
1×1-pixel image assets, and `#FFD700` gold colors in `CoachScreen.tsx` /
`ProgressScreen.tsx` / `OnboardingScreen.tsx`.

All of these are fixed again as of this round (gold colors swapped for
`COLORS.primaryGreen`/`COLORS.primaryBlue`, `package-lock.json`
regenerated, `icon.png`/`splash.png`/`adaptive-icon.png`/`favicon.png`/
`hero-splash.png` rebuilt from the brand mark at correct sizes — this
time using `assets/branding/neurofit-ai-icon-mark.svg`, which had
already been added but never actually rendered into real PNGs or wired
into `app.json`). But if something else is regenerating these files
between sessions — another tool, a parallel Claude Code session, a
template being reapplied — it's worth finding that source, because
otherwise this list will likely come back a third time. `LoginScreen.tsx`
also reverted to its own internal sign-up-mode + remote Unsplash-photo
version rather than the link-to-`/register` + local-icon version from
last round; left as-is this time since it isn't broken, just
stylistically inconsistent with the shared `COLORS` theme — worth
deciding deliberately rather than me flip-flopping it back and forth
each round.

## Verified this round

- `python -c "from main import app"` imports cleanly, 29 routes register.
- `seed_guardrails()` + `query_guardrails()` run with zero network calls
  and return correct, relevant results across multiple test phrasings.
- Full `run_coach()` pipeline completes with a mocked LLM call — no
  exception anywhere before or after the (mocked) Groq call.
- `npm install` clean (789 packages, no ERESOLVE), `npx tsc --noEmit`
  zero errors, `npx expo export --platform web` bundles all modules with
  no errors, `npx expo-doctor` back to 15/18 (the 3 failures are the same
  sandbox-network-blocked / benign-nested-copy items as before, not
  project bugs).

## Still not verified

- Not run against your actual live Supabase + Groq credentials end to
  end (both blocked from my sandbox's network egress) — only verified
  with a mocked LLM response and fake Supabase credentials. The fix
  removes the specific failure mode in your logs; if `/api/coach/chat`
  still 500s after this with your real keys, the error detail in the
  response body (the route returns `f"AI Coach error: {str(e)}"`) will
  say exactly what's failing now — paste that exact text rather than
  just the log lines around it.
