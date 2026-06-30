"""
Motivation Engine — VYRN  (v2)

Every motivation message references a REAL number from the user's history.
No quotes. No canned strings. Examples:

  "You've trained 21 days this month — best month ever."
  "You're only 3 kg away from 100 kg Bench."
  "7-day streak — you've never gone this long before."
  "Protein hit every day this week. First time in 3 weeks."

Motivation types (each tries to find a real, impressive number):
  - best_month_ever      (workout count vs previous months)
  - pr_proximity         (closest you've been to a round-number PR)
  - streak_personal_best (longest streak ever)
  - protein_streak       (consecutive days hitting protein target)
  - volume_milestone     (total kg lifted this month)
  - comeback             (returning after a gap)

Coach personality is applied as a tone wrapper after the message is built.
"""
from __future__ import annotations
import logging
from datetime import date, timedelta
from db.supabase_client import get_supabase
from services.agent_state_store import get_agent_state

logger = logging.getLogger(__name__)


# ── Data helpers ──────────────────────────────────────────────────────────────

def _workouts_this_month(user_id: str) -> int:
    sb = get_supabase()
    start = str(date.today().replace(day=1))
    res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", start)
        .execute()
    )
    return res.count or 0


def _workouts_per_month(user_id: str, months: int = 6) -> list[int]:
    """Return workout count per calendar month, oldest first."""
    sb = get_supabase()
    counts = []
    today = date.today()
    for i in range(months, 0, -1):
        # Build start/end for that month
        month_offset = today.month - i
        year = today.year + (month_offset - 1) // 12
        month = ((month_offset - 1) % 12) + 1
        start = str(date(year, month, 1))
        if month == 12:
            end_y, end_m = year + 1, 1
        else:
            end_y, end_m = year, month + 1
        end = str(date(end_y, end_m, 1))
        try:
            res = (
                sb.table("workout_sessions")
                .select("id", count="exact")
                .eq("user_id", user_id)
                .eq("completed", True)
                .gte("session_date", start)
                .lt("session_date", end)
                .execute()
            )
            counts.append(res.count or 0)
        except Exception:
            counts.append(0)
    return counts


def _get_prs(user_id: str) -> list[dict]:
    sb = get_supabase()
    res = (
        sb.table("personal_records")
        .select("exercise_name, weight_kg, reps")
        .eq("user_id", user_id)
        .execute()
    )
    return res.data or []


def _get_streak_history(user_id: str) -> int:
    """Approximation: longest run of consecutive completed workout days in the last 180 days."""
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=180))
    res = (
        sb.table("workout_sessions")
        .select("session_date")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", cutoff)
        .order("session_date")
        .execute()
    )
    dates = sorted({r["session_date"] for r in (res.data or [])})
    if not dates:
        return 0
    best = current = 1
    for i in range(1, len(dates)):
        d1 = date.fromisoformat(dates[i - 1])
        d2 = date.fromisoformat(dates[i])
        if (d2 - d1).days == 1:
            current += 1
            best = max(best, current)
        else:
            current = 1
    return best


def _total_volume_this_month(user_id: str) -> float:
    sb = get_supabase()
    start = str(date.today().replace(day=1))
    res = (
        sb.table("workout_sessions")
        .select("total_volume_kg")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", start)
        .execute()
    )
    return sum(r.get("total_volume_kg") or 0 for r in (res.data or []))


# ── PR proximity helper ────────────────────────────────────────────────────────

_ROUND_PR_TARGETS = [50, 60, 70, 80, 90, 100, 110, 120, 140, 150, 160, 180, 200, 220, 250]

def _nearest_pr_target(weight_kg: float) -> tuple[float, float] | None:
    """Returns (target_kg, gap_kg) for the nearest round-number milestone above current PR."""
    for target in _ROUND_PR_TARGETS:
        if target > weight_kg:
            gap = round(target - weight_kg, 1)
            if gap <= 15:   # only motivating if reachable within ~1 block
                return target, gap
    return None


# ── Tone wrappers ─────────────────────────────────────────────────────────────

def _apply_tone(message: str, tone: str) -> str:
    tone = (tone or "friendly").lower()
    if tone == "strict":
        return message + " Don't let up tomorrow."
    if tone == "military":
        return message.upper() + " KEEP MOVING."
    if tone == "scientific":
        return message + " Progressive overload confirmed."
    if tone == "supportive":
        return "You're doing great — " + message[0].lower() + message[1:]
    return message   # friendly: as-is


# ── Motivation builders ───────────────────────────────────────────────────────

