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
import json
import math
from datetime import date, timedelta
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import NutritionCreate, Goal
from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context, upsert_agent_state
from services.nutrition import calculate_macros, is_training_day_for_user
from agents.nutrition_agent import run_nutrition_agent
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Nutrition"])


# ─── Targets ─────────────────────────────────────────────────────────────────

class FoodEstimateRequest(BaseModel):
    food_name: str = Field(min_length=2, max_length=120)
    portion: str = Field(min_length=1, max_length=100)
    preparation: str | None = Field(default=None, max_length=240)


@router.post("/estimate")
async def estimate_food_nutrition(
    payload: FoodEstimateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Return a clearly-labelled AI estimate for food not found in a database.

    No values are persisted here: the user reviews the assumptions and
    explicitly confirms before the frontend submits /nutrition/log.
    """
    prompt = f"""Estimate nutrition for this food portion, using plausible common recipes and portions.
Food: {payload.food_name}
Amount eaten: {payload.portion}
Preparation/details: {payload.preparation or "Not provided"}

Return ONLY one JSON object with:
{{
  "calories": integer,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "confidence": "low" or "medium",
  "assumptions": ["short concrete assumptions, 1-3 items"],
  "portion_summary": "short description of the assumed portion"
}}

Rules:
- These are estimates, not laboratory values or exact measurements.
- Prefer conservative, realistic estimates. Do not claim high confidence.
- For fried food, account for batter and absorbed oil; for mixed dishes, explain recipe variation.
- Do not invent a precise weight when the user gave only pieces or a bowl; state the assumed size.
- All nutrient values must be non-negative and plausible for the stated portion.
- Calories should broadly agree with protein*4 + carbs*4 + fat*9. Return no extra text."""

    def run_estimate() -> dict:
        from agents.coach_agent import get_llm
        from langchain_core.messages import HumanMessage

        response = get_llm().invoke([HumanMessage(content=prompt)])
        content = response.content
        raw = (
            "\\n".join(
                str(part.get("text", "")) if isinstance(part, dict) else str(part)
                for part in content
            ).strip()
            if isinstance(content, list)
            else str(content or "").strip()
        )
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            start = cleaned.find("{")
            if start < 0:
                raise ValueError("Nutrition estimate was not valid JSON")
            parsed, _ = json.JSONDecoder().raw_decode(cleaned[start:])
        if not isinstance(parsed, dict):
            raise ValueError("Nutrition estimate must be an object")

        values = {}
        limits = {"calories": 3000, "protein_g": 250, "carbs_g": 400, "fat_g": 250}
        for key, maximum in limits.items():
            value = parsed.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"Missing or invalid {key}")
            if not math.isfinite(float(value)) or value < 0 or value > maximum:
                raise ValueError(f"Out-of-range {key}")
            values[key] = int(round(value)) if key == "calories" else round(float(value), 1)

        energy_from_macros = (
            values["protein_g"] * 4
            + values["carbs_g"] * 4
            + values["fat_g"] * 9
        )
        if energy_from_macros > 0 and abs(values["calories"] - energy_from_macros) > max(120, energy_from_macros * 0.35):
            raise ValueError("Nutrition estimate failed its consistency check")

        confidence = parsed.get("confidence")
        if confidence not in {"low", "medium"}:
            confidence = "low"
        assumptions = parsed.get("assumptions")
        if not isinstance(assumptions, list):
            assumptions = []
        safe_assumptions = [
            str(item).strip()[:160] for item in assumptions
            if isinstance(item, (str, int, float)) and str(item).strip()
        ][:3]
        portion_summary = str(parsed.get("portion_summary") or payload.portion).strip()[:160]

        return {
            "food_name": payload.food_name.strip(),
            "portion": payload.portion.strip(),
            "portion_summary": portion_summary,
            **values,
            "confidence": confidence,
            "assumptions": safe_assumptions,
            "source": "ai_estimate",
            "requires_confirmation": True,
        }

    try:
        return await asyncio.to_thread(run_estimate)
    except Exception as exc:
        logger.warning("Food nutrition estimate failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail="VYRN could not estimate this food right now. Try again or choose a database result.",
        )


@router.get("/targets")
async def get_nutrition_targets(
    is_training_day: bool | None = None,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    training_day = is_training_day if is_training_day is not None else is_training_day_for_user(user_id)
    profile, _ = get_full_user_context(user_id)
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    return calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=training_day,
    )


# ─── Today's Summary ─────────────────────────────────────────────────────────

@router.get("/today")
async def get_today_nutrition(
    is_training_day: bool | None = None,
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
    training_day = is_training_day if is_training_day is not None else is_training_day_for_user(user_id)

    profile, agent_state = get_full_user_context(user_id)
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=training_day,
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


# ─── Meal Generator & Smart Grocery ───────────────────────────────────────────

@router.get("/meal-plan")
async def get_meal_plan(
    is_training_day: bool | None = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Item #10 — a ready-to-eat combination sized to today's actual
    remaining macros (reuses the same targets/consumed math as GET
    /today), not a single-item suggestion. Returns items: [] once
    remaining need is trivial.
    """
    from agents.nutrition_agent import generate_meal_plan

    user_id = current_user["user_id"]
    sb = get_supabase()
    today_str = str(date.today())
    training_day = is_training_day if is_training_day is not None else is_training_day_for_user(user_id)
    profile, _ = get_full_user_context(user_id)
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=training_day,
    )
    res = (
        sb.table("nutrition_logs")
        .select("protein_g, carbs_g, fat_g")
        .eq("user_id", user_id)
        .eq("log_date", today_str)
        .execute()
    )
    logs = res.data or []
    consumed_protein = sum(l.get("protein_g") or 0 for l in logs)
    consumed_carbs = sum(l.get("carbs_g") or 0 for l in logs)
    consumed_fat = sum(l.get("fat_g") or 0 for l in logs)

    plans = generate_meal_plan(
        protein_remaining_g=max(0.0, targets["protein_g"] - consumed_protein),
        carbs_remaining_g=max(0.0, targets["carbs_g"] - consumed_carbs),
        fat_remaining_g=max(0.0, targets["fat_g"] - consumed_fat),
        food_preference=profile.get("food_preference"),
    )
    return {"plans": plans}


