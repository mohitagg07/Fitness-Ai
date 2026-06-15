from fastapi import APIRouter, Depends
from schemas.models import MetricsCreate, NutritionCreate
from core.security import get_current_user
from db.supabase_client import get_supabase
from services.nutrition import calculate_macros

router = APIRouter(prefix="/progress", tags=["Progress"])


@router.post("/metrics", status_code=201)
async def log_metrics(payload: MetricsCreate, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
    if data.get("recorded_date"):
        data["recorded_date"] = str(data["recorded_date"])
    res = sb.table("progress_metrics").insert(data).execute()
    return res.data[0]


@router.get("/metrics")
async def get_metrics(limit: int = 30, current_user: dict = Depends(get_current_user)):
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


@router.get("/strength")
async def get_strength_history(current_user: dict = Depends(get_current_user)):
    """Returns exercise logs grouped for strength progress charts."""
    sb = get_supabase()
    res = (
        sb.table("exercise_logs")
        .select("exercise_name, weight_kg, reps, logged_at")
        .eq("user_id", current_user["user_id"])
        .order("logged_at", desc=False)
        .execute()
    )
    # Group by exercise
    grouped = {}
    for row in (res.data or []):
        name = row["exercise_name"]
        if name not in grouped:
            grouped[name] = []
        grouped[name].append({
            "weight_kg": row["weight_kg"],
            "reps": row["reps"],
            "date": row["logged_at"],
        })
    return grouped


@router.post("/nutrition", status_code=201)
async def log_nutrition(payload: NutritionCreate, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
    if data.get("log_date"):
        data["log_date"] = str(data["log_date"])
    res = sb.table("nutrition_logs").insert(data).execute()
    return res.data[0]


@router.get("/nutrition/targets")
async def get_nutrition_targets(is_training_day: bool = True, current_user: dict = Depends(get_current_user)):
    """Returns AI-calculated macro targets for the user based on their profile."""
    sb = get_supabase()
    profile_res = sb.table("profiles").select("*").eq("id", current_user["user_id"]).single().execute()
    p = profile_res.data or {}

    if not p.get("weight_kg"):
        return {"error": "Complete your profile first to get nutrition targets."}

    return calculate_macros(
        weight_kg=p.get("weight_kg", 75),
        height_cm=p.get("height_cm", 175),
        age=p.get("age", 22),
        gender=p.get("gender", "male"),
        goal=p.get("goal", "maintain"),
        is_training_day=is_training_day,
    )


@router.get("/nutrition")
async def get_nutrition_history(limit: int = 30, current_user: dict = Depends(get_current_user)):
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
