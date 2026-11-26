from datetime import date

from api.routes.progress import _build_volume_heatmap


def test_progress_heatmap_excludes_warmups_and_aggregates_same_day_sessions():
    result = _build_volume_heatmap(
        weeks=1,
        today=date(2026, 11, 23),  # Monday
        sessions=[
            {"session_date": "2026-11-23", "total_volume_kg": 100, "completed": True},
            {"session_date": "2026-11-23", "total_volume_kg": 125.5, "completed": True},
            {"session_date": "2026-11-23", "total_volume_kg": 900, "completed": False},
        ],
        logs=[
            {"logged_at": "2026-11-23T08:00:00Z", "is_warmup": False},
            {"logged_at": "2026-11-23T08:01:00Z", "is_warmup": True},
            {"logged_at": "2026-11-23T08:02:00Z", "is_warmup": False},
        ],
    )

    monday = result["weeks"][0][0]
    assert monday["sets"] == 2
    assert monday["volume_kg"] == 225.5
    assert monday["has_session"] is True
    assert monday["session_count"] == 2
    assert result["total_sessions"] == 2
    assert result["has_data"] is True


def test_progress_heatmap_has_empty_state_and_marks_future_cells():
    result = _build_volume_heatmap(
        weeks=1,
        today=date(2026, 11, 23),  # Monday
        sessions=[],
        logs=[{"logged_at": "2026-11-23T08:00:00Z", "is_warmup": False}],
    )

    assert result["has_data"] is False
    assert result["total_sessions"] == 0
    assert result["weeks"][0][0]["future"] is False
    assert result["weeks"][0][1]["future"] is True
    assert result["weeks"][0][1]["sets"] == 0
