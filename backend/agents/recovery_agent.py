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


WEIGHTS = {"sleep": 25, "soreness": 15, "energy": 10, "volume": 15, "nutrition": 15, "rpe": 10, "cns": 10}
MINIMUM_DATA_COMPLETENESS_PCT = 60


def _today_recovery_checkin(user_id: str, target_date: date | None = None) -> dict | None:
    """Read today's reported recovery; never substitute profile sleep baseline."""
    local_day = str(target_date or date.today())
    try:
        result = (
            get_supabase().table("recovery_checkins")
            .select("local_date, sleep_hours, soreness_level, energy_level, notes, updated_at")
            .eq("user_id", user_id).eq("local_date", local_day).limit(1).execute()
        )
    except Exception:
        # Missing migration means missing evidence, not a fabricated fallback.
        return None
    rows = result.data or []
    return rows[0] if rows else None


def _latest_post_session_feedback(
    user_id: str,
    target_date: date | None = None,
    lookback_days: int = 7,
) -> dict | None:
    """Read explicit recent session-effort and energy feedback for next-session coaching."""
    end_day = target_date or date.today()
    cutoff = str(end_day - timedelta(days=lookback_days - 1))
    try:
        result = (
            get_supabase().table("workout_sessions")
            .select("session_date, session_effort, energy_level, cns_fatigue_after, finished_at")
            .eq("user_id", user_id)
            .eq("completed", True)
            .gte("session_date", cutoff)
            .lte("session_date", str(end_day))
            .order("session_date", desc=True)
            .order("finished_at", desc=True)
            .limit(10)
            .execute()
        )
    except Exception:
        # Failed reads remain unavailable; do not convert them into a clean check-in.
        return None

    for row in result.data or []:
        if any(row.get(key) is not None for key in ("session_effort", "energy_level", "cns_fatigue_after")):
            return row
    return None


def _latest_reported_session_pain(
    user_id: str,
    target_date: date | None = None,
    lookback_days: int = 7,
) -> dict | None:
    """Return the most recent explicit post-session pain report.

    A later explicit 'none' or 'mild' report clears an older sharp/worsening
    report. Sessions without a pain check-in are ignored rather than treated
    as a negative report.
    """
    end_day = target_date or date.today()
    cutoff = str(end_day - timedelta(days=lookback_days - 1))
    try:
        result = (
            get_supabase().table("workout_sessions")
            .select("pain_status, pain_notes, session_date, finished_at")
            .eq("user_id", user_id)
            .eq("completed", True)
            .gte("session_date", cutoff)
            .order("session_date", desc=True)
            .order("finished_at", desc=True)
            .limit(20)
            .execute()
        )
    except Exception:
        # A pain-history read failure must not be represented as a clean report.
        return {"status": "unavailable", "source": "session_feedback", "read_failed": True}

    for row in result.data or []:
        status = str(row.get("pain_status") or "").strip().lower()
        if status not in {"none", "mild", "sharp", "worsening"}:
            continue
        session_day = row.get("session_date")
        try:
            reported_day = date.fromisoformat(str(session_day))
        except (TypeError, ValueError):
            continue
        if reported_day > end_day or (end_day - reported_day).days >= lookback_days:
            continue
        return {
            "status": status,
            "notes": row.get("pain_notes"),
            "session_date": str(session_day),
            "source": "post_workout_checkin",
            "lookback_days": lookback_days,
        }

    return None


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


def _soreness_component(soreness_level: int | None) -> int | None:
    if soreness_level is None or not 1 <= soreness_level <= 5:
        return None
    return round(15 - ((soreness_level - 1) * 3.75))


def _energy_component(energy_level: int | None) -> int | None:
    if energy_level is None or not 1 <= energy_level <= 5:
        return None
    return round((energy_level - 1) * 2.5)


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


