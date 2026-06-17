"""
Workout Agent — decides what today's training should be instead of waiting
to be asked. Reads the active workout_plans schedule, checks whether
yesterday's planned session was actually completed, and either confirms
today's plan or reschedules a missed day.

"You missed leg day yesterday. Rescheduling it for today at 6 PM."
"""
from datetime import date, timedelta
from schemas.models import WorkoutDecision
from db.supabase_client import get_supabase

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _active_plan(user_id: str) -> dict | None:
    sb = get_supabase()
    res = (
        sb.table("workout_plans")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def _session_on(user_id: str, on_date: date) -> dict | None:
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("*")
        .eq("user_id", user_id)
        .eq("session_date", str(on_date))
        .execute()
    )
    return res.data[0] if res.data else None


def _planned_type_for(schedule: dict, on_date: date) -> str | None:
    key = DAY_KEYS[on_date.weekday()]
    return (schedule or {}).get(key)


def run_workout_agent(user_id: str, preferred_time: str | None = None) -> WorkoutDecision:
    plan = _active_plan(user_id)
    today = date.today()
    yesterday = today - timedelta(days=1)

    if not plan:
        return WorkoutDecision(
            message="No active workout plan found yet — complete onboarding so I can build one.",
            rescheduled=False,
            recommended_type=None,
        )

    schedule = plan.get("schedule") or {}
    today_planned = _planned_type_for(schedule, today)
    yesterday_planned = _planned_type_for(schedule, yesterday)

    # Check whether yesterday's planned session (if any, and not "rest") was completed
    missed_yesterday = False
    if yesterday_planned and yesterday_planned.lower() != "rest":
        y_session = _session_on(user_id, yesterday)
        if not y_session or not y_session.get("completed"):
            missed_yesterday = True

    time_str = f" at {preferred_time}" if preferred_time else ""

    if missed_yesterday:
        message = (
            f"You missed {yesterday_planned.replace('_', ' ').title()} day yesterday. "
            f"Rescheduling it for today{time_str}."
        )
        return WorkoutDecision(
            message=message,
            rescheduled=True,
            recommended_type=yesterday_planned,
        )

    if not today_planned or today_planned.lower() == "rest":
        return WorkoutDecision(
            message="Today is a scheduled rest day. Recovery is part of the plan — take it.",
            rescheduled=False,
            recommended_type="rest",
        )

    today_session = _session_on(user_id, today)
    if today_session and today_session.get("completed"):
        return WorkoutDecision(
            message=f"{today_planned.replace('_', ' ').title()} day is already logged as complete. Nice work.",
            rescheduled=False,
            recommended_type=today_planned,
        )

    message = f"{today_planned.replace('_', ' ').title()} day is on schedule for today{time_str}."
    return WorkoutDecision(
        message=message,
        rescheduled=False,
        recommended_type=today_planned,
    )
