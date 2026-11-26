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
        .select("exercise_name, weight_kg, reps, rpe, logged_at, is_warmup")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )
    # Warm-up sets are useful session data but should not inflate working
    # tonnage, intensity summaries, muscle balance, or ACWR.
    return [row for row in (res.data or []) if not row.get("is_warmup")]


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
        if log.get("is_warmup"):
            continue
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


# Recovery windows are standard sports-science ballparks for time-to-full-
# recovery after a hard session, not a per-user measurement (nothing in
# this schema tracks actual muscle soreness/DOMS) — smaller, faster-
# recovering groups get shorter windows than large compound-heavy ones.
RECOVERY_WINDOW_HOURS = {
    "Chest": 48, "Back": 48, "Shoulders": 48,
    "Arms": 36, "Core": 24, "Legs": 72,
}


def compute_muscle_recovery_map(user_id: str) -> dict:
    """
    For each muscle group: hours since it was last trained (from the most
    recent exercise_logs row that classify_muscle_group() maps to that
    group), turned into a 0-100% recovery estimate via a linear ramp
    across RECOVERY_WINDOW_HOURS, capped at 100. A group with no logged
    history in the last 21 days is reported as "no_data" rather than a
    fabricated 100% — a group that's never been trained isn't "recovered,"
    it's simply unmeasured.

    This is the backing data for the Muscle Recovery Map — colors are a
    presentation detail the frontend derives from recovery_pct
    (>=80 green, 40-79 yellow, <40 red), not computed here, so the two
    stay in sync by construction rather than by convention.
    """
    from datetime import datetime, timezone

    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=21))
    res = (
        sb.table("exercise_logs")
        .select("exercise_name, logged_at, is_warmup")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .order("logged_at")
        .execute()
    )
    logs = res.data or []

    last_trained: dict[str, str] = {}
    for log in logs:
        group = classify_muscle_group(log.get("exercise_name", ""))
        if not group:
            continue
        logged_at = log.get("logged_at")
        if not logged_at:
            continue
        # logs are ordered ascending, so the last write per group wins —
        # simplest way to keep "most recent" without a second sort pass.
        last_trained[group] = logged_at

    now = datetime.now(timezone.utc)
    groups_out = []
    for g in ALL_GROUPS:
        ts = last_trained.get(g)
        if not ts:
            groups_out.append({
                "name": g, "recovery_pct": None, "hours_since_trained": None,
                "status": "no_data",
            })
            continue
        try:
            trained_at = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            groups_out.append({
                "name": g, "recovery_pct": None, "hours_since_trained": None,
                "status": "no_data",
            })
            continue
        hours_since = max(0.0, (now - trained_at).total_seconds() / 3600)
        window = RECOVERY_WINDOW_HOURS.get(g, 48)
        recovery_pct = min(100, round((hours_since / window) * 100))
        status = "green" if recovery_pct >= 80 else "yellow" if recovery_pct >= 40 else "red"
        groups_out.append({
            "name": g,
            "recovery_pct": recovery_pct,
            "hours_since_trained": round(hours_since, 1),
            "status": status,
        })

    return {
        "muscle_groups": groups_out,
        "has_data": any(g["status"] != "no_data" for g in groups_out),
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
