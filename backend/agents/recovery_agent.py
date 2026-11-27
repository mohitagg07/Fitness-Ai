"""
Evidence-based recovery estimate.

Only observed inputs contribute to readiness. Missing sleep, nutrition,
training history, effort ratings and post-session fatigue remain unavailable;
they are never converted to neutral or fully-recovered values.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from schemas.models import RecoveryDecision
from db.supabase_client import get_supabase


WEIGHTS = {"sleep": 30, "volume": 20, "nutrition": 20, "rpe": 15, "cns": 15}
MINIMUM_DATA_COMPLETENESS_PCT = 60


def compute_cns_load(volume_kg: float, avg_rpe: float, frequency_days: int,
                     consecutive_high_rpe: int, cns_fatigue_score: int) -> dict:
    """Return the deterministic CNS-load estimate and its observed components."""
    vol_score = min(100, max(0, volume_kg / 5000 * 100)) * 0.25
    rpe_score = ((min(10, max(1, avg_rpe)) - 1) / 9) * 100 * 0.25
    freq_score = min(100, max(0, frequency_days) / 7 * 100) * 0.15
    hrpe_score = min(100, max(0, consecutive_high_rpe) * 20) * 0.20
    cns_score = (min(10, max(0, cns_fatigue_score)) / 10) * 100 * 0.15
    total = vol_score + rpe_score + freq_score + hrpe_score + cns_score
    label = "Low" if total < 25 else "Medium" if total < 50 else "High" if total < 75 else "Very High"
    return {
        "score": round(total),
        "label": label,
        "components": {
            "volume": round(vol_score), "intensity": round(rpe_score),
            "frequency": round(freq_score), "high_rpe_days": round(hrpe_score),
            "cns_fatigue": round(cns_score),
        },
    }


def _sleep_component(sleep_hours: float | None) -> int | None:
    """0-30 points from a reported sleep duration; None means not reported."""
    if sleep_hours is None:
        return None
    try:
        hours = float(sleep_hours)
    except (TypeError, ValueError):
        return None
    if not 0 <= hours <= 24:
        return None
    if hours >= 8: return 30
    if hours >= 7: return 25
    if hours >= 6: return 16
    if hours >= 5: return 8
    return 0


def _volume_component(recent_volume_kg: float | None) -> int | None:
    """20-point estimate from an actual completed session; missing history is None."""
    if recent_volume_kg is None:
        return None
    try:
        volume = float(recent_volume_kg)
    except (TypeError, ValueError):
        return None
    if volume < 0: return None
    if volume == 0: return 20
    if volume < 3000: return 18
    if volume < 6000: return 14
    if volume < 10000: return 9
    return 4


def _nutrition_component(protein_pct: float | None, calorie_pct: float | None) -> int | None:
    """20-point estimate only when both logged nutrition and targets are available."""
    if protein_pct is None or calorie_pct is None:
        return None
    protein_score = min(1.0, max(0.0, protein_pct)) * 12
    calorie_score = min(1.0, max(0.0, calorie_pct)) * 8
    return round(protein_score + calorie_score)


def _rpe_component(high_rpe_days: int | None) -> int | None:
    """15 points from actual logged set-effort history, not an AgentState default."""
    if high_rpe_days is None or high_rpe_days < 0: return None
    if high_rpe_days == 0: return 15
    if high_rpe_days == 1: return 12
    if high_rpe_days == 2: return 8
    if high_rpe_days == 3: return 4
    return 0


def _cns_component(cns_fatigue_score: int | None) -> int | None:
    """15 points from an explicit post-session self-report."""
    if cns_fatigue_score is None or not 0 <= cns_fatigue_score <= 10:
        return None
    return max(0, 15 - cns_fatigue_score * 2)


def _last_session_volume(user_id: str) -> float | None:
    """Get actual volume from latest completed session; no row is unknown."""
    result = (
        get_supabase().table("workout_sessions").select("total_volume_kg")
        .eq("user_id", user_id).eq("completed", True)
        .order("session_date", desc=True).limit(1).execute()
    )
    rows = result.data or []
    if not rows or rows[0].get("total_volume_kg") is None:
        return None
    try:
        value = float(rows[0]["total_volume_kg"])
        return value if value >= 0 else None
    except (TypeError, ValueError):
        return None


def _nutrition_ratios_today(user_id: str, protein_target_g: float | None,
                             calorie_target: float | None,
                             target_date: date | None = None) -> tuple[float | None, float | None]:
    """Return measured intake ratios, or (None, None) when evidence is absent."""
    if (protein_target_g is None or calorie_target is None
            or protein_target_g <= 0 or calorie_target <= 0):
        return None, None
    local_day = str(target_date or date.today())
    result = (
        get_supabase().table("nutrition_logs").select("protein_g, calories")
        .eq("user_id", user_id).eq("log_date", local_day).execute()
    )
    rows = result.data or []
    if not rows:
        return None, None
    if not any(row.get("protein_g") is not None for row in rows):
        return None, None
    if not any(row.get("calories") is not None for row in rows):
        return None, None
    protein = sum(float(row.get("protein_g") or 0) for row in rows)
    calories = sum(float(row.get("calories") or 0) for row in rows)
    return protein / protein_target_g, calories / calorie_target


def _recent_rpe_stats(user_id: str, target_date: date | None = None) -> tuple[float | None, int | None]:
    """Read actual set RPE in the trailing seven calendar days."""
    end_day = target_date or date.today()
    cutoff = datetime.combine(end_day - timedelta(days=6), time.min, tzinfo=timezone.utc).isoformat()
    result = (
        get_supabase().table("exercise_logs").select("rpe, logged_at")
        .eq("user_id", user_id).gte("logged_at", cutoff).execute()
    )
    values: list[float] = []
    by_day: dict[str, list[float]] = {}
    for row in result.data or []:
        raw_rpe, raw_time = row.get("rpe"), row.get("logged_at")
        if raw_rpe is None or not raw_time:
            continue
        try:
            rpe = float(raw_rpe)
            if not 1 <= rpe <= 10: continue
            stamp = datetime.fromisoformat(str(raw_time).replace("Z", "+00:00"))
            if stamp.tzinfo is None: stamp = stamp.replace(tzinfo=timezone.utc)
            values.append(rpe)
            by_day.setdefault(stamp.date().isoformat(), []).append(rpe)
        except (TypeError, ValueError):
            continue
    if not values: return None, None
    high_days = sum(1 for values_for_day in by_day.values()
                    if sum(values_for_day) / len(values_for_day) >= 8)
    return round(sum(values) / len(values), 2), high_days


def _last_explicit_cns_fatigue(user_id: str) -> int | None:
    """Read explicit post-session fatigue; default AgentState zero is not evidence."""
    result = (
        get_supabase().table("workout_sessions").select("cns_fatigue_after")
        .eq("user_id", user_id).eq("completed", True)
        .order("session_date", desc=True).limit(10).execute()
    )
    for row in result.data or []:
        value = row.get("cns_fatigue_after")
        if value is None: continue
        try:
            parsed = int(value)
            if 0 <= parsed <= 10: return parsed
        except (TypeError, ValueError):
            continue
    return None


def _sessions_last_7_days(user_id: str, target_date: date | None = None) -> int:
    cutoff = str((target_date or date.today()) - timedelta(days=6))
    result = (
        get_supabase().table("workout_sessions").select("id", count="exact")
        .eq("user_id", user_id).eq("completed", True).gte("session_date", cutoff).execute()
    )
    return result.count or 0


def run_recovery_agent(user_id: str, sleep_hours: float | None,
                       planned_workout_type: str | None = None,
                       protein_target_g: float | None = None,
                       calorie_target: float | None = None,
                       target_date: date | None = None) -> RecoveryDecision:
    """
    Estimate readiness using observed information only.

    data_completeness_pct is the total weight of available evidence. Below 60%,
    readiness is unavailable and action becomes check_in. The approved plan
    remains unchanged and no load or schedule change is implied.
    """
    recent_volume = _last_session_volume(user_id)
    protein_pct, calorie_pct = _nutrition_ratios_today(
        user_id, protein_target_g, calorie_target, target_date
    )
    avg_rpe, high_rpe_days = _recent_rpe_stats(user_id, target_date)
    cns_fatigue = _last_explicit_cns_fatigue(user_id)
    components = {
        "sleep": _sleep_component(sleep_hours),
        "volume": _volume_component(recent_volume),
        "nutrition": _nutrition_component(protein_pct, calorie_pct),
        "rpe": _rpe_component(high_rpe_days),
        "cns": _cns_component(cns_fatigue),
    }
    available = {name: value for name, value in components.items() if value is not None}
    completeness_pct = sum(WEIGHTS[name] for name in available)
    score_100 = (round(sum(available.values()) * 100 / completeness_pct)
                 if completeness_pct else None)
    score_10 = round(score_100 / 10) if score_100 is not None else 0

    cns_load = {"score": None, "label": "Insufficient data", "components": {}}
    if recent_volume is not None and avg_rpe is not None and high_rpe_days is not None and cns_fatigue is not None:
        cns_load = compute_cns_load(
            volume_kg=recent_volume, avg_rpe=avg_rpe,
            frequency_days=_sessions_last_7_days(user_id, target_date),
            consecutive_high_rpe=high_rpe_days, cns_fatigue_score=cns_fatigue,
        )

    high_intensity = (planned_workout_type or "").lower() in {"push", "pull", "legs", "cardio"}
    if completeness_pct < MINIMUM_DATA_COMPLETENESS_PCT or score_100 is None:
        action = "check_in"
        missing = ", ".join(sorted(set(WEIGHTS) - set(available))) or "more recent data"
        message = (
            f"Recovery data is incomplete ({completeness_pct}% of weighted inputs available; "
            f"missing: {missing}). Keep today's approved plan unchanged and use conservative "
            "effort. No automatic load or schedule change is recommended."
        )
        score_pct = None
    elif cns_load["label"] == "Very High" or score_100 < 30:
        action = "deload"
        message = (
            f"Recovery estimate {score_100}% — CNS load is Very High. "
            + ("Consider a deload proposal for today's session. " if high_intensity else "Consider a deload proposal. ")
            + "The approved plan remains unchanged until you review and approve a proposal."
        )
        score_pct = score_100
    elif score_100 < 50:
        action = "rest"
        message = (
            f"Recovery estimate {score_100}% is low. A rest-day change may be appropriate; "
            "the approved schedule remains unchanged until you choose to adjust it."
        )
        score_pct = score_100
    elif score_100 < 70:
        action = "replace_with_light"
        message = (
            f"Recovery estimate {score_100}% is moderate. Consider a lighter session, "
            "but do not change the approved plan automatically."
        )
        score_pct = score_100
    else:
        action = "proceed"
        message = (
            f"Recovery estimate {score_100}% is favorable based on available tracked inputs. "
            "Follow the prescribed workout and effort targets."
        )
        score_pct = score_100

    decision = RecoveryDecision(recovery_score=score_10, action=action, message=message)
    decision.__dict__["score_pct"] = score_pct
    decision.__dict__["data_completeness_pct"] = completeness_pct
    decision.__dict__["available_signals"] = sorted(available)
    decision.__dict__["missing_signals"] = sorted(set(WEIGHTS) - set(available))
    decision.__dict__["sub_scores"] = components
    decision.__dict__["cns_load"] = cns_load
    decision.__dict__["source_values"] = {
        "sleep_hours": sleep_hours,
        "last_session_volume_kg": recent_volume,
        "protein_ratio": protein_pct,
        "calorie_ratio": calorie_pct,
        "recent_average_rpe": avg_rpe,
        "recent_high_rpe_days": high_rpe_days,
        "explicit_post_session_cns_fatigue": cns_fatigue,
    }
    return decision
