"""
backend/schemas/models.py

KEY FIX (was causing workout tables to never render on frontend):
  StructuredDecision now includes:
    • mission      Optional[dict]  — { goal, recovery, workout_type }
    • workout      Optional[List[dict]] — exercises array
    • decisions    Optional[List[dict]] — AI decisions array
    • nutrition    Optional[dict]  — { calories, protein, carbs, fat, water_l, diet_note }

  Previously these fields were absent, so Pydantic silently stripped them
  when serializing ChatResponse → the frontend received structured_decision
  without the workout/decisions/nutrition keys → tables never rendered.
"""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Any
from datetime import date, datetime
from enum import Enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class Goal(str, Enum):
    cut      = "cut"
    bulk     = "bulk"
    maintain = "maintain"
    recomp   = "recomp"


class ExperienceLevel(str, Enum):
    beginner     = "beginner"
    intermediate = "intermediate"
    advanced     = "advanced"
    elite        = "elite"


class Gender(str, Enum):
    male   = "male"
    female = "female"
    other  = "other"


class MessageRole(str, Enum):
    user      = "user"
    assistant = "assistant"


# ─── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email:     str = Field(..., min_length=3, max_length=255)
    password:  str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=100)

    @field_validator("email")
    @classmethod
    def email_lower(cls, v: str) -> str:
        return v.strip().lower()


