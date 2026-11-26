"""
Progress route — metrics logging + rich analytics data for the Progress Center.
main.py mounts this at prefix="/api/progress".
"""
import asyncio

from fastapi import APIRouter, Depends, Query
from schemas.models import MetricsCreate
from core.security import get_current_user
from db.supabase_client import get_supabase
from agents.consistency_agent import run_consistency_agent
from datetime import date, timedelta
from collections import defaultdict

from services.exercise_catalog import list_exercises
from services.exercise_library import classify_muscle_group

# ✅ NO prefix here — main.py sets prefix="/api/progress"
router = APIRouter(tags=["Progress"])


def _build_volume_heatmap(
    weeks: int,
    today: date,
    sessions: list[dict],
    logs: list[dict],
) -> dict:
    """Build a Mon-Sun grid without double-counting days or overwriting sessions."""
    start_monday = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    set_counts: dict[str, int] = defaultdict(int)
    for log in logs:
        if log.get("is_warmup"):
            continue
        logged_at = log.get("logged_at")
        if not logged_at:
            continue
        set_counts[str(logged_at)[:10]] += 1

    session_counts: dict[str, int] = defaultdict(int)
    volume_by_day: dict[str, float] = defaultdict(float)
    for session in sessions:
        if session.get("completed") is not True:
            continue
        session_date = session.get("session_date")
        if not session_date:
            continue
        day_key = str(session_date)[:10]
        session_counts[day_key] += 1
        volume_by_day[day_key] += float(session.get("total_volume_kg") or 0)

    grid = []
    for week_index in range(weeks):
        week_start = start_monday + timedelta(weeks=week_index)
        week = []
        for day_index in range(7):
            day = week_start + timedelta(days=day_index)
            day_key = str(day)
            session_count = session_counts.get(day_key, 0)
            week.append({
                "date": day_key,
                "sets": set_counts.get(day_key, 0),
                "volume_kg": round(volume_by_day.get(day_key, 0.0), 1),
                "has_session": session_count > 0,
                "session_count": session_count,
                "future": day > today,
            })
        grid.append(week)

    total_sessions = sum(session_counts.values())
    has_logged_sets = any(count > 0 for count in set_counts.values())
    return {
        "weeks": grid,
        "total_sessions": total_sessions,
        "has_data": total_sessions > 0 or has_logged_sets,
        "empty_state": "Log working sets or complete a workout to see your training activity.",
    }


