"""
Progress route — metrics logging + rich analytics data for the Progress Center.
main.py mounts this at prefix="/api/progress".
"""
from fastapi import APIRouter, Depends
from schemas.models import MetricsCreate
from core.security import get_current_user
from db.supabase_client import get_supabase
from datetime import date, timedelta
from collections import defaultdict

# ✅ NO prefix here — main.py sets prefix="/api/progress"
router = APIRouter(tags=["Progress"])


@router.post("/metrics", status_code=201)
async def log_metrics(
    payload: MetricsCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = current_user["user_id"]
    if data.get("recorded_date"):
        data["recorded_date"] = str(data["recorded_date"])
    res = sb.table("progress_metrics").insert(data).execute()
    return res.data[0] if res.data else {}


@router.get("/metrics")
async def get_metrics(
    limit: int = 30,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("progress_metrics")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("recorded_date", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data


@router.get("/heatmap")
async def get_volume_heatmap(
    weeks: int = 8,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns a 2D grid of actual session volume (sets count) per day
    for the last N weeks. Used by VolumeHeatmap in AnalyticsScreen.

    Response: { weeks: [[{date, sets, volume_kg, has_session}...] x 7] x N }
    Each inner array is Mon→Sun. Cells in the future are marked future=True.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]
    today = date.today()
    # Align to Monday of the oldest week
    start_monday = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    cutoff = str(start_monday)

    # Fetch all completed sessions in range with their volume
    sessions_res = (
        sb.table("workout_sessions")
        .select("session_date, total_volume_kg, completed")
        .eq("user_id", user_id)
        .gte("session_date", cutoff)
        .order("session_date")
        .execute()
    )
    sessions = sessions_res.data or []

    # Fetch exercise_logs to compute real set counts per day
    logs_res = (
        sb.table("exercise_logs")
        .select("logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )
    logs = logs_res.data or []

    # Build a lookup: date_str -> set count
    sets_by_date: dict[str, int] = defaultdict(int)
    for log in logs:
        d = log["logged_at"][:10]
        sets_by_date[d] += 1

    # Build a lookup: date_str -> volume_kg
    vol_by_date: dict[str, float] = {}
    session_dates: set[str] = set()
    for s in sessions:
        d = str(s["session_date"])[:10]
        vol_by_date[d] = s.get("total_volume_kg") or 0
        session_dates.add(d)

    # Build grid: list of weeks, each a list of 7 days (Mon→Sun)
    grid = []
    for w in range(weeks):
        week_start = start_monday + timedelta(weeks=w)
        week = []
        for d in range(7):
            day = week_start + timedelta(days=d)
            ds = str(day)
            week.append({
                "date": ds,
                "sets": sets_by_date.get(ds, 0),
                "volume_kg": round(vol_by_date.get(ds, 0), 1),
                "has_session": ds in session_dates,
                "future": day > today,
            })
        grid.append(week)

    total_sessions = len(session_dates)
    return {
        "weeks": grid,
        "total_sessions": total_sessions,
        "has_data": total_sessions > 0,
    }


@router.get("/muscle-balance")
async def get_muscle_balance(
    weeks: int = 4,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns muscle group training frequency as a percentage of total sessions,
    computed from real exercise_logs. Used by RadarChart in AnalyticsScreen.
    """
    sb = get_supabase()
    user_id = current_user["user_id"]
    cutoff = str(date.today() - timedelta(weeks=weeks))

    logs_res = (
        sb.table("exercise_logs")
        .select("exercise_name, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )
    logs = logs_res.data or []

    if not logs:
        return {
            "has_data": False,
            "muscle_groups": [],
            "empty_state": f"Complete {3 if weeks <= 4 else weeks} workouts to unlock muscle balance.",
        }

    # Map exercise names to muscle groups (keyword heuristic)
    def classify_exercise(name: str) -> str:
        name_l = name.lower()
        if any(k in name_l for k in ["bench", "chest", "pec", "fly", "push up", "pushup", "dip"]):
            return "Chest"
        if any(k in name_l for k in ["pull", "row", "lat", "back", "deadlift", "chin"]):
            return "Back"
        if any(k in name_l for k in ["shoulder", "press", "delt", "lateral", "overhead", "ohp", "military"]):
            return "Shoulders"
        if any(k in name_l for k in ["curl", "tricep", "bicep", "arm", "hammer", "skullcrusher"]):
            return "Arms"
        if any(k in name_l for k in ["squat", "leg", "lunge", "calf", "quad", "hamstring", "glute", "hip", "rdl", "leg press"]):
            return "Legs"
        if any(k in name_l for k in ["plank", "crunch", "core", "ab", "cable crunch", "situp", "sit-up"]):
            return "Core"
        return None

    muscle_sets: dict[str, int] = defaultdict(int)
    total_sets = 0
    for log in logs:
        mg = classify_exercise(log.get("exercise_name", ""))
        if mg:
            muscle_sets[mg] += 1
            total_sets += 1

    if total_sets == 0:
        return {
            "has_data": False,
            "muscle_groups": [],
            "empty_state": "Log exercises with recognized names (Bench Press, Squat, Deadlift) to see muscle balance.",
        }

    all_groups = ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs"]
    max_sets = max(muscle_sets.values()) if muscle_sets else 1
    result = []
    for g in all_groups:
        count = muscle_sets.get(g, 0)
        pct = round((count / max_sets) * 100) if max_sets > 0 else 0
        result.append({"name": g, "sets": count, "pct": pct})

    lagging = [g["name"] for g in result if g["pct"] < 40]
    return {
        "has_data": True,
        "muscle_groups": result,
        "lagging": lagging,
        "total_sets": total_sets,
        "weeks": weeks,
    }


@router.get("/pr-timeline")
async def get_pr_timeline(
    limit: int = 20,
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
        .select("id, total_volume_kg, completed, session_date")
        .eq("user_id", user_id)
        .gte("session_date", str(week_start))
        .execute()
    )
    sessions = sessions_res.data or []
    completed = [s for s in sessions if s.get("completed")]

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
        "avg_rpe": avg_rpe,
        "logs_count": len(logs),
        "has_data": len(completed) > 0,
    }