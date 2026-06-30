"""
Nutrition Agent — decides what the user should eat right now.

FIX (httpcore.LocalProtocolError: Invalid input StreamInputs.SEND_HEADERS in state 5):
  The Supabase client uses an httpx.Client with HTTP/2 enabled. When multiple
  asyncio.to_thread() calls share the same httpx.Client instance (via the
  module-level get_supabase() singleton), httpx's HTTP/2 multiplexing state
  machine gets corrupted across threads — this is the exact error in the log.
  Fix: call get_supabase() inside each function, never cache it at module level.
  This creates a fresh httpx connection per agent call, which is safe.
"""
from datetime import datetime, date
from schemas.models import Goal, NutritionDecision
from services.nutrition import calculate_macros


PROTEIN_SOURCES = {
    "veg":       [("paneer", 18, 100), ("greek yogurt", 10, 100), ("lentils (dal)", 9, 100), ("tofu", 13, 100)],
    "vegan":     [("tofu", 13, 100), ("lentils (dal)", 9, 100), ("tempeh", 19, 100), ("chickpeas", 9, 100)],
    "eggetarian":[("eggs (2)", 13, 100), ("paneer", 18, 100), ("greek yogurt", 10, 100)],
    "non-veg":   [("chicken breast", 31, 100), ("eggs (2)", 13, 100), ("fish", 22, 100), ("paneer", 18, 100)],
}


def _today_intake(user_id: str) -> dict:
    # FIX: import inside function so each call creates a fresh httpx session
    from db.supabase_client import get_supabase
    sb = get_supabase()
    today = str(date.today())
    try:
        res = (
            sb.table("nutrition_logs")
            .select("calories, protein_g, carbs_g, fat_g, water_ml")
            .eq("user_id", user_id)
            .eq("log_date", today)
            .execute()
        )
        logs = res.data or []
    except Exception:
        logs = []
    return {
        "calories":  sum(l.get("calories")  or 0 for l in logs),
        "protein_g": sum(l.get("protein_g") or 0 for l in logs),
        "carbs_g":   sum(l.get("carbs_g")   or 0 for l in logs),
        "fat_g":     sum(l.get("fat_g")     or 0 for l in logs),
        "water_ml":  sum(l.get("water_ml")  or 0 for l in logs),
    }


def _suggest_meal(protein_remaining: float, food_pref: str) -> str | None:
    if protein_remaining <= 5:
        return None
    sources = PROTEIN_SOURCES.get(food_pref or "non-veg", PROTEIN_SOURCES["non-veg"])
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
    local_hour: int | None = None,
) -> NutritionDecision:
    targets = calculate_macros(weight_kg, height_cm, age, gender, goal, is_training_day)
    consumed = _today_intake(user_id)

    calories_remaining = max(0, targets["calories"] - int(consumed["calories"]))
    protein_remaining  = max(0.0, targets["protein_g"] - consumed["protein_g"])
    hour = local_hour if local_hour is not None else datetime.now().hour
    suggestion = _suggest_meal(protein_remaining, food_preference or "non-veg")

    if protein_remaining <= 5:
        message = "Protein target hit for today. Nice work — stay consistent."
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
