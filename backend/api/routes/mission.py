"""
Mission Route — GET /api/mission/today

The Automation Layer.  Called once when the app opens.  Runs every agent
in parallel, then distils their output into a single "Today's Mission"
decision card — a small structured object the UI renders directly with
no further logic required.

Decision Card shape:
  {
    "mission":       "Push Day",
    "recovery":      82,              # 0-100%
    "protein_target": 180,            # grams
    "calories_target": 2800,
    "ai_decision":   "Bench Press 80kg × 5",
    "next_action":   "Train before 7 PM",
    "coach_insight": "You've hit protein 4 days straight. Keep it up.",
    "intensity":     "High",          # High | Moderate | Low | Rest
    "workout_type":  "Push",
    "nutrition_status": {
        "calories_remaining": 1100,
        "protein_remaining_g": 95.0,
        "water_remaining_ml": 1200,
        "calories_pct": 61,
        "protein_pct":  47,
    },
    "alerts": [],                     # proactive warnings, max 2
    "greeting": "Ready to train, Mohit?",
    "generated_at": "2026-06-22T10:30:00",
  }

The frontend ONLY reads this object.  No if/else on the client.
"""
import asyncio
from datetime import date, datetime
from fastapi import APIRouter, Depends, Query
from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context
from schemas.models import Goal
from services.nutrition import calculate_macros, is_training_day_for_user
from services.timezone import local_now, local_today
from agents.nutrition_agent import run_nutrition_agent
from agents.workout_agent import run_workout_agent
from agents.progress_agent import run_progress_agent
from agents.recovery_agent import run_recovery_agent
from agents.motivation_agent import get_daily_motivation
from agents.pattern_engine import run_pattern_engine
from agents.coach_brain import generate_proactive_brief
from agents.consistency_agent import run_consistency_agent
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Mission"])


