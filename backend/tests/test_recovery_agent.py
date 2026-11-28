from datetime import date
from types import SimpleNamespace

from agents import recovery_agent


def test_missing_sleep_volume_nutrition_rpe_and_cns_remain_unavailable():
    assert recovery_agent._sleep_component(None) is None
    assert recovery_agent._volume_component(None) is None
    assert recovery_agent._nutrition_component(None, None) is None
    assert recovery_agent._rpe_component(None) is None
    assert recovery_agent._cns_component(None) is None


def test_zero_volume_is_distinct_from_missing_training_history():
    assert recovery_agent._volume_component(None) is None
    assert recovery_agent._volume_component(0) == 20


def test_nutrition_without_logged_entries_is_unavailable(monkeypatch):
    class Query:
        def select(self, *_args, **_kwargs): return self
        def eq(self, *_args): return self
        def execute(self): return SimpleNamespace(data=[])

    class Supabase:
        def table(self, _name): return Query()

    monkeypatch.setattr(recovery_agent, "get_supabase", lambda: Supabase())
    assert recovery_agent._nutrition_ratios_today("u1", 140, 2400) == (None, None)


def test_readiness_does_not_claim_recovery_when_all_sources_are_missing(monkeypatch):
    class Query:
        def __init__(self, table): self.table = table
        def select(self, *_args, **_kwargs): return self
        def eq(self, *_args): return self
        def gte(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def execute(self): return SimpleNamespace(data=[], count=0)

    class Supabase:
        def table(self, name): return Query(name)

    monkeypatch.setattr(recovery_agent, "get_supabase", lambda: Supabase())
    result = recovery_agent.run_recovery_agent(
        "u1", sleep_hours=None, protein_target_g=140, calorie_target=2400
    )

    assert result.action == "check_in"
    assert result.__dict__["score_pct"] is None
    assert result.__dict__["data_completeness_pct"] == 0
    assert set(result.__dict__["missing_signals"]) == {
        "sleep", "soreness", "energy", "volume", "nutrition", "rpe", "cns"
    }
    assert "approved plan unchanged" in result.message


def test_decision_center_uses_only_dated_recovery_checkin_inputs() -> None:
    from agents.decision_engine import _daily_recovery_evidence

    missing = _daily_recovery_evidence(None)
    assert [signal.value for signal in missing] == [
        "Not reported", "Not reported", "Not reported"
    ]
    assert all(signal.weight == 0 for signal in missing)
    assert all(not signal.favorable for signal in missing)

    reported = _daily_recovery_evidence({
        "sleep_hours": 7.5,
        "soreness_level": 2,
        "energy_level": 4,
    })
    assert [signal.value for signal in reported] == ["7.5h", "2/5", "4/5"]
    # The Recovery aggregate already includes these values; detail rows are
    # display-only and must not add the same measurements to confidence twice.
    assert [signal.weight for signal in reported] == [0.0, 0.0, 0.0]
    assert all(signal.favorable for signal in reported)


def test_decision_center_coverage_uses_recovery_agents_weighted_completeness():
    from types import SimpleNamespace
    from agents.decision_engine import _recovery_data_coverage

    assert _recovery_data_coverage(SimpleNamespace(data_completeness_pct=60)) == 60
    assert _recovery_data_coverage(SimpleNamespace(data_completeness_pct=85.4)) == 85
    assert _recovery_data_coverage(SimpleNamespace(data_completeness_pct=None)) == 0
    assert _recovery_data_coverage(SimpleNamespace(data_completeness_pct=140)) == 100
    assert _recovery_data_coverage(SimpleNamespace(data_completeness_pct=-5)) == 0



def test_recent_sharp_pain_overrides_a_favourable_readiness_score(monkeypatch):
    monkeypatch.setattr(
        recovery_agent,
        "_today_recovery_checkin",
        lambda _user_id, _target_date: {
            "sleep_hours": 8,
            "soreness_level": 1,
            "energy_level": 5,
        },
    )
    monkeypatch.setattr(recovery_agent, "_last_session_volume", lambda _user_id: 2500)
    monkeypatch.setattr(
        recovery_agent,
        "_nutrition_ratios_today",
        lambda *_args: (1.0, 1.0),
    )
    monkeypatch.setattr(
        recovery_agent,
        "_recent_rpe_stats",
        lambda *_args: (6.0, 0),
    )
    monkeypatch.setattr(recovery_agent, "_last_explicit_cns_fatigue", lambda _user_id: 1)
    monkeypatch.setattr(recovery_agent, "_latest_post_session_feedback", lambda *_args: None)
    monkeypatch.setattr(
        recovery_agent,
        "_latest_reported_session_pain",
        lambda *_args: {
            "status": "sharp",
            "notes": "Pain during shoulder press",
            "session_date": "2026-11-28",
            "source": "post_workout_checkin",
        },
    )

    result = recovery_agent.run_recovery_agent(
        "u1",
        sleep_hours=None,
        planned_workout_type="push",
        protein_target_g=140,
        calorie_target=2400,
        target_date=date(2026, 11, 28),
    )

    assert result.action == "pain_review"
    assert result.score_pct is not None
    assert "sharp pain" in result.message
    assert "shoulder press" in result.message
    assert "approved plan unchanged" in result.message.lower()
    assert result.pain_signal["source"] == "post_workout_checkin"


def test_latest_explicit_no_pain_report_clears_older_sharp_report(monkeypatch):
    class Query:
        def select(self, *_args, **_kwargs): return self
        def eq(self, *_args): return self
        def gte(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def execute(self):
            return SimpleNamespace(data=[
                {
                    "pain_status": "none",
                    "pain_notes": None,
                    "session_date": "2026-11-28",
                    "finished_at": "2026-11-28T13:00:00+00:00",
                },
                {
                    "pain_status": "sharp",
                    "pain_notes": "Old shoulder pain",
                    "session_date": "2026-11-26",
                    "finished_at": "2026-11-26T13:00:00+00:00",
                },
            ])

    class Supabase:
        def table(self, _name): return Query()

    monkeypatch.setattr(recovery_agent, "get_supabase", lambda: Supabase())
    result = recovery_agent._latest_reported_session_pain(
        "u1", date(2026, 11, 28)
    )

    assert result["status"] == "none"
    assert result["session_date"] == "2026-11-28"



def test_recent_post_workout_energy_and_effort_feed_next_recovery_estimate(monkeypatch):
    monkeypatch.setattr(
        recovery_agent,
        "_today_recovery_checkin",
        lambda _user_id, _target_date: {
            "sleep_hours": 7.5,
            "soreness_level": 2,
            "energy_level": None,
        },
    )
    monkeypatch.setattr(recovery_agent, "_latest_post_session_feedback", lambda *_args: {
        "session_date": "2026-11-28",
        "session_effort": 9,
        "energy_level": 2,
        "cns_fatigue_after": 7,
    })
    monkeypatch.setattr(recovery_agent, "_last_session_volume", lambda _user_id: 4200)
    monkeypatch.setattr(recovery_agent, "_nutrition_ratios_today", lambda *_args: (0.8, 0.9))
    monkeypatch.setattr(recovery_agent, "_recent_rpe_stats", lambda *_args: (6.0, 0))
    monkeypatch.setattr(recovery_agent, "_last_explicit_cns_fatigue", lambda _user_id: 7)
    monkeypatch.setattr(recovery_agent, "_latest_reported_session_pain", lambda *_args: None)

    result = recovery_agent.run_recovery_agent(
        "u1",
        sleep_hours=None,
        planned_workout_type="pull",
        protein_target_g=140,
        calorie_target=2400,
        target_date=date(2026, 11, 28),
    )

    assert result.source_values["energy_level"] == 2
    assert result.source_values["energy_source"] == "recent_post_workout_checkin"
    assert result.source_values["latest_post_session_effort"] == 9
    assert result.source_values["recent_average_rpe"] == 7.5
    assert result.source_values["recent_high_rpe_days"] == 1
    assert result.data_completeness_pct >= 60


def test_latest_post_workout_feedback_returns_only_explicit_completed_session_data(monkeypatch):
    class Query:
        def select(self, *_args, **_kwargs): return self
        def eq(self, *_args): return self
        def gte(self, *_args): return self
        def lte(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def execute(self):
            return SimpleNamespace(data=[
                {
                    "session_date": "2026-11-28",
                    "session_effort": None,
                    "energy_level": None,
                    "cns_fatigue_after": None,
                },
                {
                    "session_date": "2026-11-27",
                    "session_effort": 8,
                    "energy_level": 3,
                    "cns_fatigue_after": None,
                },
            ])

    class Supabase:
        def table(self, _name): return Query()

    monkeypatch.setattr(recovery_agent, "get_supabase", lambda: Supabase())
    result = recovery_agent._latest_post_session_feedback(
        "u1", date(2026, 11, 28)
    )

    assert result["session_date"] == "2026-11-27"
    assert result["session_effort"] == 8
    assert result["energy_level"] == 3
