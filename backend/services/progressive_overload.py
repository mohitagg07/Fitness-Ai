"""History-backed, conservative exercise progression recommendations."""
from __future__ import annotations

import re
from typing import Any

from db.supabase_client import get_supabase
from services.exercise_catalog import resolve_exercise


def _parse_rep_range(value: str | None) -> tuple[int, int]:
    text = str(value or "8-12").strip()
    values = [int(part) for part in re.findall(r"\d+", text)]
    if not values:
        return 8, 12
    if len(values) == 1:
        return values[0], values[0]
    low, high = values[0], values[1]
    if low <= 0 or high <= 0 or high < low or high > 50:
        return 8, 12
    return low, high


def recommend_progression(
    sessions: list[dict[str, Any]],
    target_reps: str | None = "8-12",
    target_load_kg: float | None = None,
) -> dict[str, Any]:
    """Pure progression rules. New load requires two successful rated exposures."""
    low_reps, high_reps = _parse_rep_range(target_reps)
    recent = [item for item in sessions if item.get("sets")]
    latest = recent[0] if recent else None
    current_load = target_load_kg
    if current_load is None and latest:
        loads = [float(row.get("weight_kg") or 0) for row in latest["sets"]]
        current_load = max(loads) if loads else None

    def session_passed(item: dict[str, Any]) -> bool:
        sets = item.get("sets") or []
        if not sets:
            return False
        reps = [int(row.get("reps") or 0) for row in sets]
        effort = [float(row["rpe"]) for row in sets if row.get("rpe") is not None]
        # No increase is recommended without an actual effort rating.
        return (
            len(effort) == len(sets)
            and all(value >= high_reps for value in reps)
            and sum(effort) / len(effort) <= 8.0
        )

    passed_last_two = len(recent) >= 2 and session_passed(recent[0]) and session_passed(recent[1])
    status = "maintain"
    reason = "Keep the current target and collect consistent reps and effort ratings."
    suggested_load = current_load

    if latest:
        reps = [int(row.get("reps") or 0) for row in latest["sets"]]
        effort = [float(row["rpe"]) for row in latest["sets"] if row.get("rpe") is not None]
        avg_rpe = round(sum(effort) / len(effort), 1) if effort else None
        if current_load is not None and current_load > 0 and avg_rpe is not None:
            if avg_rpe >= 9.5 and reps and min(reps) < low_reps:
                status = "reduce"
                suggested_load = round(max(0, current_load * 0.95) * 2) / 2
                reason = "Recent sets were above the intended effort and below the rep floor. Reduce load slightly and rebuild clean reps."
            elif passed_last_two:
                status = "increase"
                suggested_load = round(current_load * 1.025 * 2) / 2
                if suggested_load <= current_load:
                    suggested_load = current_load + 0.5
                reason = "You reached the top of the rep range in two consecutive sessions with controlled effort. A small load increase is appropriate."
            elif avg_rpe > 8.5:
                reason = "Effort was high. Keep the load steady or reduce it if technique deteriorates."
            elif not effort:
                reason = "Effort ratings are missing. Maintain the load until VYRN can verify that the target reps were comfortable."
        elif current_load == 0:
            reason = "This is a bodyweight or unloaded movement. Build reps within the target range before adding resistance."
        elif not effort:
            reason = "Log RPE for working sets before VYRN recommends increasing resistance."

    previous = None
    if latest:
        sets = latest["sets"]
        previous = {
            "session_date": latest.get("session_date"),
            "working_sets": len(sets),
            "sets": [
                {
                    "weight_kg": float(row.get("weight_kg") or 0),
                    "reps": int(row.get("reps") or 0),
                    "rpe": row.get("rpe"),
                }
                for row in sets
            ],
            "average_rpe": (
                round(sum(float(row["rpe"]) for row in sets if row.get("rpe") is not None)
                      / len([row for row in sets if row.get("rpe") is not None]), 1)
                if any(row.get("rpe") is not None for row in sets) else None
            ),
        }

    return {
        "has_history": bool(latest),
        "history_sessions": len(recent),
        "target_rep_range": {"min": low_reps, "max": high_reps},
        "previous_session": previous,
        "current_load_kg": current_load,
        "recommended_load_kg": suggested_load,
        "recommendation": status,
        "reason": reason,
        "confidence": "high" if passed_last_two or status == "reduce" else "moderate" if latest else "low",
    }


def get_exercise_progression(
    user_id: str,
    exercise_name: str,
    target_reps: str | None = "8-12",
    target_load_kg: float | None = None,
) -> dict[str, Any]:
    """Load recent completed sessions and match aliases to a canonical movement."""
    definition = resolve_exercise(exercise_name)
    if definition is None:
        return {
            "exercise": exercise_name,
            **recommend_progression([], target_reps, target_load_kg),
            "message": "This movement is not in the verified exercise catalogue yet.",
        }

    sb = get_supabase()
    session_result = (
        sb.table("workout_sessions")
        .select("id, session_date")
        .eq("user_id", user_id)
        .eq("completed", True)
        .order("session_date", desc=True)
        .limit(12)
        .execute()
    )
    session_rows = session_result.data or []
    session_ids = [row["id"] for row in session_rows if row.get("id")]
    if not session_ids:
        return {
            "exercise": definition.name,
            **recommend_progression([], target_reps, target_load_kg),
        }

    log_result = (
        sb.table("exercise_logs")
        .select("session_id, exercise_name, weight_kg, reps, rpe, is_warmup, logged_at")
        .eq("user_id", user_id)
        .in_("session_id", session_ids)
        .order("logged_at", desc=True)
        .execute()
    )

    by_session: dict[str, list[dict[str, Any]]] = {}
    for log in log_result.data or []:
        if log.get("is_warmup") is True:
            continue
        logged_definition = resolve_exercise(str(log.get("exercise_name") or ""))
        if not logged_definition or logged_definition.exercise_id != definition.exercise_id:
            continue
        if log.get("reps") is None:
            continue
        by_session.setdefault(str(log["session_id"]), []).append(log)

    sessions: list[dict[str, Any]] = []
    for session in session_rows:
        rows = by_session.get(str(session["id"]), [])
        if rows:
            rows.sort(key=lambda row: str(row.get("logged_at") or ""))
            sessions.append({
                "session_date": session.get("session_date"),
                "sets": rows,
            })

    result = recommend_progression(sessions, target_reps, target_load_kg)
    return {
        "exercise": definition.name,
        "exercise_id": definition.exercise_id,
        **result,
    }
