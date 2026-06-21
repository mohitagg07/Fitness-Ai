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

## Design System — Modeled on WHOOP

The entire UI is now built to WHOOP's official Brand & Design Guidelines, not a generic dark-mode guess. Every color below is WHOOP's documented hex value, centralized in one file.

| Token | Hex | Meaning |
|---|---|---|
| `background` | `#000000` | Pitch-black canvas — WHOOP's signature "Cod Gray" |
| `recoveryHigh` | `#16EC06` | High Recovery, 67–100% |
| `recoveryMed` | `#FFDE00` | Medium Recovery, 34–66% |
| `recoveryLow` | `#FF0026` | Low Recovery, 0–33% |
| `strain` | `#0093E7` | Strain / activity data |
| `sleep` | `#7BA1BB` | Sleep-related data |
| `recoveryBlue` | `#67AEE6` | Recovery data shown without a value judgement |

**Typography:** WHOOP specifies Proxima Nova for words and DIN Pro for numbers (both licensed). We use the closest free system-font equivalents with the same treatment: ALL-CAPS, bold, ~10% letter-spacing for headlines; tabular-figure numerals for scores so digits align in stacked stat lists (e.g. PR tables).

**The Recovery Ring:** WHOOP's core visual primitive — a circular progress ring whose color and label shift across the three Recovery bands above. `src/components/shared/RecoveryRing.tsx` implements this with a soft colored glow (no hard borders) and an animated fill on mount, exactly matching the reference screenshots reviewed during this redesign.

All colors live in **`frontend/src/theme/colors.ts`** — no screen should ever hardcode a hex value for a brand/semantic color. Import `COLORS` (and `recoveryColor(score)` / `recoveryLabel(score)` for the three-zone Recovery logic) instead.

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
│   │   ├── register.tsx
│   │   └── onboarding.tsx
│   └── src/
│       ├── components/
│       │   └── shared/RecoveryRing.tsx   ★ WHOOP-style animated score ring
│       ├── theme/
│       │   ├── colors.ts                 ★ Single source of truth for all colors
│       │   └── typography.ts              Headline/numeral type specs
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

## Staying Logged In

If the app keeps sending you back to the login screen, it's almost always one of these two things — not a bug in the auth flow itself, which already persists your token securely (`SecureStore` on device, `localStorage` on web) and attaches it to every request automatically:

1. **`backend/.env` is missing `SECRET_KEY`.** Without it, the backend falls back to an insecure default and **logs a warning on startup**. Worse: the moment you *do* set a real `SECRET_KEY` (or it changes for any reason), every previously-issued token is invalidated at once — forcing every signed-in user to log in again. Set it once, keep it stable:
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   # paste the output into backend/.env as SECRET_KEY=...
   ```
2. **Token lifetime.** Sessions now last **30 days** (`access_token_expire_minutes` in `core/config.py`), up from the previous 7 — you should rarely see a natural expiry during normal use.

If you ever see the specific error `ORPHANED_SESSION`, that means your device has an old token pointing at a Supabase user that no longer exists (most often after resetting the Supabase project). The fix is a one-time logout/login — the backend detects this case explicitly rather than letting it crash into a confusing 500 error.

---

## Recent Fixes

### Startup Crash — ChromaDB Import Error
**Symptom:** `ImportError: cannot import name 'InvalidArgumentError' from 'chromadb.errors'` on `uvicorn main:app --reload`.
**Cause:** newer `chromadb` releases relocated/renamed this exception class depending on install method/version.
**Fix:** `backend/db/chroma_client.py` now tries the documented import path, falls back to an older internal location, and finally falls back to plain `ValueError` (which is what `chromadb` raised before this exception existed) — so the app never fails to *import* over this regardless of which chromadb version is installed.

### Runtime Audit — 2026-06-18

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

## Local Development

### Backend

```bash
cd backend
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload --host 0.0.0.0
```

Environment variables required (`backend/.env`, copy from `.env.example`):
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GROQ_API_KEY=
SECRET_KEY=          # generate with: python3 -c "import secrets; print(secrets.token_hex(32))"
```

### Frontend

```bash
cd frontend
npm install
npx expo start
```

If testing on a physical device or Android Emulator, set `EXPO_PUBLIC_API_URL` in `frontend/.env` to your machine's LAN IP (not `localhost` — see the console warning if this is missing).

---

## Database Setup

Run `CRITICAL_RUN_THIS_SQL_FIRST.sql` in the Supabase SQL editor before first run. This creates the required tables: `profiles`, `agent_states`, `workout_sessions`, `progress_metrics`, `ai_conversations`, `nutrition_logs`, `exercise_logs`, `personal_records`, `injury_profiles`, `workout_plans`.

---

## Security Notes

- Passwords hashed with `bcrypt` via `passlib`.
- JWTs signed with `HS256`; **always** set a real `SECRET_KEY` in production — see "Staying Logged In" above.
- The backend auto-detects and rejects `ORPHANED_SESSION` tokens (valid signature, but pointing at a deleted/non-existent user) rather than crashing into an unrelated 500 error.
- CORS origins are explicitly allow-listed via `ALLOWED_ORIGINS` — update this for your deployed frontend domain before shipping.
- Service-role Supabase key (`SUPABASE_SERVICE_KEY`) is backend-only and bypasses Row Level Security — never expose it to the frontend; the frontend only ever talks to your FastAPI backend, never directly to Supabase.

---

## License

Private project — all rights reserved.
