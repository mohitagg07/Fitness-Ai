"""
Habits route — the unified Habit Intelligence profile.

main.py mounts this at prefix="/api/habits".
"""
from fastapi import APIRouter, Depends

from core.security import get_current_user
from agents.habit_engine import get_cached_habit_profile

router = APIRouter(tags=["Habit Intelligence"])


@router.get("")
async def get_habit_profile(current_user: dict = Depends(get_current_user)):
    """
    Returns the aggregated habit profile — avoided days, late-training
    days, weekend nutrition dip, typical schedule — computed by
    agents/habit_engine.py. Reads the nightly-cached version when fresh,
    otherwise computes it live (see get_cached_habit_profile).
    """
    return get_cached_habit_profile(current_user["user_id"])
