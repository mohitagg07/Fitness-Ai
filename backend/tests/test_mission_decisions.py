from types import SimpleNamespace

from api.routes.mission import _pick_ai_decision, _pick_next_action


def test_daily_next_action_uses_the_learned_usual_gym_time():
    workout = SimpleNamespace(recommended_type="push", rescheduled=False)
    recovery = SimpleNamespace(action="proceed", recovery_score=8)
    nutrition = SimpleNamespace(suggested_meal=None, message="Nutrition is on track")
    learned_time = {
        "period": "evening",
        "label": "Usual start time",
        "display_label": "6:30 PM",
        "source": "training_history",
        "is_exact": False,
    }

    result = _pick_next_action(
        workout,
        recovery,
        nutrition,
        {"workout_time_preference": "morning"},
        protein_remaining=10,
        water_remaining_ml=0,
        training_window=learned_time,
    )

    assert "6:30 PM" in result
    assert "usual start time" in result.lower()


def test_pain_review_overrides_workout_and_nutrition_action():
    workout = SimpleNamespace(recommended_type="push", rescheduled=False)
    recovery = SimpleNamespace(action="pain_review", recovery_score=8)
    nutrition = SimpleNamespace(suggested_meal="Lunch", message="Lunch is ready")

    decision = _pick_ai_decision(workout, recovery, nutrition)
    next_action = _pick_next_action(
        workout,
        recovery,
        nutrition,
        {},
        protein_remaining=40,
        water_remaining_ml=1200,
    )

    assert "pain" in decision.lower()
    assert "pain" in next_action.lower()
    assert "do not repeat" in next_action.lower()
