"""
Program Rewriter + Program Evolution Routes — VYRN

Backs:
  - GET  /api/program/versions   → ProgramEvolution UI (version chip row)
  - POST /api/program/rewrite    → trigger adaptive rewrite on demand
  - GET  /api/program/latest     → what changed in the most recent version
"""
import asyncio
import copy
import logging
import math
from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context
from agents.program_rewriter import run_program_rewriter
from api.routes.training_plans import _load_athlete_constraints, validate_workout_constraints, WorkoutPrescription
from services.exercise_catalog import normalize_exercise_name, resolve_exercise

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Program Evolution"])


def _apply_adaptive_changes(snapshot: dict, changes: list[dict], trigger: str) -> dict:
    """Apply only deterministic, explainable edits to a copied approved snapshot."""
    proposed = copy.deepcopy(snapshot)
    workout = proposed.get("workout")
    if not isinstance(workout, dict) or not isinstance(workout.get("exercises"), list):
        raise HTTPException(
            409,
            "Your active plan does not contain a detailed approved exercise prescription yet. Build and approve a detailed workout before requesting an adaptive change.",
        )

    exercises = workout["exercises"]
    if not exercises:
        raise HTTPException(409, "The approved plan has no exercises to adapt.")

    for change in changes:
        change_type = str(change.get("type") or "")
        target_name = str(change.get("exercise") or "").strip().casefold()
        for exercise in exercises:
            if not isinstance(exercise, dict):
                continue
            current_name = str(exercise.get("name") or "").strip()
            target_definition = resolve_exercise(target_name) if target_name else None
            current_definition = resolve_exercise(current_name)
            matches_target = (
                not target_name
                or normalize_exercise_name(current_name) == normalize_exercise_name(target_name)
                or (
                    target_definition is not None
                    and current_definition is not None
                    and target_definition.exercise_id == current_definition.exercise_id
                )
            )
            if change_type == "deload":
                original_sets = max(1, int(exercise.get("sets") or 1))
                exercise["sets"] = max(1, math.floor(original_sets * 0.7))
                load = exercise.get("load_kg")
                if isinstance(load, (int, float)) and load > 0:
                    exercise["load_kg"] = round(float(load) * 0.7, 2)
                exercise["rpe_target"] = min(float(exercise.get("rpe_target") or 7), 7)
            elif change_type == "volume_reduction" and matches_target:
                current_sets = max(1, int(exercise.get("sets") or 1))
                exercise["sets"] = max(1, current_sets - 1) if trigger.startswith("plateau") else max(1, math.floor(current_sets * 0.85))
            elif change_type == "intensity_increase" and matches_target:
                load = exercise.get("load_kg")
                if isinstance(load, (int, float)) and load > 0:
                    exercise["load_kg"] = round(float(load) * 1.025, 2)
                exercise["reps"] = "5-8"
            elif change_type == "intensity_reduction":
                exercise["rpe_target"] = min(float(exercise.get("rpe_target") or 7), 7)
            elif change_type == "session_cap":
                workout["estimated_duration_minutes"] = min(
                    45,
                    int(workout.get("estimated_duration_minutes") or 45),
                )
            elif change_type == "exercise_swap" and matches_target:
                swap_to = str(change.get("swap_to") or "").strip()
                if swap_to:
                    exercise["name"] = swap_to
                    exercise.pop("exercise_id", None)
                    exercise.pop("equipment_required", None)
                    exercise.pop("muscle_groups", None)

    return proposed


@router.get("/versions")
async def list_versions(
    limit: int = 10,
    current_user: dict = Depends(get_current_user),
):
    """
    Return program version history for the Program Evolution UI.
    Each version has a version_number, trigger, explanation, and changes list.
    """
    sb = get_supabase()
    try:
        res = (
            sb.table("program_versions")
            .select("id, version_number, trigger, explanation, changes, created_at")
            .eq("user_id", current_user["user_id"])
            .order("version_number", desc=True)
            .limit(limit)
            .execute()
        )
        return {"versions": res.data or []}
    except Exception as e:
        raise HTTPException(500, f"Could not load program versions: {e}")


