# VYRN complete training journey migration

Apply MIGRATION_v14_complete_training_journey.sql only after the core schema
migrations and MIGRATION_v13_daily_recovery_checkins.sql.

This migration is additive. It introduces versioned workout prescriptions,
immutable session snapshots, session lifecycle and idempotency fields,
exercise skip/replace events, structured post-session feedback, atomic
approval/rollback/session/set RPCs, and row-level security.

Before production deployment:
1. Apply the SQL in a Supabase staging project first.
2. Run the migration contract tests and database integration tests.
3. Verify one approved active version per athlete; stale proposals must fail
   approval with PLAN_DRAFT_STALE.
4. Verify session creation rejects superseded/inactive plan versions and
   refuses to start on a scheduled rest day.
5. Confirm approved snapshots cannot be rewritten through a direct client.
6. Confirm rollback creates a new version and does not rewrite old sessions.

A Git commit does not apply SQL to the hosted Supabase database.
