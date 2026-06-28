"""
Nutrition Service — AI-calculated macros that adjust weekly
based on user goal, body weight, training intensity, and progress.
"""
from schemas.models import Goal


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