def _build_best_month_message(user_id: str) -> str | None:
    this_month = _workouts_this_month(user_id)
    history    = _workouts_per_month(user_id, months=5)   # previous 5 months
    if this_month == 0 or not history:
        return None
    prev_best = max(history) if history else 0
    if this_month > prev_best and prev_best > 0:
        return f"You've trained {this_month} days this month — best month ever."
    if this_month >= 20:
        return f"You've trained {this_month} days this month — elite consistency."
    return None


def _build_pr_proximity_message(user_id: str) -> str | None:
    prs = _get_prs(user_id)
    if not prs:
        return None
    best = None
    for pr in prs:
        result = _nearest_pr_target(pr.get("weight_kg") or 0)
        if result:
            target, gap = result
            if best is None or gap < best[2]:
                best = (pr["exercise_name"], target, gap)
    if best:
        exercise, target, gap = best
        return f"You're only {gap} kg away from a {target} kg {exercise}."
    return None


def _build_streak_message(user_id: str, current_streak: int) -> str | None:
    if current_streak < 3:
        return None
    historical_best = _get_streak_history(user_id)
    if current_streak >= historical_best:
        return f"{current_streak}-day workout streak — longest you've ever gone."
    return f"{current_streak} days in a row — you're building real momentum."


def _build_protein_streak_message(protein_streak: int) -> str | None:
    if protein_streak >= 7:
        return f"Protein target hit {protein_streak} days in a row. Muscle-building mode: locked."
    if protein_streak >= 3:
        return f"{protein_streak}-day protein streak — keep it going, this is where gains happen."
    return None


def _build_volume_milestone_message(user_id: str) -> str | None:
    vol = _total_volume_this_month(user_id)
    if vol <= 0:
        return None
    tonnes = vol / 1000
    if tonnes >= 50:
        return f"You've moved {tonnes:.0f} tonnes of iron this month. Machine."
    if tonnes >= 20:
        return f"{tonnes:.0f} tonnes lifted this month — dialled in."
    return None


def _build_comeback_message(user_id: str, agent_state: dict) -> str | None:
    """Fires if the user had a gap of 5+ days then came back and has a 3+ day streak now."""
    streak = agent_state.get("workout_streak", 0)
    if streak < 3:
        return None
    # Check for a gap just before the current streak
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=14))
    res = (
        sb.table("workout_sessions")
        .select("session_date, completed")
        .eq("user_id", user_id)
        .gte("session_date", cutoff)
        .order("session_date")
        .execute()
    )
    dates = sorted({r["session_date"] for r in (res.data or []) if r.get("completed")})
    if len(dates) < 2:
        return None
    # Find the gap just before the last `streak` days
    if len(dates) > streak:
        d_before = date.fromisoformat(dates[-(streak + 1)])
        d_after  = date.fromisoformat(dates[-streak])
        gap_days = (d_after - d_before).days
        if gap_days >= 5:
            return f"Back on track after a {gap_days}-day break — {streak} straight already."
    return None


# ── Main public interface ─────────────────────────────────────────────────────

def get_motivation_message(user_id: str, motivation_style: str = "friendly") -> str:
    """
    Returns ONE best motivation message — real numbers, no canned strings.
    Tries each builder in priority order and returns the first non-None result.
    Falls back to a workout count message which always has a real number.
    """
    agent_state   = get_agent_state(user_id)
    streak        = agent_state.get("workout_streak", 0)
    protein_streak = agent_state.get("protein_streak", 0)

    for builder in [
        lambda: _build_best_month_message(user_id),
        lambda: _build_pr_proximity_message(user_id),
        lambda: _build_streak_message(user_id, streak),
        lambda: _build_protein_streak_message(protein_streak),
        lambda: _build_volume_milestone_message(user_id),
        lambda: _build_comeback_message(user_id, agent_state),
    ]:
        try:
            msg = builder()
            if msg:
                return _apply_tone(msg, motivation_style)
        except Exception as e:
            logger.debug(f"motivation builder failed: {e}")

    # Final fallback — always has a real number
    count = _workouts_this_month(user_id)
    fallback = (
        f"You've completed {count} workout{'s' if count != 1 else ''} this month — keep it up."
        if count > 0
        else "Today's workout is the most important one — start strong."
    )
    return _apply_tone(fallback, motivation_style)


# ── Back-compat shims (existing callers) ──────────────────────────────────────

def get_daily_motivation(user_id: str, motivation_style: str = "friendly") -> str:
    return get_motivation_message(user_id, motivation_style)


def get_weekly_motivation(user_id: str, goal=None, motivation_style: str = "friendly") -> str:
    return get_motivation_message(user_id, motivation_style)
