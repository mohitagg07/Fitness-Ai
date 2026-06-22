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

# ─── FatSecret food search ──────────────────────────────────────────────────────
import httpx as _httpx
import time as _time
import re as _re
import os as _os

_fs_token_cache: dict = {}   # holds {token, expires_at}


async def _get_fatsecret_token() -> str:
    """
    Exchange client_credentials for a FatSecret OAuth2 bearer token.
    Token is cached in memory until 60 s before expiry so we don't hit
    the token endpoint on every search request.
    """
    client_id     = _os.getenv("FATSECRET_CLIENT_ID", "")
    client_secret = _os.getenv("FATSECRET_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail="FatSecret credentials not set. Add FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET to backend/.env",
        )

    now    = _time.time()
    cached = _fs_token_cache.get("data")
    if cached and cached["expires_at"] > now + 60:
        return cached["token"]

    async with _httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth.fatsecret.com/connect/token",
            data={"grant_type": "client_credentials", "scope": "basic"},
            auth=(client_id, client_secret),
            timeout=10,
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"FatSecret token error {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    _fs_token_cache["data"] = {
        "token":      body["access_token"],
        "expires_at": now + body.get("expires_in", 3600),
    }
    return _fs_token_cache["data"]["token"]


def _parse_fs_description(desc: str) -> dict:
    """
    Parse FatSecret's food_description string, e.g.:
      'Per 100g - Calories: 165kcal | Fat: 3.57g | Carbs: 0g | Protein: 31.02g'
    Returns {calories, fat_g, carbs_g, protein_g}.
    """
    def _grab(label: str, default: float = 0.0) -> float:
        m = _re.search(rf"{label}:?\s*([\d.]+)", desc, _re.IGNORECASE)
        return float(m.group(1)) if m else default

    return {
        "calories":  int(_grab("Calories")),
        "fat_g":     round(_grab("Fat"),     2),
        "carbs_g":   round(_grab("Carbs"),   2),
        "protein_g": round(_grab("Protein"), 2),
    }


@router.get("/search")
async def search_food(
    q: str,
    max_results: int = 8,
    current_user: dict = Depends(get_current_user),
):
    """
    Search FatSecret for food items matching *q*.
    Returns a ranked list of food items with pre-parsed macros so the
    frontend can auto-fill the log-meal form in one tap.

    GET /api/nutrition/search?q=chicken+rice&max_results=8
    """
    if not q or len(q.strip()) < 2:
        raise HTTPException(400, "Query must be at least 2 characters")

    token = await _get_fatsecret_token()
    clamp = min(max(1, max_results), 20)

    async with _httpx.AsyncClient() as client:
        resp = await client.get(
            "https://platform.fatsecret.com/rest/server.api",
            params={
                "method":            "foods.search",
                "search_expression": q.strip(),
                "format":            "json",
                "max_results":       clamp,
                "page_number":       0,
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )

    if resp.status_code != 200:
        raise HTTPException(502, f"FatSecret search failed {resp.status_code}: {resp.text[:300]}")

    data       = resp.json()
    raw_foods  = data.get("foods", {}).get("food", [])
    # API returns a plain dict (not list) when only 1 result
    if isinstance(raw_foods, dict):
        raw_foods = [raw_foods]

    results = []
    for f in raw_foods:
        desc = f.get("food_description", "")
        results.append({
            "food_id":             f.get("food_id"),
            "name":                f.get("food_name", "Unknown"),
            "brand":               f.get("brand_name") or "",
            "food_type":           f.get("food_type", ""),
            "serving_description": desc,
            **_parse_fs_description(desc),
        })

    return {"results": results, "total": len(results)}
