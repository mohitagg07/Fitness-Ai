"""
Calendar Intelligence — VYRN

Learns each user's real workout schedule (which days, roughly what time)
from actual logged sessions, then services/scheduler.py's
job_workout_reminders() uses it to push a reminder ~45 minutes before
their usual time — "User trains 6 PM → auto-reminds 5:15 PM" from the
roadmap.

No calendar app integration (that would need OAuth against Google/Apple
Calendar, out of scope here) — this reads the same workout_sessions table
every other analytics feature in the app already reads, so "the AI
learned my schedule" costs nothing extra to log.
"""
from __future__ import annotations
import logging
from datetime import date, timedelta

logger = logging.getLogger(__name__)

MIN_SESSIONS_FOR_PATTERN = 4
REMINDER_LEAD_MINUTES = 45


def get_typical_schedule(user_id: str, days: int = 60) -> dict:
    """
    Returns {"days": {"Monday": {"typical_hour": 18, "sessions": 6}, ...},
    "has_pattern": bool}. "typical_hour" is the most common hour (mode) a
    completed session's created_at fell in for that weekday — created_at
    is the closest real timestamp the schema has to "when the workout
    happened" (there's no dedicated start_time column). A day only gets a
    typical_hour once it has at least 3 completed sessions, so a single
    late-night outlier doesn't define "your Tuesday time."
    """
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    try:
        res = (
            sb.table("workout_sessions")
            .select("session_date, created_at")
            .eq("user_id", user_id)
            .eq("completed", True)
            .gte("session_date", cutoff)
            .execute()
        )
        sessions = res.data or []
    except Exception as e:
        logger.warning(f"calendar_intelligence: query failed for {user_id}: {e}")
        return {"days": {}, "has_pattern": False}

    by_day: dict[str, list[int]] = {}
    for s in sessions:
        created = s.get("created_at")
        if not created:
            continue
        try:
            hour = int(created[11:13])
            day_name = date.fromisoformat(s["session_date"]).strftime("%A")
        except Exception:
            continue
        by_day.setdefault(day_name, []).append(hour)

    days_out = {}
    for day, hours in by_day.items():
        if len(hours) < 3:
            continue
        # mode, tie-broken by earliest hour for a stable, predictable pick
        counts: dict[int, int] = {}
        for h in hours:
            counts[h] = counts.get(h, 0) + 1
        best_hour = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        days_out[day] = {"typical_hour": best_hour, "sessions": len(hours)}

    return {"days": days_out, "has_pattern": len(sessions) >= MIN_SESSIONS_FOR_PATTERN}


def _already_trained_today(user_id: str) -> bool:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    try:
        res = (
            sb.table("workout_sessions")
            .select("id")
            .eq("user_id", user_id)
            .eq("session_date", str(date.today()))
            .eq("completed", True)
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def check_reminder_due(user_id: str, now_hour: int, now_minute: int) -> dict | None:
    """
    Returns a notification payload (same shape services/notifications.py
    builds) if right now falls in the ~45-minute reminder window before
    today's typical workout time and the user hasn't already trained
    today. Returns None otherwise — most calls, most of the time, since
    this fires once in a ~15-30 minute window per day per user.
    """
    schedule = get_typical_schedule(user_id)
    if not schedule["has_pattern"]:
        return None

    today_name = date.today().strftime("%A")
    day_info = schedule["days"].get(today_name)
    if not day_info:
        return None  # no established pattern for today specifically

    if _already_trained_today(user_id):
        return None

    typical_hour = day_info["typical_hour"]
    reminder_minute_of_day = typical_hour * 60 - REMINDER_LEAD_MINUTES
    now_minute_of_day = now_hour * 60 + now_minute

    # Fire once, in the ~15-minute window the scheduler's interval job
    # checks (see job_workout_reminders in services/scheduler.py) —
    # window width matches the job's polling interval so this can't be
    # missed by running too infrequently or fire twice from overlap.
    if 0 <= (now_minute_of_day - reminder_minute_of_day) < 15:
        return {
            "type": "workout_reminder",
            "title": "Workout coming up",
            "body": f"You usually train around {typical_hour % 12 or 12}{'AM' if typical_hour < 12 else 'PM'} on {today_name}s. Starting soon?",
            "priority": "normal",
            "cta": "/workout",
            "data": {"typical_hour": typical_hour, "day": today_name},
        }
    return None
