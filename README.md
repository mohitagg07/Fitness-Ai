<div align="center">

```
 V  Y  R  N
   │  │
   ▼  ▼
Adaptive Performance System
```

# VYRN
### An autonomous AI fitness coach that thinks before you ask, remembers your training, detects patterns, explains every recommendation, and continuously adapts your workouts.

**Unlike traditional fitness apps, VYRN doesn't wait for prompts.**  
**It proactively decides what you should do today.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![React Native](https://img.shields.io/badge/React_Native-Expo-61DAFB?style=flat-square&logo=react)](https://expo.dev)
[![LangGraph](https://img.shields.io/badge/LangGraph-Multi--Agent-8A2BE2?style=flat-square)](https://github.com/langchain-ai/langgraph)
[![Groq](https://img.shields.io/badge/Groq-llama--3.3--70b-F55036?style=flat-square)](https://groq.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com)

</div>

---

## Why VYRN Exists

Most AI fitness apps are chatbots. You ask — they answer. You forget to ask — nothing happens.

VYRN is different. Every time you open the app, the AI has already observed your training, nutrition, recovery, injury history, memory, and patterns. It has already made a decision. You see the result — not a prompt box.

> *"The user should open the app and know exactly what to do next — without having to think."*

That's the only design principle this project was built around.

---

## How VYRN Compares

| Feature | ChatGPT | Typical Fitness App | VYRN |
|---|---|---|---|
| Remembers your training across sessions | ❌ | ⚠️ Basic | ✅ ChromaDB long-term memory |
| Proactive daily decisions (no prompt) | ❌ | ❌ | ✅ Mission pipeline on every open |
| Pattern detection (plateaus, missed days) | ❌ | ⚠️ Simple streaks | ✅ Rule-based pattern engine |
| Explains its reasoning with evidence | ❌ | ❌ | ✅ AI Decision Center |
| AI confidence score backed by real data | ❌ | ❌ | ✅ Deterministic, not hallucinated |
| Weekly AI strategy reviews | ❌ | ⚠️ Generic | ✅ LLM narrative + data |
| Multi-agent AI pipeline | ❌ | ❌ | ✅ 8 specialized agents |
| Safety guardrails (injury-aware) | ❌ | ❌ | ✅ ChromaDB biomechanical rules |
| Adaptive workout splits | ⚠️ | ⚠️ | ✅ Recovery + CNS fatigue-driven |
| Coach personality selection | ❌ | ❌ | ✅ Friendly / Strict / Military |

---

## AI Decision Center

VYRN's signature feature. Every recommendation comes with a full evidence trail.

```
Today's Decision
─────────────────────────────────────────
Recovery Score      84%   ✓  favorable
Sleep Duration      7h 42m ✓  favorable  
Protein Adherence   162g   ✓  at target
Bench Trend         +5 kg  ✓  last 21 days
Shoulder Pain       None   ✓  cleared
─────────────────────────────────────────
Decision:     Heavy Push Day
Confidence:   96%
─────────────────────────────────────────
Expected Outcome:
  +2–3 kg on bench within 2 weeks
  if adherence stays consistent.

Alternative:
  If shoulder discomfort returns,
  switch to incline dumbbell press.
─────────────────────────────────────────
```

**Confidence is never hallucinated.** Every percent point traces back to a real signal:
- Each signal (`recovery`, `sleep`, `protein`, `bench trend`, `injury`) is a deterministic threshold check — no LLM opinion
- `confidence_pct` = weighted average of favorable signals — pure arithmetic
- The LLM is used only to phrase the `reasoning` sentence — given the already-computed verdict as fixed input

If the LLM call fails, a deterministic template is used instead. The card never silently degrades to fabricated text.

---

## Coach Memory

VYRN tracks what it learns about you across every session:

```
Coach Memory
──────────────────────────────────
✓  Loves Incline Bench
✓  Trains at 6 PM
✓  Left shoulder impingement
✓  Vegetarian on Tuesdays  
✓  Sleeps ~7 hours
✓  Goal: Strength
──────────────────────────────────
Stored: 23 personal facts
Last updated: today
```

Memory is extracted automatically after every coach chat — no tagging, no manual input. The next conversation picks up exactly where the last one left off, even weeks later.

**Memory categories:** `food_preference` · `schedule_pattern` · `injury` · `training_preference` · `general`

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     VYRN Mobile App                     │
│              React Native + Expo Router                 │
└────────────────────────┬────────────────────────────────┘
                         │ REST
┌────────────────────────▼────────────────────────────────┐
│                  FastAPI Backend                         │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Mission Pipeline                     │   │
│  │         (runs on every app open)                 │   │
│  │                                                  │   │
│  │  asyncio.gather():                               │   │
│  │  ├── Recovery Agent    → 0-10 score              │   │
│  │  ├── Workout Agent     → today's split           │   │
│  │  ├── Nutrition Agent   → macro targets           │   │
│  │  ├── Progress Agent    → plateau detection       │   │
│  │  ├── Pattern Engine    → rule-based alerts       │   │
│  │  ├── Motivation Agent  → daily coaching line     │   │
│  │  └── Coach Brain       → proactive brief         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │            Coach Chat Pipeline                   │   │
│  │         (LangGraph, on every message)            │   │
│  │                                                  │   │
│  │  parse_input_node                                │   │
│  │    → evaluate_fatigue_node                       │   │
│  │      → retrieve_guardrails_node  (ChromaDB)      │   │
│  │        → recall_memory_node      (ChromaDB)      │   │
│  │          → build_workout_node    (Groq LLM)      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │           AI Decision Center                     │   │
│  │    (deterministic confidence engine)             │   │
│  └──────────────────────────────────────────────────┘   │
└───────────┬──────────────┬──────────────────────────────┘
            │              │
┌───────────▼──┐  ┌────────▼───────────────────────────────┐
│  Supabase    │  │  ChromaDB (local vector store)          │
│  PostgreSQL  │  │  ├── vyrn_guardrails  (safety rules)    │
│  + Auth      │  │  └── vyrn_user_memory (per-user facts)  │
│  + RLS       │  └────────────────────────────────────────┘
└──────────────┘           │
                  ┌────────▼───────┐
                  │   Groq API     │
                  │ llama-3.3-70b  │
                  └────────────────┘
```

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Project Structure](#2-project-structure)
3. [Data & Chat Flows](#3-data--chat-flows)
4. [Database Schema](#4-database-schema)
5. [Backend — Setup & Running](#5-backend--setup--running)
6. [Frontend — Setup & Running](#6-frontend--setup--running)
7. [Environment Variables](#7-environment-variables)
8. [API Reference](#8-api-reference)
9. [Agent System](#9-agent-system)
10. [AI Coach — How It Works](#10-ai-coach--how-it-works)
11. [Design System](#11-design-system)
12. [Screen Guide](#12-screen-guide)
13. [Engineering Improvements](#13-engineering-improvements)
14. [Production Roadmap](#14-production-roadmap)
15. [Deployment](#15-deployment)
16. [Security](#16-security)

---

## 1. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Mobile** | React Native + Expo Router | Cross-platform app with file-based routing |
| **Backend** | FastAPI (async, `0.115.6`) | REST API, async agent orchestration |
| **Database** | Supabase (PostgreSQL + Auth + RLS) | User data, workouts, nutrition logs |
| **Vector DB** | ChromaDB | Biomechanical safety guardrails + long-term user memory |
| **AI Agent** | LangGraph | State-machine orchestration of multi-step coach pipeline |
| **LLM** | Groq (`llama-3.3-70b-versatile`) | Fast inference, structured JSON output |
| **State** | Custom Zustand-like store | Global client state (token, session, chat history) |
| **Auth** | JWT (HS256) + Supabase Auth | 30-day tokens, ORPHANED_SESSION detection |
| **Embedding** | `LocalHashEmbeddingFunction` (custom) | 256-dim deterministic hash embeddings — no ONNX download |
| **Deployment** | Render (backend) + EAS (mobile builds) | |

---

## 2. Project Structure

```
VYRN-main/
│
├── CRITICAL_RUN_THIS_SQL_FIRST.sql   ← Run this in Supabase before anything else
│
├── backend/
│   ├── main.py                       FastAPI app, route mounting, lifespan (ChromaDB seed)
│   ├── requirements.txt
│   ├── Procfile                      For Railway/Render: web: uvicorn main:app ...
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
│   │   ├── decision_engine.py        ★ AI Decision Center — deterministic confidence engine
│   │   ├── recovery_agent.py         Computes 0-10 recovery score from sleep + CNS fatigue
│   │   ├── workout_agent.py          Decides today's workout type based on split + history
│   │   ├── nutrition_agent.py        Mifflin-St Jeor macro calculator + meal suggestions
│   │   ├── progress_agent.py         Detects stalled progress, suggests calorie adjustments
│   │   ├── motivation_agent.py       Generates one daily coaching insight/quote
│   │   ├── weekly_review_agent.py    7-day review generation (LLM-based narrative)
│   │   └── pattern_engine.py         Rule-based pattern detection (plateaus, protein, missed sessions)
│   │
│   ├── api/routes/
│   │   ├── auth.py                   POST /register, POST /login
│   │   ├── profile.py                GET/PUT /me, POST /onboard, injuries, PRs
│   │   ├── workouts.py               Sessions CRUD, set logging, strength progression
│   │   ├── coach.py                  POST /chat, GET /history, GET /memory, GET /timeline
│   │   ├── mission.py                ★ GET /today — main dashboard data endpoint
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
    │       ├── progress.tsx          Progress tab
    │       ├── profile.tsx           Profile tab
    │       └── prs.tsx               Personal Records screen
    │
    └── src/
        ├── components/
        │   ├── auth/
        │   │   ├── LoginScreen.tsx
        │   │   └── RegisterScreen.tsx
        │   ├── coach/
        │   │   └── CoachScreen.tsx         6 structured card types + chat bubble
        │   ├── dashboard/
        │   │   ├── DashboardScreen.tsx     Main home screen
        │   │   ├── PatternInsightsCard.tsx Pattern engine output card
        │   │   └── ProactiveBriefCard.tsx  Coach Brain proactive brief card
        │   ├── onboarding/
        │   │   └── OnboardingScreen.tsx    5-slide onboarding (includes coach style selection)
        │   ├── profile/
        │   │   └── ProfileScreen.tsx
        │   ├── progress/
        │   │   ├── ProgressScreen.tsx      5-tab: Body | Strength | Nutrition | Recovery | Review
        │   │   ├── StrengthProgressionChart.tsx
        │   │   ├── WeightChart.tsx
        │   │   ├── WeeklyReviewScreen.tsx
        │   │   ├── PRScreen.tsx
        │   │   └── NutritionSearchModal.tsx
        │   ├── shared/
        │   │   ├── Logo.tsx                VYRN brand mark — V/Y(gradient)/RN wordmark + SVG chevron badge
        │   │   ├── RecoveryRing.tsx        Animated circular progress ring
        │   │   └── LoadingOverlay.tsx      Skeleton cards
        │   ├── splash/
        │   │   └── AnimatedSplash.tsx      Scale + fade entrance sequence
        │   ├── system/
        │   │   └── ErrorBoundary.tsx
        │   └── workout/
        │       ├── WorkoutHUD.tsx          Full workout tracking: sets, rest timer, RPE, PR detection
        │       └── WorkoutSummaryCard.tsx
        │
        ├── store/
        │   └── index.ts                   Token, session, chatHistory, profile — Zustand-like
        │
        ├── theme/
        │   ├── colors.ts                  ★ Single source of truth for ALL colors
        │   └── typography.ts              Font spec (Inter / Space Grotesk)
        │
        └── utils/
            ├── api.ts                     All API namespaces: authApi, profileApi, coachApi...
            ├── config.ts                  EXPO_PUBLIC_API_URL with loud fallback warning
            └── storage.ts                 SecureStore wrapper (device) / localStorage (web)
```

---

## 3. Data & Chat Flows

### Mission pipeline (on every app open)

```
DashboardScreen mounts
  ↓
missionApi.getToday()  →  GET /api/mission/today
  ↓
mission.py: asyncio.gather():
  ├── run_nutrition_agent()       macro targets, meal suggestion
  ├── _today_consumed()           today's logged calories / protein / water
  ├── run_workout_agent()         today's training split decision
  └── run_progress_agent()        plateau detection, calorie adjustment
  ↓
run_recovery_agent()              0-10 recovery score (needs workout type)
  ↓
asyncio.gather():
  ├── run_pattern_engine()        rule-based pattern alerts
  ├── get_daily_motivation()      one coaching line
  └── generate_proactive_brief()  Coach Brain full reasoning chain
  ↓
Single unified JSON card rendered — no client logic
```

### Coach chat pipeline (on every message)

```
User types message → POST /api/coach/chat
  ↓
coach.py: loads profile + agent_state + last 10 conversation turns
  ↓
run_coach() → LangGraph graph:
  parse_input_node
    → evaluate_fatigue_node
      → retrieve_guardrails_node  (ChromaDB: injury-specific safety rules)
        → recall_memory_node      (ChromaDB: user long-term preferences)
          → build_workout_node    (Groq LLM → structured JSON)
  ↓
Returns structured_decision:
  { response_type, coach_message, exercises[], summary, tips, ... }
  ↓
CoachScreen picks card based on response_type:
  ├── "workout_plan"    → WorkoutCard
  ├── "live_set"        → LiveSetCard
  ├── "nutrition_tip"   → NutritionCard
  ├── "recovery_advice" → RecoveryCard
  ├── "progress_update" → ProgressCard
  └── "chat"            → ChatBubble
```

### ChromaDB — two collections

| Collection | Purpose | Populated by |
|---|---|---|
| `vyrn_guardrails` | Biomechanical safety rules (e.g. "barbell OHP contraindicated for shoulder impingement") | `seed_guardrails()` on startup |
| `vyrn_user_memory` | Per-user durable facts (schedule, food preferences, injuries from chat) | `_auto_extract_memories()` after every coach message |

Both use `LocalHashEmbeddingFunction` (256-dim deterministic hash — no ONNX model download required). Both self-heal dimension mismatches on first use.

---

## 4. Database Schema

Run `CRITICAL_RUN_THIS_SQL_FIRST.sql` in Supabase SQL editor once. Tables:

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (FK → auth.users), `full_name`, `goal`, `weight_kg`, `height_cm`, `equipment[]`, `coach_style`, `onboarding_complete` | Auto-created on first login if missing |
| `injury_profiles` | `user_id`, `body_part`, `issue_type`, `severity`, `doctor_restriction` | Many per user, fed to guardrails query |
| `workout_plans` | `user_id`, `schedule` (JSONB), `is_active` | AI-generated training splits |
| `workout_sessions` | `user_id`, `session_date`, `day_label`, `completed`, `total_volume_kg` | One per training day |
| `exercise_logs` | `session_id`, `exercise_name`, `set_number` (auto), `weight_kg`, `reps`, `rpe` | Many per session |
| `personal_records` | `user_id`, `exercise_name`, `weight_kg` | Upserted, one per exercise |
| `progress_metrics` | `user_id`, `recorded_date`, `weight_kg`, `recovery_score`, `body_fat_pct` | Daily check-ins |
| `nutrition_logs` | `user_id`, `log_date`, `food_name`, `calories`, `protein_g`, `water_ml` | Multiple per day |
| `ai_conversations` | `user_id`, `session_id`, `role`, `content` | Full chat history |
| `agent_states` | `user_id`, `cns_fatigue_score`, `workout_streak`, `protein_streak`, `total_workouts` | Single row per user, upserted |
| `ai_timeline_events` | `user_id`, `event_type`, `message` | Append-only coach event feed |

Row Level Security is enabled on all tables — `auth.uid() = user_id` on every policy.

---

## 5. Backend — Setup & Running

### First time

```bash
cd backend

# Create .env (see Section 7)
cp .env.example .env
# Fill in GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SECRET_KEY

# Install dependencies (pin matters — unpinned FastAPI drops routes silently)
pip install -r requirements.txt --break-system-packages

# Run the Supabase SQL schema (Supabase dashboard → SQL editor)
# File: CRITICAL_RUN_THIS_SQL_FIRST.sql

# Start dev server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Verify

```
http://localhost:8000/        → { "app": "VYRN Adaptive Performance System", "status": "running" }
http://localhost:8000/health  → { "status": "ok" }
http://localhost:8000/docs    → Swagger UI with all endpoints
```

### ChromaDB

Stored locally in `./chroma_store/`. On first run, `seed_guardrails()` populates 12 biomechanical safety rules. If the server is wiped (Render free tier), guardrails are automatically re-seeded on next startup. User memories are lost — see Section 14 for options.

---

## 6. Frontend — Setup & Running

### First time

```bash
cd frontend
npm install

# Create .env
echo "EXPO_PUBLIC_API_URL=http://localhost:8000/api" > .env
```

### Development

```bash
# Expo dev server (scan QR with Expo Go)
npx expo start

# Physical device or Android Emulator — localhost won't work
# Use your machine's LAN IP:
EXPO_PUBLIC_API_URL=http://192.168.1.5:8000/api npx expo start
```

### Build (EAS)

```bash
npm install -g eas-cli
eas login

# APK for testing
eas build --platform android --profile preview

# Production
eas build --platform android --profile production
```

---

## 7. Environment Variables

### Backend (`backend/.env`)

```env
# LLM
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile          # optional, this is the default

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...                 # service role key — backend only, bypasses RLS

# JWT
SECRET_KEY=                                 # python3 -c "import secrets; print(secrets.token_hex(32))"
# Rotating this key invalidates ALL existing sessions

# CORS
ALLOWED_ORIGINS=http://localhost:8081,https://your-prod-frontend.com

# ChromaDB
CHROMA_PERSIST_DIR=./chroma_store
CHROMA_COLLECTION_NAME=vyrn_guardrails
```

### Frontend (`frontend/.env`)

```env
EXPO_PUBLIC_API_URL=https://your-backend.onrender.com/api

# Local dev on physical device:
# EXPO_PUBLIC_API_URL=http://192.168.1.XXX:8000/api

# Android Emulator:
# EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api
```

> **Warning:** If `EXPO_PUBLIC_API_URL` is not set, the app falls back to `http://localhost:8000/api` and logs a loud console warning. This only works in the iOS Simulator running on the same machine as the backend — not on any physical device.

---

## 8. API Reference

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
| `GET` | `/today` | Full decision card (primary dashboard source) |

**`/api/mission/today` response:**
```json
{
  "mission": "Push Day",
  "greeting": "Ready to train?",
  "intensity": "High",
  "ai_decision": "Push session as planned",
  "next_action": "Train before evening",
  "coach_insight": "You've hit protein 4 days straight.",
  "alerts": ["⚠️ Recovery low — modify or skip training"],

  "recovery": { "score": 7, "action": "proceed", "message": "..." },
  "workout_today": { "type": "push", "rescheduled": false, "message": "..." },
  "progress": { "stalled": false, "calorie_adjustment": 0, "message": "..." },

  "calories_remaining": 1200,
  "protein_remaining_g": 85.0,
  "water_remaining_ml": 1500,
  "calories_target": 2800,
  "protein_target_g": 180,
  "water_target_ml": 3000,

  "cns_fatigue": 3,
  "workout_streak": 4,
  "protein_streak": 4,
  "pattern_insights": [{ "category", "severity", "title", "detail", "recommendation" }],
  "proactive_brief": { "coach_message", "todays_focus", "recommendation", "reasoning_steps" }
}
```

### Progress — `/api/progress`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `POST` | `/metrics` | `{ weight_kg?, recovery_score?, body_fat_pct? }` | Created metric |
| `GET` | `/metrics` | `?limit=30` | `[metric]` newest-first |

### Nutrition — `/api/nutrition`

| Method | Path | Body/Params | Returns |
|---|---|---|---|
| `GET` | `/targets` | `?is_training_day=true` | `{ calories, protein_g, carbs_g, fat_g, water_ml }` |
| `GET` | `/today` | `?is_training_day=true` | Targets + today's consumed totals |
| `POST` | `/log` | `{ food_name, calories, protein_g, water_ml?, log_date? }` | Created log |
| `GET` | `/history` | `?limit=30` | `[nutrition_log]` |
| `GET` | `/search` | `?q=chicken+breast&max_results=5` | FatSecret search results |

---

## 9. Agent System

### Agent responsibilities

| Agent | Triggered by | Output |
|---|---|---|
| **CoachAgent** | Every `/coach/chat` request | `structured_decision` JSON |
| **CoachBrain** | `/mission/today` | `ProactiveBrief` with reasoning steps |
| **DecisionEngine** | `/mission/today` | `DecisionCenter` with confidence + evidence |
| **RecoveryAgent** | Mission + Dashboard | `RecoveryDecision(score, action, message)` |
| **WorkoutAgent** | Mission + Dashboard | `WorkoutDecision(recommended_type, rescheduled, message)` |
| **NutritionAgent** | Mission + Dashboard | `NutritionDecision(suggested_meal, message)` |
| **ProgressAgent** | Mission + Dashboard | `ProgressDecision(stalled, calorie_adjustment, message)` |
| **MotivationAgent** | Mission | One coaching line (`str`) |
| **WeeklyReviewAgent** | `/api/review` | Full 7-day LLM-generated review |
| **PatternEngine** | Mission | `[PatternInsight]` — rule-based alerts |

### LangGraph nodes (CoachAgent)

```
parse_input_node          Extract exercise data from message (LLM JSON parse)
evaluate_fatigue_node     Update CNS fatigue based on RPE + compound lift flags
retrieve_guardrails_node  ChromaDB query: injury-relevant safety rules
recall_memory_node        ChromaDB query: user's stored habits and preferences
build_workout_node        Groq LLM call → structured JSON response
```

### Recovery score formula

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

### CNS Fatigue accumulation

Updated by `evaluate_fatigue_node` after every logged set:

| Condition | Delta |
|---|---|
| RPE ≥ 9.5 + heavy compound (deadlift/squat/bench) | +3 |
| RPE ≥ 9.0 | +2 |
| RPE ≥ 8.0 | +1 |
| RPE < 8.0 | -1 (recovery signal) |
| Range | 0–10 |

Persisted in `agent_states.cns_fatigue_score` via `upsert_agent_state()`.

### Pattern engine — detection rules

| Category | Trigger | Output |
|---|---|---|
| `plateau` | No strength increase on an exercise over 4 weeks | Alert + deload suggestion |
| `missed_workout` | Missed session without rest-day explanation | Pattern alert |
| `recovery_decline` | Recovery score trending down 3+ consecutive days | Warning + sleep tip |
| `protein_deficit` | Protein below target 3+ days | Nutrition alert |
| `pr_opportunity` | 8+ days since last attempt, recovery high, trend up | PR push recommendation |

---

## 10. AI Coach — How It Works

### Prompt engineering

The system prompt in `build_workout_node` injects:
- Full athlete profile (goal, experience, weight, equipment, injuries, coach style)
- Current CNS fatigue and computed recovery percentage
- Weight caps = `PR × 1.05` — the LLM cannot prescribe weights above this (anti-hallucination guardrail)
- Relevant safety rules retrieved from ChromaDB (injury-specific)
- Long-term memory facts recalled from ChromaDB
- Last 10 conversation turns for continuity

### Coach personality system

Selected during onboarding and stored in `profiles.coach_style`:

| Style | Behavior |
|---|---|
| `friendly` | Supportive, explanatory, motivating |
| `strict` | Direct, no excuses, performance-first |
| `military` | Drill-sergeant tone, zero tolerance for skipped sessions |

The personality injects a tone modifier into the system prompt — same intelligence underneath, different communication style.

### Response type routing

| `response_type` | Triggered when | Card rendered |
|---|---|---|
| `workout_plan` | User asks for today's workout | Exercise table with sets/reps/weight/rest/focus |
| `live_set` | User logs a completed set | Set analysis + next action + coaching cue |
| `nutrition_tip` | User asks about food/protein/calories | Macro panel + meal suggestion |
| `recovery_advice` | User asks about recovery/sleep/fatigue | Recovery ring + tips |
| `progress_update` | User asks about PRs/progress | PR highlights + trend |
| `chat` | General conversation | Plain message + optional tips |
| `emergency` | Acute pain keywords detected | R.I.C.E. protocol — workout terminated immediately |

### Memory extraction

After every coach message, `_auto_extract_memories()` runs:

1. **Fast path:** keyword matching for schedule / food / injury / equipment signals
2. **LLM path:** for messages over 8 words, Groq decides if there's a durable fact worth storing
3. **Storage:** facts stored in `vyrn_user_memory` with category tags
4. **Recall:** retrieved on next conversation via `recall_memory_node`

### AI Decision Center — confidence calculation

```python
signals = [
  { "label": "Recovery",         "favorable": recovery_pct >= 70 },
  { "label": "Sleep",            "favorable": sleep_hours >= 7   },
  { "label": "Protein",          "favorable": protein_adherence  },
  { "label": "Strength Trend",   "favorable": bench_delta_kg > 0 },
  { "label": "Injury Status",    "favorable": no_active_pain     },
]

# Weighted average — no LLM involved
confidence_pct = sum(w * s["favorable"] for w, s in zip(weights, signals)) / sum(weights)

# LLM writes one reasoning sentence using pre-computed signals as fixed input
# If LLM fails, a deterministic template is used — card never silently degrades
```

---

## 11. Design System

### Brand

**Logo:** Three-part wordmark — `V` (white) · `Y` (lime → blue gradient SVG) · `RN` (white). Badge: circle emblem with V-chevron mark, `#7CFF00 → #28B8FF` gradient.

**Tagline:** ADAPTIVE PERFORMANCE SYSTEM

**Brand colors:**

| Token | Hex | Use |
|---|---|---|
| Lime green | `#7CFF00` | Logo Y gradient start, brand accent |
| Electric blue | `#28B8FF` | Logo Y gradient end, brand accent |

### App color palette (`frontend/src/theme/colors.ts`)

Never hardcode hex values in components — always import `COLORS`.

| Token | Hex | Use |
|---|---|---|
| `background` | `#000000` | Main canvas |
| `card` | `#0D0D0D` | Card backgrounds |
| `cardElevated` | `#161616` | Elevated cards |
| `recoveryHigh` | `#16EC06` | Recovery 67–100%, success |
| `recoveryMed` | `#FFDE00` | Recovery 34–66%, warning |
| `recoveryLow` | `#FF0026` | Recovery 0–33%, danger |
| `strain` | `#0093E7` | Activity, exertion, primary blue |
| `strainGlow` | `#00F19F` | CTAs, highlights |
| `text` | `#FFFFFF` | Primary text |
| `textSecondary` | `#9A9A9A` | Secondary text |

Helper functions:
```ts
recoveryColor(score: number)  // 0–100 → hex color
recoveryLabel(score: number)  // 0–100 → "HIGH RECOVERY" | "MEDIUM RECOVERY" | "LOW RECOVERY"
alpha(hex, opacity)           // hex + opacity → 8-digit hex
```

### Logo component

```tsx
<Logo size="sm" />              // Tab bar / inline header
<Logo size="md" />              // Screen headers (default)
<Logo size="lg" />              // Login screen
<Logo size="xl" />              // Splash screen
<Logo showBadge={false} />      // Wordmark only
<Logo showWordmark={false} />   // Badge icon only
<Logo vertical />               // Stack badge above wordmark (login)
```

### RecoveryRing component

```tsx
<RecoveryRing
  value={75}
  size={120}
  strokeWidth={10}
  label="RECOVERY"
  sublabel="HIGH"
  color={COLORS.recoveryHigh}
/>
```

---

## 12. Screen Guide

### Dashboard (Home tab)

Calls `GET /api/mission/today` on mount. Falls back to `GET /api/dashboard/summary`.

Renders: Recovery ring · Mission card · Workout card · Macro bars (calories/protein/water) · Pattern insights · Proactive coach brief · Timeline feed

Pull-to-refresh re-runs all agents.

### Coach tab

Full chat interface with `POST /api/coach/chat`. Structured cards rendered based on `response_type`. Suggestion chips on first open. "Regenerate Workout" button for a fresh plan.

### Workout tab (WorkoutHUD)

- **Pre-session:** START SESSION + "Ask Coach for Today's Plan"
- **Active session:** Exercise tabs · Set logger (weight/reps/RPE) · Auto rest timer · Volume counter · Live PR detection
- **Post-session:** `PATCH /sessions/{id}/complete` — computes total volume, updates streaks and CNS fatigue

### Progress tab

Five sub-tabs:

| Tab | Content |
|---|---|
| **Body** | Weight input + WeightChart sparkline + body stats + streak counters + PR table |
| **Strength** | StrengthProgressionChart — weekly best weight per exercise (bar chart) |
| **Nutrition** | Food log button + today's macros + CaloriesChart + ProteinAdherenceBar |
| **Recovery** | Recovery score input (0–100) + RecoveryTrend sparkline + recent score list |
| **Review** | AI-generated 7-day weekly review (LLM narrative with full data context) |

### Profile tab

View/edit profile data · Injury management (add/delete) · Coach style selection · Logout

---

## 13. Engineering Improvements

These are the concrete bugs found and fixed during the build process.

### Fix 1 — `coach_agent.py`: `NoneType.split()` crash on new users

**Root cause:** `profile.get('full_name', 'Athlete')` returns `None` when the database column exists but is `NULL`. Python's `.get(key, default)` only uses the default when the key is absent — not when the value is `None`. Every new user who registered without completing onboarding had a null `full_name`, causing every coach chat to crash.

```python
# Broken
- Name: {profile.get('full_name', 'Athlete').split()[0]}

# Fixed
- Name: {(profile.get('full_name') or 'Athlete').split()[0]}
```

### Fix 2 — `mission.py`: Recovery ring permanently showed 0

**Root cause:** `DashboardScreen` calls `GET /api/mission/today` and falls back to `GET /api/dashboard/summary` only if the request throws. But `mission/today` returned **200 OK** with a flat shape — while the screen read nested fields:

| Screen reads | Mission was returning |
|---|---|
| `summary.recovery.score` | `recovery` (flat int, not nested) |
| `summary.calories_remaining` | `nutrition_status.calories_remaining` (nested) |
| `summary.workout_today.type` | `workout_type` (flat) |

Result: `summary?.recovery.score` was `undefined ?? 0 = 0` every time. The fallback never fired because the request succeeded with HTTP 200.

**Fix:** `mission/today` now returns all dashboard-compatible nested fields alongside its own payload. Both endpoints satisfy `DashboardSummary`.

### Fix 3 — `WorkoutHUD.tsx`: Wrong session field name (silent Pydantic drop)

```ts
// Broken — Pydantic ignores unknown fields silently, session created with no label
workoutApi.createSession({ title: 'Training Session' })

// Fixed — correct schema field name
workoutApi.createSession({ day_label: 'Training Session' })
```

### Fix 4 — `ProgressScreen.tsx`: Recovery tab had no input

The Recovery tab displayed "Log recovery scores from the Profile screen" — but Profile had no such feature. Users could never populate recovery data.

**Fix:** Added a LOG RECOVERY SCORE input (0–100) directly on the Recovery tab, calling `progressApi.logMetrics({ recovery_score })`.

### Fix 5 — `Logo.tsx`: Text too small, alignment broken

`AI` fontSize was 8px at `sm` — invisible. `fontWeight: 700`, aligned to `flex-end`.

**Fix:** Sizes corrected to `12/16/22/30` across all four sizes. `fontWeight: 800`. `alignSelf: center`. The full Logo component was subsequently rebuilt with the VYRN brand identity (V/Y/RN wordmark + SVG chevron badge).

### Fix 6 — Auth token key mismatch (auth header never sent)

`api.ts` was reading `fitai_token`, while `store/index.ts` was writing to `neurofit_token` (now `vyrn_token`). The Authorization header was never populated — every authenticated request returned 401.

**Fix:** Unified to a single key `vyrn_token` across `store/index.ts`, `api.ts`, and `app/(tabs)/_layout.tsx`.

### Fix 7 — FastAPI version pin (routes silently dropped)

Unpinned `fastapi` and `starlette` caused all registered routes to disappear after a dependency update.

**Fix:** `requirements.txt` pinned to `fastapi==0.115.6` and `starlette==0.41.3`.

---

## 14. Production Roadmap

| Item | Impact | Suggested approach |
|---|---|---|
| Rate limiting on `/api/coach/chat` | Prevents Groq API cost abuse | `slowapi` per-user limiter, 20 req/hour |
| ChromaDB persistence across Render deploys | User memories survive redeployment | Mount a Render disk, or migrate to Pinecone/Qdrant |
| JWT refresh token | Silent re-auth after 30-day expiry | Add `/api/auth/refresh` + axios interceptor |
| Coach Brain LLM call (still serial) | Dashboard cold start ~5–8s | Move to `asyncio.gather()` alongside other agents |
| Onboarding resume support | Users stuck if they close mid-flow | Add `onboarding_step` field, resume from last step |
| Adaptive program rewriter | Weekly plan auto-restructure based on performance | New `program_rewriter_agent.py` running every Monday |
| AI simulation ("What if?") | "What if I add 250 calories?" → predicted outcome | Extend DecisionCenter with scenario projection |
| Decision history log | Every recommendation saved with evidence trail | Extend `ai_timeline_events` with `evidence` JSON column |

### ChromaDB on Render (free tier)

Render's free tier has no persistent disk — `chroma_store/` is wiped on every deploy. Guardrails are auto-reseeded (no problem). User memories are lost. Options:

1. **Render disk (paid):** mount at `/chroma_store`, set `CHROMA_PERSIST_DIR=/chroma_store`
2. **Pinecone:** replace `LocalHashEmbeddingFunction` with Pinecone SDK; update `chroma_client.py` and `memory_client.py`
3. **Accept loss during free tier:** guardrails always recover; only personal memory is lost

---

## 15. Deployment

### Backend (Render)

1. Connect repo as a **Web Service**
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add all env vars from Section 7
5. Set `ALLOWED_ORIGINS` to include your frontend's deployed URL

### Frontend (EAS)

Set `EXPO_PUBLIC_API_URL` in `eas.json`:

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

Then:
```bash
eas build --platform android --profile production
eas submit --platform android   # optional: submit to Play Store
```

---

## 16. Security

| Concern | Implementation |
|---|---|
| Passwords | bcrypt via `passlib` |
| JWT | HS256, 30-day expiry, `SECRET_KEY` env var |
| Orphaned session | Valid JWT pointing at deleted user → explicit 401, not 500 |
| Service key | `SUPABASE_SERVICE_KEY` backend-only — never exposed to frontend |
| CORS | `ALLOWED_ORIGINS` allowlist — update before shipping |
| Row Level Security | Enabled on all tables — `auth.uid() = user_id` |
| ChromaDB | Local-only, no network exposure |
| Weight caps | LLM cannot prescribe weight above `PR × 1.05` |

---

## Quick Reference

### Add a new screen

1. Create `frontend/app/(tabs)/myscreen.tsx` — Expo Router auto-registers it
2. Add the tab to `_layout.tsx`
3. Create `frontend/src/components/myscreen/MyScreen.tsx` with UI
4. Add backend endpoints to `backend/api/routes/` and register in `main.py`

### Add a new agent

1. Create `backend/agents/my_agent.py` — return a dataclass result
2. Import and call it in `mission.py` inside `asyncio.gather()`
3. Add its output to the mission response JSON

### Add a new coach card type

1. Add `response_type` to the LLM prompt in `build_workout_node`
2. Add card component to `CoachScreen.tsx`
3. Add routing case in the message rendering switch

### Debug the coach pipeline

```bash
# Full LangGraph logs
uvicorn main:app --reload --log-level debug

# Test Groq directly
python backend/test_groq.py

# Inspect ChromaDB state
python3 -c "
import chromadb
c = chromadb.PersistentClient('./chroma_store')
print(c.list_collections())
g = c.get_collection('vyrn_guardrails')
m = c.get_collection('vyrn_user_memory')
print(g.count(), 'guardrail docs')
print(m.count(), 'memory facts')
"
```

---

<div align="center">

*VYRN — Adaptive Performance System*  
*Built June 2026*

**Train. Don't Think.**

</div>
