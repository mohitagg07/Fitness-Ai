"""
Adaptive Training Strategy Engine — VYRN  ⭐⭐⭐⭐⭐

This is the biggest AI feature left on the roadmap. Instead of just
rewriting a program when a plateau is detected, this engine:

  1. Reads GOAL + RECOVERY + PROGRESS + HISTORY
  2. Chooses a long-term training BLOCK (Hypertrophy / Strength /
     Deload / Peak / Maintenance / Cut)
  3. Explains WHY with real numbers
  4. Calls program_rewriter with the chosen block strategy
  5. Predicts the expected outcome (kg/week, reps/week)

Decision pipeline (fully deterministic — no LLM chooses the block):

  Score signals → choose_block() → build_rationale() → rewrite

The LLM is only used to phrase the rationale in natural language AFTER
the block decision is already made from hard rules.

Block selection rules (in priority order):
  1. CNS Very High OR recovery < 30%             → DELOAD
  2. Plateau on ≥ 1 primary lift, recovery ≥ 70% → STRENGTH (break plateau)
  3. Goal = "cut"                                 → CUT block
  4. Workout streak ≥ 6 weeks, recovery ≥ 70%    → PEAK (max strength)
  5. Recovery 50-70%, goal = "bulk"/"maintain"    → HYPERTROPHY
  6. Recovery ≥ 70%, goal = "bulk"/"maintain"     → HYPERTROPHY or STRENGTH
  7. Default                                      → MAINTENANCE
"""
from __future__ import annotations
import json
import logging
from datetime import date
from typing import Optional

from db.supabase_client import get_supabase, get_full_user_context
from services.agent_state_store import get_agent_state
from agents.pattern_engine import run_pattern_engine
from agents.recovery_agent import run_recovery_agent

logger = logging.getLogger(__name__)


# ── Block definitions ─────────────────────────────────────────────────────────

BLOCK_CONFIGS = {
    "strength": {
        "label": "Strength Block",
        "duration_weeks": 4,
        "rep_range": "3-5",
        "intensity_pct": 85,        # % of 1RM
        "volume_modifier": 0.85,    # relative to baseline
        "deload_frequency": 4,      # every N weeks
        "description": "Heavy compound work in the 3-5 rep range. CNS-demanding. One deload per 4-week cycle.",
    },
    "hypertrophy": {
        "label": "Hypertrophy Block",
        "duration_weeks": 6,
        "rep_range": "8-12",
        "intensity_pct": 70,
        "volume_modifier": 1.15,
        "deload_frequency": 6,
        "description": "Moderate intensity, higher volume. 8-12 reps, progressive overload each week.",
    },
    "deload": {
        "label": "Deload Week",
        "duration_weeks": 1,
        "rep_range": "8-12",
        "intensity_pct": 60,
        "volume_modifier": 0.60,
        "deload_frequency": 1,
        "description": "Recovery week. All volumes cut 30-40%. No new PRs. Technique focus.",
    },
    "peak": {
        "label": "Peak Block",
        "duration_weeks": 3,
        "rep_range": "1-3",
        "intensity_pct": 92,
        "volume_modifier": 0.70,
        "deload_frequency": 3,
        "description": "Near-maximal effort. 1-3 reps. Pre-competition or PR attempt phase.",
    },
    "cut": {
        "label": "Cut Block",
        "duration_weeks": 8,
        "rep_range": "6-10",
        "intensity_pct": 72,
        "volume_modifier": 0.90,
        "deload_frequency": 4,
        "description": "Calorie deficit phase. Maintain muscle with moderate volume, slight intensity drop.",
    },
    "maintenance": {
        "label": "Maintenance Block",
        "duration_weeks": 4,
        "rep_range": "6-10",
        "intensity_pct": 75,
        "volume_modifier": 1.0,
        "deload_frequency": 4,
        "description": "Steady-state training. Maintain current performance while recovering.",
    },
}


# ── Signal collection ─────────────────────────────────────────────────────────

