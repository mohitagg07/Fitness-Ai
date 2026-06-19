"""
Recovery Agent — reads sleep + CNS fatigue + recent training intensity and
proactively swaps the day's plan instead of letting the user push through.

"Recovery score is low. Replace HIIT with walking today."
"""
from datetime import date, timedelta
from schemas.models import RecoveryDecision
from db.supabase_client import get_supabase
from services.agent_state_store import get_agent_state


def _sessions_last_n_days(user_id: str, days: int) -> list[dict]:
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("workout_sessions")
        .select("session_date, cns_fatigue_after, completed")
        .eq("user_id", user_id)
        .gte("session_date", cutoff)
        .execute()
    )
    return res.data or []


def _compute_recovery_score(sleep_hours: float | None, cns_fatigue: int, high_rpe_days: int) -> int:
    """
    0-10 score, 10 = fully recovered. Simple weighted heuristic:
    - Sleep below 6h is a heavy penalty (most controllable lever)
    - High CNS fatigue score is a heavy penalty
    - Consecutive high-RPE days compounds the penalty (no deload yet)
    """
    score = 10

    if sleep_hours is not None:
        if sleep_hours < 5:
            score -= 4
        elif sleep_hours < 6:
            score -= 2
        elif sleep_hours < 7:
            score -= 1

    score -= min(5, cns_fatigue // 2)
    score -= min(3, high_rpe_days)

    return max(0, min(10, score))


def run_recovery_agent(user_id: str, sleep_hours: float | None, planned_workout_type: str | None = None) -> RecoveryDecision:
    agent_state = get_agent_state(user_id)
    cns_fatigue = agent_state.get("cns_fatigue_score", 0)
    high_rpe_days = agent_state.get("consecutive_high_rpe_days", 0)

    score = _compute_recovery_score(sleep_hours, cns_fatigue, high_rpe_days)

    high_intensity_types = {"push", "pull", "legs", "cardio"}
    is_high_intensity_planned = (planned_workout_type or "").lower() in high_intensity_types

    if score <= 3:
        action = "rest"
        if is_high_intensity_planned:
            message = (
                f"Recovery score is {score}/10 — low. Skip training entirely today. "
                "Focus on sleep, hydration, and light stretching."
            )
        else:
            message = f"Recovery score is {score}/10 — low. Take a full rest day, even from light work."
    elif score <= 6:
        action = "replace_with_light"
        if is_high_intensity_planned:
            message = f"Recovery score is {score}/10 — low. Replace today's {planned_workout_type} session with a walk or light mobility work."
        else:
            message = f"Recovery score is {score}/10. Keep today light — mobility, walking, or technique work only."
    else:
        action = "proceed"
        message = f"Recovery score is {score}/10 — you're good to train as planned today."

    return RecoveryDecision(
        recovery_score=score,
        action=action,
        message=message,
    )
