"""
Dashboard route — assembles the "Today's Mission" agentic summary.
All endpoints wrapped in try/except with logger.exception for full tracebacks.
"""
import asyncio
import logging
from datetime import date
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context
from schemas.models import Goal
from services.nutrition import calculate_macros
from agents.nutrition_agent import run_nutrition_agent
from agents.workout_agent import run_workout_agent
from agents.progress_agent import run_progress_agent
from agents.recovery_agent import run_recovery_agent
from agents.motivation_agent import get_daily_motivation

logger = logging.getLogger(__name__)
router = APIRouter()


def _today_nutrition_consumed(user_id: str) -> dict:
    sb = get_supabase()
    today = str(date.today())
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
        "protein_g": sum(l.get("protein_g") or 0 for l in logs),
        "water_ml": sum(l.get("water_ml") or 0 for l in logs),
    }


@router.get("/summary")
async def get_dashboard_summary(
    current_user: dict = Depends(get_current_user),
    local_hour: int | None = None,
):
    try:
        user_id = current_user["user_id"]
        profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)

        full_name = profile.get("full_name") or "there"
        goal_str = profile.get("goal") or "maintain"
        goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain

        weight_kg = profile.get("weight_kg") or 75
        height_cm = profile.get("height_cm") or 175
        age = profile.get("age") or 28
        gender = profile.get("gender") or "male"
        food_pref = profile.get("food_preference") or "non-veg"
        coach_style = profile.get("coach_style") or "friendly"

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
                is_training_day=True,
                local_hour=local_hour,
            ),
            asyncio.to_thread(_today_nutrition_consumed, user_id),
            asyncio.to_thread(run_workout_agent, user_id, preferred_time=profile.get("workout_time_preference")),
            asyncio.to_thread(run_progress_agent, user_id, goal),
        )
        targets = calculate_macros(weight_kg, height_cm, age, gender, goal, is_training_day=True)

        recovery_decision = await asyncio.to_thread(
            run_recovery_agent,
            user_id,
            sleep_hours=profile.get("sleep_hours"),
            planned_workout_type=workout_decision.recommended_type,
        )

        motivation_message = await asyncio.to_thread(get_daily_motivation, user_id, coach_style)

        calories_remaining = max(0, targets["calories"] - int(consumed["calories"]))
        protein_remaining = max(0.0, targets["protein_g"] - consumed["protein_g"])
        water_remaining_ml = max(0, targets["water_ml"] - int(consumed["water_ml"]))

        if recovery_decision.action == "rest":
            next_task = recovery_decision.message
        elif workout_decision.rescheduled:
            next_task = workout_decision.message
        elif progress_decision.stalled:
            next_task = progress_decision.message
        elif protein_remaining > 5:
            next_task = nutrition_decision.message
        elif water_remaining_ml > 500:
            next_task = f"Drink {water_remaining_ml}ml water to hit today's hydration target."
        else:
            next_task = workout_decision.message

        return {
            "greeting": f"Ready to train, {full_name}?",
            "mission_text": next_task,
            "calories_remaining": calories_remaining,
            "protein_remaining_g": round(protein_remaining, 1),
            "water_remaining_ml": water_remaining_ml,
            "calories_target": targets["calories"],
            "protein_target_g": targets["protein_g"],
            "water_target_ml": targets["water_ml"],
            "calories_pct": round(100 * (1 - calories_remaining / max(1, targets["calories"]))),
            "protein_pct": round(100 * (1 - protein_remaining / max(1, targets["protein_g"]))),
            "water_pct": round(100 * (1 - water_remaining_ml / max(1, targets["water_ml"]))),
            "next_task": next_task,
            "workout_today": {
                "type": workout_decision.recommended_type,
                "rescheduled": workout_decision.rescheduled,
                "message": workout_decision.message,
            },
            "recovery": {
                "score": recovery_decision.recovery_score,
                "action": recovery_decision.action,
                "message": recovery_decision.message,
            },
            "progress": {
                "stalled": progress_decision.stalled,
                "calorie_adjustment": progress_decision.suggested_calorie_adjustment,
                "message": progress_decision.message,
            },
            "cns_fatigue": agent_state.get("cns_fatigue_score", 0),
            "workout_streak": agent_state.get("workout_streak", 0),
            "protein_streak": agent_state.get("protein_streak", 0),
            "motivation_message": motivation_message,
            "sleep_goal": profile.get("sleep_time"),
        }
    except Exception as e:
        logger.exception(f"get_dashboard_summary failed for {current_user.get('user_id')}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Dashboard couldn't load right now. Please try again."},
        )


@router.get("/decision")
async def get_decision_center(
    current_user: dict = Depends(get_current_user)
):
    """AI Decision Center — Today's Decision card."""
    try:
        from agents.decision_engine import build_decision_center
        user_id = current_user["user_id"]
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        decision = await asyncio.to_thread(build_decision_center, user_id, profile)
        return decision.model_dump()
    except Exception as e:
        logger.exception(f"get_decision_center failed: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Decision center couldn't load. Please try again."},
        )