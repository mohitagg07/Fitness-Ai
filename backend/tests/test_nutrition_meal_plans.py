from agents.nutrition_agent import generate_meal_plan


def test_meal_plan_returns_remaining_meals_for_current_day():
    plans = generate_meal_plan(
        protein_remaining_g=90,
        carbs_remaining_g=140,
        fat_remaining_g=25,
        food_preference="veg",
        local_hour=6,
    )

    assert [meal["meal"] for meal in plans] == [
        "Breakfast",
        "Lunch",
        "Afternoon snack",
        "Dinner",
    ]
    assert all(meal["items"] for meal in plans)
    assert all(item["grams"] > 0 for meal in plans for item in meal["items"])
    assert all("chicken" not in item["food"] for meal in plans for item in meal["items"])


def test_meal_plan_respects_dairy_and_gluten_exclusions():
    plans = generate_meal_plan(
        protein_remaining_g=70,
        carbs_remaining_g=100,
        fat_remaining_g=20,
        food_preference="veg",
        allergies=["milk"],
        food_restrictions=["gluten"],
        local_hour=16,
    )

    assert plans
    foods = [item["food"].lower() for meal in plans for item in meal["items"]]
    assert not any(word in food for food in foods for word in ("paneer", "yogurt", "milk", "curd"))
    assert not any(word in food for food in foods for word in ("roti", "chapati", "wheat", "bread"))


def test_meal_plan_respects_vegan_profile_and_excludes_egg_and_dairy():
    plans = generate_meal_plan(
        protein_remaining_g=55,
        carbs_remaining_g=80,
        fat_remaining_g=15,
        food_preference="vegan",
        allergies=["dairy", "egg"],
        local_hour=10,
    )

    foods = [item["food"].lower() for meal in plans for item in meal["items"]]
    assert plans
    assert not any(word in food for food in foods for word in ("paneer", "yogurt", "milk", "curd", "egg", "cheese"))


def test_meal_plan_returns_no_suggestion_when_macro_gap_is_trivial():
    assert generate_meal_plan(
        protein_remaining_g=4,
        carbs_remaining_g=8,
        fat_remaining_g=0,
        food_preference="veg",
        local_hour=20,
    ) == []


def test_meal_plan_uses_local_time_for_remaining_meal_slots():
    plans = generate_meal_plan(
        protein_remaining_g=30,
        carbs_remaining_g=45,
        fat_remaining_g=10,
        food_preference="non-veg",
        local_hour=17,
    )

    assert [meal["meal"] for meal in plans] == ["Dinner"]
