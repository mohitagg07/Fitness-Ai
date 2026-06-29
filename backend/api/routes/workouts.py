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
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import SetLog
from core.security import get_current_user
from db.supabase_client import get_supabase, upsert_agent_state, get_full_user_context
from typing import Optional
from pydantic import BaseModel, Field

router = APIRouter(tags=["Workouts"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    plan_id: Optional[str] = None
    session_date: Optional[date] = None
    day_label: Optional[str] = Field(None, max_length=50)
    workout_type: Optional[str] = None
    muscle_groups: list = Field(default_factory=list)
    cns_fatigue_before: Optional[int] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=500)


class SetLogRequest(BaseModel):
    """
    FIX: set_number removed as required field — auto-computed server-side.
    Frontend only needs exercise_name + weight_kg + reps.
    """
    exercise_name: str = Field(min_length=1)
    weight_kg: float = Field(gt=0)
    reps: int = Field(ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    equipment_modifiers: list = Field(default_factory=list)
    notes: Optional[str] = Field(None, max_length=300)


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.post("/sessions", status_code=201)
async def create_session(
    payload: SessionCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    # CRITICAL FIX: model_dump() returns None for optional fields that were
    # not provided. Sending "session_date": None as JSON explicitly sets the
    # column to NULL in Postgres — which violates the NOT NULL constraint even
    # though DEFAULT CURRENT_DATE is defined. PostgreSQL only applies the
    # DEFAULT when the column is *omitted* from the INSERT statement entirely,
    # not when it is included with a null value. Strip every None-valued key
    # so the DB default fires correctly.
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = user_id

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
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    # ── Compute real session stats from actual logged sets ──────────────
    # workout_sessions.total_volume_kg/duration_minutes/calories_burned
    # have existed in the schema since the original migration but were
    # never populated — PATCH /complete only ever wrote `completed` and
    # `cns_fatigue_after`. The "Session Complete" summary card needs real
    # numbers here, not invented ones, so this computes them from the
    # exercise_logs that were actually inserted during the session.
    logs_res = (
        sb.table("exercise_logs")
        .select("exercise_name, weight_kg, reps, rpe, created_at")
        .eq("session_id", session_id)
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    logs = logs_res.data or []

    total_volume_kg = round(sum((l.get("weight_kg") or 0) * (l.get("reps") or 0) for l in logs), 1)

    duration_minutes = None
    if len(logs) >= 2:
        try:
            first_ts = datetime.fromisoformat(logs[0]["created_at"].replace("Z", "+00:00"))
            last_ts = datetime.fromisoformat(logs[-1]["created_at"].replace("Z", "+00:00"))
            duration_minutes = max(1, round((last_ts - first_ts).total_seconds() / 60))
        except Exception:
            duration_minutes = None

    # Rough calorie estimate: ~0.1 kcal per kg of volume moved is a crude
    # but directionally-honest approximation for resistance training (not
    # a substitute for a real MET-based calculation, which would need
    # bodyweight + exercise-specific MET values this schema doesn't track
    # yet). Flagged clearly as an estimate wherever it's shown.
    calories_burned = round(total_volume_kg * 0.1) if total_volume_kg else None

    update_data = {"completed": True}
    if cns_fatigue_after is not None:
        update_data["cns_fatigue_after"] = cns_fatigue_after
    if total_volume_kg:
        update_data["total_volume_kg"] = total_volume_kg
    if duration_minutes:
        update_data["duration_minutes"] = duration_minutes
    if calories_burned:
        update_data["calories_burned"] = calories_burned

    res = (
        sb.table("workout_sessions")
        .update(update_data)
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )
    session = res.data[0] if res.data else {}

    # ── Detect new PRs set during this specific session ──────────────────
    # Compares each exercise's heaviest set THIS session against the
    # personal_records table (the same table /profile/prs reads/writes),
    # so "Top PR: Bench +2.5kg" on the summary card reflects a real,
    # persisted comparison rather than a guess.
    new_prs: list[dict] = []
    if logs:
        best_this_session: dict[str, dict] = {}
        for l in logs:
            name = l.get("exercise_name")
            w = l.get("weight_kg") or 0
            if not name:
                continue
            if name not in best_this_session or w > best_this_session[name]["weight_kg"]:
                best_this_session[name] = {"weight_kg": w, "reps": l.get("reps")}

        try:
            pr_res = (
                sb.table("personal_records")
                .select("exercise_name, weight_kg")
                .eq("user_id", user_id)
                .execute()
            )
            existing_prs = {r["exercise_name"]: r["weight_kg"] for r in (pr_res.data or [])}
        except Exception:
            existing_prs = {}

        for name, best in best_this_session.items():
            old_pr = existing_prs.get(name)
            if old_pr is None or best["weight_kg"] > old_pr:
                delta = round(best["weight_kg"] - old_pr, 1) if old_pr is not None else None
                new_prs.append({
                    "exercise_name": name,
                    "weight_kg": best["weight_kg"],
                    "previous_pr_kg": old_pr,
                    "delta_kg": delta,
                })
                try:
                    sb.table("personal_records").upsert({
                        "user_id": user_id,
                        "exercise_name": name,
                        "weight_kg": best["weight_kg"],
                        "reps": best.get("reps"),
                    }, on_conflict="user_id,exercise_name").execute()
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"PR upsert failed for {name}: {e}")

    # ── Pull a fresh recovery prediction so the summary card can show
    # "Recovery Prediction: Medium" without the frontend making a second
    # round-trip to a different endpoint right after this one returns. ──
    recovery_prediction = None
    try:
        from agents.recovery_agent import run_recovery_agent
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        recovery_decision = await asyncio.to_thread(
            run_recovery_agent,
            user_id,
            sleep_hours=profile.get("sleep_hours"),
            planned_workout_type=None,
        )
        score = recovery_decision.recovery_score
        recovery_prediction = "High" if score >= 70 else "Medium" if score >= 40 else "Low"
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Recovery prediction failed: {e}")

    # FIX: Update agent_state counters that were defined but never incremented.
    # streak, total_workouts, last_session_date, weekly_session_count,
    # and consecutive_high_rpe_days were always 0 for every user.
    try:
        await asyncio.to_thread(_update_agent_state_on_completion, user_id, cns_fatigue_after)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            f"Could not update agent_state after session complete for {user_id}: {e}"
        )
        # Don't fail the request — session is already marked complete.

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

    return {
        **session,
        "summary": {
            "total_volume_kg": total_volume_kg,
            "duration_minutes": duration_minutes,
            "calories_burned": calories_burned,
            "calories_is_estimate": True,
            "new_prs": new_prs,
            "recovery_prediction": recovery_prediction,
            "sets_logged": len(logs),
        },
    }


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


def _update_agent_state_on_completion(user_id: str, cns_fatigue_after: Optional[int]):
    """
    Recompute and persist the agent_state fields that track longitudinal
    training history. Called synchronously in a thread after a session
    is marked complete.
    """
    sb = get_supabase()
    today = date.today()

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

    # ── Consecutive high-RPE days ───────────────────────────────────────
    # Increment if this session had cns_fatigue_after >= 7, else reset to 0
    high_rpe_days = state.get("consecutive_high_rpe_days", 0)
    if cns_fatigue_after is not None:
        if cns_fatigue_after >= 7:
            high_rpe_days = high_rpe_days + 1
        else:
            high_rpe_days = 0

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

    upsert_agent_state(user_id, updated_state)


@router.post("/sessions/{session_id}/logs", status_code=201)
async def log_set(
    session_id: str,
    payload: SetLogRequest,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    # FIX: Auto-compute set_number so the frontend doesn't need to track it.
    existing_res = (
        sb.table("exercise_logs")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .eq("exercise_name", payload.exercise_name)
        .execute()
    )
    set_number = (existing_res.count or 0) + 1

    data = payload.model_dump()
    data["session_id"] = session_id
    data["user_id"] = user_id
    data["set_number"] = set_number

    res = sb.table("exercise_logs").insert(data).execute()
    if not res.data:
        raise HTTPException(500, "Failed to log set")
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
        .select("weight_kg, reps, logged_at")
        .eq("user_id", current_user["user_id"])
        .ilike("exercise_name", f"%{exercise}%")
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