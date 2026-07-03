"""
Training Load Engine — VYRN

Deterministic tonnage/intensity analytics computed straight from
exercise_logs and workout_sessions — no LLM, no estimated numbers, so it's
safe to surface directly in the dashboard per the app's no-fabricated-
metrics policy. Mirrors the query conventions used in agents/pattern_engine.py.
"""
from __future__ import annotations
from datetime import date, timedelta
from db.supabase_client import get_supabase
from services.exercise_library import classify_muscle_group

ALL_GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs"]
PUSH_GROUPS = ["Chest", "Shoulders", "Arms"]
PULL_GROUPS = ["Back"]
UPPER_GROUPS = ["Chest", "Back", "Shoulders", "Arms"]
LOWER_GROUPS = ["Legs"]


def _ratio_flag(a_vol: float, b_vol: float, a_label: str, b_label: str) -> dict | None:
    """Flag a lopsided split (e.g. Push vs Pull) once one side has real
    volume and the other is under 60% of it. Returns None when balanced
    or when there isn't enough volume on either side to compare yet."""
    if a_vol <= 0 or b_vol <= 0:
        return None
    bigger, smaller = max(a_vol, b_vol), min(a_vol, b_vol)
    if smaller / bigger >= 0.6:
        return None
    lagging_label = b_label if b_vol < a_vol else a_label
    return {
        "a": {"label": a_label, "volume_kg": round(a_vol, 1)},
        "b": {"label": b_label, "volume_kg": round(b_vol, 1)},
        "message": f"{lagging_label} volume is lagging — consider adding a session this week.",
    }


