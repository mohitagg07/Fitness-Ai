"""
Workout Agent — recommends today's scheduled workout without silently moving sessions.

A missed workout is reported as context. It is never moved to another day
or substituted for today's plan without an explicit athlete-approved
schedule change.
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


def _was_session_missed(session: dict | None) -> bool:
    """Only absent or explicitly unfinished terminal sessions count as missed.

    Active/paused sessions are unresolved work and must not be duplicated by
    suggesting another copy on a different day.
    """
    if session is None:
        return True
    if session.get("completed") is True:
        return False
    if session.get("status") in {"active", "paused"}:
        return False
    return True


def run_workout_agent(
    user_id: str,
    preferred_time: str | None = None,
    target_date: date | None = None,
) -> WorkoutDecision:
    plan = _active_plan(user_id)
    today = target_date or date.today()
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

    missed_yesterday = False
    if yesterday_planned and yesterday_planned.lower() != "rest":
        yesterday_session = _session_on(user_id, yesterday)
        missed_yesterday = _was_session_missed(yesterday_session)

    time_str = f" at {preferred_time}" if preferred_time else ""

    # Today's recorded completion takes precedence over any missed previous day.
    today_session = None
    if today_planned and today_planned.lower() != "rest":
        today_session = _session_on(user_id, today)
        if today_session and today_session.get("completed"):
            message = (
                f"{today_planned.replace('_', ' ').title()} day is already logged as complete. "
                "Your schedule is unchanged."
            )
            if missed_yesterday:
                message += (
                    f" Yesterday's {yesterday_planned.replace('_', ' ').title()} session "
                    "was not logged as complete and has not been moved."
                )
            return WorkoutDecision(
                message=message,
                rescheduled=False,
                recommended_type=today_planned,
            )

    if not today_planned or today_planned.lower() == "rest":
        if missed_yesterday:
            message = (
                f"Yesterday's {yesterday_planned.replace('_', ' ').title()} session "
                "was not logged as complete. Today remains a scheduled rest day; "
                "nothing has been moved and your weekly plan is unchanged."
            )
        else:
            message = "Today is a scheduled rest day. Recovery is part of the plan — take it."
        return WorkoutDecision(
            message=message,
            rescheduled=False,
            recommended_type="rest",
        )

    today_label = today_planned.replace("_", " ").title()
    if missed_yesterday:
        missed_label = yesterday_planned.replace("_", " ").title()
        message = (
            f"Yesterday's {missed_label} session was not logged as complete. "
            f"Today's scheduled {today_label} remains unchanged. "
            "The missed session has not been rescheduled; move it only after you approve a schedule change."
        )
    else:
        message = f"{today_label} day is on schedule for today{time_str}."

    return WorkoutDecision(
        message=message,
        rescheduled=False,
        recommended_type=today_planned,
    )
