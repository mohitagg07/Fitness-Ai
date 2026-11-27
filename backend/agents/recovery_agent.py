"""
Dynamic Recovery Engine — VYRN  (v2)

Recovery is now computed from FIVE real signals instead of three:

  Previous volume  +  Sleep  +  Nutrition adherence
  +  Consecutive high-RPE days  +  CNS fatigue score
  ↓
  Recovery Score  (0-100)   ← was 0-10, now 0-100 for finer granularity
  ↓
  RecoveryDecision (proceed / replace_with_light / rest / deload)

The score is also decomposed into named sub-components that the
Decision Center card can surface as evidence signals:
  sleep_component, volume_component, nutrition_component,
  rpe_component, cns_component

CNS Load is separately exposed as a 4-band label:
  Low  /  Medium  /  High  /  Very High

Both are deterministic — no LLM touches the number.
"""
from __future__ import annotations
import logging
from datetime import date, timedelta
from schemas.models import RecoveryDecision
from db.supabase_client import get_supabase
from services.agent_state_store import get_agent_state

logger = logging.getLogger(__name__)


# ── CNS Load ─────────────────────────────────────────────────────────────────

def compute_cns_load(
    volume_kg: float,
    avg_rpe: float,
    frequency_days: int,       # sessions in last 7 days
    consecutive_high_rpe: int,
    cns_fatigue_score: int,    # 0-10 from agent_state
) -> dict:
    """
    Returns {"score": 0-100, "label": "Low"|"Medium"|"High"|"Very High",
             "components": {...}}.

    Formula is intentionally transparent:
      - Volume contribution  (normalised at 5000 kg = ceiling)
      - Intensity (avg_rpe scaled 1-10)
      - Frequency (sessions per week, ceiling 7)
      - Consecutive high-RPE days
      - Existing CNS fatigue accumulation
    Weights sum to 100.
    """
    vol_score    = min(100, (volume_kg / 5000) * 100) * 0.25
    rpe_score    = ((avg_rpe - 1) / 9) * 100 * 0.25
    freq_score   = min(100, (frequency_days / 7) * 100) * 0.15
    hrpe_score   = min(100, consecutive_high_rpe * 20) * 0.20
    cns_score    = (cns_fatigue_score / 10) * 100 * 0.15

    total = vol_score + rpe_score + freq_score + hrpe_score + cns_score

    if total < 25:
        label = "Low"
    elif total < 50:
        label = "Medium"
    elif total < 75:
        label = "High"
    else:
        label = "Very High"

    return {
        "score": round(total),
        "label": label,
        "components": {
            "volume":          round(vol_score),
            "intensity":       round(rpe_score),
            "frequency":       round(freq_score),
            "high_rpe_days":   round(hrpe_score),
            "cns_fatigue":     round(cns_score),
        },
    }


# ── Recovery sub-score helpers ────────────────────────────────────────────────

def _sleep_component(sleep_hours: float | None) -> int | None:
    """0-30 pts — missing sleep is unknown, not a neutral score."""
    if sleep_hours is None:
        return None
    if sleep_hours >= 8:
        return 30
    if sleep_hours >= 7:
        return 25
    if sleep_hours >= 6:
        return 16
    if sleep_hours >= 5:
        return 8
    return 0


def _volume_component(recent_volume_kg: float | None) -> int | None:
    """0-20 pts — missing training history is unknown."""
    if recent_volume_kg is None:
        return None
    if recent_volume_kg <= 0:
        return 20
    if recent_volume_kg < 3000:
        return 18
    if recent_volume_kg < 6000:
        return 14
    if recent_volume_kg < 10000:
        return 9
    return 4


def _nutrition_component(protein_pct: float | None, calorie_pct: float | None) -> int | None:
    """
    0-20 pts — eating at/above target accelerates recovery.
    protein_pct / calorie_pct are consumed/target ratios (0-1+).
    """
    if protein_pct is None or calorie_pct is None:
        return None
    protein_score = min(1.0, protein_pct) * 12  # up to 12 pts for protein
    calorie_score = min(1.0, calorie_pct) * 8   # up to 8 pts for calories
    return round(protein_score + calorie_score)


