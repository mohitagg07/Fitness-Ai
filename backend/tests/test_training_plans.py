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



def test_recovery_components_keep_missing_data_unknown() -> None:
    from agents.recovery_agent import (
        _cns_component,
        _nutrition_component,
        _rpe_component,
        _sleep_component,
        _soreness_component,
        _volume_component,
    )

    assert _sleep_component(None) is None
    assert _volume_component(None) is None
    assert _nutrition_component(None, None) is None
    assert _rpe_component(None) is None
    assert _cns_component(None) is None
    assert _soreness_component(None) is None


def test_recovery_energy_component_is_bounded_and_uses_reported_input() -> None:
    from agents.recovery_agent import _energy_component

    assert _energy_component(1) == 0
    assert _energy_component(3) == 5
    assert _energy_component(5) == 10
    assert _energy_component(None) is None
    assert _energy_component(6) is None


def test_recovery_sleep_and_soreness_components_are_bounded() -> None:
    from agents.recovery_agent import _sleep_component, _soreness_component

    assert _sleep_component(8) == 30
    assert _sleep_component(0) == 0
    assert _soreness_component(1) == 15
    assert _soreness_component(5) == 0
    assert _soreness_component(0) is None
    assert _soreness_component(6) is None


def test_recovery_checkin_payload_rejects_invalid_ranges() -> None:
    from pydantic import ValidationError
    from api.routes.recovery import RecoveryCheckInRequest

    assert RecoveryCheckInRequest(sleep_hours=7.5, soreness_level=2, energy_level=4).sleep_hours == 7.5
    with pytest.raises(ValidationError):
        RecoveryCheckInRequest(sleep_hours=25)
    with pytest.raises(ValidationError):
        RecoveryCheckInRequest(soreness_level=6)
    with pytest.raises(ValidationError):
        RecoveryCheckInRequest(energy_level=0)


def test_today_recovery_checkin_fails_as_unknown_when_migration_is_missing(monkeypatch) -> None:
    from agents import recovery_agent

    class BrokenSupabase:
        def table(self, _name):
            raise RuntimeError("relation recovery_checkins does not exist")

    monkeypatch.setattr(recovery_agent, "get_supabase", lambda: BrokenSupabase())
    assert recovery_agent._today_recovery_checkin("user-1") is None


def test_adaptive_plan_transform_creates_a_new_snapshot_and_preserves_original() -> None:
    from api.routes.program import _apply_adaptive_changes

    original = {
        "name": "Strength plan",
        "schedule": {"mon": "push"},
        "workout": {
            "label": "Push",
            "workout_type": "push",
            "estimated_duration_minutes": 55,
            "exercises": [
                {"name": "Bench Press", "sets": 4, "reps": "8-10", "load_kg": 80},
                {"name": "Triceps Pushdown", "sets": 3, "reps": "10-12", "load_kg": 25},
            ],
        },
    }

    updated = _apply_adaptive_changes(
        original,
        [{"type": "deload", "exercise": None}],
        "recovery_decline",
    )

    assert original["workout"]["exercises"][0]["sets"] == 4
    assert original["workout"]["exercises"][0]["load_kg"] == 80
    assert updated is not original
    assert updated["workout"]["exercises"][0]["sets"] == 2
    assert updated["workout"]["exercises"][0]["load_kg"] == 56
    assert updated["workout"]["exercises"][1]["sets"] == 2


def test_adaptive_plan_volume_reduction_targets_the_requested_exercise() -> None:
    from api.routes.program import _apply_adaptive_changes

    original = {
        "workout": {
            "exercises": [
                {"name": "Bench Press", "sets": 4, "reps": "8-10"},
                {"name": "Triceps Pushdown", "sets": 3, "reps": "10-12"},
            ]
        }
    }
    updated = _apply_adaptive_changes(
        original,
        [{"type": "volume_reduction", "exercise": "Bench Press"}],
        "plateau",
    )
    assert updated["workout"]["exercises"][0]["sets"] == 3
    assert updated["workout"]["exercises"][1]["sets"] == 3


def test_session_exercise_event_payload_requires_replacement_for_replace() -> None:
    from pydantic import ValidationError
    from api.routes.workouts import SessionExerciseEventRequest

    payload = SessionExerciseEventRequest(
        action="replace",
        exercise_name="Bench Press",
        replacement_exercise="Push Up",
        client_request_id="session-replace-bench-001",
    )
    assert payload.action == "replace"

    with pytest.raises(ValidationError):
        SessionExerciseEventRequest(
            action="replace",
            exercise_name="Bench Press",
            client_request_id="session-replace-bench-002",
        )

    with pytest.raises(ValidationError):
        SessionExerciseEventRequest(
            action="skip",
            exercise_name="Bench Press",
            replacement_exercise="Push Up",
        )


def test_session_exercise_event_rejects_unknown_action() -> None:
    from pydantic import ValidationError
    from api.routes.workouts import SessionExerciseEventRequest

    with pytest.raises(ValidationError):
        SessionExerciseEventRequest(
            action="delete",
            exercise_name="Bench Press",
            client_request_id="session-delete-bench-001",
        )
