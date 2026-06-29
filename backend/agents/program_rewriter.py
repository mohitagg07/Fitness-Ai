"""
Adaptive Program Rewriter — VYRN

The biggest missing AI feature. The pattern_engine already DETECTS plateaus,
recovery decline, and under-eating. This agent ACTS on those detections by
rewriting the user's training block.

Design principles (same as decision_engine.py — never hallucinate data):
  1. All inputs come from existing DB tables and agent outputs.
  2. The rewrite decision is deterministic (based on pattern severity).
  3. The LLM is used ONLY to phrase the explanation of WHY it changed.
  4. Every rewrite is saved as a new program_versions row with a diff summary.
  5. Called by the /api/coach/rewrite-program endpoint and nightly scheduler.

Rewrite triggers (in priority order):
  - PLATEAU  → reduce volume 15-20%, increase intensity (heavier/fewer reps),
                swap the plateau exercise for a close variation
  - RECOVERY_DECLINE → deload week: cut all volumes 30%, no new PRs
  - UNDER_EATING     → flag protein target, reduce volume until corrected
  - PR_OPPORTUNITY   → add a top set at 95% of PR weight
"""
from __future__ import annotations
import json
import logging
from datetime import date
from typing import Optional

from db.supabase_client import get_supabase
from agents.pattern_engine import (
    detect_strength_plateaus,
    detect_recovery_decline,
    run_pattern_engine,
)

logger = logging.getLogger(__name__)

# ── Exercise swap dictionary — plateau on A, switch to B ─────────────────────
EXERCISE_SWAPS: dict[str, list[str]] = {
    "bench press":       ["incline bench press", "pause bench press", "dumbbell press"],
    "squat":             ["front squat", "box squat", "leg press"],
    "deadlift":          ["romanian deadlift", "trap bar deadlift", "sumo deadlift"],
    "overhead press":    ["push press", "dumbbell shoulder press", "seated overhead press"],
    "barbell row":       ["pendlay row", "dumbbell row", "cable row"],
    "incline bench":     ["flat bench press", "dumbbell incline press", "cable fly"],
    "pull-up":           ["lat pulldown", "assisted pull-up", "cable pullover"],
}


def _get_swap_for(exercise_name: str) -> Optional[str]:
    """Return the next exercise swap for a plateau, cycling through the list."""
    lower = exercise_name.lower()
    for key, swaps in EXERCISE_SWAPS.items():
        if key in lower:
            # Return the first swap that isn't the current exercise
            for swap in swaps:
                if swap.lower() != lower:
                    return swap.title()
    return None