def _get_signals(user_id: str) -> dict:
    """Collect all decision signals from existing data sources."""
    profile, agent_state = get_full_user_context(user_id)
    goal      = profile.get("goal") or "maintain"
    sleep_hrs = profile.get("sleep_hours")

    # Recovery (use the full dynamic engine)
    from services.nutrition import calculate_macros
    from schemas.models import Goal as GoalEnum
    goal_enum = GoalEnum(goal) if goal in GoalEnum._value2member_map_ else GoalEnum.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal_enum,
        is_training_day=True,
    )
    recovery = run_recovery_agent(
        user_id,
        sleep_hours=sleep_hrs,
        protein_target_g=targets["protein_g"],
        calorie_target=targets["calories"],
    )

    # Pattern insights
    insights = run_pattern_engine(user_id, protein_target_g=targets["protein_g"])
    has_plateau      = any(getattr(i, "category", None) == "plateau" for i in insights)
    has_rec_decline  = any(getattr(i, "category", None) == "recovery_decline" for i in insights)

    streak     = agent_state.get("workout_streak", 0)
    total_wks  = agent_state.get("total_workouts", 0) // max(1, 4)   # rough week estimate
    cns_label  = recovery.__dict__.get("cns_load", {}).get("label", "Medium")

    return {
        "goal":            goal,
        "recovery_pct":    recovery.__dict__.get("score_pct", recovery.recovery_score * 10),
        "cns_label":       cns_label,
        "has_plateau":     has_plateau,
        "has_rec_decline": has_rec_decline,
        "workout_streak":  streak,
        "weeks_training":  total_wks,
        "insights":        insights,
        "recovery_obj":    recovery,
        "profile":         profile,
        "agent_state":     agent_state,
        "targets":         targets,
    }


# ── Block chooser — DETERMINISTIC, no LLM ────────────────────────────────────

def choose_block(signals: dict) -> tuple[str, list[str]]:
    """
    Returns (block_name, reasons_list).
    reasons_list is a list of short strings used to build the rationale.
    """
    rec  = signals["recovery_pct"]
    cns  = signals["cns_label"]
    goal = signals["goal"]

    reasons = []

    # Priority 1: forced deload
    if cns == "Very High" or rec < 30:
        reasons.append(f"CNS load is {cns} and recovery is {rec}%")
        reasons.append("Your body needs a full deload before progressing")
        return "deload", reasons

    # Priority 2: forced rest after recovery decline
    if signals["has_rec_decline"] and rec < 50:
        reasons.append(f"Recovery declining — currently {rec}%")
        reasons.append("Deload preserves gains and reduces injury risk")
        return "deload", reasons

    # Priority 3: plateau + good recovery → strength block to bust it
    if signals["has_plateau"] and rec >= 65:
        reasons.append(f"Plateau detected on a primary lift")
        reasons.append(f"Recovery at {rec}% is strong enough for heavy work")
        reasons.append("Strength block (3-5 reps, 85% 1RM) is the proven plateau-breaker")
        return "strength", reasons

    # Priority 4: cut goal
    if goal == "cut":
        reasons.append("Goal is to cut — moderate volume preserves muscle in a deficit")
        return "cut", reasons

    # Priority 5: long streak + peak recovery → peak block
    if signals["workout_streak"] >= 42 and rec >= 80:   # 6 weeks
        reasons.append(f"{signals['workout_streak']}-day streak — longest consistent block")
        reasons.append(f"Recovery at {rec}% — ideal for near-maximal effort")
        reasons.append("Peak block (1-3 reps, 92% 1RM) for a PR attempt cycle")
        return "peak", reasons

    # Priority 6: bulk/recomp + moderate recovery → hypertrophy
    if goal in ("bulk", "recomp") and rec >= 50:
        reasons.append(f"Goal is {goal} — higher volume drives muscle growth")
        reasons.append(f"Recovery at {rec}% supports 8-12 rep hypertrophy work")
        return "hypertrophy", reasons

    # Priority 7: maintain + good recovery → hypertrophy or strength alternating
    if goal == "maintain" and rec >= 70:
        weeks = signals["weeks_training"]
        if weeks % 8 < 4:
            reasons.append("Alternating periodisation — hypertrophy phase")
            return "hypertrophy", reasons
        else:
            reasons.append("Alternating periodisation — strength phase")
            return "strength", reasons

    # Default
    reasons.append(f"Recovery at {rec}%, goal is {goal} — steady maintenance training")
    return "maintenance", reasons


# ── Outcome predictor ─────────────────────────────────────────────────────────

