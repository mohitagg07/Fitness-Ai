from pydantic import BaseModel, Field, field_validator
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


class WorkoutType(str, Enum):
    push = "push"
    pull = "pull"
    legs = "legs"
    upper = "upper"
    lower = "lower"
    full_body = "full_body"
    cardio = "cardio"
    rest = "rest"


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


# ─── Onboarding ──────────────────────────────────────────────────────────────

class OnboardingCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=13, le=80)
    gender: Gender
    height_cm: float = Field(gt=100, lt=250)
    weight_kg: float = Field(gt=30, lt=300)
    goal: Goal
    experience_level: ExperienceLevel
    gym_or_home: str = Field(default="gym")           # "gym" | "home"
    workout_days_per_week: int = Field(ge=1, le=7, default=4)
    injuries: List[dict] = Field(default_factory=list)
    food_preference: Optional[str] = None             # "veg" | "non-veg" | "vegan"
    equipment: List[str] = Field(default_factory=list)


# ─── User Profile ─────────────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=13, le=80)
    gender: Gender
    height_cm: float = Field(gt=100, lt=250)
    weight_kg: float = Field(gt=30, lt=300)
    goal: Goal
    experience_level: ExperienceLevel
    gym_or_home: str = "gym"
    workout_days_per_week: int = Field(ge=1, le=7, default=4)
    food_preference: Optional[str] = None
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
    food_preference: Optional[str] = None
    workout_days_per_week: Optional[int] = Field(None, ge=1, le=7)


# ─── Injury Profile ───────────────────────────────────────────────────────────

class InjuryCreate(BaseModel):
    body_part: str = Field(description="e.g. left_shoulder, lower_back, left_knee")
    issue_type: str = Field(description="e.g. clicking, impingement, pain, restriction")
    severity: int = Field(ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)
    doctor_restriction: bool = False


# ─── Personal Records ────────────────────────────────────────────────────────

class PRCreate(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=100)
    weight_kg: float = Field(gt=0, lt=1000)
    reps: int = Field(ge=1, le=20, default=1)
    achieved_at: Optional[date] = None


# ─── Exercise Log ────────────────────────────────────────────────────────────

class SetLog(BaseModel):
    exercise_name: str = Field(min_length=1)
    set_number: int = Field(ge=1)
    weight_kg: float = Field(gt=0)
    reps: int = Field(ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    equipment_modifiers: List[str] = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=300)


# ─── Workout Session ─────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    plan_id: Optional[str] = None
    session_date: Optional[date] = None
    day_label: Optional[str] = Field(None, max_length=50)
    workout_type: Optional[WorkoutType] = None
    muscle_groups: List[str] = Field(default_factory=list)
    cns_fatigue_before: Optional[int] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)


class SessionComplete(BaseModel):
    cns_fatigue_after: Optional[int] = Field(None, ge=1, le=10)
    total_volume_kg: Optional[float] = None
    duration_minutes: Optional[int] = None
    calories_burned: Optional[int] = None
    mood: Optional[str] = None  # "great" | "good" | "okay" | "bad"


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
    motivation_message: Optional[str] = None


class ConversationMessage(BaseModel):
    role: MessageRole
    content: str
    created_at: datetime


# ─── Parsed Performance Log (LangGraph output) ───────────────────────────────

class PerformanceLog(BaseModel):
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


# ─── Nutrition ───────────────────────────────────────────────────────────────

class NutritionCreate(BaseModel):
    log_date: Optional[date] = None
    meal_name: Optional[str] = Field(None, max_length=100)
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
    consecutive_high_rpe_days: int = 0
    weekly_session_count: int = 0
    workout_streak: int = 0
    protein_streak: int = 0
    total_workouts: int = 0


# ─── Dashboard ───────────────────────────────────────────────────────────────

class DashboardResponse(BaseModel):
    user_name: str
    today_workout_type: str
    today_workout_duration_min: int
    calories_remaining: int
    protein_remaining_g: int
    calories_target: int
    protein_target_g: int
    last_session_summary: Optional[str] = None
    next_target: Optional[str] = None  # e.g. "Bench 85kg × 5"
    workout_streak: int = 0
    protein_streak: int = 0
    motivation_message: str = ""
    cns_fatigue_score: int = 0
    mission_text: str = ""


# ─── Streak / Achievements ───────────────────────────────────────────────────

class Achievement(BaseModel):
    id: str
    title: str
    description: str
    icon: str
    unlocked_at: Optional[datetime] = None
    unlocked: bool = False


# ─── Form Check ──────────────────────────────────────────────────────────────

class FormCheckResponse(BaseModel):
    exercise: str
    feedback: str
    issues_detected: List[str]
    corrections: List[str]
    safety_level: str   # "safe" | "caution" | "stop"