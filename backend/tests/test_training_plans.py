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


def test_daily_workout_override_preserves_other_day_specific_prescriptions(monkeypatch):
    from datetime import date
    from api.routes.training_plans import _validated_plan_snapshot

    monkeypatch.setattr(
        "api.routes.training_plans.validate_workout_constraints",
        lambda workout, _equipment, _injuries: workout.model_dump(),
    )
    payload = PlanDraftRequest(session_date=date(2026, 11, 28), workout=_workout("legs"))
    base = {
        "schedule": {
            "mon": "push", "tue": "rest", "wed": "pull",
            "thu": "rest", "fri": "rest", "sat": "rest", "sun": "rest",
        },
        "workouts_by_day": {
            "mon": _workout("push").model_dump(),
            "wed": _workout("pull").model_dump(),
        },
    }

    snapshot = _validated_plan_snapshot(payload, [], [], base_snapshot=base)

    assert snapshot["schedule"]["mon"] == "push"
    assert snapshot["schedule"]["wed"] == "pull"
    assert snapshot["schedule"]["sat"] == "legs"
    assert snapshot["schedule"]["sun"] == "rest"
    assert set(snapshot["workouts_by_day"]) == {"mon", "wed", "sat"}
    assert "workout" not in snapshot


def test_daily_workout_override_fails_closed_for_legacy_mixed_schedule(monkeypatch):
    from datetime import date
    from fastapi import HTTPException
    from api.routes.training_plans import _validated_plan_snapshot

    monkeypatch.setattr(
        "api.routes.training_plans.validate_workout_constraints",
        lambda workout, _equipment, _injuries: workout.model_dump(),
    )
    payload = PlanDraftRequest(session_date=date(2026, 11, 28), workout=_workout("legs"))
    legacy = {
        "schedule": {"mon": "push", "wed": "pull", "fri": "legs"},
        "workout": _workout("push").model_dump(),
    }

    with pytest.raises(HTTPException) as error:
        _validated_plan_snapshot(payload, [], [], base_snapshot=legacy)

    assert error.value.status_code == 409
    assert "separate prescription" in error.value.detail


def test_daily_workout_override_fills_unscheduled_days_as_rest(monkeypatch):
    from datetime import date
    from api.routes.training_plans import _validated_plan_snapshot

    monkeypatch.setattr(
        "api.routes.training_plans.validate_workout_constraints",
        lambda workout, _equipment, _injuries: workout.model_dump(),
    )
    payload = PlanDraftRequest(session_date=date(2026, 11, 28), workout=_workout("legs"))

    snapshot = _validated_plan_snapshot(payload, [], [])

    assert snapshot["schedule"]["sat"] == "legs"
    assert all(
        snapshot["schedule"][day] == "rest"
        for day in ("mon", "tue", "wed", "thu", "fri", "sun")
    )
