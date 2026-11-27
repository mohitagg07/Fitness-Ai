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
        ("PATCH", "/api/workouts/sessions/{session_id}/state"),
        ("GET", "/api/training-plans/active"),
        ("POST", "/api/training-plans/drafts"),
        ("GET", "/api/training-plans/{plan_id}/versions"),
        ("POST", "/api/program/propose-rewrite"),
        ("GET", "/api/recovery/check-in/today"),
        ("PUT", "/api/recovery/check-in/today"),
        ("POST", "/api/workouts/sessions/{session_id}/logs"),
        ("POST", "/api/coach/chat"),
        ("POST", "/api/nutrition/estimate"),
        ("GET", "/api/mission/today"),
        ("GET", "/api/dashboard/summary"),
    }
    assert expected <= routes


def test_food_estimate_request_validates_food_and_portion() -> None:
    from api.routes.nutrition import FoodEstimateRequest

    payload = FoodEstimateRequest(
        food_name="Paneer pakoda",
        portion="2 medium pieces",
        preparation="Homemade, deep fried",
    )
    assert payload.food_name == "Paneer pakoda"
    assert payload.portion == "2 medium pieces"

    with pytest.raises(ValidationError):
        FoodEstimateRequest(food_name="P", portion="")

 
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


def test_metrics_create_accepts_recovery_scores_on_0_to_100_scale() -> None:
    from schemas.models import MetricsCreate

    assert MetricsCreate(recovery_score=0).recovery_score == 0
    assert MetricsCreate(recovery_score=100).recovery_score == 100
    assert MetricsCreate(weight_kg=72.5).recovery_score is None


@pytest.mark.parametrize("score", [-0.1, 100.1])
def test_metrics_create_rejects_recovery_scores_outside_range(score) -> None:
    from schemas.models import MetricsCreate

    with pytest.raises(ValidationError):
        MetricsCreate(recovery_score=score)


def test_recovery_average_ignores_null_invalid_and_non_finite_values() -> None:
    from services.recovery_metrics import average_recovery_score_pct

    assert average_recovery_score_pct([
        {"recovery_score": 70},
        {"recovery_score": 80},
        {"recovery_score": None},
        {"recovery_score": "invalid"},
        {"recovery_score": float("nan")},
        {"recovery_score": 120},
    ]) == 75.0


def test_recovery_average_returns_none_when_no_valid_measurements_exist() -> None:
    from services.recovery_metrics import average_recovery_score_pct

    assert average_recovery_score_pct([
        {"recovery_score": None},
        {"recovery_score": "not-a-number"},
        {"recovery_score": -1},
    ]) is None


def test_pattern_pr_lookup_uses_achieved_at_and_keeps_latest_rep_record(monkeypatch) -> None:
    from types import SimpleNamespace
    from agents import pattern_engine

    class Query:
        def select(self, fields):
            self.fields = fields
            return self

        def eq(self, *_args):
            return self

        def execute(self):
            assert "achieved_at" in self.fields
            assert "set_at" not in self.fields
            return SimpleNamespace(data=[
                {"exercise_name": "Bench Press", "weight_kg": 100, "reps": 1, "achieved_at": "2026-01-01"},
                {"exercise_name": "Bench Press", "weight_kg": 80, "reps": 5, "achieved_at": "2026-02-01"},
                {"exercise_name": "Squat", "weight_kg": 140, "reps": 1, "achieved_at": "2026-01-15"},
            ])

    class Supabase:
        def table(self, table_name):
            assert table_name == "personal_records"
            return Query()

    monkeypatch.setattr(pattern_engine, "get_supabase", lambda: Supabase())
    records = pattern_engine._get_prs("user-123")

    assert records["Bench Press"]["reps"] == 5
    assert records["Bench Press"]["achieved_at"] == "2026-02-01"
    assert records["Squat"]["weight_kg"] == 140


def test_pr_opportunity_detector_is_registered_and_returns_insight(monkeypatch) -> None:
    from agents import pattern_engine

    monkeypatch.setattr(
        pattern_engine,
        "get_agent_state",
        lambda _user_id: {"cns_fatigue_score": 1, "workout_streak": 4},
    )
    monkeypatch.setattr(
        pattern_engine,
        "_get_prs",
        lambda _user_id: {"Bench Press": {"weight_kg": 100, "reps": 1}},
    )

    insights = pattern_engine.detect_pr_opportunity("user-123")

    assert len(insights) == 1
    assert insights[0].category == "pr_opportunity"


