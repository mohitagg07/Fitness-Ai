"""
Workouts route.
main.py mounts this at prefix="/api/workouts".
"""
import asyncio
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import SetLog
from core.security import get_current_user
from db.supabase_client import get_supabase, upsert_agent_state, get_full_user_context
from typing import Optional
from pydantic import BaseModel, Field

router = APIRouter(tags=["Workouts"])


class SessionCreate(BaseModel):
    plan_id: Optional[str] = None
    session_date: Optional[date] = None
    day_label: Optional[str] = Field(None, max_length=50)
    workout_type: Optional[str] = None
    muscle_groups: list = Field(default_factory=list)
    cns_fatigue_before: Optional[int] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)


class SetLogRequest(BaseModel):
    exercise_name: str = Field(min_length=1)
    weight_kg: float = Field(gt=0)
    reps: int = Field(ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    equipment_modifiers: list = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=300)


@router.post("/sessions", status_code=201)
async def create_session(
    payload: SessionCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    # Ensure profiles row exists — workout_sessions has FK on profiles.id
    # Without this, first-time users get a 500 FK violation on insert.
    await asyncio.to_thread(get_full_user_context, user_id)

    data = payload.model_dump()
    data["user_id"] = user_id
    if data.get("session_date"):
        data["session_date"] = str(data["session_date"])
    res = sb.table("workout_sessions").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to create session")
    return res.data[0]


@router.get("/sessions")
async def list_sessions(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("*, exercise_logs(*)")
        .eq("user_id", current_user["user_id"])
        .order("session_date", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data


@router.patch("/sessions/{session_id}/complete")
async def complete_session(
    session_id: str,
    cns_fatigue_after: Optional[int] = None,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    update_data = {"completed": True}
    if cns_fatigue_after is not None:
        update_data["cns_fatigue_after"] = cns_fatigue_after

    res = (
        sb.table("workout_sessions")
        .update(update_data)
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )
    session = res.data[0] if res.data else {}

    try:
        await asyncio.to_thread(_update_agent_state_on_completion, user_id, cns_fatigue_after)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            f"Could not update agent_state after session complete for {user_id}: {e}"
        )

    return session


def _update_agent_state_on_completion(user_id: str, cns_fatigue_after: Optional[int]):
    sb = get_supabase()
    today = date.today()

    state_res = sb.table("agent_states").select("*").eq("user_id", user_id).execute()
    state = state_res.data[0] if state_res.data else {}

    cutoff = str(today - timedelta(days=90))
    sessions_res = (
        sb.table("workout_sessions")
        .select("session_date")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", cutoff)
        .order("session_date", desc=True)
        .execute()
    )
    session_dates = sorted(
        set(r["session_date"] for r in (sessions_res.data or [])),
        reverse=True,
    )

    streak = 0
    check_date = today
    for d in session_dates:
        d_parsed = date.fromisoformat(d) if isinstance(d, str) else d
        if d_parsed == check_date or d_parsed == check_date - timedelta(days=1):
            streak += 1
            check_date = d_parsed
        elif d_parsed < check_date - timedelta(days=1):
            break

    week_start = today - timedelta(days=today.weekday())
    weekly_res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", str(week_start))
        .execute()
    )
    weekly_count = weekly_res.count or 0

    total_res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .execute()
    )
    total = total_res.count or 0

    high_rpe_days = state.get("consecutive_high_rpe_days", 0)
    if cns_fatigue_after is not None:
        if cns_fatigue_after >= 7:
            high_rpe_days = high_rpe_days + 1
        else:
            high_rpe_days = 0

    updated_state = {
        **state,
        "user_id": user_id,
        "workout_streak": streak,
        "total_workouts": total,
        "weekly_session_count": weekly_count,
        "consecutive_high_rpe_days": high_rpe_days,
        "last_session_date": str(today),
    }
    if cns_fatigue_after is not None:
        updated_state["cns_fatigue_score"] = cns_fatigue_after

    upsert_agent_state(user_id, updated_state)


@router.post("/sessions/{session_id}/logs", status_code=201)
async def log_set(
    session_id: str,
    payload: SetLogRequest,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    existing_res = (
        sb.table("exercise_logs")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .eq("exercise_name", payload.exercise_name)
        .execute()
    )
    set_number = (existing_res.count or 0) + 1

    data = payload.model_dump()
    data["session_id"] = session_id
    data["user_id"] = user_id
    data["set_number"] = set_number

    res = sb.table("exercise_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to log set")
    return res.data[0]


@router.get("/sessions/{session_id}/logs")
async def get_session_logs(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("exercise_logs")
        .select("*")
        .eq("session_id", session_id)
        .eq("user_id", current_user["user_id"])
        .order("logged_at")
        .execute()
    )
    return res.data