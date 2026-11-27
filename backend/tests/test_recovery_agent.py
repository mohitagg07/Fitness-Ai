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
        "sleep", "volume", "nutrition", "rpe", "cns"
    }
    assert "approved plan unchanged" in result.message