def _get_logs(user_id: str, cutoff: str) -> list[dict]:
    sb = get_supabase()
    res = (
        sb.table("exercise_logs")
        .select("exercise_name, weight_kg, reps, rpe, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )
    return res.data or []


def compute_daily_volume(user_id: str, target_day: date | None = None) -> dict:
    """Total tonnage (kg) logged on a single day (default: today)."""
    target_day = target_day or date.today()
    logs = _get_logs(user_id, str(target_day))
    logs = [l for l in logs if l["logged_at"][:10] == str(target_day)]
    volume_kg = sum((l.get("weight_kg") or 0) * (l.get("reps") or 0) for l in logs)
    return {
        "date": str(target_day),
        "volume_kg": round(volume_kg, 1),
        "sets": len(logs),
        "has_data": len(logs) > 0,
    }


def compute_weekly_volume(user_id: str, weeks_ago: int = 0) -> dict:
    """Total tonnage (kg) for a given week, Monday-Sunday. weeks_ago=0 is
    the current week, weeks_ago=1 is last week, etc."""
    today = date.today()
    this_monday = today - timedelta(days=today.weekday())
    week_start = this_monday - timedelta(weeks=weeks_ago)
    week_end = week_start + timedelta(days=6)
    logs = _get_logs(user_id, str(week_start))
    logs = [l for l in logs if l["logged_at"][:10] <= str(week_end)]
    volume_kg = sum((l.get("weight_kg") or 0) * (l.get("reps") or 0) for l in logs)
    return {
        "week_start": str(week_start),
        "week_end": str(week_end),
        "volume_kg": round(volume_kg, 1),
        "sets": len(logs),
        "has_data": len(logs) > 0,
    }


def compute_average_intensity(user_id: str, days: int = 7) -> dict:
    """Average RPE across all logged sets in the window — a proxy for how
    hard the user has been training, independent of tonnage."""
    cutoff = str(date.today() - timedelta(days=days))
    logs = _get_logs(user_id, cutoff)
    rated = [l["rpe"] for l in logs if l.get("rpe")]
    if not rated:
        return {
            "days": days,
            "avg_rpe": None,
            "sets_rated": 0,
            "has_data": False,
        }
    return {
        "days": days,
        "avg_rpe": round(sum(rated) / len(rated), 1),
        "sets_rated": len(rated),
        "has_data": True,
    }


def compute_muscle_volume(user_id: str, weeks: int = 1) -> dict:
    """Tonnage per muscle group over the last N weeks, plus push/pull and
    upper/lower balance flags. Backs the RadarChart / imbalance callouts."""
    cutoff = str(date.today() - timedelta(weeks=weeks))
    logs = _get_logs(user_id, cutoff)

    volume: dict[str, float] = {}
    for log in logs:
        group = classify_muscle_group(log.get("exercise_name", ""))
        if not group:
            continue
        vol = (log.get("weight_kg") or 0) * (log.get("reps") or 0)
        volume[group] = volume.get(group, 0.0) + vol

    total = sum(volume.values())
    if not volume or total <= 0:
        return {
            "has_data": False,
            "weeks": weeks,
            "total_volume_kg": 0,
            "muscle_groups": [],
            "empty_state": "Log a few sets with recognizable exercise names (Bench Press, Squat, Row...) to unlock muscle balance.",
        }

    max_vol = max(volume.values())
    groups = []
    for g in ALL_GROUPS:
        vol_kg = volume.get(g, 0.0)
        pct_of_max = round((vol_kg / max_vol) * 100) if max_vol > 0 else 0
        pct_of_total = round((vol_kg / total) * 100) if total > 0 else 0
        groups.append({
            "name": g,
            "volume_kg": vol_kg,
            "pct_of_max": pct_of_max,
            "pct_of_total": pct_of_total,
        })

    lagging = [g["name"] for g in groups if g["volume_kg"] > 0 and g["pct_of_max"] < 40]
    untrained = [g["name"] for g in groups if g["volume_kg"] == 0]

    push_vol = sum(volume.get(g, 0.0) for g in PUSH_GROUPS)
    pull_vol = sum(volume.get(g, 0.0) for g in PULL_GROUPS)
    upper_vol = sum(volume.get(g, 0.0) for g in UPPER_GROUPS)
    lower_vol = sum(volume.get(g, 0.0) for g in LOWER_GROUPS)

    imbalances = []
    push_pull = _ratio_flag(push_vol, pull_vol, "Push", "Pull")
    if push_pull:
        imbalances.append(push_pull)
    upper_lower = _ratio_flag(upper_vol, lower_vol, "Upper Body", "Lower Body")
    if upper_lower:
        imbalances.append(upper_lower)

    recommendations = [i["message"] for i in imbalances]
    for g in untrained:
        recommendations.append(f"{g} hasn't been trained this week — add at least one {g.lower()} exercise.")
    for g in lagging:
        if g not in untrained:
            recommendations.append(f"{g} volume is lagging behind your other muscle groups this week — consider adding a set or two.")

    return {
        "has_data": True,
        "weeks": weeks,
        "total_volume_kg": round(total, 1),
        "muscle_groups": groups,
        "lagging": lagging,
        "untrained": untrained,
        "push_pull": {"push_kg": round(push_vol, 1), "pull_kg": round(pull_vol, 1)},
        "upper_lower": {"upper_kg": round(upper_vol, 1), "lower_kg": round(lower_vol, 1)},
        "imbalances": imbalances,
        "recommendations": recommendations,
    }


def compute_acute_chronic_ratio(user_id: str) -> dict:
    """Acute:Chronic Workload Ratio (ACWR) — 7-day average daily tonnage vs
    28-day average daily tonnage. The standard sports-science injury-risk
    signal: >1.5 means load has spiked well beyond what the body has
    adapted to; <0.8 means training has dropped off from the established
    baseline."""
    acute_week = compute_weekly_volume(user_id, weeks_ago=0)
    acute_load = acute_week["volume_kg"] / 7

    cutoff_28 = str(date.today() - timedelta(days=28))
    logs = _get_logs(user_id, cutoff_28)
    chronic_total = sum((l.get("weight_kg") or 0) * (l.get("reps") or 0) for l in logs)
    chronic_load = chronic_total / 28

    if chronic_load <= 0:
        return {
            "acute_load": round(acute_load, 1),
            "chronic_load": 0,
            "ratio": None,
            "band": "insufficient_data",
            "message": "Not enough training history yet — log consistently for 3-4 weeks to unlock this metric.",
        }

    ratio = round(acute_load / chronic_load, 2)
    if ratio < 0.8:
        band, message = "undertraining", f"Load ratio {ratio} — training below your usual chronic load. Room to build back up."
    elif ratio <= 1.3:
        band, message = "sweet_spot", f"Load ratio {ratio} — acute and chronic load are well matched. Sustainable training zone."
    elif ratio <= 1.5:
        band, message = "elevated", f"Load ratio {ratio} — load is ramping up faster than your body has adapted to. Monitor recovery closely."
    else:
        band, message = "high_risk", f"Load ratio {ratio} — sharp spike vs your chronic average. Elevated injury risk; consider a lighter week."

    return {
        "acute_load": round(acute_load, 1),
        "chronic_load": round(chronic_load, 1),
        "ratio": ratio,
        "band": band,
        "message": message,
    }


def compute_weekly_load_ratio(user_id: str) -> dict:
    """This week's tonnage vs last week's, as a % change. Only meaningful once last week has data."""
    this_week = compute_weekly_volume(user_id, weeks_ago=0)
    last_week = compute_weekly_volume(user_id, weeks_ago=1)
    if last_week["volume_kg"] <= 0:
        return {
            "this_week_kg": this_week["volume_kg"],
            "last_week_kg": last_week["volume_kg"],
            "pct_change": None,
            "message": "No volume logged last week — can't compute a week-over-week trend yet.",
        }
    pct_change = round(((this_week["volume_kg"] - last_week["volume_kg"]) / last_week["volume_kg"]) * 100)
    return {
        "this_week_kg": this_week["volume_kg"],
        "last_week_kg": last_week["volume_kg"],
        "pct_change": pct_change,
        "message": (
            f"Weekly tonnage is {'up' if pct_change >= 0 else 'down'} {abs(pct_change)}% vs last week."
        ),
    }


def run_training_load_engine(user_id: str) -> dict:
    """Full deterministic training-load report — the aggregate entry point."""
    return {
        "daily_volume": compute_daily_volume(user_id),
        "weekly_volume": compute_weekly_volume(user_id),
        "muscle_volume_this_week": compute_muscle_volume(user_id, weeks=1),
        "average_intensity_7d": compute_average_intensity(user_id, days=7),
        "acute_chronic_ratio": compute_acute_chronic_ratio(user_id),
        "weekly_load_trend": compute_weekly_load_ratio(user_id),
    }
