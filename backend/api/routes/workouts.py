"""
FIX: Removed prefix="/workouts" from APIRouter.
main.py already mounts this at prefix="/api/workouts".
"""
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import SessionCreate, SetLog
from core.security import get_current_user
from db.supabase_client import get_supabase
from typing import Optional

# ✅ NO prefix here — main.py sets prefix="/api/workouts"
router = APIRouter(tags=["Workouts"])


@router.post("/sessions", status_code=201)
async def create_session(
    payload: SessionCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
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
    update_data = {"completed": True}
    if cns_fatigue_after is not None:
        update_data["cns_fatigue_after"] = cns_fatigue_after
    res = (
        sb.table("workout_sessions")
        .update(update_data)
        .eq("id", session_id)
        .eq("user_id", current_user["user_id"])
        .execute()
    )
    return res.data[0] if res.data else {}


@router.post("/sessions/{session_id}/logs", status_code=201)
async def log_set(
    session_id: str,
    payload: SetLog,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = payload.model_dump()
    data["session_id"] = session_id
    data["user_id"] = current_user["user_id"]
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