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



def test_last_completed_session_summary_exposes_saved_review_and_comparison(monkeypatch):
    from api.routes import mission

    class Query:
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def execute(self):
            return SimpleNamespace(data=[{
                "id": "session-123",
                "session_date": "2026-11-28",
                "workout_type": "push",
                "day_label": "Push Day",
                "total_volume_kg": 4200,
                "duration_minutes": 54,
                "session_effort": 7,
                "energy_level": 4,
                "pain_status": "none",
                "completion_result": {
                    "planned_vs_actual": {
                        "completed_working_sets": 15,
                        "planned_working_sets": 16,
                    },
                    "previous_comparable_session": {
                        "volume_delta_kg": 200,
                        "volume_delta_pct": 5.0,
                    },
                    "coach_message": "Keep the same load next time.",
                },
            }])

    class Supabase:
        def table(self, _name): return Query()

    monkeypatch.setattr(mission, "get_supabase", lambda: Supabase())
    result = mission._last_completed_session_summary("athlete-1")

    assert result["id"] == "session-123"
    assert result["planned_vs_actual"]["completed_working_sets"] == 15
    assert result["previous_comparable_session"]["volume_delta_kg"] == 200
    assert result["coach_message"] == "Keep the same load next time."
