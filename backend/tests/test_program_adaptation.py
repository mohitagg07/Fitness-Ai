from api.routes.program import _apply_adaptive_changes, _snapshot_change_details


def _exercise(name, sets, reps="8-12", load=100):
    return {
        "name": name,
        "sets": sets,
        "reps": reps,
        "load_kg": load,
        "rest_seconds": 90,
        "rpe_target": 8,
    }


def test_deload_updates_each_scheduled_day_and_preserves_rest_day():
    current = {
        "schedule": {"mon": "push", "wed": "pull", "fri": "rest"},
        "workouts_by_day": {
            "mon": {"workout_type": "push", "exercises": [_exercise("Bench Press", 4)]},
            "wed": {"workout_type": "pull", "exercises": [_exercise("Lat Pulldown", 3)]},
        },
    }
    proposed = _apply_adaptive_changes(current, [{"type": "deload"}], "recovery_decline")
    assert proposed["workouts_by_day"]["mon"]["exercises"][0]["sets"] == 2
    assert proposed["workouts_by_day"]["mon"]["exercises"][0]["load_kg"] == 70
    assert proposed["workouts_by_day"]["wed"]["exercises"][0]["sets"] == 2
    assert proposed["workouts_by_day"]["wed"]["exercises"][0]["load_kg"] == 70
    assert proposed["schedule"]["fri"] == "rest"
    assert current["workouts_by_day"]["mon"]["exercises"][0]["sets"] == 4


def test_plateau_change_only_updates_target_exercise_and_records_field_diff():
    current = {
        "schedule": {"mon": "push"},
        "workouts_by_day": {
            "mon": {
                "workout_type": "push",
                "exercises": [
                    _exercise("Bench Press", 4),
                    _exercise("Incline Dumbbell Press", 3, load=30),
                ],
            }
        },
    }
    proposed = _apply_adaptive_changes(
        current,
        [
            {"type": "volume_reduction", "exercise": "Bench Press"},
            {"type": "intensity_increase", "exercise": "Bench Press"},
        ],
        "plateau on bench press",
    )
    changed, unchanged, unchanged_days = _snapshot_change_details(current, proposed)
    assert proposed["workouts_by_day"]["mon"]["exercises"][0]["sets"] == 3
    assert proposed["workouts_by_day"]["mon"]["exercises"][0]["load_kg"] == 102.5
    assert proposed["workouts_by_day"]["mon"]["exercises"][1] == current["workouts_by_day"]["mon"]["exercises"][1]
    assert any(item["exercise"] == "Bench Press" and item["day"] == "mon" for item in changed)
    assert any(item["exercise"] == "Incline Dumbbell Press" for item in unchanged)
    assert unchanged_days == []


def test_legacy_single_workout_snapshot_still_adapts():
    proposed = _apply_adaptive_changes(
        {"workout": {"workout_type": "push", "exercises": [_exercise("Bench Press", 3)]}},
        [{"type": "deload"}],
        "recovery_decline",
    )
    assert proposed["workout"]["exercises"][0]["sets"] == 2


def test_nonmatching_adaptive_change_fails_closed():
    from fastapi import HTTPException
    import pytest

    with pytest.raises(HTTPException):
        _apply_adaptive_changes(
            {"workout": {"workout_type": "push", "exercises": [_exercise("Bench Press", 3)]}},
            [{"type": "volume_reduction", "exercise": "Barbell Squat"}],
            "plateau on barbell squat",
        )
