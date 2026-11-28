from api.routes.workouts import build_previous_session_comparison


def test_previous_session_comparison_uses_same_workout_type_and_computes_deltas():
    comparison = build_previous_session_comparison(
        current_workout_type="push",
        current_day_label="Push Day",
        current_volume_kg=5250,
        current_duration_minutes=58,
        previous_session={
            "id": "previous-session",
            "session_date": "2026-11-21",
            "workout_type": "push",
            "day_label": "Push Day",
            "total_volume_kg": 5000,
            "duration_minutes": 64,
        },
    )

    assert comparison["comparison_basis"] == "workout_type"
    assert comparison["session_id"] == "previous-session"
    assert comparison["volume_delta_kg"] == 250
    assert comparison["volume_delta_pct"] == 5.0
    assert comparison["duration_delta_minutes"] == -6


def test_previous_session_comparison_does_not_invent_missing_metrics():
    comparison = build_previous_session_comparison(
        current_workout_type=None,
        current_day_label="Upper A",
        current_volume_kg=0,
        current_duration_minutes=None,
        previous_session={
            "id": "previous-session",
            "session_date": "2026-11-20",
            "day_label": "Upper A",
            "total_volume_kg": None,
            "duration_minutes": 52,
        },
    )

    assert comparison["comparison_basis"] == "day_label"
    assert comparison["volume_delta_kg"] is None
    assert comparison["volume_delta_pct"] is None
    assert comparison["duration_delta_minutes"] is None


def test_previous_session_comparison_handles_zero_previous_volume():
    comparison = build_previous_session_comparison(
        current_workout_type="mobility",
        current_day_label="Mobility",
        current_volume_kg=0,
        current_duration_minutes=25,
        previous_session={
            "id": "previous-session",
            "session_date": "2026-11-19",
            "workout_type": "mobility",
            "total_volume_kg": 0,
            "duration_minutes": 30,
        },
    )

    assert comparison["volume_delta_kg"] == 0
    assert comparison["volume_delta_pct"] is None
    assert comparison["duration_delta_minutes"] == -5
