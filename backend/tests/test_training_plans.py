import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api.routes.training_plans import (
    PlanDraftRequest,
    PlannedExercise,
    WorkoutPrescription,
    validate_workout_constraints,
)
from api.routes.workouts import SessionCompleteRequest, SessionTransitionRequest


def _workout(name: str = "Dumbbell Bench Press", workout_type: str = "push") -> WorkoutPrescription:
    return WorkoutPrescription(
        label="Upper-body session",
        workout_type=workout_type,
        exercises=[
            PlannedExercise(
                name=name,
                sets=3,
                reps="8-12",
                rest_seconds=90,
                equipment_required=["untrusted-client-value"],
            )
        ],
    )


def test_plan_workout_rejects_a_training_day_without_exercises() -> None:
    with pytest.raises(ValidationError):
        WorkoutPrescription(label="Push", workout_type="push", exercises=[])


def test_plan_workout_rejects_exercises_on_rest_day() -> None:
    with pytest.raises(ValidationError):
        WorkoutPrescription(
            label="Rest",
            workout_type="rest",
            exercises=[PlannedExercise(name="Plank", sets=2, reps="30 sec")],
        )


def test_plan_exercise_bounds_are_validated() -> None:
    with pytest.raises(ValidationError):
        PlannedExercise(name="Bench Press", sets=0, reps="8")
    with pytest.raises(ValidationError):
        PlannedExercise(name="Bench Press", sets=3, reps=" ")


def test_plan_schedule_rejects_unknown_weekdays_and_workout_types() -> None:
    with pytest.raises(ValidationError):
        PlanDraftRequest(workout=_workout(), schedule={"funday": "push"})
    with pytest.raises(ValidationError):
        PlanDraftRequest(workout=_workout(), schedule={"mon": "invented_split"})


def test_known_exercise_is_canonicalized_and_uses_catalogue_equipment() -> None:
    validated = validate_workout_constraints(
        _workout("db bench press"),
        available_equipment=["dumbbell", "bench"],
        injuries=[],
    )
    exercise = validated["exercises"][0]
    assert exercise["name"] == "Dumbbell Bench Press"
    assert exercise["exercise_id"] == "dumbbell_bench_press"
    assert exercise["equipment_required"] == ["dumbbell", "bench"]
    # Client-provided equipment metadata is not trusted.
    assert exercise["equipment_required"] != ["untrusted-client-value"]


def test_unknown_exercise_is_not_silently_accepted() -> None:
    with pytest.raises(HTTPException) as error:
        validate_workout_constraints(
            _workout("Some made-up press"),
            available_equipment=["dumbbell", "bench"],
            injuries=[],
        )
    assert error.value.status_code == 422


def test_exercise_requires_all_catalogue_equipment() -> None:
    with pytest.raises(HTTPException) as error:
        validate_workout_constraints(
            _workout("Dumbbell Bench Press"),
            available_equipment=["dumbbell"],
            injuries=[],
        )
    assert error.value.status_code == 422
    assert "bench" in str(error.value.detail)


def test_serious_recorded_injury_blocks_overlapping_exercise_group() -> None:
    with pytest.raises(HTTPException) as error:
        validate_workout_constraints(
            _workout("Dumbbell Bench Press"),
            available_equipment=["dumbbell", "bench"],
            injuries=[{"body_part": "left_shoulder", "severity": 8, "doctor_restriction": False}],
        )
    assert error.value.status_code == 409


def test_low_severity_injury_without_doctor_restriction_is_not_a_hard_block() -> None:
    validated = validate_workout_constraints(
        _workout("Dumbbell Bench Press"),
        available_equipment=["dumbbell", "bench"],
        injuries=[{"body_part": "left_shoulder", "severity": 2, "doctor_restriction": False}],
    )
    assert validated["exercises"][0]["exercise_id"] == "dumbbell_bench_press"


def test_doctor_restriction_blocks_even_when_recorded_severity_is_low() -> None:
    with pytest.raises(HTTPException) as error:
        validate_workout_constraints(
            _workout("Dumbbell Bench Press"),
            available_equipment=["dumbbell", "bench"],
            injuries=[{"body_part": "left_shoulder", "severity": 2, "doctor_restriction": True}],
        )
    assert error.value.status_code == 409


def test_post_workout_feedback_enforces_ranges_and_allowed_pain_states() -> None:
    assert SessionCompleteRequest(
        mood="good",
        session_effort=8,
        energy_level=3,
        pain_status="none",
    ).session_effort == 8

    with pytest.raises(ValidationError):
        SessionCompleteRequest(session_effort=11)
    with pytest.raises(ValidationError):
        SessionCompleteRequest(energy_level=0)
    with pytest.raises(ValidationError):
        SessionCompleteRequest(pain_status="diagnosed")


@pytest.mark.parametrize("action", ["pause", "resume", "abandon"])
def test_session_transition_supports_only_explicit_lifecycle_actions(action: str) -> None:
    assert SessionTransitionRequest(action=action).action == action


def test_session_transition_rejects_unsupported_lifecycle_action() -> None:
    with pytest.raises(ValidationError):
        SessionTransitionRequest(action="complete")
