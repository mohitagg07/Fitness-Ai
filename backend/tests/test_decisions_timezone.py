from datetime import date
from types import SimpleNamespace

import pytest

from api.routes import decisions
from services.timezone import local_today


@pytest.mark.asyncio
async def test_save_today_decision_uses_local_date_for_idempotency(monkeypatch):
    captured = {}

    class Query:
        def select(self, fields):
            captured["fields"] = fields
            return self
        def eq(self, key, value):
            if key == "decision_date":
                captured["decision_date"] = value
            return self
        def limit(self, _value):
            return self
        def execute(self):
            return SimpleNamespace(data=[{
                "id": "existing-1",
                "decision": "Rest Day",
                "confidence_pct": 80,
            }])

    class Supabase:
        def table(self, name):
            captured["table"] = name
            return Query()

    monkeypatch.setattr(decisions, "get_supabase", lambda: Supabase())
    response = await decisions.save_today_decision(
        "Asia/Kolkata",
        {"user_id": "athlete-1"},
    )

    assert response["reason"] == "already_saved_today"
    assert captured["table"] == "ai_decisions"
    assert captured["decision_date"] == str(local_today("Asia/Kolkata"))


@pytest.mark.asyncio
async def test_save_today_decision_passes_local_date_into_decision_engine(monkeypatch):
    captured = {}
    local_day = local_today("Asia/Kolkata")

    class Query:
        def select(self, _fields): return self
        def eq(self, key, value):
            if key == "decision_date":
                captured["decision_date"] = value
            return self
        def limit(self, _value): return self
        def insert(self, values):
            captured["inserted"] = values
            return self
        def execute(self):
            return SimpleNamespace(data=[])

    class Supabase:
        def table(self, _name): return Query()

    async def fake_to_thread(func, *args):
        if func is decisions.build_decision_center:
            captured["engine_date"] = args[2]
            return SimpleNamespace(
                decision="Rest Day",
                confidence_pct=0,
                reasoning="insufficient data",
                expected_outcome=None,
                alternative=None,
                signals=[],
                why_not=[],
            )
        return {"goal": "maintain"}, {}

    monkeypatch.setattr(decisions, "get_supabase", lambda: Supabase())
    monkeypatch.setattr(decisions.asyncio, "to_thread", fake_to_thread)
    async def load_context(_user_id):
        return {"goal": "maintain"}, {}
    import db.supabase_client
    monkeypatch.setattr(db.supabase_client, "get_full_user_context", load_context)

    response = await decisions.save_today_decision(
        "Asia/Kolkata",
        {"user_id": "athlete-1"},
    )

    assert response["saved"] is True
    assert captured["decision_date"] == str(local_day)
    assert captured["engine_date"] == local_day
    assert captured["inserted"]["decision_date"] == str(local_day)
