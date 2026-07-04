-- ============================================================
-- VYRN Database Schema v5 — username column
-- Run in Supabase SQL editor (Project Settings → SQL Editor)
--
-- api/routes/profile.py (username_available, onboard, update_me) and
-- schemas/models.py both read/write profiles.username and rely on
-- catching a unique-violation on "profiles_username_unique_idx", but no
-- prior migration ever added the column or the index — hence
--   {'message': 'column profiles.username does not exist', 'code': '42703'}
-- on every call to GET /api/profile/username-available.
--
-- Safe to run even if profiles already has rows: existing users simply
-- get username = NULL, which the app treats as "no username set yet"
-- (same as onboarding_complete = false convention elsewhere).
-- ============================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS username TEXT;

-- Case-insensitive-in-practice uniqueness: the API always stores/queries
-- the *lowercased* value (see username_available()/onboard()/update_me()
-- normalizing with .strip().lower() before touching the DB), so a plain
-- unique index on the column is sufficient here — there's no path that
-- writes a mixed-case username.
--
-- Partial index (WHERE username IS NOT NULL) so multiple existing rows
-- with a NULL username don't collide with each other; Postgres unique
-- indexes already treat NULLs as distinct from one another, but being
-- explicit here matches the intent and keeps the index smaller.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
    ON public.profiles (username)
    WHERE username IS NOT NULL;
