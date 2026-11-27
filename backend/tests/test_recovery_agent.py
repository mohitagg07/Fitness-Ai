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