@router.post("/metrics", status_code=201)
async def log_metrics(
    payload: MetricsCreate,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    data = {key: value for key, value in payload.model_dump().items() if value is not None}
    data["user_id"] = current_user["user_id"]
    if data.get("recorded_date"):
        data["recorded_date"] = str(data["recorded_date"])
    response = sb.table("progress_metrics").insert(data).execute()
    return response.data[0] if response.data else {}


@router.get("/metrics")
async def get_metrics(
    limit: int = 30,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    response = (
        sb.table("progress_metrics")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("recorded_date", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data


@router.get("/heatmap")
async def get_volume_heatmap(
    weeks: int = Query(default=8, ge=1, le=16),
    current_user: dict = Depends(get_current_user),
):
    """Return daily working-set counts and completed-session volume for 1–16 weeks."""
    sb = get_supabase()
    user_id = current_user["user_id"]
    today = date.today()
    start_monday = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    cutoff = str(start_monday)

    sessions_response = (
        sb.table("workout_sessions")
        .select("session_date, total_volume_kg, completed")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", cutoff)
        .order("session_date")
        .execute()
    )
    logs_response = (
        sb.table("exercise_logs")
        .select("logged_at, is_warmup")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )

    return _build_volume_heatmap(
        weeks=weeks,
        today=today,
        sessions=sessions_response.data or [],
        logs=logs_response.data or [],
    )


@router.get("/predictions/trajectory")
async def get_trajectory_predictions(current_user: dict = Depends(get_current_user)):
    """
    Real trend-regression projections — bodyweight and the user's most-
    logged lift — computed by services/prediction_engine.py from actual
    logged history. Every projection ships with n_points, r_squared, and
    a confidence label so a noisy trend reads as noisy, not as a
    confident number pulled from nowhere. See that module's docstring for
    why this is intentionally separate from the Dashboard's Trajectory
    card, which deliberately avoids ETA-style projections.
    """
    from services.prediction_engine import run_prediction_engine
    return run_prediction_engine(current_user["user_id"])


@router.get("/muscle-recovery")
async def get_muscle_recovery(current_user: dict = Depends(get_current_user)):
    """
    Per-muscle-group recovery estimate (0-100%, green/yellow/red) computed
    from real exercise_logs timestamps — see
    services/training_load_engine.compute_muscle_recovery_map for the model.
    Backs the Muscle Recovery Map on the Progress screen.
    """
    from services.training_load_engine import compute_muscle_recovery_map
    return await asyncio.to_thread(
        compute_muscle_recovery_map,
        current_user["user_id"],
    )


@router.get("/exercise-catalog")
async def get_exercise_catalog(current_user: dict = Depends(get_current_user)):
    """Return curated movement metadata shared by analytics and form tools."""
    return {"version": "1.0", "exercises": list_exercises()}


@router.get("/muscle-balance")
async def get_muscle_balance(
    weeks: int = Query(default=4, ge=1, le=16),
    current_user: dict = Depends(get_current_user),
):
    """
    Compare classified working-set counts with the most-logged primary group.
    Each exercise log contributes one primary group; secondary involvement is
    not fractionally attributed. Percentages are descriptive, not hypertrophy.
    """
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(weeks=weeks))
    logs_response = (
        sb.table("exercise_logs")
        .select("exercise_name, logged_at, is_warmup")
        .eq("user_id", current_user["user_id"])
        .gte("logged_at", cutoff)
        .execute()
    )
    logs = [row for row in (logs_response.data or []) if not row.get("is_warmup")]

    if not logs:
        return {
            "has_data": False,
            "muscle_groups": [],
            "empty_state": "Log working sets to start building your primary-muscle distribution.",
            "total_sets": 0,
            "weeks": weeks,
            "comparison_basis": "percentage_of_highest_primary_group",
            "lower_exposure_threshold_pct": 40,
        }

    muscle_sets: dict[str, int] = defaultdict(int)
    classified_sets = 0
    for log in logs:
        group = classify_muscle_group(log.get("exercise_name", ""))
        if group:
            muscle_sets[group] += 1
            classified_sets += 1

    if classified_sets == 0:
        return {
            "has_data": False,
            "muscle_groups": [],
            "empty_state": "No logged exercises matched the catalogue yet. Use a supported exercise name to classify primary-muscle exposure.",
            "total_sets": 0,
            "weeks": weeks,
            "comparison_basis": "percentage_of_highest_primary_group",
            "lower_exposure_threshold_pct": 40,
        }

    all_groups = ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs"]
    peak_sets = max(muscle_sets.values()) or 1
    groups = [
        {
            "name": name,
            "sets": muscle_sets.get(name, 0),
            "pct": round((muscle_sets.get(name, 0) / peak_sets) * 100),
        }
        for name in all_groups
    ]
    lower_exposure = [group["name"] for group in groups if group["pct"] < 40]

    return {
        "has_data": True,
        "muscle_groups": groups,
        "lower_exposure_groups": lower_exposure,
        "lagging": lower_exposure,
        "total_sets": classified_sets,
        "weeks": weeks,
        "comparison_basis": "percentage_of_highest_primary_group",
        "lower_exposure_threshold_pct": 40,
    }


@router.get("/pr-timeline")
async def get_pr_timeline(
    limit: int = Query(default=20, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the user's real personal records sorted by date descending.
    Used by PRTimeline in AnalyticsScreen.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]

    prs_res = (
        sb.table("personal_records")
        .select("exercise_name, weight_kg, reps, achieved_at")
        .eq("user_id", user_id)
        .order("achieved_at", desc=True)
        .limit(limit)
        .execute()
    )
    prs = prs_res.data or []

    if not prs:
        return {
            "has_data": False,
            "prs": [],
            "empty_state": "Log your first bench press, squat, or deadlift to start your PR timeline.",
        }

    formatted = []
    for pr in prs:
        d = pr.get("achieved_at") or ""
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(d) if d else None
            date_label = dt.strftime("%b %-d") if dt else "Unknown"
        except Exception:
            date_label = d[:10] if d else "Unknown"
        formatted.append({
            "date": date_label,
            "lift": pr["exercise_name"],
            "weight_kg": pr["weight_kg"],
            "reps": pr.get("reps") or 1,
            "is_pr": True,  # All rows in personal_records are PRs by definition
        })

    return {"has_data": True, "prs": formatted}


@router.get("/consistency")
async def get_consistency(
    current_user: dict = Depends(get_current_user),
):
    """
    Standalone version of the same consistency score shown on the dashboard
    (see agents/consistency_agent.py) — used by the Progress tab so the
    number and message stay identical wherever it's shown.
    """
    result = run_consistency_agent(current_user["user_id"])
    return {
        "status":   result.status,
        "score":    result.score,
        "headline": result.headline,
        "mood":     result.mood_summary,
        "pillars": [
            {"label": p.label, "pct": p.pct, "status": p.status, "detail": p.detail}
            for p in result.pillars
        ],
    }


@router.get("/weekly-stats")
async def get_weekly_stats(
    current_user: dict = Depends(get_current_user),
):
    """
    Returns real weekly statistics: sessions this week, total volume this week,
    avg RPE, most trained muscle group. Used by AnalyticsScreen weekly stats row.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]
    today = date.today()
    week_start = today - timedelta(days=today.weekday())

    sessions_res = (
        sb.table("workout_sessions")
        .select("id, total_volume_kg, duration_minutes, completed, session_date")
        .eq("user_id", user_id)
        .gte("session_date", str(week_start))
        .execute()
    )
    sessions = sessions_res.data or []
    completed = [s for s in sessions if s.get("completed")]
    total_minutes = sum(s.get("duration_minutes") or 0 for s in completed)

    logs_res = (
        sb.table("exercise_logs")
        .select("rpe, exercise_name")
        .eq("user_id", user_id)
        .gte("logged_at", str(week_start))
        .execute()
    )
    logs = logs_res.data or []

    total_volume = sum(s.get("total_volume_kg") or 0 for s in completed)
    avg_rpe = (
        round(sum(l["rpe"] for l in logs if l.get("rpe")) / len([l for l in logs if l.get("rpe")]), 1)
        if any(l.get("rpe") for l in logs) else None
    )

    return {
        "sessions_completed": len(completed),
        "total_sessions": len(sessions),
        "total_volume_kg": round(total_volume, 1),
        "total_minutes": total_minutes,
        "avg_rpe": avg_rpe,
        "logs_count": len(logs),
        "has_data": len(completed) > 0,
    }
