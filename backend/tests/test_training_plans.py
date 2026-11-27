import pytest
from pydantic import ValidationError

from api.routes.training_plans import PlanDraftRequest, WorkoutPrescription


def _workout(kind: str, label: str | None = None) -> WorkoutPrescription:
    # The weekly validator needs only the prescription day/type relation;
    # catalogue and exercise-level safety validation runs in the API helper.
    return WorkoutPrescription.model_construct(
        workout_type=kind,
        exercises=[],
    )


def test_weekly_plan_requires_individual_prescription_for_every_training_day():
    payload = PlanDraftRequest(
        schedule={"mon": "push", "wed": "pull", "fri": "rest"},
        workouts_by_day={"mon": _workout("push"), "wed": _workout("pull")},
    )
    assert set(payload.workouts_by_day) == {"mon", "wed"}
    assert payload.schedule["fri"] == "rest"


def test_weekly_plan_rejects_missing_day_prescription():
    with pytest.raises(ValidationError):
        PlanDraftRequest(
            schedule={"mon": "push", "thu": "legs"},
            workouts_by_day={"mon": _workout("push")},
        )


def test_weekly_plan_rejects_prescription_type_mismatch():
    with pytest.raises(ValidationError):
        PlanDraftRequest(
            schedule={"mon": "pull"},
            workouts_by_day={"mon": _workout("push")},
        )


def test_single_workout_maps_to_the_only_scheduled_training_day():
    payload = PlanDraftRequest(
        schedule={"tue": "push", "sun": "rest"},
        workout=_workout("push"),
    )
    assert payload.workouts_by_day["tue"].workout_type == "push"


def test_single_session_draft_without_weekly_schedule_remains_supported():
    payload = PlanDraftRequest(workout=_workout("push"))
    assert payload.schedule == {}
    assert payload.workout.workout_type == "push"


def test_plan_without_any_prescription_is_rejected():
    with pytest.raises(ValidationError):
        PlanDraftRequest()
