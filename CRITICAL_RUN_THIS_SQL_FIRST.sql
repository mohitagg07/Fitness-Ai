-- ============================================================
-- VYRN Database Schema v2
-- Run in Supabase SQL editor (Project Settings → SQL Editor)
-- ============================================================

-- Users (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    age INT CHECK (age BETWEEN 13 AND 80),
    gender TEXT CHECK (gender IN ('male','female','other')),
    height_cm FLOAT CHECK (height_cm BETWEEN 100 AND 250),
    weight_kg FLOAT CHECK (weight_kg BETWEEN 30 AND 300),
    target_weight_kg FLOAT CHECK (target_weight_kg BETWEEN 30 AND 300),
    body_fat_pct FLOAT CHECK (body_fat_pct BETWEEN 0 AND 60),
    goal TEXT CHECK (goal IN ('cut','bulk','maintain','recomp')),
    experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced','elite')),
    activity_level TEXT DEFAULT 'moderate' CHECK (activity_level IN ('sedentary','light','moderate','very_active','extra_active')),
    sleep_hours FLOAT CHECK (sleep_hours BETWEEN 0 AND 24),
    occupation TEXT,
    daily_steps INT CHECK (daily_steps >= 0),
    gym_or_home TEXT DEFAULT 'gym' CHECK (gym_or_home IN ('home','gym','hybrid')),
    workout_days_per_week INT DEFAULT 4,
    food_preference TEXT,
    allergies TEXT[],
    food_restrictions TEXT[],
    equipment TEXT[],
    wake_time TEXT,
    sleep_time TEXT,
    workout_time_preference TEXT,
    coach_style TEXT DEFAULT 'friendly' CHECK (coach_style IN ('friendly','strict','military')),
    onboarding_complete BOOLEAN DEFAULT FALSE,
    onboarding_step INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Injury / Health Profile
CREATE TABLE IF NOT EXISTS public.injury_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    body_part TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    severity INT CHECK (severity BETWEEN 1 AND 10),
    notes TEXT,
    doctor_restriction BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workout Plans (AI-generated)
CREATE TABLE IF NOT EXISTS public.workout_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phase TEXT,
    weeks INT DEFAULT 4,
    schedule JSONB,          -- {mon: "push", tue: "rest", ...}
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workout Sessions
CREATE TABLE IF NOT EXISTS public.workout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES public.workout_plans(id),
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    day_label TEXT,
    workout_type TEXT,
    muscle_groups TEXT[],
    cns_fatigue_before INT CHECK (cns_fatigue_before BETWEEN 1 AND 10),
    cns_fatigue_after INT CHECK (cns_fatigue_after BETWEEN 1 AND 10),
    total_volume_kg FLOAT,
    duration_minutes INT,
    calories_burned INT,
    mood TEXT,
    notes TEXT,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Exercise Logs (set-by-set)
CREATE TABLE IF NOT EXISTS public.exercise_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    exercise_name TEXT NOT NULL,
    set_number INT NOT NULL,
    weight_kg FLOAT,
    reps INT,
    rpe FLOAT CHECK (rpe BETWEEN 1 AND 10),
    equipment_modifiers TEXT[],
    notes TEXT,
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Personal Records
CREATE TABLE IF NOT EXISTS public.personal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    exercise_name TEXT NOT NULL,
    weight_kg FLOAT NOT NULL,
    reps INT NOT NULL DEFAULT 1,
    achieved_at DATE DEFAULT CURRENT_DATE,
    UNIQUE (user_id, exercise_name, reps)
);

-- Progress Metrics (body composition)
CREATE TABLE IF NOT EXISTS public.progress_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    recorded_date DATE DEFAULT CURRENT_DATE,
    weight_kg FLOAT,
    body_fat_pct FLOAT,
    waist_cm FLOAT,
    chest_cm FLOAT,
    arms_cm FLOAT,
    thighs_cm FLOAT,
    notes TEXT
);