def test_training_load_excludes_warmup_sets(monkeypatch) -> None:
    from types import SimpleNamespace
    from services import training_load_engine

    class Query:
        def select(self, fields):
            assert "is_warmup" in fields
            return self

        def eq(self, *_args):
            return self

        def gte(self, *_args):
            return self

        def execute(self):
            return SimpleNamespace(data=[
                {"exercise_name": "Squat", "weight_kg": 100, "reps": 5, "rpe": 7, "logged_at": "2026-02-01T10:00:00Z", "is_warmup": False},
                {"exercise_name": "Squat", "weight_kg": 60, "reps": 5, "rpe": 4, "logged_at": "2026-02-01T09:50:00Z", "is_warmup": True},
            ])

    class Supabase:
        def table(self, table_name):
            assert table_name == "exercise_logs"
            return Query()

    monkeypatch.setattr(training_load_engine, "get_supabase", lambda: Supabase())
    logs = training_load_engine._get_logs("user-123", "2026-02-01")

    assert len(logs) == 1
    assert logs[0]["weight_kg"] == 100


def test_training_day_resolver_uses_explicit_plan_days() -> None:
    from datetime import date
    from services.nutrition import resolve_training_day_from_schedule

    schedule = {
        "mon": "push",
        "tue": "REST",
        "wed": "legs",
        "thu": None,
    }
    assert resolve_training_day_from_schedule(schedule, date(2026, 11, 23)) is True
    assert resolve_training_day_from_schedule(schedule, date(2026, 11, 24)) is False
    assert resolve_training_day_from_schedule(schedule, date(2026, 11, 25)) is True
    assert resolve_training_day_from_schedule(schedule, date(2026, 11, 26)) is False


def test_training_day_resolver_returns_none_when_schedule_does_not_define_day() -> None:
    from datetime import date
    from services.nutrition import resolve_training_day_from_schedule

    assert resolve_training_day_from_schedule({"mon": "push"}, date(2026, 11, 24)) is None


def test_weekly_review_cache_requires_recent_timestamp() -> None:
    from datetime import datetime, timedelta, timezone
    from api.routes.review import _is_weekly_cache_fresh

    now = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)
    assert _is_weekly_cache_fresh((now - timedelta(minutes=5)).isoformat(), now)
    assert not _is_weekly_cache_fresh((now - timedelta(minutes=20)).isoformat(), now)
    assert not _is_weekly_cache_fresh((now + timedelta(minutes=10)).isoformat(), now)
    assert not _is_weekly_cache_fresh(None, now)


@pytest.mark.asyncio
async def test_missing_owned_mutations_return_404(monkeypatch) -> None:
    from types import SimpleNamespace
    from fastapi import HTTPException
    from api.routes import bodyweight, decisions, notifications, profile

    class EmptyMutationQuery:
        def delete(self):
            return self

        def update(self, _data):
            return self

        def eq(self, *_args):
            return self

        def select(self, _fields):
            return self

        def execute(self):
            return SimpleNamespace(data=[])

    class Supabase:
        def table(self, _table):
            return EmptyMutationQuery()

    fake_supabase = Supabase()
    monkeypatch.setattr(bodyweight, "get_supabase", lambda: fake_supabase)
    monkeypatch.setattr(profile, "get_supabase", lambda: fake_supabase)
    monkeypatch.setattr(decisions, "get_supabase", lambda: fake_supabase)
    monkeypatch.setattr(notifications, "get_supabase", lambda: fake_supabase)

    cases = [
        bodyweight.delete_weight_entry("missing-weight", {"user_id": "u1"}),
        profile.delete_injury("missing-injury", {"user_id": "u1"}),
        decisions.update_outcome(
            "missing-decision",
            decisions.OutcomeUpdate(outcome="correct"),
            {"user_id": "u1"},
        ),
        notifications.mark_read("missing-notification", {"user_id": "u1"}),
    ]
    for case in cases:
        with pytest.raises(HTTPException) as exc:
            await case
        assert exc.value.status_code == 404


def test_coach_style_instructions_cover_every_supported_style() -> None:
    from agents.coach_agent import get_coach_style_instruction
    from schemas.models import CoachStyle

    for style in CoachStyle:
        instruction = get_coach_style_instruction(style.value)
        assert isinstance(instruction, str)
        assert len(instruction) > 30

    assert "non-judgmental" in get_coach_style_instruction("supportive")
    assert "measured data" in get_coach_style_instruction("scientific")
    assert get_coach_style_instruction("unknown") == get_coach_style_instruction("friendly")


def test_scheduler_is_disabled_by_default() -> None:
    from core.config import Settings

    assert Settings().scheduler_enabled is False


def test_scheduler_worker_requires_explicit_enablement() -> None:
    from core.config import Settings
    from worker import _require_scheduler_enabled

    with pytest.raises(RuntimeError):
        _require_scheduler_enabled(Settings(scheduler_enabled=False))
    _require_scheduler_enabled(Settings(scheduler_enabled=True))


