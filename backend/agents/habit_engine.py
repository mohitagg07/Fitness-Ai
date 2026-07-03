"""
Habit Intelligence — VYRN

The roadmap's #1 priority: "everything should feed into it." The
individual habit signals already existed as separate PatternInsight rows
(agents/pattern_engine.py's detect_missed_workout_patterns,
detect_weekend_nutrition_dip, detect_workout_time_drift) plus
services/calendar_intelligence.py's typical-schedule detection — but
nothing combined them into one profile other agents could actually read
and act on. This module is that aggregation layer.

Design:
  1. Reads the SAME underlying queries the individual detectors use (no
     new heuristics invented here — this is a synthesis layer, not a
     new source of truth).
  2. Produces one deterministic `habit_profile` dict, cached in
     agent_state (same pattern as job_pattern_detection's cached_patterns)
     so other agents can read it cheaply instead of re-querying.
  3. Is consumed by agents/workout_agent.py (nudges away from a
     habitually-skipped day when rescheduling) — the actual "feeds into
     everything" part, not just a display card.
"""
from __future__ import annotations
import logging
from datetime import date, timedelta

logger = logging.getLogger(__name__)

MIN_SESSIONS_FOR_HABITS = 4


def _get_sessions(user_id: str, days: int) -> list[dict]:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("workout_sessions")
        .select("session_date, created_at, completed")
        .eq("user_id", user_id)
        .gte("session_date", cutoff)
        .execute()
    )
    return res.data or []


def _avoided_days(sessions: list[dict]) -> list[dict]:
    """Days where missed sessions outnumber completed ones, needing at
    least 2 data points that day to avoid a one-off skip reading as a
    pattern. Mirrors detect_missed_workout_patterns' threshold."""
    day_stats: dict[str, dict] = {}
    for s in sessions:
        try:
            d = date.fromisoformat(s["session_date"])
            day_name = d.strftime("%A")
        except Exception:
            continue
        day_stats.setdefault(day_name, {"completed": 0, "missed": 0})
        if s.get("completed"):
            day_stats[day_name]["completed"] += 1
        else:
            day_stats[day_name]["missed"] += 1

    out = []
    for day, stats in day_stats.items():
        total = stats["completed"] + stats["missed"]
        if total >= 2 and stats["missed"] >= 2 and stats["missed"] > stats["completed"]:
            out.append({"day": day, "missed": stats["missed"], "completed": stats["completed"]})
    return sorted(out, key=lambda x: -x["missed"])


def _late_days(sessions: list[dict]) -> list[dict]:
    """Days where >=70% of completed sessions logged after 8 PM — same
    rule as pattern_engine.detect_workout_time_drift, reused here so the
    two never disagree."""
    by_day: dict[str, list[int]] = {}
    for s in sessions:
        if not s.get("completed"):
            continue
        created = s.get("created_at")
        if not created:
            continue
        try:
            hour = int(created[11:13])
            day_name = date.fromisoformat(s["session_date"]).strftime("%A")
        except Exception:
            continue
        by_day.setdefault(day_name, []).append(hour)

    out = []
    for day, hours in by_day.items():
        if len(hours) < 3:
            continue
        late_count = sum(1 for h in hours if h >= 20)
        if late_count / len(hours) >= 0.7:
            out.append({"day": day, "avg_hour": round(sum(hours) / len(hours)), "late_count": late_count, "total": len(hours)})
    return out


def _weekend_nutrition_dip(user_id: str) -> dict | None:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=28))
    res = (
        sb.table("nutrition_logs")
        .select("log_date, protein_g")
        .eq("user_id", user_id)
        .gte("log_date", cutoff)
        .execute()
    )
    logs = res.data or []
    if len(logs) < 6:
        return None

    by_date: dict[str, float] = {}
    for l in logs:
        d = l.get("log_date", "")
        by_date[d] = by_date.get(d, 0.0) + (l.get("protein_g") or 0)

    weekday_vals, weekend_vals = [], []
    for d, protein in by_date.items():
        try:
            is_weekend = date.fromisoformat(d).weekday() >= 5
        except Exception:
            continue
        (weekend_vals if is_weekend else weekday_vals).append(protein)

    if len(weekday_vals) < 4 or len(weekend_vals) < 2:
        return None

    avg_weekday = sum(weekday_vals) / len(weekday_vals)
    avg_weekend = sum(weekend_vals) / len(weekend_vals)
    if avg_weekday <= 0:
        return None

    drop_pct = round(100 * (avg_weekday - avg_weekend) / avg_weekday)
    if drop_pct >= 20:
        return {"drop_pct": drop_pct, "avg_weekday": round(avg_weekday), "avg_weekend": round(avg_weekend)}
    return None


def build_habit_profile(user_id: str) -> dict:
    """
    The single aggregated habit profile. Returns has_data: False with a
    reason once there isn't enough logged history yet — same honesty
    pattern every other analytics module in this app follows.
    """
    from services.calendar_intelligence import get_typical_schedule

    sessions = _get_sessions(user_id, days=42)
    total_sessions = len(sessions)

    if total_sessions < MIN_SESSIONS_FOR_HABITS:
        return {
            "has_data": False,
            "reason": f"Need at least {MIN_SESSIONS_FOR_HABITS} logged sessions — currently {total_sessions}.",
            "avoided_days": [],
            "late_days": [],
            "weekend_nutrition_dip": None,
            "typical_schedule": {},
        }

    avoided = _avoided_days(sessions)
    late = _late_days(sessions)
    dip = _weekend_nutrition_dip(user_id)
    schedule = get_typical_schedule(user_id)

    notes = []
    if avoided:
        days_str = ", ".join(a["day"] for a in avoided)
        notes.append(f"Tends to skip {days_str}.")
    if late:
        days_str = ", ".join(l["day"] for l in late)
        notes.append(f"Trains late on {days_str}.")
    if dip:
        notes.append(f"Protein drops {dip['drop_pct']}% on weekends.")
    if not notes:
        notes.append("No strong habit patterns detected yet — consistency looks steady.")

    return {
        "has_data": True,
        "avoided_days": [a["day"] for a in avoided],
        "avoided_days_detail": avoided,
        "late_days": [l["day"] for l in late],
        "late_days_detail": late,
        "weekend_nutrition_dip": dip,
        "typical_schedule": schedule.get("days", {}),
        "summary": " ".join(notes),
        "computed_from_sessions": total_sessions,
    }


def cache_habit_profile(user_id: str) -> dict:
    """Computes and persists the habit profile into agent_state, mirroring
    job_pattern_detection's cached_patterns pattern — called from the
    nightly scheduler job so other agents read a cheap cached value
    instead of re-querying on every request."""
    from db.supabase_client import get_full_user_context, upsert_agent_state

    profile = build_habit_profile(user_id)
    _, agent_state = get_full_user_context(user_id)
    upsert_agent_state(user_id, {
        **agent_state,
        "habit_profile": profile,
        "habit_profile_at": str(date.today()),
    })
    return profile


def get_cached_habit_profile(user_id: str) -> dict:
    """Reads the cached profile if it's from today; otherwise computes it
    fresh (cheap fallback for a user whose nightly job hasn't run yet,
    e.g. brand new account)."""
    from services.agent_state_store import get_agent_state

    agent_state = get_agent_state(user_id)
    cached = agent_state.get("habit_profile")
    cached_at = agent_state.get("habit_profile_at")
    if cached and cached_at == str(date.today()):
        return cached
    return build_habit_profile(user_id)
