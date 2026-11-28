from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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


class ActivityLevel(str, Enum):
    sedentary = "sedentary"
    light = "light"
    moderate = "moderate"
    very_active = "very_active"
    extra_active = "extra_active"


class CoachStyle(str, Enum):
    friendly = "friendly"
    supportive = "supportive"
    scientific = "scientific"
    strict = "strict"
    military = "military"


class WorkoutLocation(str, Enum):
    home = "home"
    gym = "gym"
    hybrid = "hybrid"


class FoodPreference(str, Enum):
    veg = "veg"
    non_veg = "non-veg"
    vegan = "vegan"
    eggetarian = "eggetarian"


class WorkoutTimePreference(str, Enum):
    morning = "morning"
    afternoon = "afternoon"
    evening = "evening"


class Mood(str, Enum):
    great = "great"
    good = "good"
    okay = "okay"
    bad = "bad"


class Intensity(str, Enum):
    high = "High"
    moderate = "Moderate"
    low = "Low"
    rest = "Rest"


class ResponseType(str, Enum):
    workout_plan = "workout_plan"
    live_set = "live_set"
    nutrition_tip = "nutrition_tip"
    recovery_advice = "recovery_advice"
    progress_update = "progress_update"
    weekly_summary = "weekly_summary"
    chat = "chat"
    emergency = "emergency"


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


class RegisterResponse(BaseModel):
    verification_required: bool
    message: str
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user_id: str


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
    target_weight_kg: Optional[float] = Field(None, gt=30, lt=300)
    body_fat_pct: Optional[float] = Field(None, ge=0, le=60)
    goal: Goal
    experience_level: ExperienceLevel
    activity_level: ActivityLevel = ActivityLevel.moderate
    sleep_hours: Optional[float] = Field(None, ge=0, le=24)
    occupation: Optional[str] = Field(None, max_length=100)
    daily_steps: Optional[int] = Field(None, ge=0)
    injuries: List[dict] = Field(default_factory=list)
    food_preference: Optional[FoodPreference] = None
    allergies: List[str] = Field(default_factory=list)
    food_restrictions: List[str] = Field(default_factory=list)
    gym_or_home: WorkoutLocation = WorkoutLocation.gym
    workout_days_per_week: int = Field(ge=1, le=7, default=4)
    equipment: List[str] = Field(default_factory=list)

    @field_validator("equipment", mode="before")
    @classmethod
    def normalize_equipment(cls, values):
        return normalize_equipment_values(values)

    wake_time: Optional[str] = None
    sleep_time: Optional[str] = None
    workout_time_preference: Optional[WorkoutTimePreference] = None
    coach_style: CoachStyle = CoachStyle.friendly


def normalize_equipment_values(values):
    """Normalize old UI labels to the canonical equipment keys used by agents."""
    if values is None:
        return None
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, (list, tuple, set)):
        raise ValueError("equipment must be a list of strings")

    aliases = {
        "dumbbells": "dumbbell",
        "kettlebells": "kettlebell",
        "bodyweight only": "bodyweight",
        "no equipment": "bodyweight",
        "resistance bands": "resistance_bands",
        "pull-up bar": "pull_up_bar",
        "pull up bar": "pull_up_bar",
        "cable machine": "cable",
        "machines": "machine",
        "smith machine": "smith_machine",
        "squat rack": "squat_rack",
    }
    normalized: list[str] = []
    for item in values:
        value = str(item or "").strip().lower()
        if not value:
            continue
        canonical = aliases.get(value, value.replace("-", "_").replace(" ", "_"))
        if canonical not in normalized:
            normalized.append(canonical)
    return normalized


# ─── User Profile ─────────────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    username: Optional[str] = Field(None, min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_.]+$")
    age: int = Field(ge=13, le=80)
    gender: Gender
    height_cm: float = Field(gt=100, lt=250)
    weight_kg: float = Field(gt=30, lt=300)
    target_weight_kg: Optional[float] = Field(None, gt=30, lt=300)
    body_fat_pct: Optional[float] = Field(None, ge=0, le=60)
    goal: Goal
    experience_level: ExperienceLevel
    activity_level: ActivityLevel = ActivityLevel.moderate
    sleep_hours: Optional[float] = Field(None, ge=0, le=24)
    occupation: Optional[str] = Field(None, max_length=100)
    daily_steps: Optional[int] = Field(None, ge=0)
    food_preference: Optional[FoodPreference] = None
    allergies: List[str] = Field(default_factory=list)
    food_restrictions: List[str] = Field(default_factory=list)
    gym_or_home: WorkoutLocation = WorkoutLocation.gym
    workout_days_per_week: int = Field(ge=1, le=7, default=4)
    equipment: List[str] = Field(default_factory=list)
    wake_time: Optional[str] = None                     # "HH:MM"
    sleep_time: Optional[str] = None                     # "HH:MM"
    workout_time_preference: Optional[WorkoutTimePreference] = None
    coach_style: CoachStyle = CoachStyle.friendly


class ProfileUpdate(BaseModel):
    """Partial profile update — all fields optional."""
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    username: Optional[str] = Field(None, min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_.]+$")
    age: Optional[int] = Field(None, ge=13, le=80)
    gender: Optional[Gender] = None
    height_cm: Optional[float] = Field(None, gt=100, lt=250)
    weight_kg: Optional[float] = Field(None, gt=30, lt=300)
    target_weight_kg: Optional[float] = Field(None, gt=30, lt=300)
    body_fat_pct: Optional[float] = Field(None, ge=0, le=60)
    goal: Optional[Goal] = None
    experience_level: Optional[ExperienceLevel] = None
    activity_level: Optional[ActivityLevel] = None
    sleep_hours: Optional[float] = Field(None, ge=0, le=24)
    occupation: Optional[str] = Field(None, max_length=100)
    daily_steps: Optional[int] = Field(None, ge=0)
    equipment: Optional[List[str]] = None

    @field_validator("equipment", mode="before")
    @classmethod
    def normalize_equipment(cls, values):
        return normalize_equipment_values(values)

    food_preference: Optional[FoodPreference] = None
    allergies: Optional[List[str]] = None
    food_restrictions: Optional[List[str]] = None
    gym_or_home: Optional[WorkoutLocation] = None
    workout_days_per_week: Optional[int] = Field(None, ge=1, le=7)
    wake_time: Optional[str] = None
    sleep_time: Optional[str] = None
    workout_time_preference: Optional[WorkoutTimePreference] = None
    coach_style: Optional[CoachStyle] = None


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
    weight_kg: float = Field(ge=0)
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
    mood: Optional[Mood] = None


# ─── AI Chat ─────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    session_id: Optional[str] = None


class CoachExercise(BaseModel):
    """Bounded exercise data used by the Coach cards and plan-draft adapter."""
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=120)
    sets: int = Field(ge=1, le=20)
    reps: str = Field(min_length=1, max_length=30)
    weight: Optional[str] = Field(default=None, max_length=60)
    rest: Optional[str] = Field(default=None, max_length=30)
    focus: Optional[str] = Field(default=None, max_length=500)

    @field_validator("name", "reps", mode="before")
    @classmethod
    def _clean_required_text(cls, value):
        if not isinstance(value, (str, int, float)):
            raise ValueError("Expected short text")
        cleaned = str(value).strip()
        if not cleaned:
            raise ValueError("Text cannot be blank")
        return cleaned

    @field_validator("weight", "rest", "focus", mode="before")
    @classmethod
    def _clean_optional_text(cls, value):
        if value is None:
            return None
        if not isinstance(value, (str, int, float)):
            raise ValueError("Expected short text")
        return str(value).strip()[:500] or None


class CoachSummary(BaseModel):
    """Short, bounded explanation of a Coach proposal."""
    model_config = ConfigDict(extra="ignore")

    intensity: Optional[str] = Field(default=None, max_length=20)
    estimated_time: Optional[str] = Field(default=None, max_length=32)
    reason: Optional[str] = Field(default=None, max_length=500)


class StructuredDecision(BaseModel):
    """
    Validated public Coach response. This schema is used by both JSON and SSE
    routes so non-streaming clients retain the same evidence and action metadata.
    """
    model_config = ConfigDict(extra="ignore")

    response_type: Optional[ResponseType] = None
    coach_message: Optional[str] = Field(default=None, max_length=600)
    exercises: List[CoachExercise] = Field(default_factory=list, max_length=40)
    summary: Optional[CoachSummary] = None
    tips: List[str] = Field(default_factory=list, max_length=4)
    next_action: Optional[str] = Field(default=None, max_length=180)
    coach_insight: Optional[str] = Field(default=None, max_length=320)
    follow_up_question: Optional[str] = Field(default=None, max_length=240)
    question_options: List[str] = Field(default_factory=list, max_length=5)
    question_key: Optional[str] = Field(default=None, max_length=64)
    recovery: Optional[int] = Field(default=None, ge=0, le=100)
    intensity: Optional[Intensity] = None

    # Server-authored metadata. Never accept model-invented citations or tool labels.
    knowledge_sources: List[dict] = Field(default_factory=list, max_length=6)
    agent_activity: Optional[dict] = None

    @field_validator("response_type", mode="before")
    @classmethod
    def _fallback_response_type(cls, value):
        if value is None or value in ResponseType._value2member_map_:
            return value
        return ResponseType.chat

    @field_validator("intensity", mode="before")
    @classmethod
    def _fallback_intensity(cls, value):
        if value is None or value in Intensity._value2member_map_:
            return value
        if isinstance(value, str) and value.strip().lower() in ("recovery", "rest", "deload"):
            return Intensity.rest
        return None

    @field_validator("exercises", mode="before")
    @classmethod
    def _validate_exercises(cls, values):
        if not isinstance(values, list):
            return []
        valid = []
        for item in values[:40]:
            if not isinstance(item, dict):
                continue
            try:
                valid.append(CoachExercise.model_validate(item))
            except Exception:
                # Never display or activate an incomplete prescription.
                continue
        return valid

    @field_validator("summary", mode="before")
    @classmethod
    def _validate_summary(cls, value):
        if value is None or isinstance(value, CoachSummary):
            return value
        if not isinstance(value, dict):
            return None
        try:
            return CoachSummary.model_validate(value)
        except Exception:
            return None

    @field_validator("tips", mode="before")
    @classmethod
    def _bound_tips(cls, values):
        if not isinstance(values, list):
            return []
        return [
            value.strip()[:160]
            for value in values
            if isinstance(value, str) and value.strip()
        ][:4]

    @field_validator("question_options", mode="before")
    @classmethod
    def _bound_question_options(cls, values):
        if not isinstance(values, list):
            return []
        output = []
        for value in values:
            if isinstance(value, str) and value.strip():
                cleaned = value.strip()[:90]
                if cleaned not in output:
                    output.append(cleaned)
            if len(output) == 5:
                break
        return output

    @field_validator("knowledge_sources", mode="before")
    @classmethod
    def _server_sources_only(cls, values):
        if not isinstance(values, list):
            return []
        output = []
        for source in values[:6]:
            if not isinstance(source, dict):
                continue
            title = source.get("title")
            url = source.get("url")
            if isinstance(title, str) and title.strip() and isinstance(url, str) and url.startswith("https://"):
                output.append({
                    "title": title.strip()[:180],
                    "url": url[:600],
                    "category": str(source.get("category") or "general")[:80],
                })
        return output

    @field_validator("workout_type", mode="before")
    @classmethod
    def _normalise_workout_type(cls, value):
        if not isinstance(value, str):
            return None
        value = value.strip().lower().replace("-", "_").replace(" ", "_")
        supported = {"push", "pull", "legs", "upper", "lower", "full_body", "cardio", "mobility", "recovery", "rest"}
        return value if value in supported else None

    @model_validator(mode="after")
    def _downgrade_incomplete_workout(self):
        if self.response_type == ResponseType.workout_plan:
            complete = (
                self.workout_type is not None
                and self.summary is not None
                and (
                    self.workout_type == "rest"
                    or len(self.exercises) >= 3
                )
                and not (self.workout_type == "rest" and self.exercises)
            )
            if not complete:
                self.response_type = ResponseType.chat
                self.exercises = []
                self.summary = None
                self.coach_message = (
                    "I couldn't validate a complete workout prescription from the available details. "
                    "Let's clarify what is missing before I recommend a session."
                )
        if self.follow_up_question is None:
            self.question_options = []
            self.question_key = None
        return self

    # v1 backward-compat aliases
    mode: Optional[str] = None
    analysis: Optional[str] = None
    mission: Optional[str] = None
    workout_type: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[int] = None
    ai_decision: Optional[str] = None
    coaching_cue: Optional[str] = None
    reason: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    guardrails_triggered: List[str] = Field(default_factory=list)
    emergency: bool = False
    cns_fatigue_score: Optional[int] = None
    workout_blocks: Optional[dict] = None
    new_prs: List[dict] = Field(default_factory=list)
    motivation_message: Optional[str] = None
    structured_decision: Optional[StructuredDecision] = None


class ConversationMessage(BaseModel):
    role: MessageRole
    content: str
    created_at: datetime


