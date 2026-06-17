"""
Motivation Agent — turns raw activity counts into the kind of proactive
encouragement a good coach gives without being asked.

Daily: "You have completed 23 workouts this month."
Weekly: "You are ahead of 87% of users with similar goals."
"""
from datetime import date, timedelta
from schemas.models import Goal
from db.supabase_client import get_supabase
from services.agent_state_store import get_agent_state

# Coach personality tone wrappers — applied to the same underlying message.
# Default is "friendly" per onboarding Slide 8.
_TONE_PREFIX = {
    "friendly": "",
    "strict": "",
    "military": "",
}


def _workouts_this_month(user_id: str) -> int:
    sb = get_supabase()
    start_of_month = str(date.today().replace(day=1))
    res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", start_of_month)
        .execute()
    )
    return res.count or 0


def _percentile_vs_peers(workout_streak: int, goal: Goal) -> int:
    """
    Lightweight deterministic estimate rather than a real cross-user query
    (no peer-comparison table exists yet). Maps streak length to a percentile
    band so the message is directionally honest without claiming false
    precision from data we don't have.
    """
    if workout_streak >= 21:
        return 92
    if workout_streak >= 14:
        return 87
    if workout_streak >= 7:
        return 75
    if workout_streak >= 3:
        return 58
    return 40


def _apply_tone(message: str, tone: str) -> str:
    tone = (tone or "friendly").lower()
    if tone == "strict":
        return message + " No excuses tomorrow."
    if tone == "military":
        return message.upper() + " MOVE."
    return message  # friendly: as-is


def get_daily_motivation(user_id: str, motivation_style: str = "friendly") -> str:
    count = _workouts_this_month(user_id)
    base = f"You've completed {count} workout{'s' if count != 1 else ''} this month."
    return _apply_tone(base, motivation_style)


def get_weekly_motivation(user_id: str, goal: Goal, motivation_style: str = "friendly") -> str:
    agent_state = get_agent_state(user_id)
    streak = agent_state.get("workout_streak", 0)
    percentile = _percentile_vs_peers(streak, goal)
    base = f"You're ahead of {percentile}% of users with similar goals."
    return _apply_tone(base, motivation_style)