def predict_outcome(block_name: str, signals: dict) -> dict:
    """
    Lightweight prediction — trend-based, not ML. Returns a human-readable
    outcome string and a confidence label.
    """
    rec   = signals["recovery_pct"]
    conf  = "High" if rec >= 75 else "Medium" if rec >= 50 else "Low"

    predictions = {
        "strength":    f"Expected +2.5-5kg on main lifts over 4 weeks",
        "hypertrophy": f"Expected +1-2% lean mass over 6 weeks",
        "deload":      f"Expect full recovery within 7 days; performance rebounds +5-8%",
        "peak":        f"High probability of a new 1RM within 3 weeks",
        "cut":         f"Expected -0.5-1kg/week body weight while maintaining lifts",
        "maintenance": f"Lifts stable; recovery improves 10-15% by week 4",
    }
    return {
        "outcome": predictions.get(block_name, "Steady progress expected"),
        "confidence": conf,
    }


# ── LLM rationale (one sentence, grounded in signals) ────────────────────────

def _llm_rationale(block_name: str, reasons: list[str], signals: dict) -> str:
    """Call Groq/llama to phrase the rationale. Falls back to a rule-based sentence."""
    try:
        import os
        from groq import Groq
        client = Groq(api_key=os.environ["GROQ_API_KEY"])
        block_cfg = BLOCK_CONFIGS[block_name]
        prompt = (
            f"You are an expert strength coach. Explain this training block selection in ONE clear sentence. "
            f"Block chosen: {block_cfg['label']}. "
            f"Key reasons: {'; '.join(reasons)}. "
            f"Recovery: {signals['recovery_pct']}%. Goal: {signals['goal']}. "
            f"Do not use filler words. Be direct and specific. No fluff."
        )
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=80,
            temperature=0.4,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"_llm_rationale: groq call failed, using fallback: {e}")
        return f"Based on your {signals['recovery_pct']}% recovery and {signals['goal']} goal, {BLOCK_CONFIGS[block_name]['label']} is the optimal strategy right now."


# ── Save strategy decision ────────────────────────────────────────────────────

def _save_strategy(user_id: str, block_name: str, rationale: str, outcome: dict, signals: dict) -> dict:
    sb = get_supabase()
    row = {
        "user_id": user_id,
        "decided_at": str(date.today()),
        "block": block_name,
        "block_label": BLOCK_CONFIGS[block_name]["label"],
        "rationale": rationale,
        "predicted_outcome": outcome["outcome"],
        "confidence": outcome["confidence"],
        "recovery_pct": signals["recovery_pct"],
        "cns_label": signals["cns_label"],
        "goal": signals["goal"],
    }
    try:
        res = sb.table("training_strategies").insert(row).execute()
        return res.data[0] if res.data else row
    except Exception as e:
        logger.warning(f"_save_strategy: could not persist: {e}")
        return row


# ── Main public interface ─────────────────────────────────────────────────────

def run_strategy_engine(user_id: str, rewrite_program: bool = True) -> dict:
    """
    Full pipeline:
      signals → block choice → rationale → outcome prediction
      → (optionally) program rewrite → return structured result

    Returns:
    {
      "block": "hypertrophy",
      "block_label": "Hypertrophy Block",
      "config": {...},
      "rationale": "Your 78% recovery and bulk goal make higher-volume training optimal right now.",
      "predicted_outcome": "Expected +1-2% lean mass over 6 weeks",
      "confidence": "High",
      "signals": {...},
      "rewrite_result": {...} | None,
    }
    """
    signals    = _get_signals(user_id)
    block_name, reasons = choose_block(signals)
    rationale  = _llm_rationale(block_name, reasons, signals)
    outcome    = predict_outcome(block_name, signals)

    _save_strategy(user_id, block_name, rationale, outcome, signals)

    rewrite_result = None
    if rewrite_program and block_name != "deload":
        try:
            from agents.program_rewriter import run_program_rewriter
            rewrite_result = run_program_rewriter(user_id)
        except Exception as e:
            logger.warning(f"run_strategy_engine: program rewrite failed (non-fatal): {e}")

    return {
        "block":             block_name,
        "block_label":       BLOCK_CONFIGS[block_name]["label"],
        "config":            BLOCK_CONFIGS[block_name],
        "reasons":           reasons,
        "rationale":         rationale,
        "predicted_outcome": outcome["outcome"],
        "confidence":        outcome["confidence"],
        "signals": {
            "recovery_pct": signals["recovery_pct"],
            "cns_label":    signals["cns_label"],
            "goal":         signals["goal"],
            "streak_days":  signals["workout_streak"],
            "has_plateau":  signals["has_plateau"],
        },
        "rewrite_result": rewrite_result,
    }
