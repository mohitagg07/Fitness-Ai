"""Fast, offline smoke checks for the VYRN FastAPI app.

These tests deliberately do not enter the ASGI lifespan: that startup path
seeds ChromaDB and starts the scheduler, which belong in a deployment smoke
test with a configured persistent data directory.
"""
from fastapi.routing import APIRoute
import pytest
from pydantic import ValidationError

from main import app
from api.routes.workouts import SetLogRequest
from schemas.models import SetLog


def _registered_routes() -> set[tuple[str, str]]:
    return {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in (route.methods or set())
    }


def test_health_and_core_routes_are_registered() -> None:
    routes = _registered_routes()
    expected = {
        ("GET", "/health"),
        ("HEAD", "/health"),
        ("POST", "/api/auth/login"),
        ("GET", "/api/profile/me"),
        ("POST", "/api/profile/onboard"),
        ("POST", "/api/workouts/sessions"),
        ("POST", "/api/workouts/sessions/{session_id}/logs"),
        ("POST", "/api/coach/chat"),
        ("GET", "/api/mission/today"),
        ("GET", "/api/dashboard/summary"),
    }
    assert expected <= routes


def test_health_handler_is_independent_of_external_services() -> None:
    health_route = next(
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path == "/health"
        and "GET" in (route.methods or set())
    )
    assert health_route.endpoint() == {"status": "ok"}


def test_bodyweight_set_is_valid_in_api_and_shared_schema() -> None:
    api_payload = SetLogRequest(
        exercise_name="Push Up",
        weight_kg=0,
        reps=12,
    )
    shared_payload = SetLog(
        exercise_name="Push Up",
        set_number=1,
        weight_kg=0,
        reps=12,
    )
    assert api_payload.weight_kg == 0
    assert shared_payload.weight_kg == 0


@pytest.mark.parametrize("payload_factory", [SetLogRequest, SetLog])
def test_negative_external_load_is_rejected(payload_factory) -> None:
    values = {
        "exercise_name": "Push Up",
        "weight_kg": -1,
        "reps": 12,
    }
    if payload_factory is SetLog:
        values["set_number"] = 1
    with pytest.raises(ValidationError):
        payload_factory(**values)

def test_personal_records_are_compared_per_exercise_and_rep_count() -> None:
    from services.pr_validator import find_new_personal_records

    existing = [
        {"exercise_name": "Bench Press", "weight_kg": 100, "reps": 1},
        {"exercise_name": "Bench Press", "weight_kg": 80, "reps": 5},
    ]
    session = [
        {"exercise_name": "Bench Press", "weight_kg": 102.5, "reps": 1},
        {"exercise_name": "Bench Press", "weight_kg": 82.5, "reps": 5},
        {"exercise_name": "Bench Press", "weight_kg": 100, "reps": 1},
    ]

    records = find_new_personal_records(session, existing)

    assert records == [
        {
            "exercise_name": "Bench Press",
            "weight_kg": 102.5,
            "reps": 1,
            "previous_pr_kg": 100.0,
        },
        {
            "exercise_name": "Bench Press",
            "weight_kg": 82.5,
            "reps": 5,
            "previous_pr_kg": 80.0,
        },
    ]


def test_personal_record_helper_ignores_bodyweight_and_invalid_rows() -> None:
    from services.pr_validator import find_new_personal_records

    records = find_new_personal_records(
        [
            {"exercise_name": "Push Up", "weight_kg": 0, "reps": 15},
            {"exercise_name": "Bench Press", "weight_kg": 60, "reps": 0},
            {"exercise_name": "Squat", "weight_kg": 100, "reps": 5},
            {"exercise_name": "Squat", "weight_kg": 90, "reps": 5},
        ],
        [],
    )

    assert records == [
        {
            "exercise_name": "Squat",
            "weight_kg": 100.0,
            "reps": 5,
            "previous_pr_kg": None,
        }
    ]




def test_secret_key_must_be_random_and_at_least_32_characters() -> None:
    from core.config import validate_secret_key

    assert validate_secret_key("a" * 64) == "a" * 64
    with pytest.raises(RuntimeError):
        validate_secret_key("")
    with pytest.raises(RuntimeError):
        validate_secret_key("too-short")
    with pytest.raises(RuntimeError):
        validate_secret_key("dev-secret-key-change-in-production")


def test_global_admin_dependency_denies_regular_user(monkeypatch) -> None:
    from types import SimpleNamespace
    from fastapi import HTTPException
    from core import security

    class Query:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            return SimpleNamespace(data={"app_role": "user"})

    class Supabase:
        def table(self, _name):
            return Query()

    monkeypatch.setattr(security, "get_supabase", lambda: Supabase())

    with pytest.raises(HTTPException) as exc:
        security.require_admin_user({"user_id": "user-123"})
    assert exc.value.status_code == 403


def test_global_admin_dependency_allows_database_admin(monkeypatch) -> None:
    from types import SimpleNamespace
    from core import security

    class Query:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            return SimpleNamespace(data={"app_role": "admin"})

    class Supabase:
        def table(self, _name):
            return Query()

    monkeypatch.setattr(security, "get_supabase", lambda: Supabase())
    user = {"user_id": "admin-123", "email": "admin@example.test"}

    assert security.require_admin_user(user) is user


def test_global_admin_dependency_fails_closed_before_role_migration(monkeypatch) -> None:
    from core import security
    from fastapi import HTTPException

    class MissingColumn(Exception):
        code = "42703"

    class Query:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            raise MissingColumn("column profiles.app_role does not exist")

    class Supabase:
        def table(self, _name):
            return Query()

    monkeypatch.setattr(security, "get_supabase", lambda: Supabase())

    with pytest.raises(HTTPException) as exc:
        security.require_admin_user({"user_id": "user-123"})
    assert exc.value.status_code == 503
