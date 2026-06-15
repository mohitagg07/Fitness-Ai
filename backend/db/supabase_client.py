"""
Supabase client — database layer for FitAI.
All DB calls go through this module.
"""
import logging
from supabase import create_client, Client
from core.config import get_settings
from functools import lru_cache

logger = logging.getLogger(__name__)
settings = get_settings()


@lru_cache()
def get_supabase() -> Client:
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env"
        )
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ─── Profile helpers ─────────────────────────────────────────────────────────

def get_full_user_context(user_id: str) -> tuple[dict, dict]:
    """
    Returns (user_profile, agent_state).
    Profile includes injuries and personal_records.
    """
    sb = get_supabase()

    profile_res = sb.table("profiles").select("*").eq("id", user_id).single().execute()
    injuries_res = sb.table("injury_profiles").select("*").eq("user_id", user_id).execute()
    prs_res = sb.table("personal_records").select("*").eq("user_id", user_id).execute()
    state_res = sb.table("agent_states").select("*").eq("user_id", user_id).execute()

    profile = profile_res.data or {}
    profile["injuries"] = injuries_res.data or []
    profile["personal_records"] = {
        row["exercise_name"]: row["weight_kg"]
        for row in (prs_res.data or [])
    }

    agent_state = state_res.data[0] if state_res.data else {
        "user_id": user_id,
        "cns_fatigue_score": 0,
        "accumulated_spinal_load": 0,
        "last_session_date": None,
        "active_muscle_groups": [],
        "last_logged_rpe": 5.0,
        "current_phase": profile.get("goal", "maintain"),
        "consecutive_high_rpe_days": 0,
        "weekly_session_count": 0,
    }

    return profile, agent_state


def upsert_agent_state(user_id: str, state: dict) -> None:
    sb = get_supabase()
    state["user_id"] = user_id
    state["updated_at"] = "now()"
    sb.table("agent_states").upsert(state, on_conflict="user_id").execute()


def save_conversation_message(
    user_id: str, session_id: str | None, role: str, content: str
) -> None:
    sb = get_supabase()
    sb.table("ai_conversations").insert({
        "user_id": user_id,
        "session_id": session_id,
        "role": role,
        "content": content,
    }).execute()


def upsert_personal_record(user_id: str, exercise_name: str, weight_kg: float, reps: int) -> None:
    sb = get_supabase()
    sb.table("personal_records").upsert({
        "user_id": user_id,
        "exercise_name": exercise_name,
        "weight_kg": weight_kg,
        "reps": reps,
    }, on_conflict="user_id,exercise_name,reps").execute()


# ─── Supabase Schema SQL ─────────────────────────────────────────────────────
# Run this in your Supabase SQL editor once.

SCHEMA_SQL = """
-- ============================================================
-- FitAI Database Schema
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
    goal TEXT CHECK (goal IN ('cut','bulk','maintain','recomp')),
    experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced','elite')),
    equipment TEXT[],
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

-- Workout Plans
CREATE TABLE IF NOT EXISTS public.workout_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phase TEXT,
    weeks INT DEFAULT 4,
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
    muscle_groups TEXT[],
    cns_fatigue_before INT CHECK (cns_fatigue_before BETWEEN 1 AND 10),
    cns_fatigue_after INT CHECK (cns_fatigue_after BETWEEN 1 AND 10),
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

-- Nutrition Logs
CREATE TABLE IF NOT EXISTS public.nutrition_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    log_date DATE DEFAULT CURRENT_DATE,
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
    session_id UUID REFERENCES public.workout_sessions(id),
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
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Row Level Security ───────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.injury_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_states ENABLE ROW LEVEL SECURITY;

-- ─── RLS Policies ────────────────────────────────────────────────────────
CREATE POLICY "Users own their profile"    ON public.profiles          FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users own their injuries"   ON public.injury_profiles   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their plans"      ON public.workout_plans     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their sessions"   ON public.workout_sessions  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their logs"       ON public.exercise_logs     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their PRs"        ON public.personal_records  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their metrics"    ON public.progress_metrics  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their nutrition"  ON public.nutrition_logs    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their AI history" ON public.ai_conversations  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their state"      ON public.agent_states      FOR ALL USING (auth.uid() = user_id);

-- ─── Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_date ON public.workout_sessions(user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user ON public.exercise_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_session ON public.exercise_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON public.ai_conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_metrics_user_date ON public.progress_metrics(user_id, recorded_date DESC);
"""