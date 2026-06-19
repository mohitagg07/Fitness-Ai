# NeuroFit AI — Your AI Fitness Coach

> **An autonomous AI coach, not a chatbot. Remembers everything. Adapts every session.**

---

## What this is

NeuroFit AI is an AI companion that stays with you through your entire fitness journey:

**User → AI remembers everything → AI decides workout → AI adapts workout → AI adjusts nutrition → AI tracks recovery → AI motivates → AI remembers forever.**

It tracks your PRs, monitors CNS fatigue, adjusts workouts based on RPE feedback, guards against injury using a RAG safety layer, and removes decision fatigue entirely.

**The one sentence that guides everything:**
*"The user should open the app and know exactly what to do next without having to think."*

---

## Brand & Theme

| Token | Value | Usage |
|---|---|---|
| `primaryGreen` | `#7ED957` | Primary actions, active states, success |
| `primaryBlue` | `#4A9EFF` | Secondary accent, info, AI badges |
| `background` | `#0A0A0A` | App background |
| `card` | `#121212` | Card surfaces |

All colors are centralized in `frontend/src/theme/colors.ts`. No hardcoded hex values should appear anywhere else in the codebase — import `COLORS` instead.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo Router) |
| Backend | FastAPI (async) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Vector DB | ChromaDB (biomechanical guardrails + long-term memory) |
| AI Agent | LangGraph state machine |
| LLM | Groq (Llama) |
| State | Zustand |
| Auth | JWT + Supabase Auth |

---

## Project Structure

```
NeuroFit-AI/
├── frontend/
│   ├── app/                          Expo Router routes
│   │   ├── (tabs)/                   Bottom tab group (Home, Coach, Workout, Progress, Profile)
│   │   ├── login.tsx
│   │   └── onboarding.tsx
│   └── src/
│       ├── components/               Screen-level components
│       ├── theme/colors.ts           ★ Single source of truth for all colors
│       ├── store/                    Zustand global state
│       └── utils/                    API client, storage
└── backend/
    ├── main.py                       FastAPI entrypoint
    ├── api/routes/                   auth, profile, workouts, progress, coach, nutrition, dashboard
    ├── agents/                       LangGraph agents (coach, nutrition, workout, progress, recovery, motivation)
    ├── db/                           supabase_client, chroma_client, memory_client
    └── core/                         config, security
```

---

## Recent Fixes (Runtime Audit — 2026-06-18)

A full runtime audit found and fixed 4 real bugs plus 2 risk items. None required architectural changes.

| # | Issue | File | Fix |
|---|---|---|---|
| **BUG 1** | ChromaDB's ONNX model download blocked app startup indefinitely on cold deploys | `backend/main.py` | Wrapped `seed_guardrails()` in `asyncio.to_thread()` with a 30s timeout; app now boots even if the embedding model download is slow or fails |
| **BUG 2** | `recall()` crashed for any new user's first chat (ChromaDB ≥1.5 raises when `n_results` exceeds matching document count) | `backend/db/memory_client.py` | Added an existence probe before querying, capped `n_results` to the actual match count, added explicit logging instead of silent swallowing |
| **BUG 3** | `/api/dashboard/summary` made 6-8 sequential **blocking** Supabase calls inside an `async def` route, freezing the event loop for every concurrent request | `backend/api/routes/dashboard.py` | Wrapped every sync agent/DB call in `asyncio.to_thread()`; independent agent calls now run concurrently via `asyncio.gather()` |
| **BUG 4** | `updated_at` column stored the literal string `"now()"` instead of a real timestamp | `backend/db/supabase_client.py` | Replaced with `datetime.now(timezone.utc).isoformat()` |
| **RISK 1** | Unpinned `langgraph`, `langchain-core`, `chromadb`, `supabase` versions in `requirements.txt` | `backend/requirements.txt` | Added lower-bound version pins; documented `pip freeze > requirements-lock.txt` as the recommended CI strategy |
| **RISK 2** | User chat message was saved to DB *before* the LLM call, so a failed LLM call left an orphaned user turn with no assistant reply in persisted history | `backend/api/routes/coach.py` | Moved message persistence to after `run_coach()` succeeds; user + assistant messages now save together |

---

## UI Overhaul

- All gold (`#FFD700`) and yellow/amber references removed app-wide and replaced with the official **green (`#7ED957`) / blue (`#4A9EFF`)** brand palette.
- Every screen (Login, Register, Dashboard, Coach, Workout, Progress, Profile, Tab Bar) now imports from `src/theme/colors.ts` rather than hardcoding hex values.
- Dashboard redesigned with a stats row, gradient AI-coach banner, and horizontally scrollable quick-actions — patterns adapted from a Flutter reference app's clean card-based layout.
- Splash screen branding (which already used the correct palette) is now matched consistently across the entire app.

---

## Local Development

### Backend

```bash
cd backend
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload
```

Environment variables required (`.env`):
```
SUPABASE_URL=
SUPABASE_KEY=
GROQ_API_KEY=
JWT_SECRET=
```

### Frontend

```bash
cd frontend
npm install
npx expo start
```

---

## Database Setup

Run `CRITICAL_RUN_THIS_SQL_FIRST.sql` (or your project's schema file) in the Supabase SQL editor before first run. This creates the required tables: `profiles`, `agent_states`, `workout_sessions`, `progress_metrics`, `ai_conversations`, `nutrition_logs`.

---

## License

Private project — all rights reserved.
