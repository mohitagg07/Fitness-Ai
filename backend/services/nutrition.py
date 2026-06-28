"""
backend/api/routes/nutrition.py

COMPLETE REWRITE — was only a stub with /search.
Now implements all 6 endpoints the frontend calls:

  GET  /nutrition/search          ← food search (OpenFoodFacts + AI fallback)
  POST /nutrition/log             ← manual log (macros typed in)
  POST /nutrition/quick-log       ← one-tap from search result
  GET  /nutrition/targets         ← TDEE-based macro targets
  GET  /nutrition/today           ← consumed today vs targets (for donut)
  GET  /nutrition/history         ← past logs for the "Recent Meals" list

Indian food search: OpenFoodFacts has poor coverage for Indian dishes.
When a query returns < 2 results we fall back to an AI-generated
nutrition estimate so "rajma chawal", "dal makhani", "paneer butter
masala" etc always get a sensible answer.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context
from schemas.models import Goal
from services.nutrition import calculate_macros

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Nutrition"])


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _profile_macros(user_id: str, is_training_day: bool = True) -> dict:
    """Pull user profile from Supabase and compute macro targets."""
    profile, _ = get_full_user_context(user_id)
    weight = float(profile.get("weight_kg") or 75)
    height = float(profile.get("height_cm") or 175)
    age    = int(profile.get("age") or 25)
    gender = str(profile.get("gender") or "male")
    goal_raw = profile.get("goal") or "maintain"
    try:
        goal = Goal(goal_raw)
    except Exception:
        goal = Goal.maintain
    return calculate_macros(weight, height, age, gender, goal, is_training_day)


def _today_totals(user_id: str) -> dict:
    """Sum today's nutrition_logs rows for this user."""
    sb = get_supabase()
    today = str(date.today())
    res = (
        sb.table("nutrition_logs")
        .select("calories, protein_g, carbs_g, fat_g, water_ml, meal_name, log_date")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    logs = res.data or []
    return {
        "calories":  sum(int(l.get("calories")  or 0) for l in logs),
        "protein_g": round(sum(float(l.get("protein_g") or 0) for l in logs), 1),
        "carbs_g":   round(sum(float(l.get("carbs_g")   or 0) for l in logs), 1),
        "fat_g":     round(sum(float(l.get("fat_g")     or 0) for l in logs), 1),
        "water_ml":  sum(int(l.get("water_ml")  or 0) for l in logs),
    }


# ─── AI fallback for Indian / unknown foods ────────────────────────────────────

_GROQ_FOOD_PROMPT = """\
You are a nutrition database. Return ONLY valid JSON (no markdown, no preamble).

For the food query "{query}", return an array of 1-3 realistic nutrition entries.
Each entry must have exactly these keys (all per 100 g of food):
  food_name   string   — specific dish name
  calories    int      — kcal per 100g
  protein_g   float    — grams protein per 100g
  carbs_g     float    — grams carbohydrates per 100g
  fat_g       float    — grams fat per 100g

Example for "rajma chawal":
[
  {{"food_name":"Rajma Chawal (cooked, mixed)","calories":160,"protein_g":6.2,"carbs_g":28.0,"fat_g":2.8}},
  {{"food_name":"Rajma curry (cooked)","calories":110,"protein_g":7.0,"carbs_g":18.0,"fat_g":1.5}},
  {{"food_name":"Steamed Basmati Rice","calories":130,"protein_g":2.7,"carbs_g":28.2,"fat_g":0.3}}
]
"""


async def _ai_food_fallback(query: str) -> list[dict]:
    """Call Groq to estimate macros for foods not in OpenFoodFacts."""
    from core.config import get_settings
    settings = get_settings()
    if not settings.groq_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.groq_model,
                    "messages": [
                        {"role": "user", "content": _GROQ_FOOD_PROMPT.format(query=query)}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 400,
                },
            )
        raw = resp.json()["choices"][0]["message"]["content"]
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        items = json.loads(raw)
        # Add a sentinel so the UI can show "(AI estimate)"
        for item in items:
            item["source"] = "ai_estimate"
            item["food_id"] = None   # no DB id — will use manual log path
        return items
    except Exception as e:
        logger.warning(f"AI food fallback failed: {e}")
        return []


# ─── 1. SEARCH ─────────────────────────────────────────────────────────────────

@router.get("/search")
async def search_food(
    q: str = Query(..., min_length=1),
    max_results: int = Query(8, le=20),
    current_user: dict = Depends(get_current_user),
):
    """
    Search for food by name. Returns per-100g macros.
    Falls back to AI estimate for Indian dishes and anything OpenFoodFacts
    returns < 2 results for.
    """
    foods: list[dict] = []

    # ── Step 1: OpenFoodFacts ────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(
                "https://world.openfoodfacts.org/cgi/search.pl",
                params={
                    "search_terms": q,
                    "json": 1,
                    "page_size": max_results + 4,   # fetch extra; many have no macros
                    "fields": "product_name,nutriments,code",
                    "sort_by": "unique_scans_n",    # most-scanned = more reliable data
                },
            )
        products = res.json().get("products", [])
        for p in products:
            n = p.get("nutriments", {})
            cal = round(n.get("energy-kcal_100g") or n.get("energy-kcal") or 0)
            name = (p.get("product_name") or "").strip()
            if not name or cal == 0:
                continue
            foods.append({
                "food_id":   p.get("code"),
                "food_name": name,
                "calories":  cal,
                "protein_g": round(n.get("proteins_100g") or 0, 1),
                "carbs_g":   round(n.get("carbohydrates_100g") or 0, 1),
                "fat_g":     round(n.get("fat_100g") or 0, 1),
                "source":    "openfoodfacts",
            })
            if len(foods) >= max_results:
                break
    except Exception as e:
        logger.warning(f"OpenFoodFacts search failed: {e}")

    # ── Step 2: AI fallback if OFacts gave poor results ─────────────────────
    if len(foods) < 2:
        ai_foods = await _ai_food_fallback(q)
        # Merge — AI results at the top so Indian dishes appear first
        foods = ai_foods + foods

    return {"foods": foods[:max_results]}


