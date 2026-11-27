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

# grams protein/carbs/fat per 100g — shared across diet types, used by
# generate_meal_plan() to fill the carb/fat side of a meal once a protein
# source is picked, and by generate_grocery_list() to convert weekly macro
# targets into real shopping quantities.
CARB_SOURCES = [
    ("rice (cooked)", 28, 100), ("oats", 66, 100), ("sweet potato", 20, 100), ("roti/chapati", 48, 100),
]
FAT_SOURCES = [
    ("almonds", 22, 100), ("peanut butter", 50, 100), ("olive oil", 100, 100),
]


def _today_intake(user_id: str, target_date: date | None = None) -> dict:
    # FIX: import inside function so each call creates a fresh httpx session
    from db.supabase_client import get_supabase
    sb = get_supabase()
    today = str(target_date or date.today())
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
    target_date: date | None = None,
) -> NutritionDecision:
    targets = calculate_macros(weight_kg, height_cm, age, gender, goal, is_training_day)
    consumed = _today_intake(user_id, target_date)

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


def generate_meal_plan(
    protein_remaining_g: float,
    carbs_remaining_g: float,
    fat_remaining_g: float,
    food_preference: str | None,
) -> list[dict]:
    """
    Item #10 on the roadmap — "no searching," a ready-to-eat combination
    rather than a single protein source. Greedily fills protein first
    (the macro this app treats as non-negotiable — see calculate_macros'
    2.0-2.5g/kg floor), then carbs, then reports the fat the plan already
    contains rather than force-adding a fourth item most people wouldn't
    actually eat separately from oil/nuts already in their cooking.
    Returns [] once remaining needs are trivial (<10g protein) — a
    "meal plan" for 4g of protein left is noise, not help.
    """
    if protein_remaining_g < 10:
        return []

    items = []
    total_protein = total_carbs = total_fat = 0.0

    protein_sources = PROTEIN_SOURCES.get(food_preference or "non-veg", PROTEIN_SOURCES["non-veg"])
    p_name, p_per_100, _ = min(protein_sources, key=lambda s: abs(protein_remaining_g - s[1]))
    p_grams = min(300, max(50, round(protein_remaining_g / p_per_100 * 100 / 10) * 10))
    items.append({"food": p_name, "grams": p_grams, "reason": "protein"})
    total_protein += p_per_100 * p_grams / 100

    if carbs_remaining_g > 20:
        c_name, c_per_100, _ = min(CARB_SOURCES, key=lambda s: abs(carbs_remaining_g - s[1]))
        c_grams = min(250, max(50, round(carbs_remaining_g / c_per_100 * 100 / 10) * 10))
        items.append({"food": c_name, "grams": c_grams, "reason": "carbs"})
        total_carbs += c_per_100 * c_grams / 100

    return [{
        "items": items,
        "approx_protein_g": round(total_protein),
        "approx_carbs_g": round(total_carbs),
        "covers_protein_pct": round(min(100, 100 * total_protein / protein_remaining_g)) if protein_remaining_g > 0 else 100,
    }]


def generate_grocery_list(weekly_protein_target_g: float, food_preference: str | None) -> dict:
    """
    Item #9 — converts a real weekly protein target (7 × the daily target
    calculate_macros already computes) into shopping quantities, split
    across the user's usual protein sources for their diet type. This is
    NOT built from a logged meal plan (the app doesn't have one) — it's
    the honest thing it CAN compute from real data: "to hit your protein
    target for a week, here's roughly how much of each staple that is,"
    split evenly across 2-3 go-to sources rather than one unrealistic
    grocery item.
    """
    sources = PROTEIN_SOURCES.get(food_preference or "non-veg", PROTEIN_SOURCES["non-veg"])
    # Split the weekly protein need evenly across up to 3 staple sources —
    # keeps quantities realistic instead of "3.5kg chicken breast."
    use_sources = sources[:3] if len(sources) >= 3 else sources
    share_g = weekly_protein_target_g / len(use_sources)

    items = []
    for name, protein_per_100, _ in use_sources:
        grams_needed = round(share_g / protein_per_100 * 100 / 50) * 50  # round to nearest 50g
        items.append({"food": name, "quantity_g": max(50, grams_needed)})

    return {
        "week_of": str(target_date or date.today()),
        "based_on_weekly_protein_target_g": round(weekly_protein_target_g),
        "items": items,
        "note": "Quantities are derived from your weekly protein target split across your usual protein sources — not from a logged meal plan, since none exists yet. Adjust for what you'll actually cook.",
    }
