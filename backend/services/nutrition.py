"""
Nutrition Service — AI-calculated macros that adjust weekly
based on user goal, body weight, training intensity, and progress.
"""
from __future__ import annotations

import logging
from datetime import date

from db.supabase_client import get_supabase
from schemas.models import Goal

logger = logging.getLogger(__name__)


def resolve_training_day_from_schedule(
    schedule: dict | None,
    target_date: date,
) -> bool | None:
    """Resolve a calendar day from a workout-plan schedule.

    Returns None when the schedule does not explicitly describe that weekday;
    callers can then apply a documented fallback instead of inventing a split.
    """
    if not isinstance(schedule, dict):
        return None

    weekday_keys = (
        ("mon", "monday"),
        ("tue", "tuesday"),
        ("wed", "wednesday"),
        ("thu", "thursday"),
        ("fri", "friday"),
        ("sat", "saturday"),
        ("sun", "sunday"),
    )
    short_key, full_key = weekday_keys[target_date.weekday()]
    if short_key in schedule:
        value = schedule[short_key]
    elif full_key in schedule:
        value = schedule[full_key]
    else:
        return None

    if isinstance(value, bool):
        return value
    if isinstance(value, dict):
        value = value.get("workout_type") or value.get("type") or value.get("name")
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    return normalized not in {"", "rest", "rest_day", "off", "recovery", "false", "none"}


def is_training_day_for_user(
    user_id: str,
    target_date: date | None = None,
    default: bool = True,
) -> bool:
    """Use the latest active plan's weekday schedule when one is available.

    Older accounts may not have an active plan or a complete schedule. In that
    case preserve the previous default (training day) rather than infer days
    from a weekly frequency count that has no weekday placement.
    """
    target_date = target_date or date.today()
    try:
        result = (
            get_supabase()
            .table("workout_plans")
            .select("schedule")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        plans = result.data or []
        if not plans:
            return default
        resolved = resolve_training_day_from_schedule(plans[0].get("schedule"), target_date)
        return default if resolved is None else resolved
    except Exception:
        logger.exception("Could not resolve training schedule for user %s", user_id)
        return default


def calculate_tdee(weight_kg: float, height_cm: float, age: int, gender: str, activity_level: str = "very_active") -> int:
    """Mifflin-St Jeor BMR → TDEE"""
    if gender == "male":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161

    multipliers = {
        "sedentary": 1.2,
        "light": 1.375,
        "moderate": 1.55,
        "very_active": 1.725,
        "extra_active": 1.9,
    }
    return int(bmr * multipliers.get(activity_level, 1.55))


def calculate_macros(
    weight_kg: float,
    height_cm: float,
    age: int,
    gender: str,
    goal: Goal,
    is_training_day: bool = True,
) -> dict:
    """
    Returns daily macro targets adjusted for goal and training day.
    Protein minimum: 2.2g/kg bodyweight for muscle preservation.
    """
    tdee = calculate_tdee(weight_kg, height_cm, age, gender)

    if goal == Goal.cut:
        deficit = 300 if is_training_day else 500
        calories = tdee - deficit
        protein_g = round(weight_kg * 2.4, 0)   # Higher protein on cut to preserve muscle
        fat_g = round(weight_kg * 1.0, 0)
        carbs_g = round((calories - protein_g * 4 - fat_g * 9) / 4, 0)
    elif goal == Goal.bulk:
        surplus = 250 if is_training_day else 0
        calories = tdee + surplus
        protein_g = round(weight_kg * 2.2, 0)
        fat_g = round(weight_kg * 1.1, 0)
        carbs_g = round((calories - protein_g * 4 - fat_g * 9) / 4, 0)
    elif goal == Goal.recomp:
        calories = tdee + (100 if is_training_day else -200)
        protein_g = round(weight_kg * 2.5, 0)   # Highest protein for recomp
        fat_g = round(weight_kg * 1.0, 0)
        carbs_g = round((calories - protein_g * 4 - fat_g * 9) / 4, 0)
    else:  # maintain
        calories = tdee
        protein_g = round(weight_kg * 2.0, 0)
        fat_g = round(weight_kg * 1.0, 0)
        carbs_g = round((calories - protein_g * 4 - fat_g * 9) / 4, 0)

    # Ensure carbs never go negative
    carbs_g = max(carbs_g, 50)
    calories = int(protein_g * 4 + carbs_g * 4 + fat_g * 9)

    return {
        "calories": calories,
        "protein_g": int(protein_g),
        "carbs_g": int(carbs_g),
        "fat_g": int(fat_g),
        "water_ml": int(weight_kg * 40),  # 40ml per kg bodyweight
        "tdee": tdee,
        "is_training_day": is_training_day,
        "goal": goal,
    }