def _get_active_plan(user_id: str) -> Optional[dict]:
    sb = get_supabase()
    res = (
        sb.table("workout_plans")
        .select("id, name, schedule, phase, weeks")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _get_program_version_count(user_id: str) -> int:
    sb = get_supabase()
    try:
        res = (
            sb.table("program_versions")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        return res.count or 0
    except Exception:
        return 0


def _save_program_version(
    user_id: str,
    version_number: int,
    trigger: str,
    changes: list[dict],
    explanation: str,
    plan_id: Optional[str] = None,
) -> Optional[str]:
    """Persist a rewrite to program_versions. Returns the new row id."""
    sb = get_supabase()
    try:
        row = {
            "user_id": user_id,
            "version_number": version_number,
            "trigger": trigger,
            "changes": json.dumps(changes),
            "explanation": explanation,
            "plan_id": plan_id,
            "created_at": str(date.today()),
        }
        res = sb.table("program_versions").insert(row).execute()
        saved = res.data or []
        return saved[0]["id"] if saved else None
    except Exception as e:
        logger.error(f"Failed to save program version for {user_id}: {e}")
        return None


def _build_changes_for_plateau(insights: list) -> tuple[list[dict], str]:
    """
    Given plateau insights, build a concrete list of changes.
    Returns (changes_list, trigger_label).
    """
    changes = []
    plateau_exercises = [
        i for i in insights if i.category == "plateau"
    ]
    for insight in plateau_exercises:
        # Extract exercise name from insight data
        exercise = insight.data.get("exercise", "primary lift")
        swap = _get_swap_for(exercise)

        changes.append({
            "type": "volume_reduction",
            "description": f"Reduce {exercise} volume by 20% (drop 1 set per session)",
            "exercise": exercise,
            "adjustment": "-20% volume",
        })
        changes.append({
            "type": "intensity_increase",
            "description": f"Increase {exercise} working weight by 2.5–5% with fewer reps (5→3)",
            "exercise": exercise,
            "adjustment": "+2.5–5% intensity, drop to 3-rep sets",
        })
        if swap:
            changes.append({
                "type": "exercise_swap",
                "description": f"Replace {exercise} with {swap} for 3–4 weeks to break neural adaptation",
                "exercise": exercise,
                "swap_to": swap,
                "adjustment": f"swap → {swap}",
            })

    trigger = f"plateau on {', '.join(i.data.get('exercise', 'lift') for i in plateau_exercises)}"
    return changes, trigger


def _build_changes_for_recovery_decline(insights: list) -> tuple[list[dict], str]:
    changes = [
        {
            "type": "deload",
            "description": "Deload week: reduce all working weights by 30%, no new PRs attempted",
            "adjustment": "-30% all volumes",
        },
        {
            "type": "session_cap",
            "description": "Cap sessions at 45 minutes for this week",
            "adjustment": "max 45 min per session",
        },
        {
            "type": "intensity_reduction",
            "description": "Keep RPE ceiling at 7/10 for all sets this week",
            "adjustment": "RPE ≤ 7",
        },
    ]
    return changes, "recovery_decline"


def _build_changes_for_under_eating(insights: list) -> tuple[list[dict], str]:
    changes = [
        {
            "type": "volume_reduction",
            "description": "Reduce total weekly volume by 15% until protein target is consistently met",
            "adjustment": "-15% volume until nutrition corrected",
        },
        {
            "type": "intensity_hold",
            "description": "Maintain current weights — don't attempt PRs while under-eating",
            "adjustment": "no PR attempts this week",
        },
        {
            "type": "nutrition_flag",
            "description": "Hit protein target (≥0.85g/lb bodyweight) before the next volume increase",
            "adjustment": "nutrition gate active",
        },
    ]
    return changes, "under_eating"


def run_program_rewriter(user_id: str, profile: dict) -> dict:
    """
    Main entry point. Detects patterns, decides if a rewrite is warranted,
    builds the change set, saves a version row, and returns the full result.

    Returns:
        {
            "rewrite_triggered": bool,
            "trigger": str | None,
            "version_number": int,
            "changes": list[dict],
            "explanation": str,
            "version_id": str | None,
        }
    """
    # 1. Run the full pattern engine to get all current insights
    try:
        insights = run_pattern_engine(user_id, profile)
    except Exception as e:
        logger.error(f"Pattern engine failed for {user_id}: {e}")
        return {
            "rewrite_triggered": False,
            "trigger": None,
            "version_number": 0,
            "changes": [],
            "explanation": "Could not run pattern detection.",
            "version_id": None,
        }

    # 2. Determine which (if any) trigger applies — priority order
    recovery_decline = [i for i in insights if i.category == "recovery_decline" and i.severity in ("warning", "critical")]
    under_eating = [i for i in insights if i.category in ("under_eating", "protein_deficit") and i.severity in ("warning", "critical")]
    plateaus = [i for i in insights if i.category == "plateau"]

    if not (recovery_decline or under_eating or plateaus):
        return {
            "rewrite_triggered": False,
            "trigger": None,
            "version_number": _get_program_version_count(user_id),
            "changes": [],
            "explanation": "No rewrite needed — all patterns within normal range.",
            "version_id": None,
        }

    # 3. Build changes based on highest-priority trigger
    if recovery_decline:
        changes, trigger = _build_changes_for_recovery_decline(recovery_decline)
        reason_text = (
            "Your recovery score has been declining for several consecutive days. "
            "A planned deload week protects your adaptation gains and prevents "
            "overtraining — athletes who deload on schedule return stronger."
        )
    elif under_eating:
        changes, trigger = _build_changes_for_under_eating(under_eating)
        reason_text = (
            "Your protein intake has been consistently below target. "
            "Training hard in a protein deficit increases muscle breakdown "
            "without enough substrate for repair — volume is reduced until "
            "nutrition is corrected so you don't spin wheels in the gym."
        )
    else:
        changes, trigger = _build_changes_for_plateau(plateaus)
        plateau_names = ", ".join(
            i.data.get("exercise", "your primary lift") for i in plateaus
        )
        reason_text = (
            f"No new personal record on {plateau_names} in the last 4+ weeks. "
            "Volume is reduced and intensity increased to break the neural plateau. "
            "An exercise variation is swapped in to expose the muscles to a new "
            "stimulus — the same pattern elite coaches use to restart stalled progress."
        )

    # 4. Get current version number
    current_version = _get_program_version_count(user_id)
    new_version = current_version + 1

    # 5. Get active plan id (optional — plan may not exist yet)
    active_plan = _get_active_plan(user_id)
    plan_id = active_plan["id"] if active_plan else None

    # 6. Save the version
    version_id = _save_program_version(
        user_id=user_id,
        version_number=new_version,
        trigger=trigger,
        changes=changes,
        explanation=reason_text,
        plan_id=plan_id,
    )

    logger.info(f"Program rewrite v{new_version} saved for {user_id} — trigger: {trigger}")

    return {
        "rewrite_triggered": True,
        "trigger": trigger,
        "version_number": new_version,
        "changes": changes,
        "explanation": reason_text,
        "version_id": version_id,
    }