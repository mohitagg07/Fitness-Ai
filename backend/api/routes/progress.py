"""
FIX: Removed prefix="/progress" from APIRouter.
main.py already mounts this at prefix="/api/progress".
"""
from fastapi import APIRouter, Depends
from schemas.models import MetricsCreate
from core.security import get_current_user
from db.supabase_client import get_supabase

# ✅ NO prefix here — main.py sets prefix="/api/progress"
router = APIRouter(tags=["Progress"])


@router.post("/metrics", status_code=201)
async def log_metrics(
    payload: MetricsCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = current_user["user_id"]
    if data.get("recorded_date"):
        data["recorded_date"] = str(data["recorded_date"])
    res = sb.table("progress_metrics").insert(data).execute()
    return res.data[0] if res.data else {}


@router.get("/metrics")
async def get_metrics(
    limit: int = 30,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("progress_metrics")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("recorded_date", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data