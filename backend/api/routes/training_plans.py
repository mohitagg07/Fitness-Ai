"""Versioned, user-approved workout plans.

The plan version snapshot is the authoritative prescription. Workout sessions
reference the approved version and copy its workout snapshot so history never
changes when a later plan is approved.
"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core.security import get_current_user
from db.supabase_client import get_supabase

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
    name: str = Field(default="VYRN Training Plan", min_length=1, max_length=120)
    goal: str | None = Field(default=None, max_length=40)
    phase: str | None = Field(default=None, max_length=60)
    weeks: int = Field(default=4, ge=1, le=52)
    schedule: dict[str, str] = Field(default_factory=dict)
    workout: WorkoutPrescription
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


class SessionTransitionRequest(BaseModel):
    action: Literal["pause", "resume", "abandon"]


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
    data = payload.model_dump()
    workout = data.pop("workout")
    change_reason = data.pop("change_reason", None)
    snapshot = {**data, "workout": workout}
    try:
        result = get_supabase().rpc(
            "save_workout_plan_draft",
            {
                "p_user_id": user_id,
                "p_plan_id": None,
                "p_name": payload.name,
                "p_phase": payload.phase,
                "p_weeks": payload.weeks,
                "p_schedule": payload.schedule,
                "p_snapshot": snapshot,
                "p_change_reason": change_reason or "New Coach-generated workout",
            },
        ).execute()
    except Exception as exc:
        raise HTTPException(500, "Could not create the workout draft") from exc
    if not result.data:
        raise HTTPException(500, "Could not save the workout draft")
    saved = result.data[0]
    plan_result = (
        get_supabase().table("workout_plans")
        .select("*")
        .eq("id", saved["out_plan_id"])
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return {
        "plan": plan_result.data[0] if plan_result.data else {"id": saved["out_plan_id"]},
        "version": {
            "id": saved["out_version_id"],
            "version_number": saved["out_version_number"],
            "status": saved["out_status"],
            "snapshot": saved["out_snapshot"],
        },
    }


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
        sb.table("workout_plan_versions")
        .select("*")
        .eq("id", version_id)
        .eq("plan_id", plan_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not current.data:
        raise HTTPException(404, "Workout plan draft not found")
    if current.data[0].get("status") != "draft":
        raise HTTPException(409, "Only a draft plan version can be edited")

    data = payload.model_dump()
    workout = data.pop("workout")
    data.pop("change_reason", None)
    if not data.get("schedule"):
        data["schedule"] = plan.get("schedule") or {}
    snapshot = {**data, "workout": workout}
    updated = (
        sb.table("workout_plan_versions")
        .update({"snapshot": snapshot, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", version_id)
        .eq("plan_id", plan_id)
        .eq("user_id", user_id)
        .eq("status", "draft")
        .select("*")
        .execute()
    )
    if not updated.data:
        raise HTTPException(409, "The workout draft changed before it could be saved")
    return updated.data[0]


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
        raise HTTPException(409, "The workout plan could not be approved") from exc
    if not result.data:
        raise HTTPException(409, "The workout plan could not be approved")
    return result.data[0]


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
    return result.data[0]


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
    return result.data[0]
