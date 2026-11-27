import pytest
from fastapi import HTTPException
from types import SimpleNamespace

from api.routes import workouts
from api.routes.workouts import SessionExerciseEventRequest


class _Query:
    def __init__(self, table, filters, existing_event):
        self.table_name = table
        self.filters = filters
        self.existing_event = existing_event

    def select(self, _fields):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, _value):
        return self

    def execute(self):
        if self.table_name == "workout_sessions":
            return SimpleNamespace(data=[{
                "id": "session-1",
                "status": "completed",
                "completed": True,
                "planned_workout_snapshot": {"exercises": [{"name": "Bench Press"}]},
                "workout_type": "push",
            }])
        if self.table_name == "workout_session_exercise_events":
            if self.filters.get("client_request_id") == self.existing_event["client_request_id"]:
                return SimpleNamespace(data=[self.existing_event])
            return SimpleNamespace(data=[])
        raise AssertionError(f"Unexpected table: {self.table_name}")


class _Supabase:
    def __init__(self, existing_event):
        self.existing_event = existing_event

    def table(self, name):
        return _Query(name, {}, self.existing_event)


@pytest.mark.asyncio
async def test_exercise_event_retry_returns_original_event_after_session_completion(monkeypatch):
    existing = {
        "id": "event-1",
        "session_id": "session-1",
        "user_id": "athlete-1",
        "action": "replace",
        "exercise_name": "Bench Press",
        "replacement_exercise": "Dumbbell Bench Press",
        "client_request_id": "session-1:replace:bench press:dumbbell bench press",
        "reason": "Shoulder comfort",
    }
    monkeypatch.setattr(workouts, "get_supabase", lambda: _Supabase(existing))
    payload = SessionExerciseEventRequest(
        action="replace",
        exercise_name="Bench Press",
        replacement_exercise="Dumbbell Bench Press",
        client_request_id=existing["client_request_id"],
        reason="Shoulder comfort",
    )

    response = await workouts.record_session_exercise_event(
        "session-1",
        payload,
        {"user_id": "athlete-1"},
    )

    assert response == existing


@pytest.mark.asyncio
async def test_exercise_event_request_id_cannot_be_reused_for_a_different_choice(monkeypatch):
    existing = {
        "id": "event-1",
        "session_id": "session-1",
        "user_id": "athlete-1",
        "action": "skip",
        "exercise_name": "Bench Press",
        "replacement_exercise": None,
        "client_request_id": "session-1:skip:bench press",
        "reason": None,
    }
    monkeypatch.setattr(workouts, "get_supabase", lambda: _Supabase(existing))
    payload = SessionExerciseEventRequest(
        action="replace",
        exercise_name="Bench Press",
        replacement_exercise="Dumbbell Bench Press",
        client_request_id=existing["client_request_id"],
    )

    with pytest.raises(HTTPException) as error:
        await workouts.record_session_exercise_event(
            "session-1",
            payload,
            {"user_id": "athlete-1"},
        )

    assert error.value.status_code == 409
    assert "already used" in error.value.detail
