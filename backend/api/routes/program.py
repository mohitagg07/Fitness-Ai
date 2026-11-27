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
from services.exercise_catalog import resolve_exercise

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Program Evolution"])


def _workout_entries(snapshot: dict) -> list[tuple[str, dict]]:
    """Return every scheduled day prescription, or the legacy single session."""
    by_day = snapshot.get("workouts_by_day")
    if isinstance(by_day, dict) and by_day:
        return [
            (str(day), workout)
            for day, workout in by_day.items()
            if isinstance(workout, dict) and str(workout.get("workout_type") or "").lower() != "rest"
        ]
    workout = snapshot.get("workout")
    if isinstance(workout, dict) and str(workout.get("workout_type") or "").lower() != "rest":
        return [("session", workout)]
    return []


def _apply_adaptive_changes(snapshot: dict, changes: list[dict], trigger: str) -> dict:
    """Apply deterministic, explainable edits to every affected day prescription."""
    proposed = copy.deepcopy(snapshot)
    entries = _workout_entries(proposed)
    if not entries or not any(isinstance(workout.get("exercises"), list) and workout["exercises"] for _, workout in entries):
        raise HTTPException(409, "The active plan does not contain a detailed approved exercise prescription to adapt.")

    mutation_count = 0
    for change in changes:
        change_type = str(
            change.get("type") or change.get("action") or change.get("category") or ""
        ).strip().lower()
        target_name = str(
            change.get("exercise") or change.get("target_exercise") or change.get("from") or ""
        ).strip().casefold()
        target_definition = resolve_exercise(target_name) if target_name else None

        for _day, workout in entries:
            if change_type == "session_cap":
                previous = workout.get("estimated_duration_minutes")
                workout["estimated_duration_minutes"] = min(45, int(previous or 45))
                mutation_count += int(previous != workout["estimated_duration_minutes"])
                continue

            for exercise in workout.get("exercises") or []:
                if not isinstance(exercise, dict):
                    continue
                current_name = str(exercise.get("name") or "").strip()
                current_definition = resolve_exercise(current_name)
                matches_target = (
                    not target_name
                    or current_name.casefold() == target_name
                    or (
                        target_definition is not None
                        and current_definition is not None
                        and target_definition.exercise_id == current_definition.exercise_id
                    )
                )
                if not matches_target:
                    continue

                before = {
                    "name": exercise.get("name"),
                    "sets": exercise.get("sets"),
                    "reps": exercise.get("reps"),
                    "load_kg": exercise.get("load_kg"),
                    "rpe_target": exercise.get("rpe_target"),
                }

                if change_type == "deload":
                    original_sets = max(1, int(exercise.get("sets") or 1))
                    exercise["sets"] = max(1, math.floor(original_sets * 0.7))
                    load = exercise.get("load_kg")
                    if isinstance(load, (int, float)) and load > 0:
                        exercise["load_kg"] = round(float(load) * 0.7, 2)
                    exercise["rpe_target"] = min(float(exercise.get("rpe_target") or 7), 7)
                elif change_type == "volume_reduction":
                    current_sets = max(1, int(exercise.get("sets") or 1))
                    exercise["sets"] = (
                        max(1, current_sets - 1)
                        if trigger.startswith("plateau")
                        else max(1, math.floor(current_sets * 0.85))
                    )
                elif change_type == "intensity_increase":
                    load = exercise.get("load_kg")
                    if isinstance(load, (int, float)) and load > 0:
                        exercise["load_kg"] = round(float(load) * 1.025, 2)
                    exercise["reps"] = "5-8"
                elif change_type in ("intensity_reduction", "intensity_hold"):
                    exercise["rpe_target"] = min(float(exercise.get("rpe_target") or 7), 7)
                elif change_type in ("nutrition_flag", "under_fueling"):
                    # Volume reduction is already applied by the separate
                    # volume_reduction item. This change is a coaching flag,
                    # not a second volume cut.
                    pass
                elif change_type in ("exercise_swap", "swap_exercise"):
                    swap_to = str(
                        change.get("swap_to") or change.get("replacement") or change.get("to") or ""
                    ).strip()
                    if swap_to:
                        exercise["name"] = swap_to
                        exercise.pop("exercise_id", None)
                        exercise.pop("equipment_required", None)
                        exercise.pop("muscle_groups", None)

                after = {
                    "name": exercise.get("name"),
                    "sets": exercise.get("sets"),
                    "reps": exercise.get("reps"),
                    "load_kg": exercise.get("load_kg"),
                    "rpe_target": exercise.get("rpe_target"),
                }
                mutation_count += int(before != after)

    if mutation_count == 0:
        raise HTTPException(409, "The detected change did not match any exercise in the active plan. No draft was created.")
    return proposed


