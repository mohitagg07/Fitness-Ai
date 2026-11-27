from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api.routes import recovery
from services.timezone import local_today


def test_recovery_checkin_payload_requires_at_least_one_field():
    assert recovery.RecoveryCheckInRequest(sleep_hours=7.5).sleep_hours == 7.5
    with pytest.raises(ValidationError):
        recovery.RecoveryCheckInRequest()


@pytest.mark.asyncio
async def test_get_recovery_checkin_is_scoped_to_user_and_local_date(monkeypatch):
    captured = {}

    class Query:
        def select(self, fields):
            captured["fields"] = fields
            return self
        def eq(self, key, value):
            captured[key] = value
            return self
        def limit(self, value):
            captured["limit"] = value
            return self
        def execute(self):
            return SimpleNamespace(data=[{"sleep_hours": 7.5}])

    class Supabase:
        def table(self, name):
            captured["table"] = name
            return Query()

    monkeypatch.setattr(recovery, "get_supabase", lambda: Supabase())
    result = await recovery.get_today_recovery_checkin(
        "Asia/Kolkata", {"user_id": "athlete-1"}
    )
    assert result["check_in"]["sleep_hours"] == 7.5
    assert captured["table"] == "recovery_checkins"
    assert captured["user_id"] == "athlete-1"
    assert captured["local_date"] == str(local_today("Asia/Kolkata"))


@pytest.mark.asyncio
async def test_save_recovery_checkin_upserts_by_athlete_and_local_day(monkeypatch):
    captured = {}

    class Query:
        def upsert(self, values, on_conflict):
            captured["values"] = values
            captured["on_conflict"] = on_conflict
            return self
        def execute(self):
            return SimpleNamespace(data=[captured["values"]])

    class Supabase:
        def table(self, name):
            captured["table"] = name
            return Query()

    monkeypatch.setattr(recovery, "get_supabase", lambda: Supabase())
    payload = recovery.RecoveryCheckInRequest(
        sleep_hours=7.5, soreness_level=2, energy_level=4
    )
    result = await recovery.save_today_recovery_checkin(
        payload, "Asia/Kolkata", {"user_id": "athlete-1"}
    )
    assert result["check_in"]["sleep_hours"] == 7.5
    assert captured["table"] == "recovery_checkins"
    assert captured["on_conflict"] == "user_id,local_date"
    assert captured["values"]["user_id"] == "athlete-1"
    assert captured["values"]["local_date"] == str(local_today("Asia/Kolkata"))


def test_recovery_checkin_fails_closed_when_migration_is_not_applied(monkeypatch):
    class BrokenSupabase:
        def table(self, _name):
            raise RuntimeError("relation recovery_checkins does not exist")

    monkeypatch.setattr(recovery, "get_supabase", lambda: BrokenSupabase())
    with pytest.raises(HTTPException) as error:
        import asyncio
        asyncio.run(recovery.get_today_recovery_checkin("UTC", {"user_id": "u1"}))
    assert error.value.status_code == 503
