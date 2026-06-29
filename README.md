# NeuroFit AI — Complete Developer Reference

> **Autonomous AI fitness coach. Thinks before you ask. Remembers everything. Adapts every session.**

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Architecture Overview](#4-architecture-overview)
5. [Database Schema](#5-database-schema)
6. [Backend — Setup & Running](#6-backend--setup--running)
7. [Frontend — Setup & Running](#7-frontend--setup--running)
8. [Environment Variables](#8-environment-variables)
9. [API Reference](#9-api-reference)
10. [Agent System](#10-agent-system)
11. [AI Coach — How It Works](#11-ai-coach--how-it-works)
12. [Design System](#12-design-system)
13. [Screen Guide](#13-screen-guide)
14. [Bug Fixes Applied](#14-bug-fixes-applied)
15. [Known Limitations & Next Steps](#15-known-limitations--next-steps)
16. [Deployment](#16-deployment)
17. [Security](#17-security)

---

## 1. What This Is

NeuroFit AI is a full-stack mobile fitness coaching app. The core philosophy:

> *"The user should open the app and know exactly what to do next without having to think."*

It is **not a chatbot**. On every app open, the AI runs a full decision pipeline — reads your recovery, sleep, CNS fatigue, nutrition gaps, and missed sessions — then surfaces one card telling you exactly what to do today. You can also chat with it directly and it responds with structured cards (workout tables, nutrition panels, recovery rings), not plain text.

**Data flow:**
```
App opens → Mission endpoint runs all agents concurrently
         → Recovery agent + Workout agent + Nutrition agent + Progress agent + Pattern engine + Coach brain
         → Single decision card rendered with no client logic
```

**Chat flow:**
```
User message → LangGraph pipeline
             → Parse input → Evaluate CNS fatigue → Retrieve guardrails (ChromaDB)
             → Recall long-term memory (ChromaDB) → Build structured JSON response
             → Frontend renders response_type-specific card
```

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Mobile** | React Native + Expo Router | Cross-platform app with file-based routing |
| **Backend** | FastAPI (async) | REST API, async agent orchestration |
| **Database** | Supabase (PostgreSQL + Auth + RLS) | User data, workouts, nutrition logs |
| **Vector DB** | ChromaDB | Biomechanical safety guardrails + long-term user memory |
| **AI Agent** | LangGraph | State-machine orchestration of multi-step coach pipeline |
| **LLM** | Groq (`llama-3.3-70b-versatile`) | Fast inference, structured JSON output |
| **State** | Zustand (custom lightweight) | Global client state (token, session, chat history) |
| **Auth** | JWT (HS256) + Supabase Auth | 30-day tokens, ORPHANED_SESSION detection |
| **Embedding** | `LocalHashEmbeddingFunction` (custom) | 256-dim deterministic hash embeddings, no ONNX download |
| **Deployment** | Render (backend) + EAS (mobile builds) | |

---

## 3. Project Structure

```
Fitness-Ai-main/
│
├── CRITICAL_RUN_THIS_SQL_FIRST.sql   ← Run this in Supabase before anything else
│
├── backend/
│   ├── main.py                       FastAPI app, route mounting, lifespan (ChromaDB seed)
│   ├── requirements.txt
│   ├── Procfile                      For Railway/Render: `web: uvicorn main:app ...`
│   ├── railway.json
│   │
│   ├── core/
│   │   ├── config.py                 Pydantic settings (reads .env). All env vars defined here.
│   │   └── security.py               JWT creation/validation, get_current_user dependency
│   │
│   ├── db/
│   │   ├── supabase_client.py        All DB operations. get_full_user_context() is the key function.
│   │   ├── chroma_client.py          Guardrails vector store. Self-heals dimension mismatches.
│   │   ├── memory_client.py          User long-term memory store. Separate ChromaDB collection.
│   │   └── local_embeddings.py       256-dim hash embedding function (no model download needed)
│   │
│   ├── agents/
│   │   ├── coach_agent.py            ★ Main LangGraph pipeline. 5 nodes → structured JSON response.
│   │   ├── coach_brain.py            Proactive AI brief (runs on app open, not on user message)
│   │   ├── recovery_agent.py         Computes 0-10 recovery score from sleep + CNS fatigue
│   │   ├── workout_agent.py          Decides today's workout type based on split + history
│   │   ├── nutrition_agent.py        Mifflin-St Jeor macro calculator + meal suggestions
│   │   ├── progress_agent.py         Detects stalled progress, suggests calorie adjustments
│   │   ├── motivation_agent.py       Generates one daily coaching insight/quote
│   │   ├── weekly_review_agent.py    7-day review generation (LLM-based)
│   │   └── pattern_engine.py         Rule-based pattern detection (protein streaks, missed sessions, etc.)
│   │
│   ├── api/routes/
│   │   ├── auth.py                   POST /register, POST /login
│   │   ├── profile.py                GET/PUT /me, POST /onboard, injuries, PRs
│   │   ├── workouts.py               Sessions CRUD, set logging, strength progression
│   │   ├── coach.py                  POST /chat, GET /history, POST /regenerate-workout, GET /memory
│   │   ├── mission.py                ★ GET /today — the main dashboard data endpoint
│   │   ├── dashboard.py              GET /summary — fallback dashboard endpoint
│   │   ├── nutrition.py              Targets, logging, FatSecret search, history
│   │   ├── progress.py               Metrics logging + retrieval
│   │   ├── review.py                 Weekly AI review
│   │   └── memory.py                 Coach memory CRUD
│   │
│   ├── schemas/
│   │   └── models.py                 All Pydantic request/response models
│   │
│   └── services/
│       ├── nutrition.py              calculate_macros() — Mifflin-St Jeor implementation
│       ├── pr_validator.py           PR validation logic
│       └── agent_state_store.py      get_agent_state() helper
│
└── frontend/
    ├── app/                          Expo Router file-based routing
    │   ├── index.tsx                 Auth guard — redirects to login or tabs
    │   ├── login.tsx
    │   ├── register.tsx
    │   ├── onboarding.tsx
    │   └── (tabs)/
    │       ├── _layout.tsx           Bottom tab bar definition
    │       ├── index.tsx             Home/Dashboard tab
    │       ├── coach.tsx             AI Coach chat tab
    │       ├── workout.tsx           WorkoutHUD tab
    │       ├── progress.tsx          Progress tab (Body/Strength/Nutrition/Recovery/Review)
    │       ├── profile.tsx           Profile tab
    │       └── prs.tsx               Personal Records screen
    │
    └── src/
        ├── components/
        │   ├── auth/
        │   │   ├── LoginScreen.tsx
        │   │   └── RegisterScreen.tsx
        │   ├── coach/
        │   │   └── CoachScreen.tsx   7 card types: WorkoutCard, LiveSetCard, NutritionCard, etc.
        │   ├── dashboard/
        │   │   ├── DashboardScreen.tsx      Main home screen
        │   │   ├── PatternInsightsCard.tsx  Pattern engine output card
        │   │   └── ProactiveBriefCard.tsx   Coach brain proactive brief card
        │   ├── onboarding/
        │   │   └── OnboardingScreen.tsx     5-slide onboarding flow
        │   ├── profile/
        │   │   └── ProfileScreen.tsx
        │   ├── progress/
        │   │   ├── ProgressScreen.tsx       4-tab: Body | Strength | Nutrition | Recovery
        │   │   ├── StrengthProgressionChart.tsx
        │   │   ├── WeightChart.tsx
        │   │   ├── WeeklyReviewScreen.tsx
        │   │   ├── PRScreen.tsx
        │   │   └── NutritionSearchModal.tsx
        │   ├── shared/
        │   │   ├── Logo.tsx          NEURO/FIT/AI brand mark with SVG gradient
        │   │   ├── RecoveryRing.tsx   WHOOP-style animated circular progress ring
        │   │   └── LoadingOverlay.tsx Skeleton cards
        │   ├── splash/
        │   │   └── AnimatedSplash.tsx
        │   ├── system/
        │   │   └── ErrorBoundary.tsx
        │   └── workout/
        │       ├── WorkoutHUD.tsx     Full workout tracking: sets, rest timer, RPE, PR detection
        │       └── WorkoutSummaryCard.tsx
        │
        ├── store/
        │   └── index.ts              Custom Zustand-like store: token, session, chatHistory, profile
        │
        ├── theme/
        │   ├── colors.ts             ★ Single source of truth for ALL colors
        │   └── typography.ts         Font spec (Proxima Nova equivalent)
        │
        └── utils/
            ├── api.ts                All API namespaces: authApi, profileApi, coachApi, workoutApi...
            ├── config.ts             EXPO_PUBLIC_API_URL fallback with loud console warning
            └── storage.ts            SecureStore wrapper (device) / localStorage (web)
```

---

## 4. Architecture Overview

### Request lifecycle on app open

```
DashboardScreen mounts
  ↓
missionApi.getToday()  →  GET /api/mission/today
  ↓
mission.py runs asyncio.gather() on:
  ├── run_nutrition_agent()    → macro targets, meal suggestion
  ├── _today_consumed()        → today's logged calories/protein/water
  ├── run_workout_agent()      → today's training split decision
  └── run_progress_agent()     → plateau detection, calorie adjustment
  ↓
run_recovery_agent()           → 0-10 recovery score (needs workout type)
  ↓
asyncio.gather() on:
  ├── run_pattern_engine()     → rule-based pattern alerts
  ├── get_daily_motivation()   → one coaching line
  └── generate_proactive_brief()  → Coach Brain full reasoning chain
  ↓
Returns single unified JSON card
DashboardScreen renders with no client logic
```

### Coach chat lifecycle

```
User types message → POST /api/coach/chat
  ↓
coach.py loads profile + agent_state + last 10 conversation turns
  ↓
run_coach() → LangGraph graph:
  parse_input_node
    → evaluate_fatigue_node
      → retrieve_guardrails_node  (ChromaDB: injury-specific safety rules)
        → recall_memory_node      (ChromaDB: user long-term preferences)
          → build_workout_node    (Groq LLM → structured JSON)
  ↓
Returns structured_decision: { response_type, coach_message, exercises[], summary, tips, ... }
  ↓
CoachScreen picks card component based on response_type
  ├── "workout_plan"    → WorkoutCard (exercise table with sets/reps/weight/rest)
  ├── "live_set"        → LiveSetCard (set analysis + next action)
  ├── "nutrition_tip"   → NutritionCard
  ├── "recovery_advice" → RecoveryCard
  ├── "progress_update" → ProgressCard
  └── "chat"            → ChatBubble (plain message)
```

### ChromaDB — two collections

| Collection | Purpose | Populated by |
|---|---|---|
| `repmind_guardrails` | Biomechanical safety rules (e.g. "barbell OHP contraindicated for shoulder impingement") | `seed_guardrails()` on app startup |
| `neurofit_user_memory` | Per-user durable facts (schedule, food preferences, injuries mentioned in chat) | `_auto_extract_memories()` after every coach message |

Both use `LocalHashEmbeddingFunction` (256-dim deterministic hash, no ONNX/model download). Both self-heal dimension mismatches on first use.

---

## 5. Database Schema

Run `CRITICAL_RUN_THIS_SQL_FIRST.sql` in the Supabase SQL editor once. Tables created:

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (FK → auth.users), `full_name`, `goal`, `weight_kg`, `height_cm`, `equipment[]`, `onboarding_complete` | Auto-created on first login if missing (FK gap fix) |
| `injury_profiles` | `user_id`, `body_part`, `issue_type`, `severity` | Many per user, fed to guardrails query |
| `workout_plans` | `user_id`, `schedule` (JSONB), `is_active` | AI-generated training splits |
| `workout_sessions` | `user_id`, `session_date`, `day_label`, `completed`, `total_volume_kg` | One per training day |
| `exercise_logs` | `session_id`, `exercise_name`, `set_number` (auto-computed), `weight_kg`, `reps`, `rpe` | Many per session |
| `personal_records` | `user_id`, `exercise_name`, `weight_kg` | Upserted, one per exercise |
| `progress_metrics` | `user_id`, `recorded_date`, `weight_kg`, `recovery_score`, `body_fat_pct` | Daily check-ins |
| `nutrition_logs` | `user_id`, `log_date`, `food_name`, `calories`, `protein_g`, `water_ml` | Multiple per day |
| `ai_conversations` | `user_id`, `session_id`, `role`, `content` | Full chat history |
| `agent_states` | `user_id`, `cns_fatigue_score`, `workout_streak`, `protein_streak`, `total_workouts` | Single row per user, upserted |
| `ai_timeline_events` | `user_id`, `event_type`, `message` | Append-only event feed |

**Row Level Security** is enabled on all tables — users can only access their own rows.

---

## 6. Backend — Setup & Running

### First time

```bash
cd backend

# Create .env (see Environment Variables section)
cp .env.example .env
# edit .env with your keys

# Install dependencies
pip install -r requirements.txt --break-system-packages

# Run the Supabase SQL schema first (in Supabase dashboard → SQL editor)
# File: CRITICAL_RUN_THIS_SQL_FIRST.sql

# Start dev server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Verify it's running

```
http://localhost:8000/          → { "app": "RepMind AI Gym Spotter", "status": "running" }
http://localhost:8000/health    → { "status": "ok" }
http://localhost:8000/docs      → Swagger UI with all endpoints
```

### ChromaDB

ChromaDB data is stored locally in `./chroma_store/`. On first run, `seed_guardrails()` populates it with 12 biomechanical safety rules. If you wipe Render and redeploy, this directory is gone — guardrails will be reseeded automatically on next startup.

---

## 7. Frontend — Setup & Running

### First time

```bash
cd frontend
npm install

# Create .env
cp .env.example .env
# Set EXPO_PUBLIC_API_URL to your backend URL
```

### Development

```bash
# Expo dev server (scan QR with Expo Go)
npx expo start

# For physical device or Android Emulator you MUST set EXPO_PUBLIC_API_URL
# localhost does NOT work on physical devices — use your machine's LAN IP
# e.g. EXPO_PUBLIC_API_URL=http://192.168.1.5:8000/api
```

### Build (EAS)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Build for Android (APK for testing)
eas build --platform android --profile preview

# Build for production
eas build --platform android --profile production
```

---

## 8. Environment Variables

### Backend (`backend/.env`)

```env
# LLM — Groq is the only active provider
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile       # optional, this is the default

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...              # service role key (bypasses RLS — backend only)

# JWT
SECRET_KEY=                              # generate: python3 -c "import secrets; print(secrets.token_hex(32))"
# Changing this key invalidates ALL existing user sessions (forced re-login)

# CORS — comma-separated list of allowed frontend origins
ALLOWED_ORIGINS=http://localhost:8081,https://your-prod-frontend.com

# ChromaDB — where guardrails + memory are persisted
CHROMA_PERSIST_DIR=./chroma_store        # default
CHROMA_COLLECTION_NAME=repmind_guardrails # default
```

### Frontend (`frontend/.env`)

```env
EXPO_PUBLIC_API_URL=https://your-backend.onrender.com/api

# For local dev on physical device:
# EXPO_PUBLIC_API_URL=http://192.168.1.XXX:8000/api

# For Android Emulator:
# EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api
```

> **Warning:** If `EXPO_PUBLIC_API_URL` is not set, the app falls back to `http://localhost:8000/api` and logs a loud console warning. This works only in the iOS Simulator on the same machine as the backend. It will not work on any physical device.

---

## 9. API Reference

All routes require `Authorization: Bearer <token>` except `/api/auth/*`.

### Auth — `/api/auth`

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/register` | `{ email, password, full_name }` | `{ access_token, user_id }` |
| `POST` | `/login` | `{ email, password }` | `{ access_token, user_id }` |

### Profile — `/api/profile`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `GET` | `/me` | — | Full profile object |
| `PUT` | `/me` | Any profile fields | Updated profile |
| `POST` | `/onboard` | Full onboarding payload | Created profile |
| `POST` | `/injuries` | `{ body_part, issue_type, severity }` | Injury record |
| `DELETE` | `/injuries/{id}` | — | `{ deleted: true }` |
| `POST` | `/prs` | `{ exercise_name, weight_kg }` | Upserted PR |
| `GET` | `/prs` | — | `[{ exercise_name, weight_kg }]` |

### Workouts — `/api/workouts`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `POST` | `/sessions` | `{ day_label?, workout_type?, notes? }` | Created session |
| `GET` | `/sessions` | `?limit=10` | `[session + exercise_logs[]]` |
| `PATCH` | `/sessions/{id}/complete` | `?cns_fatigue_after=` | Updated session with computed stats |
| `POST` | `/sessions/{id}/logs` | `{ exercise_name, weight_kg, reps, rpe? }` | Logged set (set_number auto-computed) |
| `GET` | `/sessions/{id}/logs` | — | `[set_log]` |
| `GET` | `/strength-progression` | `?exercise=Bench+Press&weeks=8` | `{ exercise, data: [{ week, weight_kg, date }] }` |

### AI Coach — `/api/coach`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `POST` | `/chat` | `{ content, session_id? }` | `ChatResponse` with `structured_decision` |
| `GET` | `/history` | `?limit=20` | `[{ role, content, created_at }]` |
| `POST` | `/regenerate-workout` | — | New `ChatResponse` with different workout plan |
| `GET` | `/timeline` | `?limit=15` | `{ events: [{ event_type, message, created_at }] }` |
| `GET` | `/memory` | — | `{ known_preferences, injuries, freeform_memories }` |

**`ChatResponse` shape:**
```json
{
  "reply": "Plain text fallback",
  "structured_decision": {
    "response_type": "workout_plan | live_set | nutrition_tip | recovery_advice | progress_update | chat | emergency",
    "coach_message": "Direct message to athlete",
    "exercises": [{ "name", "sets", "reps", "weight", "rest", "focus" }],
    "summary": { "intensity": "High|Moderate|Low|Rest", "estimated_time", "reason" },
    "tips": ["tip1", "tip2"],
    "next_action": "Single most important next step",
    "coach_insight": "One memorable coaching line",
    "recovery": 80
  },
  "guardrails_triggered": [],
  "emergency": false,
  "cns_fatigue_score": 3
}
```

### Mission — `/api/mission`

| Method | Path | Returns |
|---|---|---|
| `GET` | `/today` | Full decision card (see below) |

**`/api/mission/today` response** (the main dashboard data source):
```json
{
  "mission": "Push Day",
  "greeting": "Ready to train, Mohit?",
  "intensity": "High",
  "ai_decision": "Push session as planned",
  "next_action": "Train before evening",
  "coach_insight": "You've hit protein 4 days straight.",
  "alerts": ["⚠️ Recovery low — modify or skip training"],

  "recovery": { "score": 7, "action": "proceed", "message": "Recovery is 7/10..." },
  "workout_today": { "type": "push", "rescheduled": false, "message": "..." },
  "progress": { "stalled": false, "calorie_adjustment": 0, "message": "..." },

  "calories_remaining": 1200,
  "protein_remaining_g": 85.0,
  "water_remaining_ml": 1500,
  "calories_target": 2800,
  "protein_target_g": 180,
  "water_target_ml": 3000,
  "calories_pct": 57,
  "protein_pct": 53,

  "nutrition_status": { "calories_remaining", "protein_remaining_g", ... },
  "cns_fatigue": 3,
  "workout_streak": 4,
  "protein_streak": 4,
  "pattern_insights": [{ "category", "severity", "title", "detail", "recommendation" }],
  "proactive_brief": { "coach_message", "todays_focus", "recommendation", "reasoning_steps", ... }
}
```

### Progress — `/api/progress`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `POST` | `/metrics` | `{ weight_kg?, recovery_score?, body_fat_pct? }` | Created metric |
| `GET` | `/metrics` | `?limit=30` | `[metric]` ordered newest-first |

### Nutrition — `/api/nutrition`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `GET` | `/targets` | `?is_training_day=true` | `{ calories, protein_g, carbs_g, fat_g, water_ml }` |
| `GET` | `/today` | `?is_training_day=true` | Targets + today's consumed totals |
| `POST` | `/log` | `{ food_name, calories, protein_g, water_ml?, log_date? }` | Created log |
| `POST` | `/quick-log` | `?food_name=chicken&calories=220&protein_g=45` | Created log (query params) |
| `GET` | `/history` | `?limit=30` | `[nutrition_log]` |
| `GET` | `/search` | `?q=chicken+breast&max_results=5` | FatSecret search results |

---

## 10. Agent System

### Agent responsibilities

| Agent | File | Triggered by | Output |
|---|---|---|---|
| **CoachAgent** | `coach_agent.py` | Every `/coach/chat` request | `structured_decision` JSON |
| **CoachBrain** | `coach_brain.py` | `/mission/today` | `ProactiveBrief` |
| **RecoveryAgent** | `recovery_agent.py` | Mission + Dashboard | `RecoveryDecision(score, action, message)` |
| **WorkoutAgent** | `workout_agent.py` | Mission + Dashboard | `WorkoutDecision(recommended_type, rescheduled, message)` |
| **NutritionAgent** | `nutrition_agent.py` | Mission + Dashboard | `NutritionDecision(suggested_meal, message)` |
| **ProgressAgent** | `progress_agent.py` | Mission + Dashboard | `ProgressDecision(stalled, suggested_calorie_adjustment, message)` |
| **MotivationAgent** | `motivation_agent.py` | Mission | `str` (one coaching line) |
| **WeeklyReviewAgent** | `weekly_review_agent.py` | `/api/review` | Full 7-day LLM-generated review |
| **PatternEngine** | `pattern_engine.py` | Mission | `[PatternInsight]` — rule-based alerts |

### CoachAgent LangGraph nodes

```
parse_input_node          → Extract exercise data from message (LLM JSON parse)
evaluate_fatigue_node     → Update CNS fatigue score based on RPE + compound lifts
retrieve_guardrails_node  → ChromaDB query for relevant safety rules + injury guardrails
recall_memory_node        → ChromaDB query for user's stored preferences/habits
build_workout_node        → Groq LLM call → structured JSON response
```

### Recovery score calculation

```
score = 10
if sleep < 5h:   score -= 4
elif sleep < 6h: score -= 2
elif sleep < 7h: score -= 1
score -= min(5, cns_fatigue // 2)
score -= min(3, consecutive_high_rpe_days)
score = clamp(0, 10)

action:
  score <= 3 → "rest"
  score <= 6 → "replace_with_light"
  score >  6 → "proceed"
```

### CNS Fatigue tracking

Updated after every logged set by `evaluate_fatigue_node`:
- RPE ≥ 9.5 + heavy compound (deadlift/squat/bench): `+3`
- RPE ≥ 9.0: `+2`
- RPE ≥ 8.0: `+1`
- RPE < 8.0: `-1` (active recovery)
- Max: 10, Min: 0

CNS fatigue is persisted in `agent_states` table via `upsert_agent_state()`.

---

## 11. AI Coach — How It Works

### Prompt engineering

The system prompt in `build_workout_node` injects:
- Full athlete profile (goal, experience, weight, equipment, injuries)
- Current CNS fatigue and computed recovery %
- Weight caps = PR × 1.05 (anti-hallucination — LLM cannot prescribe weights above this)
- Relevant safety guardrails from ChromaDB
- Long-term memories recalled from ChromaDB
- Prior conversation turns (last 10 messages) for continuity

### Response type routing

The LLM always returns a JSON object with `response_type`. The frontend picks the card:

| `response_type` | Triggered when | Card rendered |
|---|---|---|
| `workout_plan` | User asks for today's workout | Exercise table with sets/reps/weight/rest/focus |
| `live_set` | User logs a completed set | Set analysis + next action + coaching cue |
| `nutrition_tip` | User asks about food/protein/calories | Macro panel + advice |
| `recovery_advice` | User asks about recovery/sleep/fatigue | Recovery ring + tips |
| `progress_update` | User asks about PRs/progress | PR highlights + trend |
| `chat` | General conversation | Plain message + optional tips |
| `emergency` | Acute pain keywords detected | R.I.C.E. protocol — workout terminated |

### Memory extraction

After every chat message, `_auto_extract_memories()` runs:
1. Fast path: keyword matching for schedule/food/injury/equipment signals
2. LLM path: for messages >8 words, Groq decides if there's a durable fact to store
3. Stored facts are recalled on next conversation via `recall_memory_node`

---

## 12. Design System

### Colors (`frontend/src/theme/colors.ts`)

All colors are centralized. Never hardcode hex values in components — import `COLORS`.

| Token | Hex | Use |
|---|---|---|
| `background` | `#000000` | Main app canvas |
| `card` | `#0D0D0D` | Card backgrounds |
| `cardElevated` | `#161616` | Elevated cards |
| `recoveryHigh` | `#16EC06` | Recovery 67-100%, primary green, success |
| `recoveryMed` | `#FFDE00` | Recovery 34-66%, warning |
| `recoveryLow` | `#FF0026` | Recovery 0-33%, danger |
| `strain` | `#0093E7` | Strain/activity, primary blue, "AI" brand color |
| `primaryGreen` | `#16EC06` | = `recoveryHigh` (alias for brand use) |
| `primaryBlue` | `#0093E7` | = `strain` (alias for brand use) |

Helper functions:
```ts
recoveryColor(score: number)  // 0-100 → hex color
recoveryLabel(score: number)  // 0-100 → "HIGH RECOVERY" | "MEDIUM RECOVERY" | "LOW RECOVERY"
alpha(hex, opacity)           // hex + opacity → 8-digit hex
```

### Logo

`Logo.tsx` — three-part wordmark: NEURO (white) + FIT (green→blue gradient SVG) + AI (blue).

```tsx
<Logo size="sm" />   // Tab bar / inline header
<Logo size="md" />   // Screen headers (default)
<Logo size="lg" />   // Login screen
<Logo size="xl" />   // Splash screen
<Logo showBadge={false} />     // Wordmark only
<Logo showWordmark={false} />  // Badge icon only
<Logo vertical />              // Stack badge above wordmark (login)
```

### RecoveryRing

```tsx
<RecoveryRing
  value={75}           // 0-100
  size={120}
  strokeWidth={10}
  label="RECOVERY"
  sublabel="HIGH"
  color={COLORS.recoveryHigh}
/>
```

---

## 13. Screen Guide

### Dashboard (Home tab)

- Calls `GET /api/mission/today` on mount, falls back to `GET /api/dashboard/summary`
- Renders: Recovery ring, mission card, workout card, macro bars, pattern insights, proactive brief, timeline feed
- Refresh: pull-to-refresh re-runs all agents

### Coach tab

- Full chat interface with `POST /api/coach/chat`
- Response cards rendered based on `structured_decision.response_type`
- Suggestion chips for first message
- "Regenerate Workout" button → `POST /api/coach/regenerate-workout`

### Workout tab (WorkoutHUD)

- Pre-session: START SESSION button + "Ask Coach for Today's Plan"
- Active session: exercise tabs, set logger (weight/reps/RPE), rest timer, volume counter
- "Ask Coach" during session: pulls workout plan from coach, auto-populates exercise list
- Complete session: `PATCH /sessions/{id}/complete` — computes total volume, updates streaks/fatigue

### Progress tab

Five sub-tabs:
- **Body**: weight log input + WeightChart + body stats + streaks + PR table
- **Strength**: StrengthProgressionChart (bar chart of weekly best weight per exercise)
- **Nutrition**: log food button + today's macros + CaloriesChart + ProteinAdherenceBar
- **Recovery**: log recovery score input (0-100) + RecoveryTrend sparkline + recent scores list
- **Review**: AI-generated 7-day weekly review

### Profile tab

- View/edit profile data
- Injury management (add/delete)
- Logout

---

## 14. Bug Fixes Applied

These are the exact changes in the fix files provided alongside this README.

### Fix 1 — `coach_agent.py`: `NoneType.split()` crash

**File:** `backend/agents/coach_agent.py`, line 262

**Problem:** `profile.get('full_name', 'Athlete')` returns `None` when the key `full_name` exists in the dict but its database value is `NULL`. Python's `.get(key, default)` only uses the default when the key is *absent* — not when the value is `None`. This caused every coach chat request to crash with `AttributeError: 'NoneType' object has no attribute 'split'` for any user whose `full_name` column was null (all new users who registered without completing onboarding).

```python
# BROKEN
- Name: {profile.get('full_name', 'Athlete').split()[0]}

# FIXED
- Name: {(profile.get('full_name') or 'Athlete').split()[0]}
```

### Fix 2 — `mission.py`: Dashboard recovery ring always showed 0

**File:** `backend/api/routes/mission.py`

**Problem:** `DashboardScreen` tries `GET /api/mission/today` first and only falls back to `GET /api/dashboard/summary` if the request throws. But `mission/today` returned **200 OK** with a completely different shape than what `DashboardSummary` expects:

| `DashboardScreen` reads | `mission/today` was returning |
|---|---|
| `summary.recovery.score` | `recovery` (flat int 0-100, not a nested object) |
| `summary.recovery.action` | `recovery_action` (flat) |
| `summary.calories_remaining` | `nutrition_status.calories_remaining` (nested) |
| `summary.workout_today.type` | `workout_type` (flat) |

So `summary?.recovery.score` was `undefined ?? 0 = 0`, the recovery ring permanently showed 0, and macros were always wrong. The fallback to `dashboard/summary` never fired because the request succeeded.

**Fix:** `mission/today` now returns all dashboard-compatible nested fields alongside its own fields. Both endpoints satisfy `DashboardSummary`.

### Fix 3 — `WorkoutHUD.tsx`: Wrong session field name

**File:** `frontend/src/components/workout/WorkoutHUD.tsx`

**Problem:** `createSession({ title: 'Training Session' })` — `SessionCreate` schema has `day_label`, not `title`. Pydantic ignores extra fields silently, so the session was created but with no label.

```ts
// BROKEN
workoutApi.createSession({ title: 'Training Session' })

// FIXED
workoutApi.createSession({ day_label: 'Training Session' })
```

### Fix 4 — `ProgressScreen.tsx`: Recovery tab had no data input

**File:** `frontend/src/components/progress/ProgressScreen.tsx`

**Problem:** The Recovery tab empty state said "Log recovery scores from the Profile screen" — but the Profile screen has no such feature. Users had no way to populate recovery data, so the tab was always empty.

**Fix:** Added a LOG RECOVERY SCORE input (numeric 0-100) with a LOG button directly on the Recovery tab, calling `progressApi.logMetrics({ recovery_score })`.

### Fix 5 — `Logo.tsx`: AI text too small, alignment off

**File:** `frontend/src/components/shared/Logo.tsx`

**Problem:** `AI` fontSize was `8` at `sm`, `10` at `md` — effectively invisible. `fontWeight: 700`, aligned to `flex-end` (rendering too low). Badge was slightly undersized.

**Fix:** `AI` fontSize now `12/16/22/30` across sizes, `fontWeight: 800`, `alignSelf: center`. Badge bumped ~6%. Letter spacing tightened to unify the three words into one brand mark.

---

## 15. Known Limitations & Next Steps

### Production gaps (not yet fixed)

| Issue | Impact | Suggested fix |
|---|---|---|
| No rate limiting on `/api/coach/chat` | User can spam Groq API, run up bills | `slowapi` per-user rate limiter, e.g. 20 requests/hour |
| ChromaDB not persisting across Render deploys | Guardrails re-seeded on every deploy (fine), but user memories are wiped | Mount a Render disk, or migrate to Pinecone/Qdrant |
| No JWT refresh token | After 30 days, user must log in again | Add refresh token endpoint + silent refresh in axios interceptor |
| Dashboard makes multiple sequential LLM calls | Cold start ~5-8s | Already using `asyncio.gather()` for agents, but Coach Brain LLM call is still serial |
| Onboarding has no recovery | If user closes mid-flow, they get stuck | Add `onboarding_step` tracking to allow resuming |

### ChromaDB on Render

Render's free tier has no persistent disk — `chroma_store/` is wiped on every deploy. User memories are lost. Options:

1. **Render disk** (paid): mount at `/chroma_store`, set `CHROMA_PERSIST_DIR=/chroma_store`
2. **Pinecone**: replace `LocalHashEmbeddingFunction` with Pinecone SDK; update `chroma_client.py` and `memory_client.py`
3. **Accept the loss**: guardrails are always re-seeded anyway; only user memory is lost

---

## 16. Deployment

### Backend (Render)

1. Connect your repo to Render as a **Web Service**
2. Set Build Command: `pip install -r requirements.txt`
3. Set Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add all environment variables from the `.env` section above
5. Set `ALLOWED_ORIGINS` to include your frontend's deployed URL

### Frontend (EAS)

1. Set `EXPO_PUBLIC_API_URL` in your EAS build profile (`eas.json`):
```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://your-backend.onrender.com/api"
      }
    }
  }
}
```
2. Run `eas build --platform android --profile production`
3. Download APK or publish to Play Store via `eas submit`

---

## 17. Security

- Passwords hashed with `bcrypt` via `passlib`
- JWTs signed with `HS256`, 30-day expiry
- `SECRET_KEY` must be set in production — rotating it invalidates all sessions
- `ORPHANED_SESSION` detection: valid JWT pointing at a deleted user → explicit 401 instead of 500 crash
- `SUPABASE_SERVICE_KEY` is backend-only — bypasses RLS, never expose to frontend
- CORS origin allowlist via `ALLOWED_ORIGINS` — update before shipping to production
- Row Level Security enabled on all tables — `auth.uid() = user_id` policies
- ChromaDB is local-only, no network exposure

---

## Quick Reference

### Add a new screen

1. Create `frontend/app/(tabs)/myscreen.tsx` — Expo Router auto-registers it as a tab route
2. Add the tab to `_layout.tsx`
3. Create `frontend/src/components/myscreen/MyScreen.tsx` with the actual UI
4. Add any new backend endpoints to `backend/api/routes/` and register in `main.py`

### Add a new agent

1. Create `backend/agents/my_agent.py` — return a dataclass result
2. Import and call it in `mission.py` inside `asyncio.gather()` for parallel execution
3. Add its output to the mission response JSON

### Add a new coach card type

1. Add new `response_type` string to the LLM prompt in `build_workout_node`
2. Add the new card component to `CoachScreen.tsx`
3. Add the routing case in the message rendering switch

### Debug the coach pipeline

```bash
# See all LangGraph node logs
uvicorn main:app --reload --log-level debug

# Test Groq connectivity directly
python backend/test_groq.py

# Check ChromaDB state
python3 -c "
import chromadb
c = chromadb.PersistentClient('./chroma_store')
print(c.list_collections())
col = c.get_collection('repmind_guardrails')
print(col.count(), 'guardrail docs')
"
```

---

*Last updated: June 2026 — post-audit revision*