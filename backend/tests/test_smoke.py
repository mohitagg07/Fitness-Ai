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