# ─── 2. MANUAL LOG ─────────────────────────────────────────────────────────────

class NutritionLogCreate(BaseModel):
    meal_name: str = Field(..., min_length=1, max_length=200)
    calories:  int = Field(..., ge=0)
    protein_g: float = Field(0.0, ge=0)
    carbs_g:   float = Field(0.0, ge=0)
    fat_g:     float = Field(0.0, ge=0)
    water_ml:  Optional[int] = Field(None, ge=0)
    log_date:  Optional[date] = None
    notes:     Optional[str] = Field(None, max_length=300)


@router.post("/log", status_code=201)
async def log_nutrition(
    payload: NutritionLogCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Manual nutrition log — called when the user types in macros themselves
    or when quick-log path isn't available (no food_id from search).
    """
    sb = get_supabase()
    data = payload.model_dump(exclude_none=True)
    data["user_id"] = current_user["user_id"]
    if "log_date" in data and data["log_date"] is not None:
        data["log_date"] = str(data["log_date"])
    else:
        data["log_date"] = str(date.today())

    res = sb.table("nutrition_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to insert nutrition log")
    return res.data[0]


# ─── 3. QUICK-LOG (from search result) ────────────────────────────────────────

@router.post("/quick-log", status_code=201)
async def quick_log(
    food_id:   str      = Query(...),
    grams:     float    = Query(..., gt=0, le=5000),
    meal_name: Optional[str] = Query(None),
    current_user: dict  = Depends(get_current_user),
):
    """
    One-tap log from a search result.
    Frontend passes food_id (OpenFoodFacts barcode) + grams eaten.
    We re-fetch the product to get accurate per-gram macros.
    """
    sb = get_supabase()
    ratio = grams / 100.0
    cal = protein = carbs = fat = 0
    name = meal_name or food_id

    # Re-fetch from OFacts so we have the exact macros
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"https://world.openfoodfacts.org/api/v0/product/{food_id}.json",
                params={"fields": "product_name,nutriments"},
            )
        product = r.json().get("product") or {}
        n = product.get("nutriments") or {}
        cal     = round((n.get("energy-kcal_100g") or 0) * ratio)
        protein = round((n.get("proteins_100g")     or 0) * ratio, 1)
        carbs   = round((n.get("carbohydrates_100g")or 0) * ratio, 1)
        fat     = round((n.get("fat_100g")          or 0) * ratio, 1)
        name    = meal_name or product.get("product_name") or food_id
    except Exception as e:
        logger.warning(f"quick_log: OFacts re-fetch failed for {food_id}: {e}")
        # Can't get macros — return 422 so frontend falls back to /log
        raise HTTPException(
            422,
            f"Could not retrieve macros for food_id={food_id}. "
            "Use /nutrition/log with manual values instead."
        )

    data = {
        "user_id":   current_user["user_id"],
        "log_date":  str(date.today()),
        "meal_name": f"{name} ({int(grams)}g)",
        "calories":  cal,
        "protein_g": protein,
        "carbs_g":   carbs,
        "fat_g":     fat,
    }
    res = sb.table("nutrition_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to insert quick log")
    return res.data[0]


# ─── 4. TARGETS ───────────────────────────────────────────────────────────────

@router.get("/targets")
async def get_nutrition_targets(
    is_training_day: bool = Query(True),
    current_user: dict    = Depends(get_current_user),
):
    """
    Returns TDEE-calculated daily macro targets.
    Called by ProgressScreen → MacroDonut (target ring).
    Also used by coach_agent to set session nutrition plan.
    """
    import asyncio
    macros = await asyncio.to_thread(_profile_macros, current_user["user_id"], is_training_day)
    return macros


# ─── 5. TODAY (consumed + targets combined) ────────────────────────────────────

@router.get("/today")
async def get_today_nutrition(
    is_training_day: bool = Query(True),
    current_user: dict    = Depends(get_current_user),
):
    """
    Single call that returns both what was consumed today and the targets.
    ProgressScreen uses this to render the macro donut + progress bars.

    Shape:
    {
      "consumed": { calories, protein_g, carbs_g, fat_g, water_ml },
      "targets":  { calories, protein_g, carbs_g, fat_g, water_ml, ... }
    }
    """
    import asyncio
    user_id = current_user["user_id"]
    consumed, targets = await asyncio.gather(
        asyncio.to_thread(_today_totals, user_id),
        asyncio.to_thread(_profile_macros, user_id, is_training_day),
    )
    return {"consumed": consumed, "targets": targets}


# ─── 6. HISTORY ───────────────────────────────────────────────────────────────

@router.get("/history")
async def get_nutrition_history(
    limit: int = Query(30, le=100),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns past nutrition_logs ordered newest first.
    Used by ProgressScreen → "Recent Meals" list.
    """
    sb = get_supabase()
    res = (
        sb.table("nutrition_logs")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("log_date", desc=True)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []