"""Versioned, user-approved workout plans.

The plan version snapshot is the authoritative prescription. Workout sessions
reference the approved version and copy its workout snapshot so history never
changes when a later plan is approved.
"""
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from core.security import get_current_user
from db.supabase_client import get_supabase
from services.exercise_catalog import resolve_exercise
from services.exercise_library import BODY_PART_TO_MUSCLE_GROUPS

router = APIRouter(tags=["Training Plans"])

DAY_KEYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
WORKOUT_TYPES = {
    "push", "pull", "legs", "upper", "lower", "full_body",
    "cardio", "mobility", "recovery", "rest",
}


class PlannedExercise(BaseModel):
    exercise_id: str | None = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    sets: int = Field(ge=1, le=20)
    reps: str = Field(min_length=1, max_length=30)
    load_kg: float | None = Field(default=None, ge=0, le=1000)
    load_guidance: str | None = Field(default=None, max_length=240)
    rest_seconds: int = Field(default=90, ge=0, le=900)
    rpe_target: float | None = Field(default=None, ge=1, le=10)
    rir_target: float | None = Field(default=None, ge=0, le=10)
    tempo: str | None = Field(default=None, max_length=20)
    cue: str | None = Field(default=None, max_length=500)
    equipment_required: list[str] = Field(default_factory=list, max_length=12)
    muscle_groups: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Exercise name cannot be blank")
        return value

    @field_validator("reps")
    @classmethod
    def clean_reps(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Rep target cannot be blank")
        return value


class WorkoutPrescription(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    workout_type: Literal[
        "push", "pull", "legs", "upper", "lower", "full_body",
        "cardio", "mobility", "recovery", "rest"
    ]
    muscle_groups: list[str] = Field(default_factory=list, max_length=12)
    estimated_duration_minutes: int | None = Field(default=None, ge=5, le=300)
    warmup_notes: str | None = Field(default=None, max_length=1000)
    cooldown_notes: str | None = Field(default=None, max_length=1000)
    exercises: list[PlannedExercise] = Field(default_factory=list, max_length=40)

    @field_validator("exercises")
    @classmethod
    def require_exercises_for_training(cls, value, info):
        workout_type = info.data.get("workout_type")
        if workout_type != "rest" and not value:
            raise ValueError("A training workout must contain at least one exercise")
        if workout_type == "rest" and value:
            raise ValueError("A rest day cannot contain prescribed exercises")
        return value


class PlanDraftRequest(BaseModel):
    """A weekly plan with an individual exercise prescription per training day.

    A single workout remains supported for an ad-hoc one-session draft. A
    multi-day schedule must provide a separate prescription for each day.
    """
    name: str = Field(default="VYRN Training Plan", min_length=1, max_length=120)
    goal: str | None = Field(default=None, max_length=40)
    phase: str | None = Field(default=None, max_length=60)
    weeks: int = Field(default=4, ge=1, le=52)
    schedule: dict[str, str] = Field(default_factory=dict)
    workout: WorkoutPrescription | None = None
    workouts_by_day: dict[str, WorkoutPrescription] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    change_reason: str | None = Field(default=None, max_length=1000)

    @field_validator("schedule")
    @classmethod
    def validate_schedule(cls, value: dict[str, str]) -> dict[str, str]:
        normalized = {}
        for day, workout_type in value.items():
            key = day.strip().lower()
            kind = workout_type.strip().lower()
            if key not in DAY_KEYS:
                raise ValueError(f"Unsupported schedule day: {day}")
            if kind not in WORKOUT_TYPES:
                raise ValueError(f"Unsupported workout type for {day}: {workout_type}")
            normalized[key] = kind
        return normalized

    @field_validator("workouts_by_day")
    @classmethod
    def validate_workout_days(cls, value: dict[str, WorkoutPrescription]) -> dict[str, WorkoutPrescription]:
        normalized = {}
        for day, prescription in value.items():
            key = day.strip().lower()
            if key not in DAY_KEYS:
                raise ValueError(f"Unsupported workout prescription day: {day}")
            normalized[key] = prescription
        return normalized

    @model_validator(mode="after")
    def validate_weekly_prescriptions(self):
        if not self.schedule and self.workouts_by_day:
            self.schedule = {
                day: workout.workout_type
                for day, workout in self.workouts_by_day.items()
            }

        active_days = {
            day: kind for day, kind in self.schedule.items()
            if kind != "rest"
        }
        extra_days = set(self.workouts_by_day) - set(self.schedule)
        if self.schedule and extra_days:
            raise ValueError(
                "Workout prescriptions exist for days absent from the weekly schedule"
            )

        if self.schedule:
            for day, kind in self.schedule.items():
                prescription = self.workouts_by_day.get(day)
                if kind == "rest":
                    if prescription is not None and prescription.workout_type != "rest":
                        raise ValueError(f"{day} is scheduled as rest but has a training prescription")
                    continue
                if prescription is None and len(active_days) == 1 and self.workout is not None:
                    if self.workout.workout_type != kind:
                        raise ValueError(f"The {day} schedule expects {kind}, not {self.workout.workout_type}")
                    self.workouts_by_day[day] = self.workout
                    prescription = self.workout
                if prescription is None:
                    raise ValueError(f"A separate exercise prescription is required for {day} ({kind})")
                if prescription.workout_type != kind:
                    raise ValueError(f"The {day} prescription is {prescription.workout_type}, but the schedule says {kind}")
        elif self.workout is None and not self.workouts_by_day:
            raise ValueError("Provide a single workout or at least one day-specific workout prescription")

        return self


class SessionTransitionRequest(BaseModel):
    action: Literal["pause", "resume", "abandon"]


def validate_workout_constraints(
    workout: WorkoutPrescription,
    available_equipment: list[str] | None,
    injuries: list[dict] | None,
) -> dict:
    """Canonicalize and validate a proposed prescription against known athlete constraints.

    Unknown exercises are not silently accepted: the current curated catalogue
    is the safety/anatomy source of truth. Equipment requirements are derived
    from that catalogue instead of trusting LLM-provided metadata.
    """
    owned = {str(value).strip().lower().replace("-", "_").replace(" ", "_") for value in (available_equipment or [])}
    equipment_aliases = {
        "bar": "pull_up_bar",
        "rack": "squat_rack",
        "body_weight": "bodyweight",
    }
    owned = {equipment_aliases.get(value, value) for value in owned}

    blocked_groups: set[str] = set()
    for injury in injuries or []:
        try:
            severity = int(injury.get("severity") or 0)
        except (TypeError, ValueError):
            severity = 0
        if severity < 4 and not injury.get("doctor_restriction"):
            continue
        body_part = str(injury.get("body_part") or "").strip().lower().replace("_", " ")
        for injured_part, groups in BODY_PART_TO_MUSCLE_GROUPS.items():
            if injured_part in body_part:
                blocked_groups.update(groups)

    canonical_exercises = []
    for item in workout.exercises:
        definition = resolve_exercise(item.name)
        if definition is None:
            raise HTTPException(
                422,
                f"{item.name} is not in VYRN's reviewed exercise catalogue. Choose a supported exercise before approving this plan.",
            )
        if item.exercise_id and item.exercise_id != definition.exercise_id:
            raise HTTPException(422, f"Exercise identity mismatch for {item.name}.")

        required = {
            equipment_aliases.get(str(value).strip().lower().replace("-", "_").replace(" ", "_"),
                                  str(value).strip().lower().replace("-", "_").replace(" ", "_"))
            for value in definition.equipment
            if value != "bodyweight"
        }
        missing = sorted(required - owned)
        if missing:
            raise HTTPException(
                422,
                f"{definition.name} requires equipment not recorded in your profile: {', '.join(missing)}. Update your equipment profile or choose another exercise.",
            )
        if definition.primary_group in blocked_groups:
            raise HTTPException(
                409,
                f"{definition.name} targets {definition.primary_group}, which overlaps a recorded injury restriction. Choose a safer movement or update the restriction with your clinician's guidance.",
            )

        canonical_exercises.append({
            **item.model_dump(),
            "exercise_id": definition.exercise_id,
            "name": definition.name,
            "equipment_required": list(definition.equipment),
            "muscle_groups": [definition.primary_group],
        })

    return {
        "label": workout.label,
        "workout_type": workout.workout_type,
        "muscle_groups": workout.muscle_groups,
        "estimated_duration_minutes": workout.estimated_duration_minutes,
        "warmup_notes": workout.warmup_notes,
        "cooldown_notes": workout.cooldown_notes,
        "exercises": canonical_exercises,
    }


def _validated_plan_snapshot(
    payload: PlanDraftRequest,
    equipment: list[str],
    injuries: list[dict],
) -> dict:
    """Validate each day independently and build the versioned prescription."""
    day_prescriptions = {
        day: validate_workout_constraints(workout, equipment, injuries)
        for day, workout in payload.workouts_by_day.items()
    }
    snapshot = payload.model_dump(exclude={"workout", "workouts_by_day", "change_reason"})
    snapshot["workouts_by_day"] = day_prescriptions
    if payload.workout is not None:
        snapshot["workout"] = validate_workout_constraints(payload.workout, equipment, injuries)
    return snapshot


def _with_previous_snapshot(sb, user_id: str, version: dict) -> dict:
    """Resolve the before-state from the immutable parent-version reference."""
    result = dict(version)
    base_id = result.get("base_version_id")
    previous = None
    if base_id:
        parent = (
            sb.table("workout_plan_versions")
            .select("id, version_number, status, snapshot, approved_at")
            .eq("id", base_id).eq("user_id", user_id).limit(1).execute()
        )
        previous = parent.data[0] if parent.data else None
    result["previous_snapshot"] = previous.get("snapshot") if previous else None
    result["approval_state"] = (
        "approved" if result.get("status") == "approved"
        else "rejected" if result.get("status") == "rejected"
        else "superseded" if result.get("status") == "superseded"
        else "pending_athlete"
    )
    result["applied"] = result.get("status") == "approved"
    result["requires_approval"] = result.get("status") == "draft"
    return result


def _load_athlete_constraints(sb, user_id: str) -> tuple[list[str], list[dict]]:
    profile_result = (
        sb.table("profiles")
        .select("equipment, gym_or_home")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    injury_result = (
        sb.table("injury_profiles")
        .select("body_part, severity, doctor_restriction")
        .eq("user_id", user_id)
        .execute()
    )
    profile = profile_result.data[0] if profile_result.data else {}
    return profile.get("equipment") or [], injury_result.data or []


def _owned_plan(sb, user_id: str, plan_id: str) -> dict:
    result = (
        sb.table("workout_plans")
        .select("*")
        .eq("id", plan_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Workout plan not found")
    return result.data[0]


@router.get("/active")
async def get_active_training_plan(current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    user_id = current_user["user_id"]
    result = (
        sb.table("workout_plans")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return {"plan": None, "version": None}
    plan = result.data[0]
    version = None
    version_id = plan.get("current_version_id")
    if version_id:
        version_result = (
            sb.table("workout_plan_versions")
            .select("*")
            .eq("id", version_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        version = version_result.data[0] if version_result.data else None
    return {"plan": plan, "version": version}


@router.post("/drafts", status_code=201)
async def create_plan_draft(
    payload: PlanDraftRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    sb = get_supabase()
    equipment, injuries = _load_athlete_constraints(sb, user_id)
    snapshot = _validated_plan_snapshot(payload, equipment, injuries)

    try:
        result = sb.rpc(
            "save_workout_plan_draft",
            {
                "p_user_id": user_id,
                "p_plan_id": None,
                "p_name": payload.name,
                "p_phase": payload.phase,
                "p_weeks": payload.weeks,
                "p_schedule": payload.schedule,
                "p_snapshot": snapshot,
                "p_change_reason": payload.change_reason or "New Coach-generated workout",
            },
        ).execute()
    except Exception as exc:
        raise HTTPException(500, "Could not create the workout draft") from exc
    if not result.data:
        raise HTTPException(500, "Could not save the workout draft")

    saved = result.data[0]
    plan_result = (
        sb.table("workout_plans").select("*")
        .eq("id", saved["out_plan_id"]).eq("user_id", user_id).limit(1).execute()
    )
    version_result = (
        sb.table("workout_plan_versions").select("*")
        .eq("id", saved["out_version_id"]).eq("user_id", user_id).limit(1).execute()
    )
    if not version_result.data:
        raise HTTPException(500, "The draft was saved but could not be retrieved")
    version = _with_previous_snapshot(sb, user_id, version_result.data[0])
    version["change_reason"] = payload.change_reason or "New Coach-generated workout"

    return {
        "plan": plan_result.data[0] if plan_result.data else {"id": saved["out_plan_id"]},
        "version": version,
        "proposal": {
            "applied": False,
            "approval_state": "pending_athlete",
            "requires_approval": True,
            "previous_snapshot": version.get("previous_snapshot"),
            "proposed_snapshot": version.get("snapshot"),
            "change_reason": version.get("change_reason"),
            "evidence": payload.evidence,
        },
    }


@router.get("/{plan_id}/versions")
async def list_training_plan_versions(
    plan_id: str,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    if limit < 1 or limit > 50:
        raise HTTPException(422, "Version history limit must be between 1 and 50")
    sb = get_supabase()
    user_id = current_user["user_id"]
    _owned_plan(sb, user_id, plan_id)
    result = (
        sb.table("workout_plan_versions")
        .select("id, plan_id, version_number, status, snapshot, base_version_id, change_reason, approved_by, approved_at, created_at")
        .eq("plan_id", plan_id)
        .eq("user_id", user_id)
        .order("version_number", desc=True)
        .limit(limit)
        .execute()
    )
    return {"versions": result.data or []}


@router.patch("/{plan_id}/versions/{version_id}")
async def update_plan_draft(
    plan_id: str,
    version_id: str,
    payload: PlanDraftRequest,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    user_id = current_user["user_id"]
    plan = _owned_plan(sb, user_id, plan_id)
    current = (
        sb.table("workout_plan_versions").select("*")
        .eq("id", version_id).eq("plan_id", plan_id)
        .eq("user_id", user_id).limit(1).execute()
    )
    if not current.data:
        raise HTTPException(404, "Workout plan draft not found")
    draft = current.data[0]
    if draft.get("status") != "draft":
        raise HTTPException(409, "Only a draft plan version can be edited")
    if draft.get("base_version_id") != plan.get("current_version_id"):
        raise HTTPException(409, "This draft is based on an older plan version. Create a fresh proposal.")

    equipment, injuries = _load_athlete_constraints(sb, user_id)
    snapshot = _validated_plan_snapshot(payload, equipment, injuries)
    if not snapshot.get("schedule"):
        snapshot["schedule"] = plan.get("schedule") or {}
    updated = (
        sb.table("workout_plan_versions")
        .update({
            "snapshot": snapshot,
            "change_reason": payload.change_reason or draft.get("change_reason"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", version_id).eq("plan_id", plan_id)
        .eq("user_id", user_id).eq("status", "draft")
        .select("*").execute()
    )
    if not updated.data:
        raise HTTPException(409, "The workout draft changed before it could be saved")
    version = _with_previous_snapshot(sb, user_id, updated.data[0])
    return {
        **version,
        "applied": False,
        "approval_state": "pending_athlete",
        "requires_approval": True,
        "evidence": payload.evidence,
    }


@router.post("/{plan_id}/versions/{version_id}/approve")
async def approve_plan_version(
    plan_id: str,
    version_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    try:
        result = get_supabase().rpc(
            "approve_workout_plan_version",
            {"p_user_id": user_id, "p_plan_id": plan_id, "p_version_id": version_id},
        ).execute()
    except Exception as exc:
        message = str(exc).upper()
        if "PLAN_NOT_FOUND" in message or "PLAN_VERSION_NOT_FOUND" in message:
            raise HTTPException(404, "Workout plan or draft not found") from exc
        if "PLAN_DRAFT_STALE" in message:
            raise HTTPException(409, "This proposal is based on an older plan version. Refresh and create a new proposal.") from exc
        raise HTTPException(409, "The workout plan could not be approved") from exc
    if not result.data:
        raise HTTPException(409, "The workout plan could not be approved")
    return {
        **result.data[0],
        "applied": True,
        "approval_state": "approved",
        "requires_approval": False,
    }


@router.post("/{plan_id}/versions/{version_id}/reject")
async def reject_plan_version(
    plan_id: str,
    version_id: str,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    user_id = current_user["user_id"]
    _owned_plan(sb, user_id, plan_id)
    result = (
        sb.table("workout_plan_versions")
        .update({"status": "rejected", "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", version_id)
        .eq("plan_id", plan_id)
        .eq("user_id", user_id)
        .eq("status", "draft")
        .select("*")
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Editable workout draft not found")
    return {
        **result.data[0],
        "applied": False,
        "approval_state": "rejected",
        "requires_approval": False,
    }


@router.post("/{plan_id}/versions/{version_id}/rollback")
async def rollback_plan_version(
    plan_id: str,
    version_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    try:
        result = get_supabase().rpc(
            "rollback_workout_plan_version",
            {
                "p_user_id": user_id,
                "p_plan_id": plan_id,
                "p_source_version_id": version_id,
                "p_reason": "Athlete restored a previous approved workout plan",
            },
        ).execute()
    except Exception as exc:
        message = str(exc).upper()
        if "PLAN_NOT_FOUND" in message or "PLAN_VERSION_NOT_FOUND" in message:
            raise HTTPException(404, "Workout plan or version not found") from exc
        raise HTTPException(409, "The previous workout plan could not be restored") from exc
    if not result.data:
        raise HTTPException(409, "The previous workout plan could not be restored")
    return {
        **result.data[0],
        "applied": True,
        "approval_state": "approved",
        "requires_approval": False,
        "rollback": True,
    }
