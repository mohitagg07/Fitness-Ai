from pathlib import Path
import re


def test_complete_training_journey_migration_has_atomic_contracts_and_valid_dollar_quotes():
    path = Path(__file__).resolve().parents[2] / "MIGRATION_v14_complete_training_journey.sql"
    sql = path.read_text(encoding="utf-8").lower()
    required = [
        "create table if not exists public.workout_plan_versions",
        "create table if not exists public.workout_session_exercise_events",
        "create or replace function public.save_workout_plan_draft",
        "create or replace function public.approve_workout_plan_version",
        "create or replace function public.rollback_workout_plan_version",
        "create or replace function public.transition_workout_session",
        "create or replace function public.create_workout_session_idempotent",
        "create or replace function public.log_workout_set_idempotent",
        "planned_workout_snapshot jsonb",
        "client_request_id",
        "base_version_id",
        "approved_by",
        "plan_draft_stale",
        "plan_version_not_active",
        "workouts_by_day",
        "enable row level security",
    ]
    missing = [item for item in required if item not in sql]
    assert not missing, f"Migration is missing contracts: {missing}"
    assert not re.search(r"\bas \$(?!\$)", sql)
    assert sql.count("$$") % 2 == 0


def test_approved_plan_snapshots_are_immutable_and_client_cannot_mutate_versions():
    path = Path(__file__).resolve().parents[2] / "MIGRATION_v14_complete_training_journey.sql"
    sql = path.read_text(encoding="utf-8").lower()
    assert "approved_plan_snapshot_immutable" in sql
    assert 'create policy "users can view their workout plan versions"' in sql
    assert "for select" in sql
