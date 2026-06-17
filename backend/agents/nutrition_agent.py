"""
Nutrition Agent — decides what the user should eat right now, instead of
asking "what should I eat?". Reads today's logged intake, compares against
the macro targets from services/nutrition.py, and proposes a concrete meal.
"""
from datetime import datetime, date
from schemas.models import Goal, NutritionDecision
from services.nutrition import calculate_macros
from db.supabase_client import get_supabase

# Simple food suggestion table keyed by remaining-protein band and diet pref.
# Real implementation would pull from a foods/recipes table — this keeps the
# agent deterministic and testable without requiring an external food DB.
PROTEIN_SOURCES = {
    "veg": [("paneer", 18, 100), ("greek yogurt", 10, 100), ("lentils (dal)", 9, 100), ("tofu", 13, 100)],
    "vegan": [("tofu", 13, 100), ("lentils (dal)", 9, 100), ("tempeh", 19, 100), ("chickpeas", 9, 100)],
    "eggetarian": [("eggs (2)", 13, 100), ("paneer", 18, 100), ("greek yogurt", 10, 100)],
    "non-veg": [("chicken breast", 31, 100), ("eggs (2)", 13, 100), ("fish", 22, 100), ("paneer", 18, 100)],
}


def _today_intake(user_id: str) -> dict:
    sb = get_supabase()
    today = str(date.today())
    res = (
        sb.table("nutrition_logs")
        .select("*")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    logs = res.data or []
    return {
        "calories": sum(l.get("calories") or 0 for l in logs),
        "protein_g": sum(l.get("protein_g") or 0 for l in logs),
        "carbs_g": sum(l.get("carbs_g") or 0 for l in logs),
        "fat_g": sum(l.get("fat_g") or 0 for l in logs),
        "water_ml": sum(l.get("water_ml") or 0 for l in logs),
    }


def _suggest_meal(protein_remaining: float, food_pref: str) -> str | None:
    if protein_remaining <= 5:
        return None
    sources = PROTEIN_SOURCES.get(food_pref or "non-veg", PROTEIN_SOURCES["non-veg"])
    # Pick the source needing the least amount to close the gap, capped at sensible portions
    best = min(sources, key=lambda s: abs(protein_remaining - s[1]))
    name, protein_per_100, _ = best
    grams = min(300, max(50, round(protein_remaining / protein_per_100 * 100 / 10) * 10))
    return f"{grams}g {name}"


def run_nutrition_agent(
    user_id: str,
    weight_kg: float,
    height_cm: float,
    age: int,
    gender: str,
    goal: Goal,
    food_preference: str | None,
    is_training_day: bool = True,
) -> NutritionDecision:
    targets = calculate_macros(weight_kg, height_cm, age, gender, goal, is_training_day)
    consumed = _today_intake(user_id)

    calories_remaining = max(0, targets["calories"] - int(consumed["calories"]))
    protein_remaining = max(0.0, targets["protein_g"] - consumed["protein_g"])

    hour = datetime.now().hour
    suggestion = _suggest_meal(protein_remaining, food_preference)

    if protein_remaining <= 5:
        message = "Protein target hit for today. Nice work — stay consistent with the rest of your meals."
    elif suggestion:
        message = f"It's {hour}:00. You still need {int(protein_remaining)}g protein. Have {suggestion}."
    else:
        message = f"You still need {int(protein_remaining)}g protein today — fit in a protein-rich meal soon."

    return NutritionDecision(
        message=message,
        suggested_meal=suggestion,
        calories_remaining=calories_remaining,
        protein_remaining_g=round(protein_remaining, 1),
    )
