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

def _sleep_component(sleep_hours: float | None) -> int:
    """0-30 pts — sleep is the single biggest lever."""
    if sleep_hours is None:
        return 15   # unknown → neutral mid-point
    if sleep_hours >= 8:
        return 30
    if sleep_hours >= 7:
        return 25
    if sleep_hours >= 6:
        return 16
    if sleep_hours >= 5:
        return 8
    return 0


def _volume_component(recent_volume_kg: float) -> int:
    """0-20 pts — previous session volume (low volume = more recovered)."""
    if recent_volume_kg <= 0:
        return 20
    if recent_volume_kg < 3000:
        return 18
    if recent_volume_kg < 6000:
        return 14
    if recent_volume_kg < 10000:
        return 9
    return 4


def _nutrition_component(protein_pct: float, calorie_pct: float) -> int:
    """
    0-20 pts — eating at/above target accelerates recovery.
    protein_pct / calorie_pct are consumed/target ratios (0-1+).
    """
    protein_score = min(1.0, protein_pct) * 12  # up to 12 pts for protein
    calorie_score = min(1.0, calorie_pct) * 8   # up to 8 pts for calories
    return round(protein_score + calorie_score)


def _rpe_component(consecutive_high_rpe: int) -> int:
    """0-15 pts — high-RPE runs compound fatigue."""
    if consecutive_high_rpe == 0:
        return 15
    if consecutive_high_rpe == 1:
        return 12
    if consecutive_high_rpe == 2:
        return 8
    if consecutive_high_rpe == 3:
        return 4
    return 0


def _cns_component(cns_fatigue_score: int) -> int:
    """0-15 pts — accumulated CNS fatigue from agent_state."""
    # cns_fatigue_score is 0-10; 0 = fresh, 10 = torched
    return max(0, 15 - cns_fatigue_score * 2)


# ── Session data helpers ──────────────────────────────────────────────────────

def _last_session_volume(user_id: str) -> float:
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
    if not rows:
        return 0.0
    return float(rows[0].get("total_volume_kg") or 0)


def _nutrition_ratios_today(user_id: str, protein_target_g: float, calorie_target: float) -> tuple[float, float]:
    """Returns (protein_pct, calorie_pct) for today's logged nutrition."""
    sb = get_supabase()
    today = str(date.today())
    res = (
        sb.table("nutrition_logs")
        .select("protein_g, calories")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    logs = res.data or []
    if not logs or protein_target_g <= 0:
        return 0.5, 0.5   # unknown → neutral
    protein_consumed = sum(l.get("protein_g") or 0 for l in logs)
    calories_consumed = sum(l.get("calories") or 0 for l in logs)
    return (
        protein_consumed / protein_target_g,
        (calories_consumed / calorie_target) if calorie_target > 0 else 0.5,
    )


def _sessions_last_7_days(user_id: str) -> int:
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=7))
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

def run_recovery_agent(
    user_id: str,
    sleep_hours: float | None,
    planned_workout_type: str | None = None,
    protein_target_g: float = 160.0,
    calorie_target: float = 2400.0,
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
    cns_fatigue    = agent_state.get("cns_fatigue_score", 0)
    high_rpe_days  = agent_state.get("consecutive_high_rpe_days", 0)
    last_rpe       = agent_state.get("last_logged_rpe", 5.0)
    freq_7d        = _sessions_last_7_days(user_id)

    recent_volume  = _last_session_volume(user_id)
    protein_pct, calorie_pct = _nutrition_ratios_today(
        user_id, protein_target_g, calorie_target
    )

    # ── Sub-scores ────────────────────────────────────────────────────────────
    sleep_pts  = _sleep_component(sleep_hours)
    vol_pts    = _volume_component(recent_volume)
    nutr_pts   = _nutrition_component(protein_pct, calorie_pct)
    rpe_pts    = _rpe_component(high_rpe_days)
    cns_pts    = _cns_component(cns_fatigue)

    score_100 = sleep_pts + vol_pts + nutr_pts + rpe_pts + cns_pts   # 0-100
    score_10  = round(score_100 / 10)   # 0-10 for backward-compat callers

    # ── CNS Load label ────────────────────────────────────────────────────────
    cns_load = compute_cns_load(
        volume_kg=recent_volume,
        avg_rpe=last_rpe,
        frequency_days=freq_7d,
        consecutive_high_rpe=high_rpe_days,
        cns_fatigue_score=cns_fatigue,
    )

    # ── Decision ──────────────────────────────────────────────────────────────
    high_intensity_types = {"push", "pull", "legs", "cardio"}
    is_high = (planned_workout_type or "").lower() in high_intensity_types

    if cns_load["label"] == "Very High" or score_100 < 30:
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
    # Attach rich data for callers that can use it (Decision Center, notifications)
    decision.__dict__["score_pct"]  = score_100
    decision.__dict__["cns_load"]   = cns_load
    decision.__dict__["sub_scores"] = {
        "sleep":     sleep_pts,
        "volume":    vol_pts,
        "nutrition": nutr_pts,
        "rpe":       rpe_pts,
        "cns":       cns_pts,
    }

    return decision
