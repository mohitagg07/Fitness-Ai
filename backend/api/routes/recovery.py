"""Daily, athlete-reported recovery check-ins."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from core.security import get_current_user
from db.supabase_client import get_supabase
from services.timezone import local_today

router = APIRouter(tags=["Recovery"])


class RecoveryCheckInRequest(BaseModel):
    sleep_hours: Optional[float] = Field(default=None, ge=0, le=24)
    soreness_level: Optional[int] = Field(default=None, ge=1, le=5)
    energy_level: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def require_at_least_one_value(self):
        if self.notes is not None:
            self.notes = self.notes.strip() or None
        if (
            self.sleep_hours is None and self.soreness_level is None
            and self.energy_level is None and self.notes is None
        ):
            raise ValueError("Add at least one recovery detail before saving.")
        return self


@router.get("/check-in/today")
async def get_today_recovery_checkin(
    timezone_name: str = Query(default="UTC", min_length=1, max_length=64),
    current_user: dict = Depends(get_current_user),
):
    local_date = str(local_today(timezone_name))
    try:
        result = (
            get_supabase().table("recovery_checkins")
            .select("local_date, sleep_hours, soreness_level, energy_level, notes, updated_at")
            .eq("user_id", current_user["user_id"])
            .eq("local_date", local_date)
            .limit(1).execute()
        )
    except Exception as exc:
        raise HTTPException(
            503,
            "Daily recovery check-ins are not available yet. Apply the recovery-check-in migration and retry.",
        ) from exc
    rows = result.data or []
    return {"local_date": local_date, "check_in": rows[0] if rows else None}


@router.put("/check-in/today")
async def save_today_recovery_checkin(
    payload: RecoveryCheckInRequest,
    timezone_name: str = Query(default="UTC", min_length=1, max_length=64),
    current_user: dict = Depends(get_current_user),
):
    values = payload.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(422, "Add at least one recovery detail before saving.")
    local_date = str(local_today(timezone_name))
    values.update({
        "user_id": current_user["user_id"],
        "local_date": local_date,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        result = (
            get_supabase().table("recovery_checkins")
            .upsert(values, on_conflict="user_id,local_date").execute()
        )
    except Exception as exc:
        raise HTTPException(
            503,
            "Your recovery check-in could not be saved. Apply the recovery-check-in migration and retry.",
        ) from exc
    if not result.data:
        raise HTTPException(500, "Your recovery check-in was not saved.")
    return {"local_date": local_date, "check_in": result.data[0]}
