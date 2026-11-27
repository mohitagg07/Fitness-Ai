from pathlib import Path


def test_fitness_journey_migration_contains_required_release_contracts() -> None:
    migration_path = Path(__file__).resolve().parents[2] / "MIGRATION_v13_complete_training_journey.sql"
    sql = migration_path.read_text(encoding="utf-8").lower()

    required = [
        "create table if not exists public.recovery_checkins",
        "create table if not exists public.workout_plan_versions",
        "create table if not exists public.workout_session_exercise_events",
        "create or replace function public.save_workout_plan_draft",
        "create or replace function public.approve_workout_plan_version",
        "create or replace function public.rollback_workout_plan_version",
        "create or replace function public.transition_workout_session",
        "create or replace function public.create_workout_session_idempotent",
        "create or replace function public.log_workout_set_idempotent",
        "completion_result jsonb",
        "planned_workout_snapshot jsonb",
        "client_request_id",
        "enable row level security",
    ]

    missing = [contract for contract in required if contract not in sql]
    assert not missing, f"Fitness journey migration is missing required contracts: {missing}"