def test_log_set_rpc_params_include_server_user_and_session_without_client_set_number() -> None:
    from api.routes.workouts import SetLogRequest, build_log_set_rpc_params

    payload = SetLogRequest(
        exercise_name="  Bench Press  ",
        weight_kg=80,
        reps=8,
        rpe=8,
        equipment_modifiers=["barbell"],
        is_warmup=False,
        is_dropset=True,
        superset_group="superset-a",
        tempo="3-1-1-0",
        to_failure=False,
        set_notes="Controlled eccentric",
    )
    params = build_log_set_rpc_params(
        session_id="session-123",
        user_id="user-456",
        payload=payload,
    )

    assert params["p_session_id"] == "session-123"
    assert params["p_user_id"] == "user-456"
    assert params["p_exercise_name"] == "Bench Press"
    assert params["p_set"]["weight_kg"] == 80
    assert params["p_set"]["reps"] == 8
    assert params["p_set"]["is_dropset"] is True
    assert "set_number" not in params["p_set"]


def test_log_set_rejects_blank_exercise_name() -> None:
    from api.routes.workouts import SetLogRequest

    with pytest.raises(ValidationError):
        SetLogRequest(exercise_name="   ", weight_kg=40, reps=8)


def test_scenario_request_enforces_supported_time_horizon() -> None:
    from pydantic import ValidationError
    from api.routes.simulate import ScenarioRequest

    assert ScenarioRequest(scenario_id="protein", weeks=1).weeks == 1
    assert ScenarioRequest(scenario_id="sleep", weeks=12).weeks == 12
    with pytest.raises(ValidationError):
        ScenarioRequest(scenario_id="protein", weeks=0)
    with pytest.raises(ValidationError):
        ScenarioRequest(scenario_id="protein", weeks=13)


def test_muscle_recovery_map_returns_real_recent_workload_and_ignores_warmups() -> None:
    from datetime import datetime, timezone
    from services.training_load_engine import build_muscle_recovery_map_from_logs

    now = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)
    result = build_muscle_recovery_map_from_logs(
        [
            {"exercise_name": "Bench Press", "weight_kg": 80, "reps": 8, "is_warmup": False, "logged_at": "2026-11-27T10:00:00Z"},
            {"exercise_name": "Cable Fly", "weight_kg": 30, "reps": 10, "is_warmup": False, "logged_at": "2026-11-26T10:00:00Z"},
            {"exercise_name": "Bench Press", "weight_kg": 40, "reps": 10, "is_warmup": True, "logged_at": "2026-11-27T09:00:00Z"},
            {"exercise_name": "Squat", "weight_kg": 100, "reps": 5, "is_warmup": False, "logged_at": "2026-11-10T10:00:00Z"},
        ],
        now,
    )

    chest = next(group for group in result["muscle_groups"] if group["name"] == "Chest")
    legs = next(group for group in result["muscle_groups"] if group["name"] == "Legs")
    back = next(group for group in result["muscle_groups"] if group["name"] == "Back")

    assert chest["working_sets_7d"] == 2
    assert chest["volume_7d_kg"] == 940.0
    assert chest["exercises_7d"] == ["Bench Press", "Cable Fly"]
    assert chest["hours_since_trained"] == 2.0
    assert legs["working_sets_7d"] == 0
    assert legs["status"] == "green"
    assert legs["recovery_pct"] == 100
    assert back["recovery_pct"] is None
    assert result["has_data"] is True


def test_muscle_recovery_map_treats_naive_timestamps_as_utc() -> None:
    from datetime import datetime, timezone
    from services.training_load_engine import build_muscle_recovery_map_from_logs

    result = build_muscle_recovery_map_from_logs(
        [{
            "exercise_name": "Lat Pulldown",
            "weight_kg": 50,
            "reps": 10,
            "is_warmup": False,
            "logged_at": "2026-11-27T10:00:00",
        }],
        datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc),
    )
    back = next(group for group in result["muscle_groups"] if group["name"] == "Back")
    assert back["hours_since_trained"] == 2.0
    assert back["working_sets_7d"] == 1


def test_coach_prior_messages_only_apply_session_filter_when_explicit(monkeypatch) -> None:
    from types import SimpleNamespace
    from api.routes import coach

    class Query:
        def __init__(self):
            self.filters = []

        def select(self, *_args):
            return self

        def eq(self, key, value):
            self.filters.append(("eq", key, value))
            return self

        def is_(self, key, value):
            self.filters.append(("is", key, value))
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args):
            return self

        def execute(self):
            return SimpleNamespace(data=[{"role": "user", "content": "hello"}])

    class Supabase:
        def __init__(self):
            self.query = Query()

        def table(self, _name):
            return self.query

    fake = Supabase()
    monkeypatch.setattr(coach, "get_supabase", lambda: fake)

    assert coach._load_prior_messages("user-123", session_id=None)
    assert ("eq", "user_id", "user-123") in fake.query.filters
    assert not any(f[1] == "session_id" for f in fake.query.filters)

    fake.query = Query()
    assert coach._load_prior_messages("user-123", session_id="chat-123")
    assert ("eq", "session_id", "chat-123") in fake.query.filters