def _today_consumed(user_id: str, target_date: date | None = None) -> dict:
    sb = get_supabase()
    today = str(target_date or date.today())
    res = (
        sb.table("nutrition_logs")
        .select("calories, protein_g, water_ml")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    logs = res.data or []
    return {
        "calories": sum(l.get("calories") or 0 for l in logs),
        "protein_g": round(sum(l.get("protein_g") or 0 for l in logs), 1),
        "water_ml": sum(l.get("water_ml") or 0 for l in logs),
    }


def _pick_ai_decision(workout_decision, recovery_decision, nutrition_decision) -> str:
    """
    Single most important AI decision for the card — gym exercise, nutrition
    action, or rest directive. Priority: recovery override > workout > nutrition.
    """
    if recovery_decision.action == "rest":
        return "Full rest day — no training today"
    if recovery_decision.action == "replace_with_light":
        return "Replace heavy session with light walk or mobility"
    if recovery_decision.action == "check_in":
        return "Log recovery check-in; keep today's planned session comfortable"
    if workout_decision.recommended_type and workout_decision.recommended_type.lower() != "rest":
        wtype = workout_decision.recommended_type.replace("_", " ").title()
        return f"{wtype} session as planned"
    if nutrition_decision.suggested_meal:
        return f"Eat {nutrition_decision.suggested_meal} now"
    return nutrition_decision.message


def _pick_next_action(
    workout_decision,
    recovery_decision,
    nutrition_decision,
    profile: dict,
    protein_remaining: float,
    water_remaining_ml: int,
) -> str:
    """
    One concrete next step the user should do right now.
    """
    preferred_time = profile.get("workout_time_preference") or "today"

    if recovery_decision.action == "rest":
        return "Rest today and prioritise sleep"
    if recovery_decision.action == "check_in":
        return "Log last night's sleep and training effort; keep today's planned session comfortable"
    if workout_decision.rescheduled:
        return f"Complete missed session before {preferred_time}"
    if workout_decision.recommended_type and workout_decision.recommended_type.lower() != "rest":
        return f"Train before {preferred_time}"
    if protein_remaining > 20:
        return f"Hit {int(protein_remaining)}g more protein today"
    if water_remaining_ml > 500:
        return f"Drink {water_remaining_ml}ml water"
    return "Rest and recover well tonight"


def _build_alerts(
    recovery_decision,
    progress_decision,
    protein_remaining: float,
    targets: dict,
) -> list[str]:
    """
    At most 2 proactive alerts — things that need user attention today.
    """
    alerts: list[str] = []

    if recovery_decision.action in ("rest", "replace_with_light"):
        alerts.append(f"⚠️ Recovery low ({recovery_decision.recovery_score}/10) — modify or skip training")
    elif recovery_decision.action == "check_in":
        alerts.append("Recovery score unavailable — log sleep and training effort to build a reliable baseline")

    if progress_decision.stalled:
        adj = progress_decision.suggested_calorie_adjustment
        direction = "Reduce" if adj < 0 else "Add"
        alerts.append(f"📉 Progress stalled — {direction} {abs(adj)} kcal to restart")

    if protein_remaining > targets["protein_g"] * 0.5 and not alerts:
        alerts.append(f"🥩 Only {int(targets['protein_g'] - protein_remaining)}g protein logged — halfway through the day")

    return alerts[:2]


@router.get("/today")
async def get_today_mission(
    timezone_name: str = Query(default="UTC", min_length=1, max_length=64),
    current_user: dict = Depends(get_current_user)
):
    """
    THE automation endpoint.  App calls this on open.
    Returns a fully-resolved decision card — no client logic required.
    """
    user_id = current_user["user_id"]
    local_day = local_today(timezone_name)
    local_hour = local_now(timezone_name).hour
    profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)

    full_name = (profile.get("full_name") or "there").split()[0]
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain

    weight_kg = profile.get("weight_kg")
    height_cm = profile.get("height_cm")
    age = profile.get("age")
    gender = profile.get("gender")
    food_pref = profile.get("food_preference") or "non-veg"
    coach_style = profile.get("coach_style") or "friendly"

    missing_profile_fields = [
        field for field, value in {
            "weight_kg": weight_kg,
            "height_cm": height_cm,
            "age": age,
            "gender": gender,
        }.items()
        if value in (None, "", 0)
    ]
    if missing_profile_fields:
        workout_decision, recovery_decision, motivation = await asyncio.gather(
            asyncio.to_thread(
                run_workout_agent,
                user_id,
                preferred_time=profile.get("workout_time_preference"),
                target_date=local_day,
            ),
            asyncio.to_thread(
                run_recovery_agent,
                user_id,
                sleep_hours=profile.get("sleep_hours"),
                planned_workout_type=None,
                protein_target_g=None,
                calorie_target=None,
                target_date=local_day,
            ),
            asyncio.to_thread(get_daily_motivation, user_id, coach_style),
        )
        recovery_pct = getattr(recovery_decision, "score_pct", None)
        if recovery_decision.action in ("rest", "replace_with_light", "deload"):
            next_action = recovery_decision.message
        else:
            next_action = "Complete your missing profile measurements to personalise nutrition targets and training guidance."
        workout_type = workout_decision.recommended_type
        mission_label = (
            "Rest Day" if workout_type == "rest"
            else workout_type.replace("_", " ").title() + " Day"
            if workout_type else "Training Setup"
        )
        return {
            "mission": mission_label,
            "ai_decision": recovery_decision.message if recovery_decision.action in ("rest", "replace_with_light", "deload") else workout_decision.message,
            "next_action": next_action,
            "coach_insight": motivation,
            "intensity": "Rest" if recovery_decision.action in ("rest", "deload") else "Moderate",
            "workout_type": workout_type,
            "alerts": ["Add your confirmed body measurements in Profile before VYRN calculates personal nutrition targets."],
            "greeting": f"Ready to train, {full_name}?",
            "generated_at": local_now(timezone_name).isoformat(),
            "user_id": user_id,
            "mission_text": next_action,
            "next_task": next_action,
            "calories_remaining": None,
            "protein_remaining_g": None,
            "water_remaining_ml": None,
            "calories_target": None,
            "protein_target_g": None,
            "water_target_ml": None,
            "calories_pct": None,
            "protein_pct": None,
            "water_pct": None,
            "workout_today": {
                "type": workout_type,
                "rescheduled": workout_decision.rescheduled,
                "message": workout_decision.message,
            },
            "recovery": {
                "score": None if recovery_decision.action == "check_in" else recovery_decision.recovery_score,
                "score_pct": recovery_pct,
                "confidence_pct": getattr(recovery_decision, "confidence_pct", 0),
                "action": recovery_decision.action,
                "message": recovery_decision.message,
            },
            "progress": {"stalled": False, "calorie_adjustment": None, "message": None},
            "cns_fatigue": agent_state.get("cns_fatigue_score", 0),
            "workout_streak": agent_state.get("workout_streak", 0),
            "protein_streak": agent_state.get("protein_streak", 0),
            "motivation_message": motivation,
            "profile_data_needed": missing_profile_fields,
            "nutrition_status": {
                "calories_remaining": None,
                "protein_remaining_g": None,
                "water_remaining_ml": None,
                "calories_pct": None,
                "protein_pct": None,
                "water_pct": None,
            },
            "pattern_insights": [],
            "proactive_brief": None,
            "consistency": {
                "status": "unavailable",
                "score": None,
                "headline": "Complete your profile to personalise your baseline",
                "mood": None,
                "pillars": [],
            },
            "recovery_pct": recovery_pct,
            "protein_target": None,
            "workout_rescheduled": workout_decision.rescheduled,
            "workout_message": workout_decision.message,
            "recovery_score": recovery_decision.recovery_score,
            "recovery_action": recovery_decision.action,
            "progress_stalled": False,
        }

    training_day = is_training_day_for_user(user_id, target_date=local_day)

    # ── Run independent agents concurrently ──────────────────────────────────
    (
        nutrition_decision,
        consumed,
        workout_decision,
        progress_decision,
    ) = await asyncio.gather(
        asyncio.to_thread(
            run_nutrition_agent,
            user_id=user_id,
            weight_kg=weight_kg,
            height_cm=height_cm,
            age=age,
            gender=gender,
            goal=goal,
            food_preference=food_pref,
            is_training_day=training_day,
            target_date=local_day,
            local_hour=local_hour,
        ),
        asyncio.to_thread(_today_consumed, user_id, local_day),
        asyncio.to_thread(run_workout_agent, user_id, preferred_time=profile.get("workout_time_preference"), target_date=local_day),
        asyncio.to_thread(run_progress_agent, user_id, goal),
    )

    targets = calculate_macros(weight_kg, height_cm, age, gender, goal, is_training_day=training_day)

    # ── Recovery depends on workout type ─────────────────────────────────────
    recovery_decision = await asyncio.to_thread(
        run_recovery_agent,
        user_id,
        sleep_hours=profile.get("sleep_hours"),
        planned_workout_type=workout_decision.recommended_type,
        protein_target_g=targets.get("protein_g"),
        calorie_target=targets.get("calories"),
        target_date=local_day,
    )

    # ── Pattern Detection Engine + Proactive AI Brain ────────────────────────
    (
        patterns,
        motivation,
        proactive_brief,
        consistency,
    ) = await asyncio.gather(
        asyncio.to_thread(
            run_pattern_engine,
            user_id,
            targets.get("protein_g", 160.0),
        ),
        asyncio.to_thread(get_daily_motivation, user_id, coach_style),
        asyncio.to_thread(
            generate_proactive_brief,
            user_id=user_id,
            profile=profile,
            workout_decision=workout_decision,
            recovery_decision=recovery_decision,
            nutrition_decision=nutrition_decision,
            progress_decision=progress_decision,
            consumed=consumed,
            targets=targets,
        ),
        asyncio.to_thread(run_consistency_agent, user_id, targets.get("protein_g", 160.0)),
    )

    # ── Compute remaining macros ──────────────────────────────────────────────
    calories_remaining = max(0, targets["calories"] - int(consumed["calories"]))
    protein_remaining  = round(max(0.0, targets["protein_g"] - consumed["protein_g"]), 1)
    water_remaining    = max(0, targets["water_ml"] - int(consumed["water_ml"]))

    # One canonical recovery score for the mission card, Coach and analytics.
    # CNS fatigue is only one input to the recovery agent, not a substitute
    # for its full sleep / training-load / nutrition / RPE calculation.
    cns_fatigue = agent_state.get("cns_fatigue_score", 0)
    recovery_pct = getattr(
        recovery_decision,
        "score_pct",
        recovery_decision.recovery_score * 10,
    )

    # ── Determine intensity label ─────────────────────────────────────────────
    wtype = (workout_decision.recommended_type or "rest").lower()
    if recovery_decision.action in ("rest", "deload"):
        intensity = "Rest"
    elif recovery_decision.action in ("replace_with_light", "check_in") or wtype in ("rest",):
        intensity = "Low" if recovery_decision.action == "replace_with_light" else "Moderate"
    elif wtype in ("push", "pull", "legs"):
        intensity = "High"
    else:
        intensity = "Moderate"

    # ── Assemble the card ─────────────────────────────────────────────────────
    mission_label = (
        "Rest Day" if wtype == "rest"
        else workout_decision.recommended_type.replace("_", " ").title() + " Day"
        if workout_decision.recommended_type else "Focus Day"
    )

    ai_decision = _pick_ai_decision(workout_decision, recovery_decision, nutrition_decision)
    next_action  = _pick_next_action(
        workout_decision, recovery_decision, nutrition_decision,
        profile, protein_remaining, water_remaining
    )
    alerts = _build_alerts(recovery_decision, progress_decision, protein_remaining, targets)

    calories_pct = round(100 * (1 - calories_remaining / max(1, targets["calories"])))
    protein_pct  = round(100 * (1 - protein_remaining  / max(1, targets["protein_g"])))
    water_pct    = round(100 * (1 - water_remaining    / max(1, targets["water_ml"])))

    return {
        # ── Core mission card ─────────────────────────────────────────────────
        "mission":       mission_label,
        "ai_decision":   ai_decision,
        "next_action":   next_action,
        "coach_insight": motivation,
        "intensity":     intensity,
        "workout_type":  workout_decision.recommended_type,
        "alerts":        alerts,
        "greeting":      f"Ready to train, {full_name}?",
        "generated_at":  datetime.utcnow().isoformat(),
        "user_id":       user_id,

        # ── Dashboard-compatible fields (DashboardSummary type expects these) ─
        # DashboardScreen tries mission/today first; it must return the same
        # field names that dashboard/summary returns, or recovery rings / macros
        # show 0 / undefined silently.
        "mission_text":        next_action,
        "next_task":           next_action,
        "calories_remaining":  calories_remaining,
        "protein_remaining_g": round(protein_remaining, 1),
        "water_remaining_ml":  water_remaining,
        "calories_target":     targets["calories"],
        "protein_target_g":    targets["protein_g"],
        "water_target_ml":     targets["water_ml"],
        "calories_pct":        calories_pct,
        "protein_pct":         protein_pct,
        "water_pct":           water_pct,
        "workout_today": {
            "type":        workout_decision.recommended_type,
            "rescheduled": workout_decision.rescheduled,
            "message":     workout_decision.message,
        },
        # Nested recovery object — DashboardScreen reads .score / .action / .message
        "recovery": {
            "score":     None if recovery_decision.action == "check_in" else recovery_decision.recovery_score,
            "score_pct": recovery_pct,
            "confidence_pct": getattr(recovery_decision, "confidence_pct", 0),
            "action":    recovery_decision.action,
            "message":   recovery_decision.message,
        },
        "progress": {
            "stalled":            progress_decision.stalled,
            "calorie_adjustment": progress_decision.suggested_calorie_adjustment,
            "message":            progress_decision.message,
        },
        "cns_fatigue":     cns_fatigue,
        "workout_streak":  agent_state.get("workout_streak", 0),
        "protein_streak":  agent_state.get("protein_streak", 0),
        "motivation_message": motivation,
        "sleep_goal":      profile.get("sleep_time"),

        # ── Legacy flat fields (keep for any code that still reads them) ──────
        "recovery_pct":         recovery_pct,
        "protein_target":       targets["protein_g"],
        "workout_rescheduled":  workout_decision.rescheduled,
        "workout_message":      workout_decision.message,
        "recovery_score":       None if recovery_decision.action == "check_in" else recovery_decision.recovery_score,
        "recovery_action":      recovery_decision.action,
        "progress_stalled":     progress_decision.stalled,

        # ── Nutrition status block ────────────────────────────────────────────
        "nutrition_status": {
            "calories_remaining":  calories_remaining,
            "protein_remaining_g": round(protein_remaining, 1),
            "water_remaining_ml":  water_remaining,
            "calories_pct":        calories_pct,
            "protein_pct":         protein_pct,
            "water_pct":           water_pct,
        },

        # ── Pattern Detection Engine ──────────────────────────────────────────
        "pattern_insights": [
            {
                "category":       p.category,
                "severity":       p.severity,
                "title":          p.title,
                "detail":         p.detail,
                "recommendation": p.recommendation,
                "confidence":     p.confidence,
            }
            for p in (patterns or [])[:4]
        ],

        # ── Proactive AI Brain ────────────────────────────────────────────────
        "proactive_brief": proactive_brief,

        # ── Consistency Score ─────────────────────────────────────────────────
        # One number + one sentence instead of another chart to interpret.
        # See agents/consistency_agent.py for the "why" behind this design.
        "consistency": {
            "status":   consistency.status,       # "new" | "scored"
            "score":    consistency.score,        # 0-100
            "headline": consistency.headline,
            "mood":     consistency.mood_summary, # "great" | "good" | "okay" | "bad" | None
            "pillars": [
                {
                    "label":  p.label,
                    "pct":    p.pct,
                    "status": p.status,
                    "detail": p.detail,
                }
                for p in consistency.pillars
            ],
        },
    }