-- Progress Photos
CREATE TABLE IF NOT EXISTS public.progress_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    angle TEXT CHECK (angle IN ('front','side','back')),
    recorded_date DATE DEFAULT CURRENT_DATE,
    notes TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nutrition Logs
CREATE TABLE IF NOT EXISTS public.nutrition_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    log_date DATE DEFAULT CURRENT_DATE,
    meal_name TEXT,
    calories INT,
    protein_g FLOAT,
    carbs_g FLOAT,
    fat_g FLOAT,
    water_ml INT,
    notes TEXT
);

-- AI Conversation History
CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id TEXT,
    role TEXT CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LangGraph Agent State (persisted between sessions)
CREATE TABLE IF NOT EXISTS public.agent_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    cns_fatigue_score INT DEFAULT 0,
    accumulated_spinal_load INT DEFAULT 0,
    last_session_date DATE,
    active_muscle_groups TEXT[],
    last_logged_rpe FLOAT DEFAULT 5,
    current_phase TEXT DEFAULT 'maintain',
    consecutive_high_rpe_days INT DEFAULT 0,
    weekly_session_count INT DEFAULT 0,
    workout_streak INT DEFAULT 0,
    protein_streak INT DEFAULT 0,
    total_workouts INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Timeline — a compact, append-only log of decisions the AI made on
-- the user's behalf ("Workout generated", "Protein target updated",
-- "Recovery improved"), surfaced as a feed on the Dashboard so the user
-- can see the AI is actively doing things, not just chatting when asked.
-- Deliberately NOT derived by re-querying workout_sessions/nutrition_logs
-- at read time — agents write directly here as they make each decision,
-- so the timeline reflects what the AI actually decided and when, even
-- for decisions that don't have their own dedicated table row (e.g. a
-- workout reschedule, a recovery-driven rest-day call).
CREATE TABLE IF NOT EXISTS public.ai_timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,   -- workout_generated|workout_completed|nutrition_updated|recovery_changed|report_ready|...
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Row Level Security ───────────────────────────────────────────────────
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.injury_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_photos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_states      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_timeline_events ENABLE ROW LEVEL SECURITY;

-- ─── RLS Policies ────────────────────────────────────────────────────────
-- CREATE POLICY has no IF NOT EXISTS in any Postgres version (unlike
-- CREATE TABLE/INDEX above), so re-running this script without dropping
-- first fails with "ERROR: 42710: policy ... already exists" on the
-- second run. DROP POLICY IF EXISTS is genuinely idempotent — it issues
-- a notice, never an error, when the policy isn't there yet — so each
-- pair below makes this script safe to run as many times as needed.
DROP POLICY IF EXISTS "Users own their profile"    ON public.profiles;
CREATE POLICY "Users own their profile"    ON public.profiles          FOR ALL USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users own their injuries"   ON public.injury_profiles;
CREATE POLICY "Users own their injuries"   ON public.injury_profiles   FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their plans"      ON public.workout_plans;
CREATE POLICY "Users own their plans"      ON public.workout_plans     FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their sessions"   ON public.workout_sessions;
CREATE POLICY "Users own their sessions"   ON public.workout_sessions  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their logs"       ON public.exercise_logs;
CREATE POLICY "Users own their logs"       ON public.exercise_logs     FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their PRs"        ON public.personal_records;
CREATE POLICY "Users own their PRs"        ON public.personal_records  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their metrics"    ON public.progress_metrics;
CREATE POLICY "Users own their metrics"    ON public.progress_metrics  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their photos"     ON public.progress_photos;
CREATE POLICY "Users own their photos"     ON public.progress_photos   FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their nutrition"  ON public.nutrition_logs;
CREATE POLICY "Users own their nutrition"  ON public.nutrition_logs    FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their AI history" ON public.ai_conversations;
CREATE POLICY "Users own their AI history" ON public.ai_conversations  FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their state"      ON public.agent_states;
CREATE POLICY "Users own their state"      ON public.agent_states      FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their timeline"   ON public.ai_timeline_events;
CREATE POLICY "Users own their timeline"   ON public.ai_timeline_events FOR ALL USING (auth.uid() = user_id);