def test_historical_weekly_review_cache_does_not_require_fresh_timestamp(monkeypatch) -> None:
    from types import SimpleNamespace
    from api.routes import review

    class Query:
        def select(self, *_args):
            return self
        def eq(self, *_args):
            return self
        def limit(self, *_args):
            return self
        def execute(self):
            return SimpleNamespace(data=[{
                "payload": {"consistency_pct": 80},
                "generated_at": "2020-01-01T00:00:00Z",
            }])

    class Supabase:
        def table(self, _name):
            return Query()

    monkeypatch.setattr(review, "get_supabase", lambda: Supabase())

    assert review._read_weekly_cache("u1", "Jan 01 – Jan 07, 2020", require_fresh=False) == {
        "consistency_pct": 80,
        "week_label": "Jan 01 – Jan 07, 2020",
        "generated_at": "2020-01-01T00:00:00Z",
    }
    assert review._read_weekly_cache("u1", "Jan 01 – Jan 07, 2020", require_fresh=True) is None


def test_profile_equipment_is_normalized_to_agent_canonical_keys() -> None:
    from schemas.models import ProfileUpdate

    payload = ProfileUpdate(equipment=[
        "Dumbbells",
        "Resistance Bands",
        "Bodyweight Only",
        "Pull-up Bar",
        "Cable Machine",
        "Smith Machine",
        "Squat Rack",
        "dumbbell",
    ])

    assert payload.equipment == [
        "dumbbell",
        "resistance_bands",
        "bodyweight",
        "pull_up_bar",
        "cable",
        "smith_machine",
        "squat_rack",
    ]
    assert ProfileUpdate(equipment=None).equipment is None


@pytest.mark.asyncio
async def test_complete_session_returns_404_for_missing_or_unowned_session(monkeypatch) -> None:
    from types import SimpleNamespace
    from fastapi import HTTPException
    from api.routes import workouts

    class Query:
        def __init__(self, table):
            self.table_name = table

        def select(self, *_args):
            return self
        def update(self, _data):
            return self
        def eq(self, *_args):
            return self
        def order(self, *_args, **_kwargs):
            return self
        def execute(self):
            return SimpleNamespace(data=[])

    class Supabase:
        def table(self, table_name):
            return Query(table_name)

    monkeypatch.setattr(workouts, "get_supabase", lambda: Supabase())

    with pytest.raises(HTTPException) as exc:
        await workouts.complete_session(
            "session-not-owned",
            current_user={"user_id": "user-123"},
        )
    assert exc.value.status_code == 404


def test_program_version_writer_uses_atomic_idempotent_database_rpc(monkeypatch) -> None:
    from types import SimpleNamespace
    from agents import program_rewriter

    captured = {}

    class Supabase:
        def rpc(self, name, params):
            captured["name"] = name
            captured["params"] = params
            return self

        def execute(self):
            return SimpleNamespace(data=[{
                "version_id": "version-123",
                "version_number": 7,
                "changes": [{"type": "deload"}],
                "explanation": "Recent deload already recorded.",
                "already_applied": True,
            }])

    monkeypatch.setattr(program_rewriter, "get_supabase", lambda: Supabase())

    saved = program_rewriter._save_program_version(
        user_id="user-123",
        trigger="recovery_decline",
        changes=[{"type": "deload"}],
        explanation="Deload the current block.",
        plan_id="plan-123",
    )

    assert captured["name"] == "save_program_version_idempotent"
    assert captured["params"] == {
        "p_user_id": "user-123",
        "p_trigger": "recovery_decline",
        "p_changes": [{"type": "deload"}],
        "p_explanation": "Deload the current block.",
        "p_plan_id": "plan-123",
    }
    assert saved["version_id"] == "version-123"
    assert saved["version_number"] == 7
    assert saved["already_applied"] is True


def test_program_version_writer_fails_closed_when_rpc_write_fails(monkeypatch) -> None:
    from agents import program_rewriter

    class Supabase:
        def rpc(self, *_args, **_kwargs):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(program_rewriter, "get_supabase", lambda: Supabase())

    assert program_rewriter._save_program_version(
        "user-123",
        "plateau on bench",
        [{"type": "volume_reduction"}],
        "Reduce volume.",
        None,
    ) is None
