# Daily recovery check-ins

Apply MIGRATION_v13_daily_recovery_checkins.sql in Supabase after the existing v12 migration and before deploying the API/mobile build that uses the recovery check-in UI.

The migration is additive. It creates one row per athlete and local calendar date, enables row-level security, and restricts row access to the owning authenticated user.

Until the migration has been applied, GET and PUT /api/recovery/check-in/today return HTTP 503 with an explicit migration message. The app must keep recovery inputs unavailable; it must not treat the profile's onboarding sleep_hours as last night's sleep.

After applying the SQL, verify:
1. The recovery_checkins table exists and RLS is enabled.
2. A signed-in user can read/write only their own local-day row.
3. The Home check-in saves and refreshes the mission.
4. The mission and check-in endpoints use the device's IANA timezone.
