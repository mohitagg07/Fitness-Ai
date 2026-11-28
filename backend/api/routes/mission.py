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
from services.timezone import local_now
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


_TRAINING_WINDOWS = {
    "morning": {
        "period": "morning",
        "label": "Morning",
        "display_label": "6:00–10:00 AM",
    },
    "afternoon": {
        "period": "afternoon",
        "label": "Afternoon",
        "display_label": "12:00–4:00 PM",
    },
    "evening": {
        "period": "evening",
        "label": "Evening",
        "display_label": "5:00–9:00 PM",
    },
}


def _build_training_window(profile: dict) -> dict:
    """Translate a broad profile preference into a suggested local window.

    This is deliberately not represented as an exact appointment. Exact
    session times require an explicit time selection or reliable local-time
    training history, neither of which is stored in the current profile.
    """
    preference = str(profile.get("workout_time_preference") or "").strip().lower()
    window = _TRAINING_WINDOWS.get(preference)
    if not window:
        return {
            "period": None,
            "label": "No preferred time set",
            "display_label": None,
            "source": "unset",
            "is_exact": False,
            "note": "Choose a preferred training window in your profile.",
        }
    return {
        **window,
        "source": "profile_preference",
        "is_exact": False,
        "note": "Suggested window from your profile preference, not a booked gym appointment.",
    }


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
    if recovery_decision.action == "check_in":
        return "Recovery check-in needed — no readiness score is available yet"
    if recovery_decision.action == "rest":
        return "Full rest day — no training today"
    if recovery_decision.action == "replace_with_light":
        return "Replace heavy session with light walk or mobility"
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
    training_window = _build_training_window(profile)

    if recovery_decision.action == "check_in":
        return "Complete today's recovery check-in before deciding on training intensity"
    if recovery_decision.action == "rest":
        return "Keep today restful; prioritise sleep, hydration and light movement"
    if workout_decision.rescheduled:
        return "Review the missed-session adjustment with Coach; keep today's approved plan unchanged"
    if workout_decision.recommended_type and workout_decision.recommended_type.lower() != "rest":
        if training_window.get("display_label"):
            return f"Plan your session in your {training_window['label'].lower()} window ({training_window['display_label']})"
        return "Choose a training time that fits your schedule today"
    if protein_remaining > 20:
        return f"Prioritise {int(protein_remaining)}g more protein across today's meals"
    if water_remaining_ml > 500:
        return f"Drink {water_remaining_ml}ml water across the rest of today"
    return "Keep recovery on track tonight"


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

    if recovery_decision.action == "check_in":
        alerts.append("Recovery information is incomplete — keep the approved plan unchanged")
    elif recovery_decision.action in ("rest", "replace_with_light"):
        alerts.append(f"⚠️ Recovery low ({recovery_decision.recovery_score}/10) — modify or skip training")

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
    current_user: dict = Depends(get_current_user),
):
    """
    THE automation endpoint.  App calls this on open.
    Returns a fully-resolved decision card — no client logic required.
    """
    user_id = current_user["user_id"]
    local_datetime = local_now(timezone_name)
    target_day = local_datetime.date()
    profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)

    full_name = (profile.get("full_name") or "there").split()[0]
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain

    measured_weight_kg = profile.get("weight_kg")
    measured_height_cm = profile.get("height_cm")
    measured_age = profile.get("age")
    measured_gender = profile.get("gender")
    weight_kg = measured_weight_kg if measured_weight_kg is not None else 75
    height_cm = measured_height_cm if measured_height_cm is not None else 175
    age = measured_age if measured_age is not None else 28
    gender = measured_gender or "male"
    missing_measurements = [
        key for key, value in (
            ("weight_kg", measured_weight_kg), ("height_cm", measured_height_cm),
            ("age", measured_age), ("gender", measured_gender),
        ) if value is None
    ]
    nutrition_inputs_complete = not missing_measurements
    measurement_sources = {
        "weight_kg": "profile" if measured_weight_kg is not None else "estimated_default",
        "height_cm": "profile" if measured_height_cm is not None else "estimated_default",
        "age": "profile" if measured_age is not None else "estimated_default",
        "gender": "profile" if measured_gender is not None else "estimated_default",
    }
    food_pref = profile.get("food_preference") or "non-veg"
    coach_style = profile.get("coach_style") or "friendly"
    training_time = _build_training_window(profile)

    training_day = is_training_day_for_user(user_id, target_date=target_day)

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
            local_hour=local_datetime.hour,
            target_date=target_day,
        ),
        asyncio.to_thread(_today_consumed, user_id, target_day),
        asyncio.to_thread(
            run_workout_agent,
            user_id,
            preferred_time=profile.get("workout_time_preference"),
            target_date=target_day,
        ),
        asyncio.to_thread(run_progress_agent, user_id, goal),
    )

    targets = calculate_macros(weight_kg, height_cm, age, gender, goal, is_training_day=training_day)

    # ── Recovery depends on workout type ─────────────────────────────────────
    recovery_decision = await asyncio.to_thread(
        run_recovery_agent,
        user_id,
        sleep_hours=None,
        planned_workout_type=workout_decision.recommended_type,
        target_date=target_day,
        protein_target_g=targets["protein_g"] if nutrition_inputs_complete else None,
        calorie_target=targets["calories"] if nutrition_inputs_complete else None,
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
            training_window=training_time,
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
    if recovery_decision.action == "check_in":
        intensity = "Check-in"
    elif recovery_decision.action == "rest":
        intensity = "Rest"
    elif recovery_decision.action == "replace_with_light" or wtype in ("rest",):
        intensity = "Low"
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
        "training_time":  training_time,
        "alerts":        alerts,
        "greeting":      f"Ready to train, {full_name}?",
        "generated_at":  local_datetime.isoformat(),
        "user_id":       user_id,
        "measurement_sources": measurement_sources,
        "missing_measurements": missing_measurements,
        "nutrition_target_source": "profile" if nutrition_inputs_complete else "estimated_defaults",
        "nutrition_target_confidence": "personalized" if nutrition_inputs_complete else "estimated",

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
            "score": recovery_decision.recovery_score if recovery_pct is not None else None,
            "score_pct": recovery_pct,
            "action": recovery_decision.action,
            "message": recovery_decision.message,
            "data_completeness_pct": getattr(recovery_decision, "data_completeness_pct", 0),
            "available_signals": getattr(recovery_decision, "available_signals", []),
            "missing_signals": getattr(recovery_decision, "missing_signals", []),
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
        "recovery_score":       recovery_decision.recovery_score if recovery_pct is not None else None,
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