def run_recovery_agent(
    user_id: str,
    sleep_hours: float | None,
    planned_workout_type: str | None = None,
    protein_target_g: float | None = None,
    calorie_target: float | None = None,
    target_date: date | None = None,
) -> RecoveryDecision:
    """Readiness uses observed evidence; profile sleep is not a daily check-in."""
    check_in = _today_recovery_checkin(user_id, target_date)
    reported_sleep = check_in.get("sleep_hours") if check_in else None
    soreness_level = check_in.get("soreness_level") if check_in else None
    energy_level = check_in.get("energy_level") if check_in else None
    energy_source = "today_recovery_checkin" if energy_level is not None else None
    latest_session_feedback = _latest_post_session_feedback(user_id, target_date)
    if energy_level is None and latest_session_feedback and latest_session_feedback.get("energy_level") is not None:
        energy_level = latest_session_feedback["energy_level"]
        energy_source = "recent_post_workout_checkin"

    recent_volume = _last_session_volume(user_id)
    protein_pct, calorie_pct = _nutrition_ratios_today(
        user_id, protein_target_g, calorie_target, target_date
    )
    avg_rpe, high_rpe_days = _recent_rpe_stats(user_id, target_date)
    latest_session_effort = (
        latest_session_feedback.get("session_effort")
        if latest_session_feedback else None
    )
    if latest_session_effort is not None:
        try:
            session_effort_value = float(latest_session_effort)
            if 1 <= session_effort_value <= 10:
                avg_rpe = (
                    round((avg_rpe + session_effort_value) / 2, 2)
                    if avg_rpe is not None
                    else session_effort_value
                )
                if high_rpe_days is None:
                    high_rpe_days = 1 if session_effort_value >= 8 else 0
                elif session_effort_value >= 8:
                    high_rpe_days = max(1, high_rpe_days)
            else:
                latest_session_effort = None
        except (TypeError, ValueError):
            latest_session_effort = None
    cns_fatigue = _last_explicit_cns_fatigue(user_id)
    pain_signal = _latest_reported_session_pain(user_id, target_date)

    raw_sleep = _sleep_component(reported_sleep)
    raw_volume = _volume_component(recent_volume)
    raw_nutrition = _nutrition_component(protein_pct, calorie_pct)
    raw_rpe = _rpe_component(high_rpe_days)
    raw_cns = _cns_component(cns_fatigue)
    components = {
        "sleep": round(raw_sleep * (25 / 30)) if raw_sleep is not None else None,
        "soreness": _soreness_component(soreness_level),
        "energy": _energy_component(energy_level),
        "volume": round(raw_volume * (15 / 20)) if raw_volume is not None else None,
        "nutrition": round(raw_nutrition * (15 / 20)) if raw_nutrition is not None else None,
        "rpe": round(raw_rpe * (10 / 15)) if raw_rpe is not None else None,
        "cns": round(raw_cns * (10 / 15)) if raw_cns is not None else None,
    }
    available = {name: value for name, value in components.items() if value is not None}
    completeness_pct = sum(WEIGHTS[name] for name in available)
    score_100 = (
        round(sum(available.values()) * 100 / completeness_pct)
        if completeness_pct else None
    )
    score_10 = round(score_100 / 10) if score_100 is not None else 0

    cns_load = {"score": None, "label": "Insufficient data", "components": {}}
    if recent_volume is not None and avg_rpe is not None and high_rpe_days is not None and cns_fatigue is not None:
        cns_load = compute_cns_load(
            volume_kg=recent_volume,
            avg_rpe=avg_rpe,
            frequency_days=_sessions_last_7_days(user_id, target_date),
            consecutive_high_rpe=high_rpe_days,
            cns_fatigue_score=cns_fatigue,
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

    # Pain is a separate safety gate, not a readiness-score component. A recent
    # sharp/worsening report overrides a favourable score until the athlete
    # reviews the affected movement. It never edits the approved plan.
    pain_status = pain_signal.get("status") if isinstance(pain_signal, dict) else None
    if pain_status in {"sharp", "worsening"}:
        action = "pain_review"
        pain_detail = f" Note recorded: {pain_signal['notes']}" if pain_signal.get("notes") else ""
        message = (
            f"Your latest post-workout check-in on {pain_signal.get('session_date')} reported "
            f"{pain_status} pain.{pain_detail} Do not repeat or load the movement that caused it. "
            "Keep the approved plan unchanged while you review the symptoms; seek appropriate "
            "clinical guidance for sharp, worsening or persistent pain."
        )
    elif pain_status == "mild":
        message += " Your latest check-in mentioned mild discomfort; modify any movement that aggravates it."

    decision = RecoveryDecision(recovery_score=score_10, action=action, message=message)
    decision.__dict__["score_pct"] = score_pct
    decision.__dict__["data_completeness_pct"] = completeness_pct
    decision.__dict__["available_signals"] = sorted(available)
    decision.__dict__["missing_signals"] = sorted(set(WEIGHTS) - set(available))
    decision.__dict__["sub_scores"] = components
    decision.__dict__["cns_load"] = cns_load
    decision.__dict__["check_in"] = check_in
    decision.__dict__["pain_signal"] = pain_signal
    decision.__dict__["source_values"] = {
        "last_night_sleep_hours": reported_sleep,
        "soreness_level": soreness_level,
        "energy_level": energy_level,
        "energy_source": energy_source,
        "latest_post_session_effort": latest_session_effort,
        "latest_post_session_feedback_date": (
            latest_session_feedback.get("session_date")
            if latest_session_feedback else None
        ),
        "last_session_volume_kg": recent_volume,
        "protein_ratio": protein_pct,
        "calorie_ratio": calorie_pct,
        "recent_average_rpe": avg_rpe,
        "recent_high_rpe_days": high_rpe_days,
        "explicit_post_session_cns_fatigue": cns_fatigue,
        "latest_post_session_pain": pain_signal,
    }
    return decision