class LoginRequest(BaseModel):
    email:    str = Field(..., min_length=3)
    password: str = Field(..., min_length=1)

    @field_validator("email")
    @classmethod
    def email_lower(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         dict


# ─── Profile ──────────────────────────────────────────────────────────────────

class OnboardingRequest(BaseModel):
    full_name:           str
    age:                 int  = Field(..., ge=13, le=100)
    gender:              Gender
    weight_kg:           float = Field(..., gt=0, lt=500)
    height_cm:           float = Field(..., gt=0, lt=300)
    goal:                Goal
    experience_level:    ExperienceLevel
    equipment:           List[str] = Field(default_factory=list)
    workout_days_per_week: int = Field(4, ge=1, le=7)
    food_preference:     Optional[str] = None
    coach_style:         Optional[str] = None


class ProfileUpdate(BaseModel):
    full_name:             Optional[str]   = None
    age:                   Optional[int]   = Field(None, ge=13, le=100)
    gender:                Optional[Gender] = None
    weight_kg:             Optional[float] = Field(None, gt=0, lt=500)
    height_cm:             Optional[float] = Field(None, gt=0, lt=300)
    goal:                  Optional[Goal]  = None
    experience_level:      Optional[ExperienceLevel] = None
    equipment:             Optional[List[str]] = None
    workout_days_per_week: Optional[int]   = Field(None, ge=1, le=7)
    food_preference:       Optional[str]   = None
    coach_style:           Optional[str]   = None


class InjuryCreate(BaseModel):
    body_part:   str = Field(..., min_length=1, max_length=50)
    issue_type:  str = Field(..., min_length=1, max_length=50)
    severity:    str = Field("moderate", max_length=20)
    notes:       Optional[str] = Field(None, max_length=300)
    is_active:   bool = True


class PRCreate(BaseModel):
    exercise_name: str   = Field(..., min_length=1, max_length=100)
    weight_kg:     float = Field(..., gt=0, le=1000)
    reps:          int   = Field(1, ge=1, le=100)
    notes:         Optional[str] = Field(None, max_length=200)


# ─── Exercise Log ──────────────────────────────────────────────────────────────

class SetLog(BaseModel):
    exercise_name:        str   = Field(min_length=1)
    set_number:           int   = Field(ge=1)
    weight_kg:            float = Field(gt=0)
    reps:                 int   = Field(ge=1)
    rpe:                  Optional[float] = Field(None, ge=1, le=10)
    equipment_modifiers:  List[str] = Field(default_factory=list)
    notes:                Optional[str] = Field(None, max_length=300)


# ─── Workout Session ──────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    plan_id:             Optional[str]   = None
    session_date:        Optional[date]  = None
    day_label:           Optional[str]   = Field(None, max_length=50)
    workout_type:        Optional[str]   = None
    muscle_groups:       List[str]       = Field(default_factory=list)
    cns_fatigue_before:  Optional[int]   = Field(None, ge=1, le=10)
    notes:               Optional[str]   = Field(None, max_length=500)


# ─── Nutrition ────────────────────────────────────────────────────────────────

class NutritionTargets(BaseModel):
    calories:        int
    protein_g:       int
    carbs_g:         int
    fat_g:           int
    water_ml:        int
    tdee:            int
    is_training_day: bool
    goal:            str


# ─── AI Chat ──────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    content:    str = Field(min_length=1, max_length=2000)
    session_id: Optional[str] = None


class StructuredDecision(BaseModel):
    """
    Structured coach decision returned by build_workout_node.

    FIXED: Added mission (dict), workout (list), decisions (list), nutrition (dict).
    These were previously absent — Pydantic stripped them on serialization,
    causing the workout / decisions / nutrition tables to never appear on the
    frontend even though the LLM was generating them correctly.
    """
    mode:          Optional[str]  = None   # "session_plan"|"live_set"|"chat"|"emergency"
    analysis:      Optional[str]  = None
    ai_decision:   Optional[str]  = None
    next_action:   Optional[str]  = None
    coaching_cue:  Optional[str]  = None
    coach_insight: Optional[str]  = None
    reason:        Optional[str]  = None   # backward-compat alias for ai_decision
    intensity:     Optional[str]  = None   # "High"|"Moderate"|"Low"|"Rest"
    recovery:      Optional[int]  = None   # 0-100
    workout_type:  Optional[str]  = None   # "Push"|"Pull"|"Legs"|"Rest"

    # ── NEW FIELDS (were being stripped by Pydantic before this fix) ──────────
    mission:       Optional[dict] = None
    # e.g. { "goal": "Muscle Gain", "recovery": 87, "workout_type": "Push Day" }

    workout: Optional[List[dict]] = None
    # e.g. [{ "exercise": "Bench Press", "sets": 4, "reps": 6,
    #          "weight": "80 kg", "rpe": 8, "rest": "180 sec" }]

    decisions: Optional[List[dict]] = None
    # e.g. [{ "decision": "Increase bench by 2.5 kg", "reason": "..." }]

    nutrition: Optional[dict] = None
    # e.g. { "calories": 2850, "protein": 180, "carbs": 320, "fat": 75,
    #         "water_l": 3.5, "diet_note": "..." }

    # Legacy scalar fields kept for backward-compat (pre-session_plan shape)
    calories:  Optional[int] = None
    protein:   Optional[int] = None

    class Config:
        # Allow extra fields from LLM output — don't strip unknown keys
        extra = "allow"


class ChatResponse(BaseModel):
    reply:                str
    guardrails_triggered: List[str]      = Field(default_factory=list)
    emergency:            bool           = False
    cns_fatigue_score:    Optional[int]  = None
    workout_blocks:       Optional[dict] = None
    new_prs:              List[dict]     = Field(default_factory=list)
    motivation_message:   Optional[str]  = None
    structured_decision:  Optional[StructuredDecision] = None


class ConversationMessage(BaseModel):
    role:       MessageRole
    content:    str
    created_at: datetime


# ─── Parsed Performance Log (LangGraph output) ────────────────────────────────

class PerformanceLog(BaseModel):
    exercise_name:        str
    weight_kg:            float
    reps_completed:       int
    equipment_modifiers:  Optional[List[str]] = Field(default_factory=list)
    user_reported_rpe:    Optional[float]     = Field(None, ge=1, le=10)
    notes:                Optional[str]       = None


# ─── Progress Metrics ─────────────────────────────────────────────────────────

class MetricsCreate(BaseModel):
    recorded_date: Optional[date]  = None
    weight_kg:     Optional[float] = Field(None, gt=0, lt=500)
    body_fat_pct:  Optional[float] = Field(None, ge=0, le=60)
    waist_cm:      Optional[float] = Field(None, gt=0)
    chest_cm:      Optional[float] = Field(None, gt=0)
    arms_cm:       Optional[float] = Field(None, gt=0)
    thighs_cm:     Optional[float] = Field(None, gt=0)
    notes:         Optional[str]   = Field(None, max_length=500)


# ─── Agent State ──────────────────────────────────────────────────────────────

class AgentState(BaseModel):
    user_id:                  str
    cns_fatigue_score:        int       = Field(0, ge=0, le=10)
    accumulated_spinal_load:  int       = 0
    last_session_date:        Optional[date] = None
    workout_streak:           int       = 0
    total_workouts:           int       = 0
    weekly_session_count:     int       = 0
    consecutive_high_rpe_days: int      = 0


# ─── Dashboard ────────────────────────────────────────────────────────────────

class TankStatus(BaseModel):
    current:     int
    target:      int
    pct:         int
    status:      str   # "on_track" | "behind" | "complete"
    label:       str


class MissionTask(BaseModel):
    task:    str
    done:    bool  = False
    agent:   str   # which agent generated this
    priority: int  = 1


class DashboardResponse(BaseModel):
    user_name:              str
    greeting:               str
    today_workout_type:     str
    today_workout_time:     Optional[str] = None
    today_workout_duration_min: int       = 0
    calories_tank:          TankStatus
    protein_tank:           TankStatus
    water_tank:             TankStatus
    next_tasks:             List[MissionTask] = Field(default_factory=list)
    last_session_summary:   Optional[str] = None
    next_target:            Optional[str] = None
    workout_streak:         int           = 0
    protein_streak:         int           = 0
    motivation_message:     str           = ""
    cns_fatigue_score:      int           = 0
    sleep_goal:             Optional[str] = None