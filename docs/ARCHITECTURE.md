# FitAI Architecture

## System Flow

```
User (Mobile App)
      │
      │  "I deadlifted 150kg x 3 with straps, RPE 9"
      │  "Give me today's chest workout"
      │  "My shoulder is clicking"
      ▼
┌─────────────────────────────────────────────────────────┐
│                  FastAPI Backend                          │
│                                                         │
│  POST /api/coach/chat                                   │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │            LangGraph Coach Agent                 │   │
│  │                                                  │   │
│  │  Node 1: parse_input                             │   │
│  │    └─ LLM parses natural language → PerformanceLog│  │
│  │    └─ Emergency keyword check (sharp pain, pop)  │   │
│  │                    │                             │   │
│  │  Node 2: evaluate_fatigue                        │   │
│  │    └─ Updates CNS fatigue score (0-10)           │   │
│  │    └─ Tracks accumulated spinal compression      │   │
│  │                    │                             │   │
│  │  Node 3: retrieve_guardrails                     │   │
│  │    └─ Queries ChromaDB with user message         │   │
│  │    └─ Filters by user's injury profile tags      │   │
│  │    └─ Injects relevant safety rules into prompt  │   │
│  │                    │                             │   │
│  │  Node 4: build_workout                           │   │
│  │    └─ LLM generates personalized workout         │   │
│  │    └─ Weight cap enforced (max 105% of PR)       │   │
│  │    └─ Injury-safe alternatives applied           │   │
│  └──────────────────────────────────────────────────┘   │
│       │                                                 │
│       ▼                                                 │
│  PR Validator (anti-hallucination)                      │
│  Agent State Updater → Supabase                         │
│  Conversation Logger → Supabase                         │
└─────────────────────────────────────────────────────────┘
      │
      ├─── Supabase (PostgreSQL)
      │      ├── profiles (user data, goals, equipment)
      │      ├── injury_profiles (body parts, severity, restrictions)
      │      ├── workout_sessions (history, completion, CNS pre/post)
      │      ├── exercise_logs (sets, reps, weight, RPE)
      │      ├── personal_records (PRs — used for weight caps)
      │      ├── progress_metrics (body composition, measurements)
      │      ├── nutrition_logs (macros, water)
      │      ├── ai_conversations (full chat history)
      │      └── agent_states (persisted fatigue, phase, last session)
      │
      └─── ChromaDB (Vector DB)
             ├── shoulder_overhead_barbell
             ├── shoulder_bench_hyperextension
             ├── spinal_deadlift_compression
             ├── spinal_squat_compression
             ├── lower_back_free_rows
             ├── knee_pain_squat
             ├── wrist_pain_pressing
             ├── cns_fatigue_high
             ├── acute_pain_emergency
             ├── post_workout_nutrition
             └── deload_protocol

## Key Engineering Decisions

### Why LangGraph over a simple LLM call?
Standard API calls are stateless. LangGraph maintains a state machine across
nodes, allowing fatigue from Monday to influence Tuesday's workout generation.

### Why ChromaDB for guardrails?
Prevents LLM hallucination on safety rules. The LLM cannot "forget" a user's
shoulder injury — it's retrieved and injected into every prompt.

### Why Supabase over MongoDB?
Fitness data is inherently relational (User → Sessions → Sets → PRs).
SQL makes queries like "show strength trend for deadlift over 60 days" trivial.
Supabase adds auth, realtime, and RLS out of the box.

### Anti-hallucination weight cap
After LLM generates a response, the PR Validator checks every suggested
weight. If it exceeds 105% of the user's verified PR, it is overridden.
LLMs are not allowed to suggest dangerous load jumps.

### Emergency bypass
If the user message contains "sharp pain", "pop", "snap", or "tore",
the LangGraph router bypasses ALL LLM generation and returns a hardcoded
R.I.C.E protocol screen immediately. No LLM involvement on injury reports.
```