@router.post("/rewrite")
async def trigger_rewrite(
    current_user: dict = Depends(get_current_user),
):
    """
    Run the adaptive program rewriter now. Returns the rewrite result.
    Safe to call multiple times — if no rewrite is needed it returns
    rewrite_triggered=False without writing anything.
    """
    user_id = current_user["user_id"]
    try:
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        result = await asyncio.to_thread(run_program_rewriter, user_id, profile)
        return result
    except Exception as e:
        raise HTTPException(500, f"Program rewriter error: {e}")


@router.post("/propose-rewrite")
async def propose_program_rewrite(
    current_user: dict = Depends(get_current_user),
):
    """Create a detailed, unapproved plan draft from evidence-based rewrite signals.

    The legacy /rewrite endpoint remains available for the old change-history UI.
    This endpoint deliberately does not write a program_versions row or apply a
    change. Approval is performed through the versioned training-plan API.
    """
    user_id = current_user["user_id"]
    sb = get_supabase()
    try:
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        result = await asyncio.to_thread(run_program_rewriter, user_id, profile, False)
        if not result.get("rewrite_triggered"):
            return {**result, "proposal_created": False}

        active_result = (
            sb.table("workout_plans")
            .select("id, name, phase, weeks, schedule, current_version_id")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        active_rows = active_result.data or []
        if not active_rows or not active_rows[0].get("current_version_id"):
            raise HTTPException(
                409,
                "Approve a detailed version of your training plan before requesting adaptive changes.",
            )
        plan = active_rows[0]
        current_version_result = (
            sb.table("workout_plan_versions")
            .select("id, status, snapshot")
            .eq("id", plan["current_version_id"])
            .eq("plan_id", plan["id"])
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        version_rows = current_version_result.data or []
        if not version_rows or version_rows[0].get("status") != "approved":
            raise HTTPException(409, "The active training plan has no approved detailed version.")
        current_snapshot = version_rows[0].get("snapshot") or {}
        proposed_snapshot = _apply_adaptive_changes(
            current_snapshot,
            result.get("changes") or [],
            str(result.get("trigger") or ""),
        )

        equipment, injuries = _load_athlete_constraints(sb, user_id)
        workout_model = WorkoutPrescription.model_validate(proposed_snapshot.get("workout") or {})
        proposed_snapshot["workout"] = validate_workout_constraints(
            workout_model, equipment, injuries
        )
        proposed_snapshot["adaptive_trigger"] = result.get("trigger")
        proposed_snapshot["adaptive_changes"] = result.get("changes") or []
        proposed_snapshot["change_reason"] = result.get("explanation")

        saved = sb.rpc(
            "save_workout_plan_draft",
            {
                "p_user_id": user_id,
                "p_plan_id": plan["id"],
                "p_name": proposed_snapshot.get("name") or plan["name"],
                "p_phase": proposed_snapshot.get("phase") or plan.get("phase"),
                "p_weeks": proposed_snapshot.get("weeks") or plan.get("weeks") or 4,
                "p_schedule": proposed_snapshot.get("schedule") or plan.get("schedule") or {},
                "p_snapshot": proposed_snapshot,
                "p_change_reason": result.get("explanation") or result.get("trigger") or "Adaptive plan proposal",
            },
        ).execute()
        rows = saved.data or []
        if not rows:
            raise HTTPException(500, "The adaptive plan proposal could not be saved.")
        draft = rows[0]
        return {
            "proposal_created": True,
            "plan_id": draft["out_plan_id"],
            "version_id": draft["out_version_id"],
            "version_number": draft["out_version_number"],
            "status": draft["out_status"],
            "trigger": result.get("trigger"),
            "changes": result.get("changes") or [],
            "explanation": result.get("explanation"),
            "snapshot": draft["out_snapshot"],
            "requires_approval": True,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Adaptive plan proposal failed for %s", user_id)
        raise HTTPException(500, "Could not generate or save the adaptive plan proposal.") from exc


@router.get("/latest")
async def get_latest_version(
    current_user: dict = Depends(get_current_user),
):
    """What changed in the most recent program version, for the dashboard card."""
    sb = get_supabase()
    try:
        res = (
            sb.table("program_versions")
            .select("version_number, trigger, explanation, changes, created_at")
            .eq("user_id", current_user["user_id"])
            .order("version_number", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else {"version_number": 0, "trigger": None, "explanation": None, "changes": []}
    except Exception as e:
        raise HTTPException(500, f"Could not load latest version: {e}")
