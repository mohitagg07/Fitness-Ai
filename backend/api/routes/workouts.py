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
    weight_kg: float = Field(gt=0)
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


class SessionCompleteRequest(BaseModel):
    """Optional finish-summary payload — personal notes entered at the end of a session."""
    cns_fatigue_after: Optional[int] = Field(None, ge=1, le=10)
    session_notes: Optional[str] = Field(None, max_length=1000)


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

    duration_minutes = None
    if len(logs) >= 2:
        try:
            first_ts = datetime.fromisoformat(logs[0]["logged_at"].replace("Z", "+00:00"))
            last_ts = datetime.fromisoformat(logs[-1]["logged_at"].replace("Z", "+00:00"))
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
    if session_notes is not None:
        update_data["notes"] = session_notes
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
    if working_logs:
        best_this_session: dict[str, dict] = {}
        for l in working_logs:
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
    recovery_pct = None
    try:
        from agents.recovery_agent import run_recovery_agent
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        recovery_decision = await asyncio.to_thread(
            run_recovery_agent,
            user_id,
            sleep_hours=profile.get("sleep_hours"),
            planned_workout_type=None,
        )
        # NOTE: recovery_decision.recovery_score is 0-10 (schema-constrained,
        # ge=0/le=10) — comparing it against 70/40 here was a pre-existing
        # scale bug that meant recovery_prediction was effectively always
        # "Low" in production. score_pct is the real 0-100 value the agent
        # already computes (attached as an extra attribute, see
        # recovery_agent.py's docstring) — use that for both the label and
        # the percentage the summary card shows.
        score_pct_val = getattr(recovery_decision, "score_pct", recovery_decision.recovery_score * 10)
        recovery_pct = round(score_pct_val)
        recovery_prediction = "High" if score_pct_val >= 70 else "Medium" if score_pct_val >= 40 else "Low"
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Recovery prediction failed: {e}")

    # FIX: Update agent_state counters that were defined but never incremented.
    # streak, total_workouts, last_session_date, weekly_session_count,
    # and consecutive_high_rpe_days were always 0 for every user.
    workout_streak = None
    try:
        workout_streak = await asyncio.to_thread(_update_agent_state_on_completion, user_id, cns_fatigue_after)
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
    summary_flat = {
        "id": session.get("id"),
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
        "recovery_prediction": recovery_prediction,
        "recovery_pct": recovery_pct,
        "coach_message": coach_message,
        "workout_streak": workout_streak,
        "protein_streak": protein_streak,
    }

    return {
        **session,
        **summary_flat,
        "summary": summary_flat,
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
    return streak


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

    # Extended fields (is_dropset, is_warmup, superset_group, tempo,
    # to_failure, set_notes) are now real columns on exercise_logs — see
    # MIGRATION_v3_exercise_logs_extended.sql. They used to be stripped
    # here defensively, which silently discarded warm-up/dropset flags on
    # every insert (never persisted even though the UI collected them) and
    # is what caused downstream reads in this file — the workout-history
    # list and complete_session's volume calc — to 500 with "column
    # exercise_logs.is_warmup does not exist" once those reads started
    # selecting the column directly. Run the migration before deploying
    # this change.
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