-- ─── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_date ON public.workout_sessions(user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user ON public.exercise_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_session ON public.exercise_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON public.ai_conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_timeline_user ON public.ai_timeline_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_metrics_user_date ON public.progress_metrics(user_id, recorded_date DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_date ON public.nutrition_logs(user_id, log_date DESC);
-- ============================================================
-- Schema additions v2.1 — run after the v2 tables above
-- ============================================================

-- Decision History — persists every decision_engine.py output so
-- DecisionScreen shows real data instead of hardcoded mock data.
CREATE TABLE IF NOT EXISTS public.ai_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    decision_date DATE NOT NULL DEFAULT CURRENT_DATE,
    decision TEXT NOT NULL,           -- "Heavy Push Day", "Rest Day", etc.
    confidence_pct INT,               -- 0-100 deterministic score
    reasoning TEXT,                   -- deterministic explanation string
    expected_outcome TEXT,
    alternative TEXT,
    signals JSONB,                    -- array of {label, value, favorable}
    outcome TEXT DEFAULT 'pending' CHECK (outcome IN ('pending','correct','incorrect','partial')),
    outcome_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, decision_date)   -- one decision per user per day
);

-- Program Versions — every time program_rewriter.py rewrites the program,
-- a row is added here. Feeds the Program Evolution UI (version chip row + diff).
CREATE TABLE IF NOT EXISTS public.program_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES public.workout_plans(id),
    version_number INT NOT NULL,      -- 1, 2, 3...
    trigger TEXT NOT NULL,            -- "plateau on bench press", "recovery_decline", etc.
    changes JSONB,                    -- array of change objects
    explanation TEXT,                 -- human-readable "why it changed"
    created_at DATE DEFAULT CURRENT_DATE
);

-- RLS
ALTER TABLE public.ai_decisions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their decisions" ON public.ai_decisions;
CREATE POLICY "Users own their decisions"        ON public.ai_decisions     FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users own their program versions" ON public.program_versions;
CREATE POLICY "Users own their program versions" ON public.program_versions FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_decisions_user_date    ON public.ai_decisions(user_id, decision_date DESC);
CREATE INDEX IF NOT EXISTS idx_program_versions_user     ON public.program_versions(user_id, version_number DESC);

-- ============================================================
-- Schema additions v2.2 — run after the v2.1 tables above,
-- BEFORE running MIGRATION_v2.sql
-- ============================================================

-- Notifications — generated by backend/services/notifications.py
-- (generate_notifications_for_user / save_notifications) and read by
-- backend/api/routes/notifications.py. This table was previously
-- missing entirely: MIGRATION_v2.sql ran
--   ALTER TABLE notifications ADD COLUMN IF NOT EXISTS cta text;
-- against a table that had never been created, which fails with
--   ERROR: 42P01: relation "notifications" does not exist
-- regardless of statement order, since ALTER TABLE cannot create the
-- table it's altering. Columns below match exactly what
-- save_notifications() inserts (user_id, notif_date, type, title, body,
-- priority, cta, data, read) plus the id/created_at the route layer
-- expects back for ordering (GET / orders by created_at desc) and
-- per-row updates (PATCH /{id}/read).
CREATE TABLE IF NOT EXISTS public.notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    notif_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    type        TEXT NOT NULL,   -- "recovery_high" | "cns_very_high" | "missed_workout" |
                                  -- "protein_gap" | "pr_opportunity" | "recovery_decline" | "motivation"
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    priority    TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
    cta         TEXT,            -- deep-link route, e.g. "/workout", "/nutrition", "/recovery"
    data        JSONB DEFAULT '{}'::jsonb,
    read        BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, type, notif_date)  -- matches save_notifications' own dedupe query
);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their notifications" ON public.notifications;
CREATE POLICY "Users own their notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread  ON public.notifications(user_id, read) WHERE read = FALSE;
