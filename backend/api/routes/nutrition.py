"""
Nutrition route.
main.py mounts this at prefix="/api/nutrition".

FIXES applied in this version:
  1. protein_streak now updated after every nutrition log (was never updated).
  2. Added POST /quick-log — logs a meal from FatSecret food_id in one tap,
     no manual macro entry needed. Frontend just passes food_id + grams.
  3. Added GET /today — aggregated today's intake vs targets in one call
     so the dashboard never needs to compute remaining macros client-side.
  4. POST /log now accepts log_date defaulting to today if omitted (was
     silently inserting NULL which broke per-day history queries).
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


# ─── Targets ─────────────────────────────────────────────────────────────────

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


# ─── Today's Summary ─────────────────────────────────────────────────────────

@router.get("/today")
async def get_today_nutrition(
    is_training_day: bool = True,
    current_user: dict = Depends(get_current_user)
):
    """
    One-call nutrition dashboard for the frontend.
    Returns consumed + targets + remaining for calories, protein, carbs, fat, water.
    No client-side math needed.
    """
    user_id = current_user["user_id"]
    sb = get_supabase()
    today = str(date.today())

    profile, agent_state = get_full_user_context(user_id)
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=is_training_day,
    )

    res = (
        sb.table("nutrition_logs")
        .select("calories, protein_g, carbs_g, fat_g, water_ml, meal_name, log_date, id")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .order("id", desc=False)
        .execute()
    )
    logs = res.data or []

    consumed = {
        "calories": sum(l.get("calories") or 0 for l in logs),
        "protein_g": round(sum(l.get("protein_g") or 0 for l in logs), 1),
        "carbs_g": round(sum(l.get("carbs_g") or 0 for l in logs), 1),
        "fat_g": round(sum(l.get("fat_g") or 0 for l in logs), 1),
        "water_ml": sum(l.get("water_ml") or 0 for l in logs),
    }

    remaining = {
        "calories": max(0, targets["calories"] - consumed["calories"]),
        "protein_g": round(max(0.0, targets["protein_g"] - consumed["protein_g"]), 1),
        "carbs_g": round(max(0.0, targets["carbs_g"] - consumed["carbs_g"]), 1),
        "fat_g": round(max(0.0, targets["fat_g"] - consumed["fat_g"]), 1),
        "water_ml": max(0, targets["water_ml"] - consumed["water_ml"]),
    }

    pct = lambda consumed_v, target_v: round(100 * consumed_v / max(1, target_v))

    return {
        "date": today,
        "targets": targets,
        "consumed": consumed,
        "remaining": remaining,
        "percent": {
            "calories": pct(consumed["calories"], targets["calories"]),
            "protein": pct(consumed["protein_g"], targets["protein_g"]),
            "carbs": pct(consumed["carbs_g"], targets["carbs_g"]),
            "fat": pct(consumed["fat_g"], targets["fat_g"]),
            "water": pct(consumed["water_ml"], targets["water_ml"]),
        },
        "meals_today": logs,
        "protein_streak": agent_state.get("protein_streak", 0),
    }


# ─── AI Decision ─────────────────────────────────────────────────────────────

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


# ─── Log a Meal (manual) ─────────────────────────────────────────────────────

@router.post("/log", status_code=201)
async def log_nutrition(
    payload: NutritionCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Log a meal manually.  log_date defaults to today if not supplied —
    previously NULL was inserted which broke per-day history queries.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]

    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = user_id
    # FIX: always store a date so log_date IS NULL never occurs
    data.setdefault("log_date", str(date.today()))
    if isinstance(data.get("log_date"), date):
        data["log_date"] = str(data["log_date"])

    res = sb.table("nutrition_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to log nutrition entry")

    # Update protein_streak asynchronously (non-blocking)
    try:
        profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)
        await asyncio.to_thread(_update_protein_streak, user_id, profile, agent_state)
    except Exception as e:
        logger.warning(f"Could not update protein_streak for {user_id}: {e}")

    return res.data[0]


# ─── Quick-Log from FatSecret food_id ────────────────────────────────────────

@router.post("/quick-log", status_code=201)
async def quick_log_from_search(
    food_id: str,
    grams: float,
    meal_name: str | None = None,
    current_user: dict = Depends(get_current_user)
):
    """
    One-tap meal logging: user picks a FatSecret result, enters grams,
    we fetch the macros server-side and insert the log row.

    Why: the old flow required the frontend to pass ALL macro fields.
    This endpoint only needs food_id + grams — macros are fetched here.
    If FatSecret is unavailable, raises 502 so the frontend can fall back
    to the manual /log endpoint.
    """
    if grams <= 0:
        raise HTTPException(400, "grams must be positive")

    # BUG FIX: search results can include LOCAL Indian-food fallback
    # entries (food_id like "IND001") added because FatSecret's free-tier
    # dataset has very limited Indian food coverage (see
    # _search_indian_foods below). Those synthetic IDs only exist in this
    # app's own INDIAN_FOODS table — they are not real FatSecret food IDs.
    # Quick-log was unconditionally calling FatSecret's food.get.v4 with
    # whatever food_id it received, which correctly finds no serving data
    # for an ID FatSecret has never seen ("No serving data found for this
    # food", 404) — even though the search step had already shown the
    # person real macro numbers for that exact item. Local IDs now resolve
    # against the local table directly, scaled by grams, never touching
    # FatSecret at all.
    if food_id.startswith("IND"):
        local_food = next((f for f in INDIAN_FOODS if f["food_id"] == food_id), None)
        if not local_food:
            raise HTTPException(404, "Food not found")

        ratio = grams / 100  # INDIAN_FOODS values are all per-100g
        calories = round(local_food["calories"] * ratio)
        protein_g = round(local_food["protein_g"] * ratio, 1)
        carbs_g = round(local_food["carbs_g"] * ratio, 1)
        fat_g = round(local_food["fat_g"] * ratio, 1)

        log_entry = NutritionCreate(
            meal_name=meal_name or local_food["name"],
            log_date=date.today(),
            calories=calories,
            protein_g=protein_g,
            carbs_g=carbs_g,
            fat_g=fat_g,
        )

        sb = get_supabase()
        user_id = current_user["user_id"]
        data = {k: v for k, v in log_entry.model_dump().items() if v is not None}
        data["user_id"] = user_id
        data["log_date"] = str(data["log_date"])

        res = sb.table("nutrition_logs").insert(data).execute()
        if not res.data:
            raise HTTPException(500, "Failed to insert quick-log entry")

        try:
            profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)
            await asyncio.to_thread(_update_protein_streak, user_id, profile, agent_state)
        except Exception as e:
            logger.warning(f"protein_streak update failed: {e}")

        return {
            "logged": res.data[0],
            "computed_macros": {
                "calories": calories,
                "protein_g": protein_g,
                "carbs_g": carbs_g,
                "fat_g": fat_g,
                "grams_used": grams,
            },
        }

    token = await _get_fatsecret_token()

    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://platform.fatsecret.com/rest/server.api",
            params={"method": "food.get.v4", "food_id": food_id, "format": "json"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )

    if resp.status_code != 200:
        raise HTTPException(502, f"FatSecret food.get failed: {resp.status_code}")

    food_data = resp.json().get("food", {})
    servings = food_data.get("servings", {}).get("serving", [])
    if isinstance(servings, dict):
        servings = [servings]

    # Prefer the "100g" serving for consistent per-gram math
    base = next((s for s in servings if "100" in str(s.get("serving_description", ""))), None)
    if not base and servings:
        base = servings[0]
    if not base:
        raise HTTPException(404, "No serving data found for this food")

    def _safe_float(val, default=0.0) -> float:
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    # Base values are per serving_description amount; compute per-gram ratios
    base_amount = _safe_float(base.get("metric_serving_amount") or base.get("number_of_units") or 100)
    ratio = grams / max(base_amount, 1)

    calories = round(_safe_float(base.get("calories")) * ratio)
    protein_g = round(_safe_float(base.get("protein")) * ratio, 1)
    carbs_g = round(_safe_float(base.get("carbohydrate")) * ratio, 1)
    fat_g = round(_safe_float(base.get("fat")) * ratio, 1)

    log_entry = NutritionCreate(
        meal_name=meal_name or food_data.get("food_name", food_id),
        log_date=date.today(),
        calories=calories,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
    )

    sb = get_supabase()
    user_id = current_user["user_id"]
    data = {k: v for k, v in log_entry.model_dump().items() if v is not None}
    data["user_id"] = user_id
    data["log_date"] = str(data["log_date"])

    res = sb.table("nutrition_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to insert quick-log entry")

    try:
        profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)
        await asyncio.to_thread(_update_protein_streak, user_id, profile, agent_state)
    except Exception as e:
        logger.warning(f"protein_streak update failed: {e}")

    return {
        "logged": res.data[0],
        "computed_macros": {
            "calories": calories,
            "protein_g": protein_g,
            "carbs_g": carbs_g,
            "fat_g": fat_g,
            "grams_used": grams,
        },
    }


# ─── History ─────────────────────────────────────────────────────────────────

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


# ─── Protein streak helper ────────────────────────────────────────────────────

def _update_protein_streak(user_id: str, profile: dict, agent_state: dict) -> None:
    sb = get_supabase()
    today = date.today()

    goal_str = profile.get("goal") or "maintain"
    from schemas.models import Goal as _Goal
    goal = _Goal(goal_str) if goal_str in _Goal._value2member_map_ else _Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=True,
    )
    protein_target = targets["protein_g"]

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

        if day_protein >= protein_target * 0.9:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break

    upsert_agent_state(user_id, {**agent_state, "protein_streak": streak})


# ─── FatSecret food search ────────────────────────────────────────────────────
import httpx as _httpx
import time as _time
import re as _re
import os as _os

_fs_token_cache: dict = {}


async def _get_fatsecret_token() -> str:
    # Prefer the pydantic Settings (reads .env via python-dotenv) over raw
    # os.getenv — os.getenv returns empty when the .env file has not been
    # sourced into the process environment, which is the common case for
    # uvicorn run from a sub-shell or inside a venv on Windows.
    try:
        from core.config import get_settings as _get_settings
        _s = _get_settings()
        client_id     = _s.fatsecret_client_id or _os.getenv("FATSECRET_CLIENT_ID", "")
        client_secret = _s.fatsecret_client_secret or _os.getenv("FATSECRET_CLIENT_SECRET", "")
    except Exception:
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

    # FIXED: FatSecret has poor Indian food coverage — supplement with local DB
    if len(results) < 3:
        indian = _search_indian_foods(q.strip(), max_results=clamp - len(results))
        results = results + indian

    return {"results": results, "total": len(results)}

# ── Indian food fallback database ─────────────────────────────────────────
# FatSecret has very limited Indian food coverage. When a search query
# matches known Indian dishes, return local nutrition data so users aren't
# left with "No results".
INDIAN_FOODS = [
    {"food_id": "IND001", "name": "Rajma Chawal", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 140 | Fat: 2.5g | Carbs: 22g | Protein: 7g",
     "calories": 140, "protein_g": 7.0, "carbs_g": 22.0, "fat_g": 2.5},
    {"food_id": "IND002", "name": "Dal Tadka", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 90 | Fat: 3g | Carbs: 10g | Protein: 5g",
     "calories": 90, "protein_g": 5.0, "carbs_g": 10.0, "fat_g": 3.0},
    {"food_id": "IND003", "name": "Paneer Butter Masala", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 185 | Fat: 12g | Carbs: 8g | Protein: 10g",
     "calories": 185, "protein_g": 10.0, "carbs_g": 8.0, "fat_g": 12.0},
    {"food_id": "IND004", "name": "Chicken Biryani", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 166 | Fat: 6g | Carbs: 21g | Protein: 8g",
     "calories": 166, "protein_g": 8.0, "carbs_g": 21.0, "fat_g": 6.0},
    {"food_id": "IND005", "name": "Roti (Chapati)", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 297 | Fat: 3.7g | Carbs: 57g | Protein: 9g",
     "calories": 297, "protein_g": 9.0, "carbs_g": 57.0, "fat_g": 3.7},
    {"food_id": "IND006", "name": "Idli", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 88 | Fat: 0.4g | Carbs: 17g | Protein: 2g",
     "calories": 88, "protein_g": 2.0, "carbs_g": 17.0, "fat_g": 0.4},
    {"food_id": "IND007", "name": "Dosa", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 168 | Fat: 5g | Carbs: 26g | Protein: 4g",
     "calories": 168, "protein_g": 4.0, "carbs_g": 26.0, "fat_g": 5.0},
    {"food_id": "IND008", "name": "Chole Bhature", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 210 | Fat: 9g | Carbs: 27g | Protein: 6g",
     "calories": 210, "protein_g": 6.0, "carbs_g": 27.0, "fat_g": 9.0},
    {"food_id": "IND009", "name": "Aloo Paratha", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 213 | Fat: 8g | Carbs: 30g | Protein: 5g",
     "calories": 213, "protein_g": 5.0, "carbs_g": 30.0, "fat_g": 8.0},
    {"food_id": "IND010", "name": "Sambar", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 57 | Fat: 1.5g | Carbs: 8g | Protein: 3g",
     "calories": 57, "protein_g": 3.0, "carbs_g": 8.0, "fat_g": 1.5},
    {"food_id": "IND011", "name": "Palak Paneer", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 154 | Fat: 10g | Carbs: 6g | Protein: 9g",
     "calories": 154, "protein_g": 9.0, "carbs_g": 6.0, "fat_g": 10.0},
    {"food_id": "IND012", "name": "Khichdi", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 125 | Fat: 2g | Carbs: 22g | Protein: 5g",
     "calories": 125, "protein_g": 5.0, "carbs_g": 22.0, "fat_g": 2.0},
    {"food_id": "IND013", "name": "Upma", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 140 | Fat: 5g | Carbs: 20g | Protein: 4g",
     "calories": 140, "protein_g": 4.0, "carbs_g": 20.0, "fat_g": 5.0},
    {"food_id": "IND014", "name": "Poha", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 150 | Fat: 4g | Carbs: 25g | Protein: 3g",
     "calories": 150, "protein_g": 3.0, "carbs_g": 25.0, "fat_g": 4.0},
    {"food_id": "IND015", "name": "Mutton Curry", "brand": "", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 178 | Fat: 10g | Carbs: 3g | Protein: 19g",
     "calories": 178, "protein_g": 19.0, "carbs_g": 3.0, "fat_g": 10.0},
]


def _search_indian_foods(query: str, max_results: int = 8) -> list:
    """Fuzzy match against local Indian food database."""
    q = query.lower().strip()
    results = []
    for food in INDIAN_FOODS:
        name_lower = food["name"].lower()
        # Match on any word in the query appearing in the food name
        words = q.split()
        if any(w in name_lower for w in words if len(w) > 2):
            results.append(food)
        if len(results) >= max_results:
            break
    return results
