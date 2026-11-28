from schemas.models import PerformanceLog, ResponseType, StructuredDecision


def _valid_exercise(name: str):
    return {
        "name": name,
        "sets": 3,
        "reps": "8-10",
        "weight": "RPE 7",
        "rest": "90 sec",
        "focus": "Controlled eccentric",
    }


def test_complete_workout_plan_and_server_metadata_survive_schema():
    decision = StructuredDecision.model_validate({
        "response_type": "workout_plan",
        "coach_message": "This session matches your available equipment and current training focus.",
        "workout_type": "full_body",
        "exercises": [
            _valid_exercise("Goblet Squat"),
            _valid_exercise("Dumbbell Row"),
            _valid_exercise("Push-up"),
        ],
        "summary": {
            "intensity": "Moderate",
            "estimated_time": "40 min",
            "reason": "A balanced session for the current training context.",
        },
        "knowledge_sources": [
            {"title": "WHO activity guidance", "url": "https://www.who.int/initiatives/behealthy/physical-activity", "category": "activity"},
            {"title": "Untrusted URL", "url": "javascript:alert(1)", "category": "invalid"},
        ],
        "agent_activity": {"tools_used": ["get_recent_workouts"], "tool_rounds": 1},
    })

    output = decision.model_dump(mode="json")
    assert output["response_type"] == "workout_plan"
    assert len(output["exercises"]) == 3
    assert output["knowledge_sources"] == [
        {
            "title": "WHO activity guidance",
            "url": "https://www.who.int/initiatives/behealthy/physical-activity",
            "category": "activity",
        }
    ]
    assert output["agent_activity"]["tools_used"] == ["get_recent_workouts"]


def test_incomplete_workout_is_downgraded_instead_of_displayed_as_a_plan():
    decision = StructuredDecision.model_validate({
        "response_type": "workout_plan",
        "coach_message": "Here is your plan.",
        "workout_type": "legs",
        "exercises": [_valid_exercise("Squat"), _valid_exercise("Lunge")],
        "summary": {"intensity": "High", "estimated_time": "35 min", "reason": "Leg day"},
    })

    assert decision.response_type == ResponseType.chat
    assert decision.exercises == []
    assert "couldn't validate" in (decision.coach_message or "").lower()


def test_invalid_exercises_are_filtered_before_plan_validation():
    decision = StructuredDecision.model_validate({
        "response_type": "workout_plan",
        "coach_message": "A workout suggestion.",
        "workout_type": "upper",
        "exercises": [
            _valid_exercise("Press"),
            {"name": "Bad Row", "sets": -4, "reps": ""},
            _valid_exercise("Row"),
            _valid_exercise("Pulldown"),
        ],
        "summary": {"intensity": "Moderate", "estimated_time": "40 min", "reason": "Upper body"},
    })

    assert decision.response_type == ResponseType.workout_plan
    assert [exercise.name for exercise in decision.exercises] == ["Press", "Row", "Pulldown"]


def test_weekly_summary_is_a_supported_public_response_type():
    decision = StructuredDecision.model_validate({
        "response_type": "weekly_summary",
        "coach_message": "Here is your weekly summary.",
    })
    assert decision.response_type == ResponseType.weekly_summary


def test_performance_log_rejects_negative_weights_and_invalid_rpe():
    valid = PerformanceLog.model_validate({
        "exercise_name": "Bench Press",
        "weight_kg": 60,
        "reps_completed": 8,
        "user_reported_rpe": 8.5,
    })
    assert valid.weight_kg == 60

    for payload in (
        {"exercise_name": "Bench Press", "weight_kg": -60, "reps_completed": 8},
        {"exercise_name": "Bench Press", "weight_kg": 60, "reps_completed": 0},
        {"exercise_name": "Bench Press", "weight_kg": 60, "reps_completed": 8, "user_reported_rpe": 12},
    ):
        try:
            PerformanceLog.model_validate(payload)
        except Exception:
            pass
        else:
            raise AssertionError("Invalid workout log unexpectedly passed validation")