def _rpe_component(consecutive_high_rpe: int | None) -> int | None:
    """0-15 pts — missing rated sessions are unknown."""
    if consecutive_high_rpe is None:
        return None
    if consecutive_high_rpe == 0:
        return 15
    if consecutive_high_rpe == 1:
        return 12
    if consecutive_high_rpe == 2:
        return 8
    if consecutive_high_rpe == 3:
        return 4
    return 0


def _cns_component(cns_fatigue_score: int | None) -> int | None:
    """0-15 pts — only an explicitly recorded score is used."""
    if cns_fatigue_score is None:
        return None
    # cns_fatigue_score is 0-10; 0 = fresh, 10 = torched
    return max(0, 15 - cns_fatigue_score * 2)


# ── Session data helpers ──────────────────────────────────────────────────────

def _last_session_volume(user_id: str) -> float | None:
    """Total volume (kg) from the most recently completed session."""
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("total_volume_kg")
        .eq("user_id", user_id)
        .eq("completed", True)
        .order("session_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows or rows[0].get("total_volume_kg") is None:
        return None
    return float(rows[0]["total_volume_kg"])


def _nutrition_ratios_today(
    user_id: str,
    protein_target_g: float | None,
    calorie_target: float | None,
    target_date: date | None = None,
) -> tuple[float | None, float | None]:
    """Returns (protein_pct, calorie_pct) for the athlete's local day."""
    sb = get_supabase()
    today = str(target_date or date.today())
    res = (
        sb.table("nutrition_logs")
        .select("protein_g, calories")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    logs = res.data or []
    if not logs or protein_target_g is None or calorie_target is None or protein_target_g <= 0 or calorie_target <= 0:
        return None, None
    protein_consumed = sum(l.get("protein_g") or 0 for l in logs)
    calories_consumed = sum(l.get("calories") or 0 for l in logs)
    return (
        protein_consumed / protein_target_g,
        (calories_consumed / calorie_target) if calorie_target > 0 else 0.5,
    )


def _sessions_last_7_days(user_id: str, target_date: date | None = None) -> int:
    sb = get_supabase()
    cutoff = str((target_date or date.today()) - timedelta(days=7))
    res = (
        sb.table("workout_sessions")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("completed", True)
        .gte("session_date", cutoff)
        .execute()
    )
    return res.count or 0


# ── Main entry point ──────────────────────────────────────────────────────────
def _today_recovery_checkin(user_id: str, target_date: date | None = None) -> dict | None:
    """Fetch an actual recovery check-in for the athlete's local calendar day."""
    sb = get_supabase()
    local_day = str(target_date or date.today())
    try:
        result = (
            sb.table("recovery_checkins")
            .select("sleep_hours, soreness_level, energy_level, notes, local_date, updated_at")
            .eq("user_id", user_id)
            .eq("local_date", local_day)
            .limit(1)
            .execute()
        )
    except Exception:
        # Until the additive migration is applied, a missing table must remain
        # "no check-in", never fall back to the stale onboarding sleep value.
        return None
    rows = result.data or []
    return rows[0] if rows else None


def _soreness_component(soreness_level: int | None) -> int | None:
    """0-15 pts: lower reported soreness means greater recovery readiness."""
    if soreness_level is None:
        return None
    if soreness_level < 1 or soreness_level > 5:
        return None
    return round(15 - ((soreness_level - 1) * 3.75))


def _recent_rpe_stats(
    user_id: str,
    target_date: date | None = None,
) -> tuple[float | None, int | None]:
    """Return actual recent average set RPE and high-effort days."""
    from datetime import datetime, timezone

    sb = get_supabase()
    end_day = target_date or date.today()
    cutoff = datetime.combine(
        end_day - timedelta(days=6),
        datetime.min.time(),
        tzinfo=timezone.utc,
    ).isoformat()
    result = (
        sb.table("exercise_logs")
        .select("rpe, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )
    rows = [row for row in (result.data or []) if row.get("rpe") is not None and row.get("logged_at")]
    if not rows:
        return None, None
    by_day: dict[str, list[float]] = {}
    all_rpe: list[float] = []
    for row in rows:
        try:
            value = float(row["rpe"])
            stamp = datetime.fromisoformat(str(row["logged_at"]).replace("Z", "+00:00"))
            all_rpe.append(value)
            by_day.setdefault(stamp.date().isoformat(), []).append(value)
        except (TypeError, ValueError):
            continue
    if not by_day or not all_rpe:
        return None, None
    high_days = sum(1 for values in by_day.values() if sum(values) / len(values) >= 8)
    return round(sum(all_rpe) / len(all_rpe), 2), high_days


def _last_explicit_cns_fatigue(user_id: str) -> int | None:
    """Use only a stored post-session self-report; never assume a default zero."""
    sb = get_supabase()
    result = (
        sb.table("workout_sessions")
        .select("cns_fatigue_after")
        .eq("user_id", user_id)
        .eq("completed", True)
        .order("session_date", desc=True)
        .limit(10)
        .execute()
    )
    for row in (result.data or []):
        value = row.get("cns_fatigue_after")
        if value is not None:
            try:
                return max(0, min(10, int(value)))
            except (TypeError, ValueError):
                continue
    return None



def run_recovery_agent(
    user_id: str,
    sleep_hours: float | None,
    planned_workout_type: str | None = None,
    protein_target_g: float | None = None,
    calorie_target: float | None = None,
    target_date: date | None = None,
) -> RecoveryDecision:
    """
    Returns a RecoveryDecision with:
      recovery_score  — 0-100 (was 0-10; kept as int, divided by 10 for
                        legacy callers that expected 0-10 via .recovery_score)
      action          — proceed | replace_with_light | rest | deload
      message         — human-readable coach message

    Also attaches extra attributes (not in the Pydantic schema, so callers
    that only care about the schema are unaffected):
      score_pct       — 0-100 for the frontend recovery ring
      cns_load        — {"score", "label", "components"}
      sub_scores      — {"sleep", "volume", "nutrition", "rpe", "cns"}
    """
    agent_state = get_agent_state(user_id)
    check_in = _today_recovery_checkin(user_id, target_date)
    # The onboarding sleep field is a long-term baseline, not last night's
    # measured sleep. Only a dated check-in contributes to daily readiness.
    sleep_hours = check_in.get("sleep_hours") if check_in else None
    soreness_level = check_in.get("soreness_level") if check_in else None
    cns_fatigue = _last_explicit_cns_fatigue(user_id)
    recent_volume = _last_session_volume(user_id)
    protein_pct, calorie_pct = _nutrition_ratios_today(
        user_id, protein_target_g, calorie_target, target_date
    )
    avg_rpe, high_rpe_days = _recent_rpe_stats(user_id, target_date)

    # Missing sources are excluded from the weighted score, never replaced
    # with midpoint values that could look like measured readiness.
    sleep_pts = round(_sleep_component(sleep_hours) * (25 / 30)) if _sleep_component(sleep_hours) is not None else None
    soreness_pts = _soreness_component(soreness_level)
    vol_pts = _volume_component(recent_volume)
    nutr_pts = _nutrition_component(protein_pct, calorie_pct)
    rpe_pts = _rpe_component(high_rpe_days)
    cns_pts = round(_cns_component(cns_fatigue) * (10 / 15)) if _cns_component(cns_fatigue) is not None else None

    weighted = [
        (sleep_pts, 25, "last_night_sleep_checkin"),
        (soreness_pts, 15, "today_soreness_checkin"),
        (vol_pts, 20, "recent_session_volume"),
        (nutr_pts, 20, "logged_nutrition"),
        (rpe_pts, 10, "rated_training_effort"),
        (cns_pts, 10, "explicit_post_session_fatigue"),
    ]
    confidence_pct = sum(weight for value, weight, _ in weighted if value is not None)
    available_score = sum(value for value, _, _ in weighted if value is not None)
    data_sources = [name for value, _, name in weighted if value is not None]
    missing_sources = [name for value, _, name in weighted if value is None]

    score_100 = round(available_score / confidence_pct * 100) if confidence_pct else None
    score_10 = round(score_100 / 10) if score_100 is not None else 0
    freq_7d = _sessions_last_7_days(user_id, target_date)

    # Do not display a CNS-load estimate unless its source data actually
    # exists. No placeholder RPE or zero-fatigue score is inserted.
    if recent_volume is not None and avg_rpe is not None and cns_fatigue is not None and high_rpe_days is not None:
        cns_load = compute_cns_load(
            volume_kg=recent_volume,
            avg_rpe=avg_rpe,
            frequency_days=freq_7d,
            consecutive_high_rpe=high_rpe_days,
            cns_fatigue_score=cns_fatigue,
        )
    else:
        cns_load = {
            "score": None,
            "label": "Insufficient data",
            "components": {},
        }

    # ── Decision ──────────────────────────────────────────────────────────────
    high_intensity_types = {"push", "pull", "legs", "cardio"}
    is_high = (planned_workout_type or "").lower() in high_intensity_types

    if confidence_pct < 60 or score_100 is None:
        action = "check_in"
        message = (
            "I don't have enough recent recovery data to give you a reliable readiness score yet. "
            "Log your sleep and a few training sessions with effort ratings; follow your approved plan conservatively meanwhile."
        )
    elif cns_load["label"] == "Very High" or score_100 < 30:
        action = "deload"
        if is_high:
            message = (
                f"Recovery {score_100}% — CNS load is {cns_load['label']}. "
                f"Swap to a full deload week: cut all volumes 30%, no new PRs, "
                f"replace today's {planned_workout_type} with light technique work."
            )
        else:
            message = (
                f"Recovery {score_100}% — CNS load is {cns_load['label']}. "
                "Full deload week recommended: reduce all loads 30%, focus on mobility."
            )
    elif score_100 < 50:
        action = "rest"
        if is_high:
            message = (
                f"Recovery {score_100}% — low. Skip today's {planned_workout_type} session. "
                "Focus on sleep and hydration."
            )
        else:
            message = f"Recovery {score_100}% — low. Full rest day."
    elif score_100 < 70:
        action = "replace_with_light"
        if is_high:
            message = (
                f"Recovery {score_100}% — moderate. Replace today's {planned_workout_type} "
                "with a walk, mobility, or technique work only."
            )
        else:
            message = f"Recovery {score_100}% — moderate. Keep today light."
    else:
        action = "proceed"
        intensity_note = ""
        if score_100 >= 90:
            intensity_note = " Consider a top set at 95% — conditions are ideal."
        message = (
            f"Recovery {score_100}% — CNS load {cns_load['label']}. "
            f"You're good to train as planned today.{intensity_note}"
        )

    decision = RecoveryDecision(
        recovery_score=score_10,
        action=action,
        message=message,
    )
    # Attach data provenance and completeness for the dashboard and Coach.
    decision.__dict__["score_pct"] = score_100 if confidence_pct >= 60 else None
    decision.__dict__["confidence_pct"] = confidence_pct
    decision.__dict__["data_sources"] = data_sources
    decision.__dict__["missing_sources"] = missing_sources
    decision.__dict__["cns_load"] = cns_load
    decision.__dict__["sub_scores"] = {
        "sleep": sleep_pts,
        "soreness": soreness_pts,
        "volume": vol_pts,
        "nutrition": nutr_pts,
        "rpe": rpe_pts,
        "cns": cns_pts,
    }
    decision.__dict__["check_in"] = check_in

    return decision
