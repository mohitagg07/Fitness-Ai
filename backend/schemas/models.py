from pydantic import BaseModel, Field, field_validator, EmailStr
from typing import Optional, List, Any
from datetime import date, datetime
from enum import Enum


# ─── Enums ───────────────────────────────────────────────────────────────────

class Goal(str, Enum):
    cut = "cut"
    bulk = "bulk"
    maintain = "maintain"
    recomp = "recomp"


class ExperienceLevel(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"
    elite = "elite"


class Gender(str, Enum):
    male = "male"
    female = "female"
    other = "other"


class MessageRole(str, Enum):
    user = "user"
    assistant = "assistant"


class TrainingPhase(str, Enum):
    strength = "strength"
    hypertrophy = "hypertrophy"
    cut = "cut"
    bulk = "bulk"
    recomp = "recomp"
    maintain = "maintain"
    deload = "deload"


# ─── Auth ────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=100)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str


# ─── User Profile ─────────────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=13, le=80)
    gender: Gender
    height_cm: float = Field(gt=100, lt=250)
    weight_kg: float = Field(gt=30, lt=300)
    goal: Goal
    experience_level: ExperienceLevel
    equipment: List[str] = Field(default_factory=list)


class ProfileUpdate(BaseModel):
    """Partial profile update — all fields optional."""
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    age: Optional[int] = Field(None, ge=13, le=80)
    gender: Optional[Gender] = None
    height_cm: Optional[float] = Field(None, gt=100, lt=250)
    weight_kg: Optional[float] = Field(None, gt=30, lt=300)
    goal: Optional[Goal] = None
    experience_level: Optional[ExperienceLevel] = None
    equipment: Optional[List[str]] = None


class ProfileResponse(ProfileCreate):
    id: str
    created_at: datetime


# ─── Injury Profile ───────────────────────────────────────────────────────────

class InjuryCreate(BaseModel):
    body_part: str = Field(
        description="e.g. left_shoulder, lower_back, left_knee, right_wrist"
    )
    issue_type: str = Field(
        description="e.g. clicking, impingement, pain, restriction"
    )
    severity: int = Field(ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)
    doctor_restriction: bool = False


class InjuryResponse(InjuryCreate):
    id: str
    user_id: str
    created_at: datetime


# ─── Personal Records ────────────────────────────────────────────────────────

class PRCreate(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=100)
    weight_kg: float = Field(gt=0, lt=1000)
    reps: int = Field(ge=1, le=20, default=1)
    achieved_at: Optional[date] = None


class PRResponse(PRCreate):
    id: str
    user_id: str


# ─── Exercise Log ────────────────────────────────────────────────────────────

class SetLog(BaseModel):
    exercise_name: str = Field(min_length=1)
    set_number: int = Field(ge=1)
    weight_kg: float = Field(gt=0)
    reps: int = Field(ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    equipment_modifiers: List[str] = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=300)


class SetLogResponse(SetLog):
    id: str
    session_id: str
    logged_at: datetime


# ─── Workout Session ─────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    plan_id: Optional[str] = None
    session_date: Optional[date] = None
    day_label: Optional[str] = Field(None, max_length=50)
    muscle_groups: List[str] = Field(default_factory=list)
    cns_fatigue_before: Optional[int] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)


class SessionResponse(SessionCreate):
    id: str
    user_id: str
    completed: bool
    cns_fatigue_after: Optional[int] = None
    created_at: datetime


# ─── AI Chat ─────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    guardrails_triggered: List[str] = Field(default_factory=list)
    emergency: bool = False
    cns_fatigue_score: Optional[int] = None
    workout_blocks: Optional[dict] = None
    new_prs: List[dict] = Field(default_factory=list)


class ConversationMessage(BaseModel):
    role: MessageRole
    content: str
    created_at: datetime


# ─── Parsed Performance Log (LangGraph output) ───────────────────────────────

class PerformanceLog(BaseModel):
    """Structured output from parsing natural language workout logs."""
    exercise_name: str
    weight_kg: float
    reps_completed: int
    equipment_modifiers: Optional[List[str]] = Field(default_factory=list)
    user_reported_rpe: Optional[float] = Field(None, ge=1, le=10)
    notes: Optional[str] = None


# ─── Progress Metrics ────────────────────────────────────────────────────────

class MetricsCreate(BaseModel):
    recorded_date: Optional[date] = None
    weight_kg: Optional[float] = Field(None, gt=0, lt=500)
    body_fat_pct: Optional[float] = Field(None, ge=0, le=60)
    waist_cm: Optional[float] = Field(None, gt=0)
    chest_cm: Optional[float] = Field(None, gt=0)
    arms_cm: Optional[float] = Field(None, gt=0)
    thighs_cm: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=500)


class MetricsResponse(MetricsCreate):
    id: str
    user_id: str


# ─── Nutrition ───────────────────────────────────────────────────────────────

class NutritionCreate(BaseModel):
    log_date: Optional[date] = None
    calories: Optional[int] = Field(None, ge=0, le=10000)
    protein_g: Optional[float] = Field(None, ge=0)
    carbs_g: Optional[float] = Field(None, ge=0)
    fat_g: Optional[float] = Field(None, ge=0)
    water_ml: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=300)


class NutritionTargets(BaseModel):
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int
    water_ml: int
    tdee: int
    is_training_day: bool
    goal: str


# ─── Agent State ─────────────────────────────────────────────────────────────

class AgentState(BaseModel):
    user_id: str
    cns_fatigue_score: int = Field(0, ge=0, le=10)
    accumulated_spinal_load: int = 0
    last_session_date: Optional[date] = None
    active_muscle_groups: List[str] = Field(default_factory=list)
    last_logged_rpe: float = 5.0
    current_phase: str = "maintain"
    consecutive_high_rpe_days: int = 0   # NEW: tracks burnout risk
    weekly_session_count: int = 0         # NEW: tracks volume


# ─── Form Check ──────────────────────────────────────────────────────────────

class FormCheckResponse(BaseModel):
    exercise: str
    feedback: str
    issues_detected: List[str]
    corrections: List[str]
    safety_level: str   # "safe" | "caution" | "stop"