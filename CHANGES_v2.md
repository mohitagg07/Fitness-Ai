# VYRN v2 — What Changed

## New files

| File | What it does |
|------|-------------|
| `backend/agents/recovery_agent.py` | **Replaced** — Dynamic Recovery Engine (0-100 score from 5 signals) + CNS Load (Low/Medium/High/Very High) |
| `backend/agents/training_strategy_engine.py` | **New** — Autonomous Training Strategy Engine: picks Hypertrophy/Strength/Deload/Peak/Cut/Maintenance block from real signals, explains why, predicts outcome |
| `backend/agents/motivation_agent.py` | **Replaced** — Real-number motivation: best month ever, PR proximity, streak PB, protein streak, volume milestones, comeback message |
| `backend/services/notifications.py` | **Replaced** — Enhanced intelligent notifications: CNS Very High deload push, recovery_pct from dynamic engine, PR proximity in body, CTA deep-links, motivation notification |
| `backend/api/routes/strategy.py` | **New** — `GET /api/strategy/current`, `GET /api/strategy/history` |
| `backend/api/routes/admin.py` | **Replaced** — Added `/run-strategy`, `/strategy-history`, `/cns-load` endpoints |
| `MIGRATION_v2.sql` | **New** — Run this after CRITICAL_RUN_THIS_SQL_FIRST.sql |

## main.py changes
- Imports `strategy_router` and registers it at `/api/strategy`

## API surface added

```
POST /api/admin/run-jobs-now          — trigger all 5 nightly jobs
POST /api/admin/run-strategy          — run strategy engine for calling user
GET  /api/admin/strategy-history      — past strategy decisions
GET  /api/admin/cns-load              — CNS load breakdown + recovery sub-scores

GET  /api/strategy/current            — today's training block decision (cached)
GET  /api/strategy/history            — strategy decision log
```

## Recovery Engine — score breakdown

| Signal | Max pts | Formula |
|--------|---------|---------|
| Sleep  | 30 | ≥8h = 30, ≥7h = 25, ≥6h = 16, ≥5h = 8, <5h = 0 |
| Previous volume | 20 | Low volume = more recovered |
| Nutrition adherence | 20 | Protein + calorie ratios vs targets |
| Consecutive high-RPE | 15 | 0 days = 15, 3+ days = 0 |
| CNS fatigue score | 15 | 0/10 = 15pts, 10/10 = 0pts |
| **Total** | **100** | |

## CNS Load bands
- **Low** (0-24) — fresh, normal training
- **Medium** (25-49) — elevated, proceed with care
- **High** (50-74) — reduce volume ~20%
- **Very High** (75-100) — deload week triggered

## Training Block selection (deterministic, no LLM)

Priority order:
1. CNS Very High OR recovery <30% → **Deload**
2. Recovery decline + recovery <50% → **Deload**
3. Plateau detected + recovery ≥65% → **Strength** (plateau breaker)
4. Goal = cut → **Cut**
5. Streak ≥42 days + recovery ≥80% → **Peak**
6. Goal = bulk/recomp + recovery ≥50% → **Hypertrophy**
7. Goal = maintain + recovery ≥70% → **Hypertrophy / Strength** (alternating)
8. Default → **Maintenance**

The LLM writes ONE sentence explaining the decision AFTER it's already been made deterministically.

## DB migration required

Run `MIGRATION_v2.sql`:
- Creates `training_strategies` table with RLS
- Adds `cta` column to `notifications`
