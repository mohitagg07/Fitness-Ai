"""
Workouts route.
main.py mounts this at prefix="/api/workouts".

FIXES:
  1. set_number was required (Field ge=1) but the frontend never sends it —
     every POST /sessions/{id}/logs returned 422 Unprocessable Entity.
     SetLog.set_number is now auto-computed from how many logs already exist
     for this session, so the frontend only needs: exercise_name, weight_kg,
     reps, and optionally rpe/notes.

  2. complete_session now updates agent_state: increments workout_streak,
     total_workouts, last_session_date, weekly_session_count, and
     consecutive_high_rpe_days. Previously these counters were defined in
     the schema and displayed on the dashboard but NEVER updated — every
     user's streak was permanently 0.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Body, Depends, HTTPException
from schemas.models import SetLog
from core.security import get_current_user
from db.supabase_client import get_supabase, upsert_agent_state, get_full_user_context
from services.pr_validator import validate_logged_weight, find_new_personal_records
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator, model_validator

router = APIRouter(tags=["Workouts"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    plan_id: Optional[str] = None
    plan_version_id: Optional[str] = None
    client_request_id: Optional[str] = Field(None, min_length=8, max_length=240)
    session_date: Optional[date] = None
    day_label: Optional[str] = Field(None, max_length=50)
    workout_type: Optional[str] = None
    muscle_groups: list = Field(default_factory=list)
    cns_fatigue_before: Optional[int] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)


class SetLogRequest(BaseModel):
    """
    Extended for full Hevy/Strong-style logging:
      - is_warmup / is_dropset / to_failure: checkboxes the UI can toggle per set
      - superset_group: a shared string ID — sets sharing the same group are
        rendered/grouped as a superset in the workout history view
      - tempo: free-text like "3-1-1-0" (eccentric-pause-concentric-pause)
      - set_notes: per-set personal note, separate from the session-level note
    All new fields are optional so existing callers logging a plain set
    keep working unchanged.
    """
    exercise_name: str = Field(min_length=1)
    weight_kg: float = Field(ge=0)
    reps: int = Field(ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    equipment_modifiers: list = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=300)
    is_warmup: bool = False
    is_dropset: bool = False
    superset_group: Optional[str] = Field(None, max_length=50)
    tempo: Optional[str] = Field(None, max_length=20)
    to_failure: bool = False
    set_notes: Optional[str] = Field(None, max_length=300)
    client_request_id: Optional[str] = Field(None, min_length=8, max_length=240)

    @field_validator("exercise_name")
    @classmethod
    def normalize_exercise_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Exercise name cannot be blank")
        return normalized


class SessionCompleteRequest(BaseModel):
    """Optional, user-reported post-workout feedback."""
    cns_fatigue_after: Optional[int] = Field(None, ge=1, le=10)
    session_notes: Optional[str] = Field(None, max_length=1000)
    mood: Optional[str] = Field(None, pattern="^(great|good|okay|bad)$")
    session_effort: Optional[int] = Field(None, ge=1, le=10)
    energy_level: Optional[int] = Field(None, ge=1, le=5)
    pain_status: Optional[str] = Field(None, pattern="^(none|mild|sharp|worsening)$")
    pain_notes: Optional[str] = Field(None, max_length=500)


class SessionTransitionRequest(BaseModel):
    action: str = Field(pattern="^(pause|resume|abandon)$")


class SessionExerciseEventRequest(BaseModel):
    action: Literal["skip", "replace"]
    exercise_name: str = Field(min_length=1, max_length=120)
    replacement_exercise: Optional[str] = Field(None, min_length=1, max_length=120)
    client_request_id: str = Field(min_length=1, max_length=360)
    reason: Optional[str] = Field(None, max_length=300)

    @model_validator(mode="after")
    def validate_replacement(self):
        if self.action == "replace" and not self.replacement_exercise:
            raise ValueError("A replacement exercise is required.")
        if self.action == "skip" and self.replacement_exercise:
            raise ValueError("A skipped exercise cannot include a replacement.")
        self.exercise_name = self.exercise_name.strip()
        if self.replacement_exercise:
            self.replacement_exercise = self.replacement_exercise.strip()
        return self


# ─── Routes ──────────────────────────────────────────────────────────────────

def build_log_set_rpc_params(
    session_id: str,
    user_id: str,
    payload: SetLogRequest,
) -> dict:
    """Build validated parameters for the transaction-safe set logger."""
    data = payload.model_dump()
    exercise_name = data.pop("exercise_name")
    return {
        "p_session_id": session_id,
        "p_user_id": user_id,
        "p_exercise_name": exercise_name,
        "p_set": data,
    }


def build_previous_session_comparison(
    current_workout_type: str | None,
    current_day_label: str | None,
    current_volume_kg: float | None,
    current_duration_minutes: int | None,
    previous_session: dict | None,
) -> dict | None:
    """Build an explicitly like-for-like comparison from a prior saved session."""
    if not previous_session:
        return None

    previous_volume = previous_session.get("total_volume_kg")
    previous_duration = previous_session.get("duration_minutes")

    def _number(value):
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    current_volume = _number(current_volume_kg)
    previous_volume = _number(previous_volume)
    current_duration = _number(current_duration_minutes)
    previous_duration = _number(previous_duration)

    volume_delta = (
        round(current_volume - previous_volume, 1)
        if current_volume is not None and previous_volume is not None
        else None
    )
    volume_delta_pct = (
        round((volume_delta / previous_volume) * 100, 1)
        if volume_delta is not None and previous_volume > 0
        else None
    )
    duration_delta = (
        round(current_duration - previous_duration, 1)
        if current_duration is not None and previous_duration is not None
        else None
    )

    return {
        "session_id": previous_session.get("id"),
        "session_date": previous_session.get("session_date"),
        "workout_type": previous_session.get("workout_type"),
        "day_label": previous_session.get("day_label"),
        "comparison_basis": "workout_type" if current_workout_type else "day_label",
        "current_workout_type": current_workout_type,
        "current_day_label": current_day_label,
        "previous_total_volume_kg": previous_volume,
        "current_total_volume_kg": current_volume,
        "volume_delta_kg": volume_delta,
        "volume_delta_pct": volume_delta_pct,
        "previous_duration_minutes": previous_duration,
        "current_duration_minutes": current_duration,
        "duration_delta_minutes": duration_delta,
    }


@router.post("/sessions", status_code=201)
async def create_session(
    payload: SessionCreate,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    if payload.plan_version_id and not payload.client_request_id:
        raise HTTPException(
            422,
            "A stable client_request_id is required to start a workout from an approved plan.",
        )
    sb = get_supabase()

    if payload.client_request_id:
        try:
            result = sb.rpc(
                "create_workout_session_idempotent",
                {
                    "p_user_id": user_id,
                    "p_client_request_id": payload.client_request_id,
                    "p_session_date": str(payload.session_date) if payload.session_date else None,
                    "p_plan_version_id": payload.plan_version_id,
                    "p_day_label": payload.day_label,
                    "p_workout_type": payload.workout_type,
                    "p_muscle_groups": payload.muscle_groups,
                },
            ).execute()
        except Exception as exc:
            message = str(exc).upper()
            if "PLAN_VERSION_NOT_APPROVED" in message or "PLAN_VERSION_NOT_ACTIVE" in message:
                raise HTTPException(409, "This workout plan version is not approved or is no longer active") from exc
            if "SESSION_ON_REST_DAY" in message:
                raise HTTPException(409, "Today is a scheduled rest day. No workout session was created.") from exc
            if "DAY_PRESCRIPTION_MISSING" in message or "DAY_PRESCRIPTION_MISMATCH" in message:
                raise HTTPException(409, "The approved plan has no valid prescription for this scheduled day.") from exc
            raise HTTPException(500, "Could not create the workout session safely") from exc
        if not result.data:
            raise HTTPException(500, "Could not create the workout session")
        return result.data[0]


    # CRITICAL FIX: model_dump() returns None for optional fields that were
    # not provided. Sending "session_date": None as JSON explicitly sets the
    # column to NULL in Postgres — which violates the NOT NULL constraint even
    # though DEFAULT CURRENT_DATE is defined. PostgreSQL only applies the
    # DEFAULT when the column is *omitted* from the INSERT statement entirely,
    # not when it is included with a null value. Strip every None-valued key
    # so the DB default fires correctly.
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = user_id

    # A planned session must come from a version the athlete explicitly approved.
    # Never accept a workout prescription copied from an untrusted client payload.
    if payload.plan_version_id:
        version_res = (
            sb.table("workout_plan_versions")
            .select("*")
            .eq("id", payload.plan_version_id)
            .eq("user_id", user_id)
            .eq("status", "approved")
            .limit(1)
            .execute()
        )
        if not version_res.data:
            raise HTTPException(409, "This workout plan version is not approved or no longer available")
        version = version_res.data[0]
        snapshot = version.get("snapshot") or {}
        workout = snapshot.get("workout") or {}
        data["plan_id"] = version["plan_id"]
        data["plan_version_id"] = version["id"]
        data["planned_workout_snapshot"] = workout
        data["day_label"] = workout.get("label") or data.get("day_label") or "Training Session"
        data["workout_type"] = workout.get("workout_type") or data.get("workout_type")
        data["muscle_groups"] = workout.get("muscle_groups") or data.get("muscle_groups") or []

    data["status"] = "active"
    data["started_at"] = datetime.now(timezone.utc).isoformat()

    # Ensure session_date is always present — fall back to today if caller
    # didn't send it and the None-stripping above removed it.
    if "session_date" not in data:
        data["session_date"] = str(date.today())
    elif not isinstance(data["session_date"], str):
        data["session_date"] = str(data["session_date"])

    try:
        res = sb.table("workout_sessions").insert(data).execute()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f"create_session insert failed for {user_id}: {exc}")
        raise HTTPException(500, f"Failed to create session: {exc}")

    if not res.data:
        raise HTTPException(500, "Failed to create session: no data returned")
    return res.data[0]


@router.patch("/sessions/{session_id}/state")
async def transition_session_state(
    session_id: str,
    payload: SessionTransitionRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        result = get_supabase().rpc(
            "transition_workout_session",
            {
                "p_user_id": current_user["user_id"],
                "p_session_id": session_id,
                "p_action": payload.action,
            },
        ).execute()
    except Exception as exc:
        message = str(exc).upper()
        if "SESSION_NOT_FOUND" in message:
            raise HTTPException(404, "Workout session not found") from exc
        if "INVALID_SESSION_TRANSITION" in message:
            raise HTTPException(409, "That workout session action is not valid in its current state") from exc
        raise HTTPException(500, "Could not update the workout session state") from exc
    if not result.data:
        raise HTTPException(409, "Could not update the workout session state")
    return result.data[0]


@router.post("/sessions/{session_id}/exercise-events", status_code=201)
async def record_session_exercise_event(
    session_id: str,
    payload: SessionExerciseEventRequest,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    user_id = current_user["user_id"]
    session_result = (
        sb.table("workout_sessions")
        .select("id, status, completed, planned_workout_snapshot, workout_type")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not session_result.data:
        raise HTTPException(404, "Workout session not found")
    session = session_result.data[0]

    def _same_request(event: dict) -> bool:
        return (
            event.get("action") == payload.action
            and str(event.get("exercise_name") or "").strip().casefold()
                == payload.exercise_name.strip().casefold()
            and str(event.get("replacement_exercise") or "").strip().casefold()
                == str(payload.replacement_exercise or "").strip().casefold()
        )

    # Resolve retries by immutable request identity before checking the
    # current session state. A retry can arrive after the session has moved
    # on, but it must return its original event and never overwrite a newer
    # skip/replace decision for that exercise.
    existing_request = (
        sb.table("workout_session_exercise_events")
        .select("*")
        .eq("session_id", session_id)
        .eq("user_id", user_id)
        .eq("client_request_id", payload.client_request_id)
        .limit(1)
        .execute()
    )
    if existing_request.data:
        event = existing_request.data[0]
        if _same_request(event):
            return event
        raise HTTPException(409, "This client request ID was already used for a different exercise change")

    if session.get("completed") or session.get("status") != "active":
        raise HTTPException(409, "Exercises can only be changed in an active workout")

    original_name = payload.exercise_name.strip()
    planned = (session.get("planned_workout_snapshot") or {}).get("exercises") or []
    matching = next(
        (
            item for item in planned
            if isinstance(item, dict)
            and str(item.get("name") or "").strip().casefold() == original_name.casefold()
        ),
        None,
    )
    if matching is None:
        raise HTTPException(404, "That exercise is not in this session's approved prescription")

    replacement_name = None
    if payload.action == "replace":
        from api.routes.training_plans import (
            PlannedExercise,
            WorkoutPrescription,
            _load_athlete_constraints,
            validate_workout_constraints,
        )
        equipment, injuries = _load_athlete_constraints(sb, user_id)
        workout_type = str(session.get("workout_type") or "full_body").lower()
        allowed_types = {"push", "pull", "legs", "upper", "lower", "full_body", "cardio", "mobility", "recovery"}
        if workout_type not in allowed_types:
            workout_type = "full_body"
        validated = validate_workout_constraints(
            WorkoutPrescription(
                label="In-session exercise replacement",
                workout_type=workout_type,
                exercises=[PlannedExercise(name=payload.replacement_exercise, sets=1, reps="1")],
            ),
            equipment,
            injuries,
        )
        replacement_name = validated["exercises"][0]["name"]
        if replacement_name.casefold() == original_name.casefold():
            raise HTTPException(422, "Choose a different exercise to replace this movement")

    try:
        saved = sb.table("workout_session_exercise_events").insert({
            "session_id": session_id,
            "user_id": user_id,
            "action": payload.action,
            "exercise_name": original_name,
            "replacement_exercise": replacement_name,
            "client_request_id": payload.client_request_id,
            "reason": payload.reason,
        }).execute()
    except Exception as exc:
        # Two identical requests can race between the initial lookup and
        # insert. The unique index is the arbiter; read back and return the
        # winner rather than surfacing a false failure to the client.
        raced_request = (
            sb.table("workout_session_exercise_events")
            .select("*")
            .eq("session_id", session_id)
            .eq("user_id", user_id)
            .eq("client_request_id", payload.client_request_id)
            .limit(1)
            .execute()
        )
        if raced_request.data and _same_request(raced_request.data[0]):
            return raced_request.data[0]
        raise HTTPException(500, "Could not save the exercise change") from exc
    if not saved.data:
        raise HTTPException(500, "Could not save the exercise change")
    return saved.data[0]


@router.get("/sessions/{session_id}/exercise-events")
async def list_session_exercise_events(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    user_id = current_user["user_id"]
    owned = (
        sb.table("workout_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not owned.data:
        raise HTTPException(404, "Workout session not found")
    result = (
        sb.table("workout_session_exercise_events")
        .select("action, exercise_name, replacement_exercise, reason, created_at")
        .eq("session_id", session_id)
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    return {"events": result.data or []}


@router.get("/history")
async def get_workout_history(
    limit: int = 20,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """
    Workout History list — completed sessions only, newest first, each with
    a lightweight summary (exercise count, set count, total volume, PR
    count) computed from the same exercise_logs rows the session-complete
    summary already used, so the numbers shown here can never drift from
    what was shown right after finishing that session.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]

    sessions_res = (
        sb.table("workout_sessions")
        .select("id, session_date, day_label, workout_type, total_volume_kg, duration_minutes, calories_burned, notes, completed")
        .eq("user_id", user_id)
        .eq("completed", True)
        .order("session_date", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    sessions = sessions_res.data or []

    if not sessions:
        return {
            "has_data": False,
            "sessions": [],
            "empty_state": "No completed workouts yet. Finish your first session to start building history.",
        }

    session_ids = [s["id"] for s in sessions]
    logs_res = (
        sb.table("exercise_logs")
        .select("session_id, exercise_name, weight_kg, reps, is_warmup")
        .in_("session_id", session_ids)
        .eq("user_id", user_id)
        .execute()
    )
    logs = logs_res.data or []

    logs_by_session: dict[str, list[dict]] = {}
    for l in logs:
        logs_by_session.setdefault(l["session_id"], []).append(l)

    enriched = []
    for s in sessions:
        session_logs = logs_by_session.get(s["id"], [])
        working = [l for l in session_logs if not l.get("is_warmup")]
        exercise_names = sorted(set(l["exercise_name"] for l in session_logs if l.get("exercise_name")))
        s = {**s, "session_notes": s.pop("notes", None)}
        enriched.append({
            **s,
            "exercise_count": len(exercise_names),
            "exercises": exercise_names,
            "set_count": len(session_logs),
            "working_set_count": len(working),
        })

    return {"has_data": True, "sessions": enriched, "count": len(enriched)}


@router.get("/sessions/{session_id}/detail")
async def get_session_detail(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Full detail for one session — every set, grouped by exercise and by
    superset_group, for a Workout History detail screen. Returns sets in
    the order they were logged so warm-up sets correctly appear before
    working sets for the same exercise.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]

    session_res = (
        sb.table("workout_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not session_res.data:
        raise HTTPException(404, "Session not found")
    session = session_res.data[0]

    logs_res = (
        sb.table("exercise_logs")
        .select("*")
        .eq("session_id", session_id)
        .eq("user_id", user_id)
        .order("logged_at")
        .execute()
    )
    logs = logs_res.data or []

    # Group by exercise, preserving log order within each group
    by_exercise: dict[str, list[dict]] = {}
    for l in logs:
        by_exercise.setdefault(l["exercise_name"], []).append(l)

    exercises = [
        {"exercise_name": name, "sets": sets}
        for name, sets in by_exercise.items()
    ]

    return {"session": session, "exercises": exercises}


@router.get("/sessions")
async def list_sessions(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("*, exercise_logs(*)")
        .eq("user_id", current_user["user_id"])
        .order("session_date", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data


@router.patch("/sessions/{session_id}/complete")
async def complete_session(
    session_id: str,
    cns_fatigue_after: Optional[int] = None,
    session_notes: Optional[str] = None,
    mood: Optional[str] = None,
    payload: Optional[SessionCompleteRequest] = Body(default=None),
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    session_res = (
        sb.table("workout_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not session_res.data:
        raise HTTPException(404, "Workout session not found")
    session = session_res.data[0]
    if session.get("completed") is True or session.get("status") == "completed":
        cached = session.get("completion_result")
        if isinstance(cached, dict):
            return cached
        raise HTTPException(409, "This workout was already completed. Open Workout History to view the saved session.")
    if session.get("status") in ("abandoned", "skipped", "draft", "approved"):
        raise HTTPException(409, "This workout is not in a completable state.")

    if payload is not None:
        cns_fatigue_after = payload.cns_fatigue_after if payload.cns_fatigue_after is not None else cns_fatigue_after
        session_notes = payload.session_notes if payload.session_notes is not None else session_notes
        mood = payload.mood if payload.mood is not None else mood
        session_effort = payload.session_effort
        energy_level = payload.energy_level
        pain_status = payload.pain_status
        pain_notes = payload.pain_notes
    else:
        session_effort = None
        energy_level = None
        pain_status = None
        pain_notes = None

    # Finish under the same row lock used by set logging. The database
    # computes duration and volume after all earlier set writes have settled;
    # no new set can be inserted once this transaction changes status.
    feedback = {}
    if cns_fatigue_after is not None:
        feedback["cns_fatigue_after"] = cns_fatigue_after
    if session_notes is not None:
        feedback["session_notes"] = session_notes
    if mood in ("great", "good", "okay", "bad"):
        feedback["mood"] = mood
    if session_effort is not None:
        feedback["session_effort"] = session_effort
    if energy_level is not None:
        feedback["energy_level"] = energy_level
    if pain_status is not None:
        feedback["pain_status"] = pain_status
    if pain_notes is not None:
        feedback["pain_notes"] = pain_notes

    try:
        completion_result = sb.rpc(
            "complete_workout_session_atomic",
            {
                "p_user_id": user_id,
                "p_session_id": session_id,
                "p_feedback": feedback,
            },
        ).execute().data
    except Exception as exc:
        message = str(exc).upper()
        if "SESSION_NOT_FOUND" in message:
            raise HTTPException(404, "Workout session not found") from exc
        if "SESSION_NOT_COMPLETABLE" in message:
            raise HTTPException(409, "This workout is not in a completable state.") from exc
        raise HTTPException(500, "Workout completion could not be saved atomically.") from exc

    if isinstance(completion_result, list):
        completion_result = completion_result[0] if completion_result else None
    if not isinstance(completion_result, dict) or not isinstance(completion_result.get("session"), dict):
        raise HTTPException(500, "The database did not return the completed workout session.")
    session = completion_result["session"]
    if completion_result.get("already_completed"):
        cached = session.get("completion_result")
        if isinstance(cached, dict):
            return cached
        raise HTTPException(409, "This workout was already completed. Refresh Workout History.")

    total_volume_kg = float(session.get("total_volume_kg") or 0)
    duration_minutes = session.get("duration_minutes")
    calories_burned = session.get("calories_burned")

    # This read occurs after the completion transaction has locked the session
    # and marked it complete. The set logger cannot append after this point.
    # ── Compute real session stats from actual logged sets ──────────────
    # workout_sessions.total_volume_kg/duration_minutes/calories_burned
    # have existed in the schema since the original migration but were
    # never populated — PATCH /complete only ever wrote `completed` and
    # `cns_fatigue_after`. The "Session Complete" summary card needs real
    # numbers here, not invented ones, so this computes them from the
    # exercise_logs that were actually inserted during the session.
    logs_res = (
        sb.table("exercise_logs")
        .select("exercise_name, weight_kg, reps, rpe, logged_at, is_warmup")
        .eq("session_id", session_id)
        .eq("user_id", user_id)
        .order("logged_at", desc=False)
        .execute()
    )
    logs = logs_res.data or []

    # Warm-up sets are excluded from total volume and PR eligibility — they
    # inflate "volume lifted" with non-working weight and would let a heavy
    # warm-up single falsely register as a PR. They're still counted in
    # sets_logged below so the session summary reflects the full session.
    working_logs = [l for l in logs if not l.get("is_warmup")]

    total_volume_kg = round(sum((l.get("weight_kg") or 0) * (l.get("reps") or 0) for l in working_logs), 1)

    # ── Detect new PRs set during this specific session ──────────────────
    # Compares each exercise's heaviest set THIS session against the
    # personal_records table (the same table /profile/prs reads/writes),
    # so "Top PR: Bench +2.5kg" on the summary card reflects a real,
    # persisted comparison rather than a guess.
    new_prs: list[dict] = []
    pr_save_warnings: list[dict] = []
    if working_logs:
        try:
            pr_res = (
                sb.table("personal_records")
                .select("exercise_name, weight_kg, reps")
                .eq("user_id", user_id)
                .execute()
            )
            existing_pr_rows = pr_res.data or []
        except Exception as e:
            # A failed history read is not an empty PR table. Do not announce
            # false first-time records when the existing records are unknown.
            import logging
            logging.getLogger(__name__).warning(
                f"Could not load PR history for {user_id}: {e}"
            )
            existing_pr_rows = None

        if existing_pr_rows is not None:
            candidates = find_new_personal_records(working_logs, existing_pr_rows)
            for candidate in candidates:
                name = candidate["exercise_name"]
                weight = candidate["weight_kg"]
                reps = candidate["reps"]
                old_pr = candidate["previous_pr_kg"]
                delta = round(weight - old_pr, 1) if old_pr is not None else None

                # Validate against the previous record for the same rep count.
                needs_review = False
                if old_pr is not None:
                    check = validate_logged_weight(name, weight, {name: old_pr})
                    needs_review = not check["valid"]

                try:
                    sb.table("personal_records").upsert({
                        "user_id": user_id,
                        "exercise_name": name,
                        "weight_kg": weight,
                        "reps": reps,
                    }, on_conflict="user_id,exercise_name,reps").execute()
                    # Only celebrate a PR after persistence succeeds.
                    new_prs.append({
                        "exercise_name": name,
                        "weight_kg": weight,
                        "reps": reps,
                        "previous_pr_kg": old_pr,
                        "delta_kg": delta,
                        "needs_review": needs_review,
                    })
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(
                        f"PR upsert failed for {name} x{reps}: {e}"
                    )
                    pr_save_warnings.append({
                        "exercise_name": name,
                        "reps": reps,
                        "message": "This record could not be saved. Your workout was completed.",
                    })

    # ── Pull a fresh recovery prediction so the summary card can show
    # "Recovery Prediction: Medium" without the frontend making a second
    # round-trip to a different endpoint right after this one returns. ──
    recovery_prediction = None
    recovery_pct = None
    try:
        from agents.recovery_agent import run_recovery_agent
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        try:
            session_local_date = date.fromisoformat(str(session.get("session_date")))
        except (TypeError, ValueError):
            session_local_date = date.today()
        protein_target = None
        calorie_target = None
        required_metrics = ("weight_kg", "height_cm", "age", "gender")
        if all(profile.get(field) not in (None, "", 0) for field in required_metrics):
            from schemas.models import Goal
            from services.nutrition import calculate_macros, is_training_day_for_user
            goal_value = profile.get("goal") or "maintain"
            goal = Goal(goal_value) if goal_value in Goal._value2member_map_ else Goal.maintain
            targets = calculate_macros(
                weight_kg=profile["weight_kg"],
                height_cm=profile["height_cm"],
                age=profile["age"],
                gender=profile["gender"],
                goal=goal,
                is_training_day=is_training_day_for_user(user_id, target_date=session_local_date),
            )
            protein_target = targets.get("protein_g")
            calorie_target = targets.get("calories")
        recovery_decision = await asyncio.to_thread(
            run_recovery_agent,
            user_id,
            sleep_hours=None,  # Daily readiness uses the dated check-in, not the onboarding baseline.
            planned_workout_type=None,
            protein_target_g=protein_target,
            calorie_target=calorie_target,
            target_date=session_local_date,
        )
        # NOTE: recovery_decision.recovery_score is 0-10 (schema-constrained,
        # ge=0/le=10) — comparing it against 70/40 here was a pre-existing
        # scale bug that meant recovery_prediction was effectively always
        # "Low" in production. score_pct is the real 0-100 value the agent
        # already computes (attached as an extra attribute, see
        # recovery_agent.py's docstring) — use that for both the label and
        # the percentage the summary card shows.
        score_pct_val = getattr(recovery_decision, "score_pct", None)
        if score_pct_val is not None:
            recovery_pct = round(score_pct_val)
            recovery_prediction = "High" if score_pct_val >= 70 else "Medium" if score_pct_val >= 40 else "Low"
        else:
            recovery_prediction = "Unavailable"
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Recovery prediction failed: {e}")

    # Update longitudinal counters and store the actual average set RPE.
    workout_streak = None
    try:
        rated_session_rpe = [float(log["rpe"]) for log in working_logs if log.get("rpe") is not None]
        session_avg_rpe = round(sum(rated_session_rpe) / len(rated_session_rpe), 2) if rated_session_rpe else None
        try:
            session_local_date = date.fromisoformat(str(session.get("session_date")))
        except (TypeError, ValueError):
            session_local_date = date.today()
        workout_streak = await asyncio.to_thread(
            _update_agent_state_on_completion,
            user_id,
            cns_fatigue_after,
            session_avg_rpe,
            session_local_date,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            f"Could not update agent_state after session complete for {user_id}: {e}"
        )
        # Don't fail the request — session is already marked complete.

    protein_streak = None
    try:
        agent_state_res = sb.table("agent_states").select("protein_streak").eq("user_id", user_id).execute()
        if agent_state_res.data:
            protein_streak = agent_state_res.data[0].get("protein_streak")
    except Exception:
        pass

    # ── Log this completion to the AI timeline so GET /timeline can show
    # it without re-deriving it from workout_sessions rows later. ────────
    try:
        await asyncio.to_thread(
            _log_timeline_event,
            user_id,
            "workout_completed",
            f"Workout completed — {total_volume_kg or 0}kg total volume"
            + (f", {len(new_prs)} new PR{'s' if len(new_prs) != 1 else ''}" if new_prs else ""),
        )
    except Exception:
        pass

    # ── Coach message: short, deterministic, grounded in this session's
    # own numbers — no LLM call on this path (latency-sensitive, and a
    # failed LLM call shouldn't ever block the completion summary). Mirrors
    # the same "compute don't invent" principle decision_engine.py uses. ──
    if new_prs:
        pr_name = new_prs[0]["exercise_name"]
        coach_message = (
            f"New PR on {pr_name}. That's {len(new_prs)} personal record"
            f"{'s' if len(new_prs) != 1 else ''} today — excellent session."
        )
    elif total_volume_kg and total_volume_kg > 0:
        coach_message = "Solid session, logged and saved. Recover well before the next one."
    else:
        coach_message = "Session saved."
    if recovery_prediction == "High":
        coach_message += " You've earned tomorrow's recovery."
    elif recovery_prediction == "Low":
        coach_message += " Prioritize sleep tonight — recovery's tight."
    if pain_status in ("sharp", "worsening"):
        coach_message += " You reported concerning pain. Stop movements that provoke it and get appropriate clinical guidance before repeating them."
    elif pain_status == "mild":
        coach_message += " Keep an eye on the discomfort and modify any movement that aggravates it."

    # Best set of the session (heaviest working weight, ties broken by reps) —
    # the frontend's WorkoutSummaryCard shows this as a fallback detail.
    best_set = None
    if working_logs:
        best_log = max(working_logs, key=lambda l: ((l.get("weight_kg") or 0), (l.get("reps") or 0)))
        best_set = {
            "exercise": best_log.get("exercise_name"),
            "weight_kg": best_log.get("weight_kg"),
            "reps": best_log.get("reps"),
            "rpe": best_log.get("rpe"),
        }

    exercise_names = list(dict.fromkeys(l.get("exercise_name") for l in logs if l.get("exercise_name")))

    # FIX: the summary card reads these fields flat off the response body
    # (data.total_volume_kg, data.exercise_count, etc — see
    # WorkoutSummaryCard.tsx's SummaryData interface), but this endpoint
    # was nesting everything under a "summary" key that nothing on the
    # frontend ever unwrapped. Every number on the "Workout Complete" card
    # (duration, exercises, volume, PRs) was silently undefined/NaN as a
    # result. Returned flat now, with the old nested "summary" duplicate
    # kept alongside for any other caller that may depend on it.
    planned_workout = session.get("planned_workout_snapshot") or {}
    planned_exercises = planned_workout.get("exercises") or []
    planned_sets = sum(
        int(exercise.get("sets") or 0)
        for exercise in planned_exercises
        if isinstance(exercise, dict)
    )
    actual_by_exercise = {}
    for log in working_logs:
        name_key = str(log.get("exercise_name") or "").strip().casefold()
        if name_key:
            actual_by_exercise[name_key] = actual_by_exercise.get(name_key, 0) + 1

    event_result = (
        sb.table("workout_session_exercise_events")
        .select("action, exercise_name, replacement_exercise, reason")
        .eq("session_id", session_id)
        .eq("user_id", user_id)
        .execute()
    )
    event_by_exercise = {
        str(event.get("exercise_name") or "").strip().casefold(): event
        for event in (event_result.data or [])
    }
    exercise_review = []
    for exercise in planned_exercises:
        if not isinstance(exercise, dict):
            continue
        original_name = str(exercise.get("name") or "").strip()
        original_key = original_name.casefold()
        event = event_by_exercise.get(original_key)
        action = event.get("action") if event else None
        current_name = (
            str(event.get("replacement_exercise") or original_name)
            if action == "replace" else original_name
        )
        current_key = current_name.casefold()
        if action == "skip":
            status = "skipped"
            # Preserve any work completed before the athlete chose to skip the
            # remaining sets; the event records the decision, not data loss.
            logged_sets = actual_by_exercise.get(original_key, 0)
        elif action == "replace":
            logged_sets = actual_by_exercise.get(current_key, 0)
            status = "replaced" if logged_sets else "replacement_not_logged"
        else:
            logged_sets = actual_by_exercise.get(original_key, 0)
            status = "completed" if logged_sets else "not_started"
        exercise_review.append({
            "name": original_name,
            "current_name": current_name,
            "planned_sets": int(exercise.get("sets") or 0),
            "logged_working_sets": logged_sets,
            "completed": status in ("completed", "replaced"),
            "status": status,
            "reason": event.get("reason") if event else None,
        })

    completed_planned_exercises = sum(1 for item in exercise_review if item["completed"])
    skipped_exercises = sum(1 for item in exercise_review if item["status"] == "skipped")
    replaced_exercises = sum(
        1 for item in exercise_review
        if item["status"] in ("replaced", "replacement_not_logged")
    )
    # Compare only against the most recent completed workout of the same
    # workout type (or day label for legacy sessions). This is a reference
    # point, not a judgement: more volume is not automatically better.
    previous_comparison = None
    try:
        previous_query = (
            sb.table("workout_sessions")
            .select("id, session_date, workout_type, day_label, total_volume_kg, duration_minutes")
            .eq("user_id", user_id)
            .eq("completed", True)
            .neq("id", session_id)
        )
        if session.get("workout_type"):
            previous_query = previous_query.eq("workout_type", session.get("workout_type"))
        elif session.get("day_label"):
            previous_query = previous_query.eq("day_label", session.get("day_label"))
        else:
            previous_query = None

        if previous_query is not None:
            previous_rows = (
                previous_query
                .order("session_date", desc=True)
                .order("finished_at", desc=True)
                .limit(1)
                .execute()
            ).data or []
            if previous_rows:
                previous_comparison = build_previous_session_comparison(
                    session.get("workout_type"),
                    session.get("day_label"),
                    total_volume_kg,
                    duration_minutes,
                    previous_rows[0],
                )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "Could not load prior comparable workout for %s: %s", session_id, e
        )

    planned_vs_actual = {
        "has_plan": bool(planned_exercises),
        "planned_exercises": len(planned_exercises),
        "exercises_with_logged_sets": completed_planned_exercises,
        "skipped_exercises": skipped_exercises,
        "replaced_exercises": replaced_exercises,
        "not_started_exercises": sum(1 for item in exercise_review if item["status"] == "not_started"),
        "planned_working_sets": planned_sets,
        "completed_working_sets": len(working_logs),
        "set_completion_ratio": round(min(1, len(working_logs) / planned_sets), 2) if planned_sets else None,
        "exercises": exercise_review,
    }

    summary_flat = {
        "id": session.get("id"),
        "status": "completed",
        "planned_vs_actual": planned_vs_actual,
        "previous_comparable_session": previous_comparison,
        "session_effort": session_effort,
        "energy_level": energy_level,
        "pain_status": pain_status,
        "pain_notes": pain_notes,
        "total_volume_kg": total_volume_kg,
        "session_minutes": duration_minutes,
        "duration_minutes": duration_minutes,
        "calories_burned": calories_burned,
        "calories_is_estimate": True,
        "sets_logged": len(logs),
        "exercises": exercise_names,
        "exercise_count": len(exercise_names),
        "best_set": best_set,
        "new_prs": new_prs,
        "pr_save_warnings": pr_save_warnings,
        "recovery_prediction": recovery_prediction,
        "recovery_pct": recovery_pct,
        "coach_message": coach_message,
        "workout_streak": workout_streak,
        "protein_streak": protein_streak,
    }

    response_payload = {
        **session,
        **summary_flat,
        "summary": summary_flat,
    }
    try:
        sb.table("workout_sessions").update({
            "completion_result": response_payload
        }).eq("id", session_id).eq("user_id", user_id).execute()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "Could not cache workout completion response for %s: %s", session_id, e
        )
    return response_payload


def _log_timeline_event(user_id: str, event_type: str, message: str) -> None:
    """
    Append-only write to ai_timeline_events. Best-effort: every call site
    wraps this in its own try/except so a timeline write failure never
    blocks the actual user-facing action (session completion, workout
    generation, etc.) that triggered it.
    """
    sb = get_supabase()
    sb.table("ai_timeline_events").insert({
        "user_id": user_id,
        "event_type": event_type,
        "message": message,
    }).execute()


def _update_agent_state_on_completion(
    user_id: str,
    cns_fatigue_after: Optional[int],
    session_avg_rpe: Optional[float] = None,
    target_date: Optional[date] = None,
):
    """
    Recompute and persist the agent_state fields that track longitudinal
    training history. Called synchronously in a thread after a session
    is marked complete.
    """
    sb = get_supabase()
    today = target_date or date.today()

    # Load current agent state
    state_res = sb.table("agent_states").select("*").eq("user_id", user_id).execute()
    state = state_res.data[0] if state_res.data else {}

    # ── Workout streak ──────────────────────────────────────────────────
    # Count consecutive days (up to today) with a completed session.
    # Only go back 90 days max for performance.
    cutoff = str(today - timedelta(days=90))
    sessions_res = (
        sb.table("workout_sessions")
        .select("session_date")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", cutoff)
        .order("session_date", desc=True)
        .execute()
    )
    session_dates = sorted(
        set(r["session_date"] for r in (sessions_res.data or [])),
        reverse=True,
    )

    streak = 0
    check_date = today
    for d in session_dates:
        d_parsed = date.fromisoformat(d) if isinstance(d, str) else d
        if d_parsed == check_date or d_parsed == check_date - timedelta(days=1):
            streak += 1
            check_date = d_parsed
        elif d_parsed < check_date - timedelta(days=1):
            break

    # ── Weekly session count ────────────────────────────────────────────
    week_start = today - timedelta(days=today.weekday())
    weekly_res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", str(week_start))
        .execute()
    )
    weekly_count = weekly_res.count or 0

    # ── Total workouts ──────────────────────────────────────────────────
    total_res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .execute()
    )
    total = total_res.count or 0

    # ── Consecutive high-effort sessions ────────────────────────────────
    # RPE is kept separate from the explicitly user-reported CNS fatigue score.
    high_rpe_days = state.get("consecutive_high_rpe_days", 0)
    if session_avg_rpe is not None:
        high_rpe_days = high_rpe_days + 1 if session_avg_rpe >= 8 else 0

    # ── Protein streak is updated by nutrition route, not here ──────────

    updated_state = {
        **state,
        "user_id": user_id,
        "workout_streak": streak,
        "total_workouts": total,
        "weekly_session_count": weekly_count,
        "consecutive_high_rpe_days": high_rpe_days,
        "last_session_date": str(today),
    }
    if cns_fatigue_after is not None:
        updated_state["cns_fatigue_score"] = cns_fatigue_after
    if session_avg_rpe is not None:
        updated_state["last_logged_rpe"] = session_avg_rpe

    upsert_agent_state(user_id, updated_state)
    return streak


@router.post("/sessions/{session_id}/logs", status_code=201)
async def log_set(
    session_id: str,
    payload: SetLogRequest,
    current_user: dict = Depends(get_current_user)
):
    if not payload.client_request_id or not payload.client_request_id.strip():
        raise HTTPException(
            422,
            "A stable client_request_id is required so retries cannot create duplicate sets.",
        )
    sb = get_supabase()
    user_id = current_user["user_id"]

    # Set numbers must be allocated inside one database transaction.
    # A client-side count followed by an insert races when two requests for
    # the same exercise arrive concurrently. The RPC takes a per-session /
    # per-exercise advisory lock, checks ownership again, and inserts the
    # next number atomically.
    params = build_log_set_rpc_params(session_id, user_id, payload)
    try:
        res = sb.rpc("log_workout_set_idempotent", params).execute()
    except Exception as exc:
        error_code = getattr(exc, "code", None)
        error_text = str(exc).upper()
        if error_code == "P0002" or "SESSION_NOT_FOUND" in error_text:
            raise HTTPException(404, "Session not found") from exc
        import logging
        logging.getLogger(__name__).exception(
            "Atomic set logging failed for user %s, session %s",
            user_id,
            session_id,
        )
        raise HTTPException(
            500,
            "The set could not be saved. Please check your workout and try again.",
        ) from exc

    if not res.data:
        raise HTTPException(500, "The set could not be saved")
    return res.data[0]


@router.get("/sessions/{session_id}/logs")
async def get_session_logs(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("exercise_logs")
        .select("*")
        .eq("session_id", session_id)
        .eq("user_id", current_user["user_id"])
        .order("logged_at")
        .execute()
    )
    return res.data

@router.get("/strength-progression")
async def get_strength_progression(
    exercise: str,
    weeks: int = 8,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the weekly best weight (kg) for a given exercise over the last N weeks.
    Used by StrengthProgressionChart on the Progress screen.
    """
    from datetime import date, timedelta
    import math

    sb = get_supabase()
    cutoff = (date.today() - timedelta(weeks=weeks)).isoformat()

    res = (
        sb.table("exercise_logs")
        .select("weight_kg, reps, logged_at, is_warmup")
        .eq("user_id", current_user["user_id"])
        .eq("exercise_name", exercise)
        .eq("is_warmup", False)
        .gte("logged_at", cutoff)
        .order("logged_at")
        .execute()
    )

    if not res.data:
        return {"exercise": exercise, "data": []}

    # Group by ISO week, take best weight per week
    weeks_map: dict = {}
    for row in res.data:
        dt = date.fromisoformat(row["logged_at"][:10])
        # ISO week key e.g. "2025-W03"
        week_key = f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"
        w = row.get("weight_kg") or 0
        if week_key not in weeks_map or w > weeks_map[week_key]["weight_kg"]:
            weeks_map[week_key] = {
                "week": week_key,
                "weight_kg": w,
                "reps": row.get("reps") or 0,
                "date": row["logged_at"][:10],
            }

    data = sorted(weeks_map.values(), key=lambda x: x["week"])
    return {"exercise": exercise, "data": data}