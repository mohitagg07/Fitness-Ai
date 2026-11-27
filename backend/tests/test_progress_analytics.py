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
        logs=[],
    )

    assert result["has_data"] is False
    assert result["total_sessions"] == 0
    assert result["weeks"][0][0]["future"] is False
    assert result["weeks"][0][1]["future"] is True
    assert result["weeks"][0][1]["sets"] == 0



# In-progress exercise logs remain visible even though completed-session count is zero.
def test_progress_heatmap_shows_logged_sets_even_before_session_completion():
    result = _build_volume_heatmap(
        weeks=1,
        today=date(2026, 11, 23),  # Monday
        sessions=[
            {"session_date": "2026-11-23", "total_volume_kg": 0, "completed": False},
        ],
        logs=[
            {"logged_at": "2026-11-23T08:00:00Z", "is_warmup": False},
            {"logged_at": "2026-11-23T08:02:00Z", "is_warmup": True},
        ],
    )

    monday = result["weeks"][0][0]
    assert result["has_data"] is True
    assert result["total_sessions"] == 0
    assert monday["sets"] == 1
    assert monday["has_session"] is False
    assert monday["session_count"] == 0
    assert monday["volume_kg"] == 0


def test_progress_agent_weight_window_uses_explicit_athlete_local_date(monkeypatch):
    from datetime import date
    from types import SimpleNamespace

    from agents import progress_agent

    captured = {}

    class Query:
        def select(self, _fields):
            return self
        def eq(self, key, value):
            captured[key] = value
            return self
        def gte(self, key, value):
            captured[key] = value
            return self
        @property
        def not_(self):
            return self
        def is_(self, key, value):
            captured[key] = value
            return self
        def order(self, key):
            captured["order"] = key
            return self
        def execute(self):
            return SimpleNamespace(data=[])

    class Supabase:
        def table(self, name):
            captured["table"] = name
            return Query()

    monkeypatch.setattr(progress_agent, "get_supabase", lambda: Supabase())
    rows = progress_agent._recent_weights(
        "athlete-1",
        10,
        target_date=date(2026, 11, 28),
    )
    assert rows == []
    assert captured["gte"] == "2026-11-18"


def test_progress_agent_keeps_server_today_default_for_legacy_callers(monkeypatch):
    from datetime import date
    from types import SimpleNamespace

    from agents import progress_agent

    captured = {}

    class Query:
        def select(self, _fields): return self
        def eq(self, key, value): return self
        def gte(self, key, value): captured["cutoff"] = value; return self
        @property
        def not_(self): return self
        def is_(self, key, value): return self
        def order(self, key): return self
        def execute(self): return SimpleNamespace(data=[])

    class Supabase:
        def table(self, name): return Query()

    monkeypatch.setattr(progress_agent, "get_supabase", lambda: Supabase())
    progress_agent._recent_weights("athlete-1", 10)
    assert captured["cutoff"] == str(date.today() - __import__("datetime").timedelta(days=10))
