# VYRN fitness journey — P0 release checklist

This release changes both the backend contract and the Supabase schema. **Do not deploy the new backend or mobile client before applying the migration.**

## 1. Database release

1. Take a current Supabase backup or confirm point-in-time recovery is available.
2. Review and apply `MIGRATION_v13_complete_training_journey.sql` to the target Supabase project.
3. Verify that these objects exist:
   - `recovery_checkins`
   - `workout_plan_versions`
   - `workout_session_exercise_events`
   - `save_workout_plan_draft`
   - `approve_workout_plan_version`
   - `rollback_workout_plan_version`
   - `transition_workout_session`
   - `create_workout_session_idempotent`
   - `log_workout_set_idempotent`
4. Verify that RLS is enabled for all new user-owned tables and that the RPC functions are executable only by the backend service role.

The migration is additive. It preserves legacy plans and sessions; new sessions receive explicit plan snapshots and lifecycle fields. Do not remove old fields or tables as part of this release.

## 2. Backend and frontend

1. Deploy the backend containing the training-plan, recovery-check-in, session-lifecycle and exercise-event routes.
2. Confirm the backend is using the intended Supabase URL and service-role key. Never ship the service-role key in the mobile app.
3. Build and distribute the mobile client only after the backend migration and deployment are healthy.
4. Confirm the app sends the device IANA timezone to the daily mission and recovery-check-in endpoints.

## 3. Required release verification

- Backend test suite: `python -m pytest -q tests`
- Frontend TypeScript: `npm run typecheck`
- Expo compatibility: `npx expo install --check`
- Expo Doctor: `npx expo-doctor`
- Android JS bundle: `npx expo export --platform android`
- iOS JS bundle: `npx expo export --platform ios`
- Standalone Android APK build and emulator smoke test.
- Manual journey: profile → daily recommendation → editable plan preview → approval → session → set logging → pause/resume → feedback → session review → adaptive proposal → approval/rejection → next Home recommendation.
- Failure checks: app restart during workout, duplicate set retry, lost session-creation response, offline set queue, abandoned session restoration, timezone midnight boundary and missing recovery data.

## 4. Rollback

- If an adaptive plan is incorrect, use the version rollback endpoint. It creates a new version from a previously approved snapshot; it does not rewrite completed sessions.
- If the app release must be rolled back, redeploy the previous backend and mobile builds. Keep the additive database migration in place unless a separately reviewed database rollback is prepared.
- Do not delete a user's pending set outbox or workout history during rollback.
