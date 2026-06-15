# FitAI — AI Gym Spotter

> **An active AI spotter, not a chatbot. Lives before → during → after your workout.**

---

## What this is

FitAI is an AI companion that stays with you through your entire fitness journey. It remembers your PRs, tracks CNS fatigue, adjusts workouts based on RPE feedback, guards against injury using a RAG safety layer, and eliminates decision fatigue.

**The one sentence that guides everything:**  
*"The user should open the app and know exactly what to do next without having to think."*

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo) |
| Backend | FastAPI (async) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Vector DB | ChromaDB (biomechanical guardrails) |
| AI Agent | LangGraph state machine |
| LLM | GPT-4o / Gemini (configurable) |
| State | Zustand |
| Auth | JWT + Supabase Auth |

---

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Fill in your keys in .env

python scripts/seed_chromadb.py   # Seed safety rules (run once)
uvicorn main:app --reload
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npx expo start
```

---

## Architecture

```
User
 │
 ▼
FastAPI  POST /api/coach/chat
 │
 ▼
LangGraph Coach Agent
 ├── Node 1: parse_input      → NL → structured PerformanceLog
 ├── Node 2: evaluate_fatigue → CNS fatigue score update
 ├── Node 3: retrieve_guardrails → ChromaDB RAG safety rules
 └── Node 4: build_workout    → personalized plan (weight-capped)
 │
 ├── PR Validator (anti-hallucination: max 105% of PR)
 ├── Agent State → Supabase (persisted between sessions)
 └── Conversation History → Supabase
```

### Why LangGraph?
Standard LLM calls are stateless. LangGraph persists a state machine across nodes — fatigue from Monday influences Tuesday's plan.

### Why ChromaDB?
Prevents safety hallucination. The LLM cannot "forget" a shoulder injury — it's retrieved and injected into every prompt via RAG.

### Anti-hallucination weight cap
After generation, the PR Validator caps every suggested weight at 105% of the user's verified PR. Dangerous load jumps are impossible.

### Emergency bypass
Keywords like "sharp pain", "pop", "snap", or "tore" bypass ALL LLM generation and immediately return a hardcoded R.I.C.E protocol screen.

---

## Database Tables

- `profiles` — user data, goals, equipment
- `injury_profiles` — body parts, severity, doctor restrictions
- `workout_sessions` — history, completion, CNS pre/post
- `exercise_logs` — sets, reps, weight, RPE per set
- `personal_records` — PR history (used for weight caps)
- `progress_metrics` — body composition, measurements
- `nutrition_logs` — macros, water intake
- `ai_conversations` — full chat history
- `agent_states` — persisted fatigue, phase, last session

---

## Development Phases

| Phase | Focus |
|---|---|
| 1 | Auth, Supabase, FastAPI scaffold |
| 2 | User Profile, Workout Agent, Diet Agent |
| 3 | Memory, ChromaDB, LangGraph state machine |
| 4 | Gym Mode, RPE Tracking, Adaptive Planning |
| 5 | Progress Tracking, Exercise Library, Form Check |

---

## Environment Variables

See `backend/.env.example` for all required variables.