@router.get("/grocery-list")
async def get_grocery_list(current_user: dict = Depends(get_current_user)):
    """
    Item #9 — weekly shopping quantities derived from the user's real
    weekly protein target (7 × the daily target), split across their
    usual protein sources for their diet type. See
    agents.nutrition_agent.generate_grocery_list for why this isn't
    built from a logged meal plan (the app doesn't have one).
    """
    from agents.nutrition_agent import generate_grocery_list

    profile, _ = get_full_user_context(current_user["user_id"])
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=is_training_day_for_user(current_user["user_id"]),
    )
    return generate_grocery_list(
        weekly_protein_target_g=targets["protein_g"] * 7,
        food_preference=profile.get("food_preference"),
    )


# ─── AI Decision ─────────────────────────────────────────────────────────────

@router.get("/decision")
async def get_nutrition_decision(
    is_training_day: bool | None = None,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    training_day = is_training_day if is_training_day is not None else is_training_day_for_user(user_id)
    profile, _ = get_full_user_context(user_id)
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
        is_training_day=training_day,
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

    # FIX: a bare httpx call here meant any transient network failure
    # (DNS hiccup, FatSecret being briefly unreachable, a slow connection
    # on the dev machine) surfaced as an unhandled httpx.ConnectTimeout
    # that FastAPI turned into a raw 500 with a full stack trace instead
    # of a clean, actionable error — and search results just vanished
    # with no useful message on the frontend.
    try:
        async with _httpx.AsyncClient() as client:
            resp = await client.post(
                "https://oauth.fatsecret.com/connect/token",
                data={"grant_type": "client_credentials", "scope": "basic"},
                auth=(client_id, client_secret),
                timeout=10,
            )
    except _httpx.TimeoutException:
        raise HTTPException(503, "Food search is temporarily unreachable (connection timed out). Please try again.")
    except _httpx.HTTPError as e:
        raise HTTPException(503, f"Food search is temporarily unreachable: {e}")

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

    query = q.strip()
    clamp = min(max(1, max_results), 20)
    remote_results = []

    # Food search is an enhancement, not a hard dependency for logging food.
    # FatSecret may be unconfigured, rate-limited or temporarily unreachable;
    # still return the local Indian ingredient/dish catalogue in those cases.
    try:
        token = await _get_fatsecret_token()
        async with _httpx.AsyncClient() as client:
            resp = await client.get(
                "https://platform.fatsecret.com/rest/server.api",
                params={
                    "method": "foods.search",
                    "search_expression": query,
                    "format": "json",
                    "max_results": clamp,
                    "page_number": 0,
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=12,
            )

        if resp.status_code != 200:
            raise HTTPException(502, f"FatSecret search failed: {resp.status_code}")

        raw_foods = resp.json().get("foods", {}).get("food", [])
        if isinstance(raw_foods, dict):
            raw_foods = [raw_foods]

        for food in raw_foods:
            description = food.get("food_description", "")
            remote_results.append({
                "food_id": food.get("food_id"),
                "name": food.get("food_name", "Unknown"),
                "brand": food.get("brand_name") or "",
                "food_type": food.get("food_type", ""),
                "serving_description": description,
                **_parse_fs_description(description),
            })
    except HTTPException as exc:
        if exc.status_code not in (502, 503):
            raise
        logger.info("FatSecret unavailable; using local nutrition search for %r: %s", query, exc.detail)
    except _httpx.HTTPError as exc:
        logger.info("FatSecret request failed; using local nutrition search for %r: %s", query, exc)

    local_results = _search_indian_foods(query, max_results=clamp)

    # Put an exact generic ingredient ahead of branded dishes when a person
    # searches for the ingredient itself (e.g. "paneer"). Keep provider
    # results after that, then append relevant local Indian dishes. This
    # preserves discovery without letting a short provider list hide basics.
    normalized_query = " ".join(query.lower().split())
    exact_local = [
        food for food in local_results
        if " ".join(food["name"].lower().split()) == normalized_query
        or " ".join(food["name"].lower().split()).startswith(normalized_query + ",")
        or " ".join(food["name"].lower().split()).startswith(normalized_query + " (")
    ]
    ordered = exact_local + remote_results + [
        food for food in local_results if food not in exact_local
    ]

    # De-duplicate provider/local entries by display name, case-insensitively.
    combined = []
    seen = set()
    for food in ordered:
        key = " ".join(str(food.get("name") or "").lower().split())
        if not key or key in seen:
            continue
        seen.add(key)
        combined.append(food)
        if len(combined) >= clamp:
            break

    return {"results": combined, "total": len(combined)}

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
    {"food_id": "IND016", "name": "Paneer, plain", "brand": "ICMR-NIN IFCT 2017", "food_type": "Generic",
     "serving_description": "Per 100g | Calories: 305 | Fat: 24.78g | Carbs: 2.41g | Protein: 18.86g | Source: IFCT 2017, food code L003",
     "calories": 305, "protein_g": 18.86, "carbs_g": 2.41, "fat_g": 24.78},
]


def _search_indian_foods(query: str, max_results: int = 8) -> list:
    """Rank local Indian foods by ingredient/name relevance."""
    q = " ".join(query.lower().strip().split())
    words = [word for word in q.split() if len(word) > 2]
    if not words:
        return []

    # Common Indian ingredient wording; aliases let people search naturally
    # without forcing the exact spelling used by the local food catalogue.
    aliases = {
        "cottage cheese": "paneer",
        "indian cottage cheese": "paneer",
        "chapati": "roti",
        "curd": "yogurt",
        "dahi": "yogurt",
    }
    search_terms = [aliases.get(q, q)]
    if q in aliases:
        search_terms = [aliases[q]]
    query_words = [word for term in search_terms for word in term.split() if len(word) > 2]

    ranked = []
    for food in INDIAN_FOODS:
        name = " ".join(food["name"].lower().split())
        if not all(word in name for word in query_words):
            continue

        # Plain ingredient entries should be more discoverable than recipes
        # when the query is simply the ingredient name.
        if name == q:
            score = 0
        elif name.startswith(q + ",") or name.startswith(q + " ("):
            score = 1
        elif name.startswith(q + " "):
            score = 2
        else:
            score = 3
        ranked.append((score, name, food))

    ranked.sort(key=lambda item: (item[0], item[1]))
    return [food for _, _, food in ranked[:max_results]]