# ─── Parsed Performance Log (LangGraph output) ───────────────────────────────

class PerformanceLog(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=120)
    weight_kg: float = Field(ge=0, le=1000)
    reps_completed: int = Field(ge=1, le=1000)
    equipment_modifiers: Optional[List[str]] = Field(default_factory=list, max_length=12)
    user_reported_rpe: Optional[float] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=300)


# ─── Progress Metrics ────────────────────────────────────────────────────────

class MetricsCreate(BaseModel):
    recorded_date: Optional[date] = None
    weight_kg: Optional[float] = Field(None, gt=0, lt=500)
    recovery_score: Optional[float] = Field(None, ge=0, le=100)
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


# ─── Today's Mission (Agentic Dashboard) ─────────────────────────────────────

class TankStatus(BaseModel):
    label: str
    consumed: float
    target: float
    pct: int
    color: str   # hex, used by the frontend gauge


class MissionTask(BaseModel):
    icon: str
    text: str
    agent: str   # which agent generated this — "nutrition" | "workout" | "recovery" | "planner"
    priority: int = 1   # lower = more urgent


class DashboardResponse(BaseModel):
    user_name: str
    greeting: str
    today_workout_type: str
    today_workout_time: Optional[str] = None
    today_workout_duration_min: int = 0
    calories_tank: TankStatus
    protein_tank: TankStatus
    water_tank: TankStatus
    next_tasks: List[MissionTask] = Field(default_factory=list)
    last_session_summary: Optional[str] = None
    next_target: Optional[str] = None
    workout_streak: int = 0
    protein_streak: int = 0
    motivation_message: str = ""
    cns_fatigue_score: int = 0
    sleep_goal: Optional[str] = None
    mission_text: str = ""


# ─── Agent decision payloads ─────────────────────────────────────────────────

class NutritionDecision(BaseModel):
    message: str
    suggested_meal: Optional[str] = None
    calories_remaining: int
    protein_remaining_g: float


class WorkoutDecision(BaseModel):
    message: str
    rescheduled: bool = False
    recommended_type: Optional[str] = None


class ProgressDecision(BaseModel):
    message: str
    stalled: bool = False
    suggested_calorie_adjustment: int = 0
    trend: str = "stable"          # "gaining" | "losing" | "stalled" | "stable"

    @property
    def calorie_adjustment(self) -> int:
        """Back-compat alias — some callers may expect the old field name."""
        return self.suggested_calorie_adjustment


class RecoveryDecision(BaseModel):
    message: str
    recovery_score: int = Field(ge=0, le=10)
    action: str = "proceed"        # "proceed" | "replace_with_light" | "rest"

    @property
    def recommend_deload(self) -> bool:
        return self.action == "rest"


# ─── AI Decision Center ───────────────────────────────────────────────────────
# Backs the "Today's Decision" card. Deliberately NOT an LLM-generated
# confidence number — every value here is derived from the same
# deterministic agent outputs (recovery_agent, progress_agent, nutrition
# targets, workout streak) that already drive the rest of the dashboard.
# An LLM is only ever used for the free-text `reasoning` sentence, which
# is generated FROM these already-computed facts, not the other way
# around — so the displayed evidence can never disagree with the
# explanation, and confidence can never be a number nobody can trace.

class EvidenceSignal(BaseModel):
    label: str            # "Recovery", "Sleep", "Protein", "Bench Trend", "Shoulder Pain"
    value: str             # human-readable current value: "84%", "7h42m", "162g", "+5kg", "None"
    favorable: bool        # True = this signal supports today's decision, False = against it
    weight: float = 1.0    # relative weight this signal had in the confidence calc, for transparency


class WhyNotItem(BaseModel):
    option: str    # the rejected alternative: "Rest", "Legs Day", "PR Attempt"
    reason: str    # deterministic, signal-grounded explanation for rejecting it


class DecisionCenter(BaseModel):
    decision: str                      # "Heavy Push Day", "Rest Day", "Deload Week"
    confidence_pct: int = Field(ge=0, le=100)
    signals: List[EvidenceSignal]      # the real numbers confidence was computed from
    reasoning: str                     # short LLM sentence explaining the decision, grounded in `signals`
    expected_outcome: Optional[str] = None
    alternative: Optional[str] = None  # what to do instead if a named signal worsens
    why_not: List[WhyNotItem] = Field(default_factory=list)  # alternatives considered and rejected, each grounded in real signals


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