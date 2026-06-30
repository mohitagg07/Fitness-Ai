"""
Body Weight Route — VYRN

A dedicated, narrow surface over progress_metrics.weight_kg. The generic
/api/progress/metrics endpoint already supports weight (plus body fat,
waist, chest, arms, thighs), but the frontend needs a fast, weight-only
read/write path for a body-weight tracking screen — log a weigh-in, see
trend, see chart data — without pulling in measurement fields it doesn't
use. This route reads/writes the SAME progress_metrics table, so a
weigh-in logged here shows up in the generic Progress/Analytics screens
too, and vice versa. No duplicate data store.
"""
import asyncio
import logging
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.security import get_current_user
from db.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Body Weight"])


class WeightLogRequest(BaseModel):
    weight_kg: float = Field(gt=0, lt=500)
    recorded_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=300)


@router.post("/log", status_code=201)
async def log_weight(
    payload: WeightLogRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Log a body-weight entry. If an entry already exists for the same date,
    updates it rather than creating a duplicate row — a user weighing in
    twice in one day (e.g. correcting a typo) shouldn't skew the trend.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]
    log_date = str(payload.recorded_date or date.today())

    existing = (
        sb.table("progress_metrics")
        .select("id")
        .eq("user_id", user_id)
        .eq("recorded_date", log_date)
        .not_.is_("weight_kg", "null")
        .limit(1)
        .execute()
    )

    if existing.data:
        row_id = existing.data[0]["id"]
        res = (
            sb.table("progress_metrics")
            .update({"weight_kg": payload.weight_kg, "notes": payload.notes})
            .eq("id", row_id)
            .execute()
        )
        return {"updated": True, "entry": res.data[0] if res.data else None}

    data = {
        "user_id": user_id,
        "recorded_date": log_date,
        "weight_kg": payload.weight_kg,
        "notes": payload.notes,
    }
    res = sb.table("progress_metrics").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to log weight entry")
    return {"updated": False, "entry": res.data[0]}


@router.get("/history")
async def get_weight_history(
    days: int = 90,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns weight entries in the last N days, oldest first — ready to feed
    directly into a line chart. Includes has_data so the frontend can show
    a real empty state instead of a fabricated flat line.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]
    cutoff = str(date.today() - timedelta(days=days))

    res = (
        sb.table("progress_metrics")
        .select("id, weight_kg, recorded_date, notes")
        .eq("user_id", user_id)
        .not_.is_("weight_kg", "null")
        .gte("recorded_date", cutoff)
        .order("recorded_date")
        .execute()
    )
    rows = [r for r in (res.data or []) if r.get("weight_kg")]

    if not rows:
        return {
            "has_data": False,
            "entries": [],
            "empty_state": "No weight logged yet. Log your first weigh-in to start tracking your trend.",
        }

    latest = rows[-1]["weight_kg"]
    earliest = rows[0]["weight_kg"]
    delta = round(latest - earliest, 1)

    return {
        "has_data": True,
        "entries": rows,
        "latest_kg": latest,
        "delta_kg": delta,
        "direction": "up" if delta > 0.1 else "down" if delta < -0.1 else "stable",
        "window_days": days,
        "entries_count": len(rows),
    }


@router.delete("/{entry_id}")
async def delete_weight_entry(
    entry_id: str,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    try:
        sb.table("progress_metrics").delete().eq("id", entry_id).eq(
            "user_id", current_user["user_id"]
        ).execute()
        return {"deleted": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete entry: {e}")