def _snapshot_change_details(before: dict, after: dict) -> tuple[list[dict], list[dict], list[str]]:
    """Return field-level per-day changes plus unchanged prescriptions."""
    before_entries = dict(_workout_entries(before))
    after_entries = dict(_workout_entries(after))
    changed: list[dict] = []
    unchanged: list[dict] = []
    changed_days: set[str] = set()

    for day in sorted(set(before_entries) | set(after_entries)):
        old_workout = before_entries.get(day) or {}
        new_workout = after_entries.get(day) or {}
        old_exercises = old_workout.get("exercises") or []
        new_exercises = new_workout.get("exercises") or []

        old_duration = old_workout.get("estimated_duration_minutes")
        new_duration = new_workout.get("estimated_duration_minutes")
        if old_duration != new_duration:
            changed.append({
                "day": day,
                "scope": "workout",
                "exercise": "Session duration",
                "fields": [{"field": "estimated_duration_minutes", "before": old_duration, "after": new_duration}],
            })
            changed_days.add(day)

        for index in range(max(len(old_exercises), len(new_exercises))):
            old = old_exercises[index] if index < len(old_exercises) else None
            new = new_exercises[index] if index < len(new_exercises) else None
            if not isinstance(old, dict) or not isinstance(new, dict):
                continue
            fields = []
            for field in ("name", "sets", "reps", "load_kg", "rpe_target", "rest_seconds"):
                old_value, new_value = old.get(field), new.get(field)
                if old_value != new_value:
                    fields.append({"field": field, "before": old_value, "after": new_value})
            row = {
                "day": day,
                "scope": "exercise",
                "exercise": old.get("name") or f"Exercise {index + 1}",
                "proposed_exercise": new.get("name") or f"Exercise {index + 1}",
            }
            if fields:
                changed.append({**row, "fields": fields})
                changed_days.add(day)
            else:
                unchanged.append({
                    **row,
                    "prescription": {
                        "sets": new.get("sets"), "reps": new.get("reps"),
                        "load_kg": new.get("load_kg"), "rpe_target": new.get("rpe_target"),
                        "rest_seconds": new.get("rest_seconds"),
                    },
                })

    unchanged_days = sorted(set(before.get("schedule") or {}) - changed_days)
    return changed, unchanged, unchanged_days


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
    user_id = current_user["user_id"]
    try:
        active = (
            sb.table("workout_plans").select("id, current_version_id")
            .eq("user_id", user_id).eq("is_active", True)
            .order("created_at", desc=True).limit(1).execute()
        )
        plans = active.data or []
        if plans and plans[0].get("id"):
            rows = (
                sb.table("workout_plan_versions")
                .select("id, plan_id, version_number, status, snapshot, change_reason, approved_by, approved_at, created_at")
                .eq("user_id", user_id).eq("plan_id", plans[0]["id"])
                .order("version_number", desc=True).limit(limit).execute()
            )
            return {"versions": rows.data or [], "plan_id": plans[0]["id"]}
        legacy = (
            sb.table("program_versions")
            .select("id, version_number, trigger, explanation, changes, created_at")
            .eq("user_id", user_id).order("version_number", desc=True)
            .limit(limit).execute()
        )
        return {"versions": legacy.data or [], "plan_id": None}
    except Exception as exc:
        logger.exception("Could not load program versions for %s", user_id)
        raise HTTPException(500, "Could not load program versions.") from exc


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
        change_details, unchanged_items, unchanged_days = _snapshot_change_details(
            current_snapshot, proposed_snapshot
        )

        equipment, injuries = _load_athlete_constraints(sb, user_id)
        if isinstance(proposed_snapshot.get("workouts_by_day"), dict):
            validated_days = {}
            for day, raw_workout in proposed_snapshot["workouts_by_day"].items():
                if not isinstance(raw_workout, dict) or str(raw_workout.get("workout_type") or "").lower() == "rest":
                    validated_days[day] = raw_workout
                    continue
                workout_model = WorkoutPrescription.model_validate(raw_workout)
                validated_days[day] = validate_workout_constraints(workout_model, equipment, injuries)
            proposed_snapshot["workouts_by_day"] = validated_days
        if isinstance(proposed_snapshot.get("workout"), dict) and str(proposed_snapshot["workout"].get("workout_type") or "").lower() != "rest":
            workout_model = WorkoutPrescription.model_validate(proposed_snapshot["workout"])
            proposed_snapshot["workout"] = validate_workout_constraints(
                workout_model, equipment, injuries
            )
        evidence = result.get("evidence") or []
        proposed_snapshot["adaptive_trigger"] = result.get("trigger")
        proposed_snapshot["adaptive_changes"] = result.get("changes") or []
        proposed_snapshot["adaptive_evidence"] = evidence
        proposed_snapshot["adaptive_change_details"] = change_details
        proposed_snapshot["adaptive_unchanged_items"] = unchanged_items
        proposed_snapshot["adaptive_unchanged_days"] = unchanged_days
        proposed_snapshot["adaptive_source_version_id"] = plan["current_version_id"]
        proposed_snapshot["change_reason"] = result.get("explanation")
        guardrails = []
        change_types = {str(change.get("type") or "") for change in (result.get("changes") or [])}
        if "intensity_hold" in change_types:
            guardrails.append("Hold working loads. Do not increase load targets until nutrition and recovery signals improve.")
        if "nutrition_flag" in change_types:
            guardrails.append("Nutrition intake is a limiting recovery signal. Prioritise consistent fueling before adding training volume.")
        if "deload" in change_types:
            guardrails.append("Deload prescription: no PR attempts; keep movement controlled and stop sets with substantial reserve.")
        proposed_snapshot["adaptive_guardrails"] = guardrails

        saved = sb.rpc(
            "save_workout_plan_draft",
            {
                "p_user_id": user_id,
                "p_plan_id": plan["id"],
                "p_name": proposed_snapshot.get("name") or plan["name"],
                "p_phase": proposed_snapshot.get("phase") or plan.get("phase"),
                "p_weeks": proposed_snapshot.get("weeks") or plan.get("weeks") or 4,
                "p_schedule": proposed_snapshot.get("schedule") or plan.get("schedule") or {},
                "p_snapshot": {
                    **proposed_snapshot,
                    "_expected_base_version_id": plan["current_version_id"],
                },
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
            "previous_snapshot": current_snapshot,
            "evidence": evidence,
            "change_details": change_details,
            "unchanged_items": unchanged_items,
            "unchanged_days": unchanged_days,
            "approval_state": "pending_athlete",
            "applied": False,
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
    """Return the latest authoritative plan version, with legacy fallback."""
    sb = get_supabase()
    user_id = current_user["user_id"]
    try:
        active = (
            sb.table("workout_plans").select("id, current_version_id")
            .eq("user_id", user_id).eq("is_active", True)
            .order("created_at", desc=True).limit(1).execute()
        )
        plans = active.data or []
        if plans and plans[0].get("current_version_id"):
            result = (
                sb.table("workout_plan_versions")
                .select("id, version_number, status, snapshot, change_reason, approved_at, created_at")
                .eq("id", plans[0]["current_version_id"])
                .eq("plan_id", plans[0]["id"]).eq("user_id", user_id)
                .limit(1).execute()
            )
            rows = result.data or []
            if rows:
                version = rows[0]
                snapshot = version.get("snapshot") or {}
                return {
                    **version,
                    "trigger": snapshot.get("adaptive_trigger"),
                    "explanation": snapshot.get("change_reason") or version.get("change_reason"),
                    "changes": snapshot.get("adaptive_changes") or [],
                }
        legacy = (
            sb.table("program_versions")
            .select("version_number, trigger, explanation, changes, created_at")
            .eq("user_id", user_id).order("version_number", desc=True)
            .limit(1).execute()
        )
        rows = legacy.data or []
        return rows[0] if rows else {
            "version_number": 0, "trigger": None, "explanation": None, "changes": []
        }
    except Exception as exc:
        logger.exception("Could not load latest program version for %s", user_id)
        raise HTTPException(500, "Could not load latest program version.") from exc
