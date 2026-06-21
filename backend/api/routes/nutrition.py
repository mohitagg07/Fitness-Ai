"""
Nutrition route.
main.py mounts this at prefix="/api/nutrition".

FIX: protein_streak was defined in agent_state and displayed on the dashboard
but NEVER updated anywhere. Added _update_protein_streak() called on every
successful nutrition log so the streak counter actually works.
"""
import asyncio
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import NutritionCreate, Goal
from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context, upsert_agent_state
from services.nutrition import calculate_macros
from agents.nutrition_agent import run_nutrition_agent
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Nutrition"])


@router.get("/targets")
async def get_nutrition_targets(
    is_training_day: bool = True,
    current_user: dict = Depends(get_current_user)
):
    profile, _ = get_full_user_context(current_user["user_id"])
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    return calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=is_training_day,
    )


@router.get("/decision")
async def get_nutrition_decision(
    is_training_day: bool = True,
    current_user: dict = Depends(get_current_user)
):
    profile, _ = get_full_user_context(current_user["user_id"])
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    return run_nutrition_agent(
        user_id=current_user["user_id"],
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        food_preference=profile.get("food_preference"),
        is_training_day=is_training_day,
    )


@router.post("/log", status_code=201)
async def log_nutrition(
    payload: NutritionCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = user_id
    if data.get("log_date"):
        data["log_date"] = str(data["log_date"])

    res = sb.table("nutrition_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to log nutrition entry")

    # FIX: Update protein_streak after every nutrition log.
    # Check if today's total protein now meets the target — if so, extend
    # the streak; if it breaks (no log yesterday), reset to 1.
    try:
        profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)
        await asyncio.to_thread(_update_protein_streak, user_id, profile, agent_state)
    except Exception as e:
        logger.warning(f"Could not update protein_streak for {user_id}: {e}")

    return res.data[0]


def _update_protein_streak(user_id: str, profile: dict, agent_state: dict) -> None:
    """
    Recompute protein_streak: number of consecutive days the user hit their
    protein target. Called synchronously in a thread after each nutrition log.
    """
    sb = get_supabase()
    today = date.today()

    goal_str = profile.get("goal") or "maintain"
    from schemas.models import Goal
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=True,
    )
    protein_target = targets["protein_g"]

    # Check consecutive days going back up to 30 days
    streak = 0
    check_date = today
    for _ in range(30):
        day_res = (
            sb.table("nutrition_logs")
            .select("protein_g")
            .eq("user_id", user_id)
            .eq("log_date", str(check_date))
            .execute()
        )
        day_logs = day_res.data or []
        day_protein = sum(l.get("protein_g") or 0 for l in day_logs)

        if day_protein >= protein_target * 0.9:  # 90% counts as hitting target
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break

    updated = {**agent_state, "protein_streak": streak}
    upsert_agent_state(user_id, updated)


@router.get("/history")
async def get_nutrition_history(
    limit: int = 30,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("nutrition_logs")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("log_date", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data