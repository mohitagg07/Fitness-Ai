"""
Exercise Library — VYRN

Single source of truth for exercise substitution chains and muscle-group
classification. Pulled out of program_rewriter.py so that both the
program rewriter agent and the substitution-engine API routes reference
the same data and never drift apart on what counts as a valid swap.

Design principle (same as decision_engine.py / program_rewriter.py):
  never hallucinate a substitute — if nothing in SUBSTITUTION_CHAINS
  matches, return an empty list so the caller can say "no substitute
  found" instead of inventing one.
"""
from __future__ import annotations
from typing import Optional

from services.exercise_catalog import classify_exercise_group


# ── Substitution chains — exercise -> ordered list of alternatives ─────────
# Each alternative carries the equipment it requires so filter_substitutes
# can narrow the list down to what the user actually has access to.
SUBSTITUTION_CHAINS: dict[str, list[dict]] = {
    "bench press": [
        {"name": "Incline Bench Press", "equipment": ["barbell", "bench"]},
        {"name": "Pause Bench Press", "equipment": ["barbell", "bench"]},
        {"name": "Dumbbell Press", "equipment": ["dumbbell", "bench"]},
        {"name": "Push Up", "equipment": ["bodyweight"]},
    ],
    "squat": [
        {"name": "Front Squat", "equipment": ["barbell"]},
        {"name": "Box Squat", "equipment": ["barbell"]},
        {"name": "Leg Press", "equipment": ["machine"]},
        {"name": "Goblet Squat", "equipment": ["dumbbell"]},
    ],
    "deadlift": [
        {"name": "Romanian Deadlift", "equipment": ["barbell"]},
        {"name": "Trap Bar Deadlift", "equipment": ["barbell"]},
        {"name": "Sumo Deadlift", "equipment": ["barbell"]},
        {"name": "Dumbbell Romanian Deadlift", "equipment": ["dumbbell"]},
    ],
    "overhead press": [
        {"name": "Push Press", "equipment": ["barbell"]},
        {"name": "Dumbbell Shoulder Press", "equipment": ["dumbbell"]},
        {"name": "Seated Overhead Press", "equipment": ["barbell", "bench"]},
        {"name": "Cable Shoulder Press", "equipment": ["cable"]},
    ],
    "barbell row": [
        {"name": "Pendlay Row", "equipment": ["barbell"]},
        {"name": "Dumbbell Row", "equipment": ["dumbbell", "bench"]},
        {"name": "Cable Row", "equipment": ["cable"]},
        {"name": "Machine Row", "equipment": ["machine"]},
    ],
    "incline bench": [
        {"name": "Flat Bench Press", "equipment": ["barbell", "bench"]},
        {"name": "Dumbbell Incline Press", "equipment": ["dumbbell", "bench"]},
        {"name": "Cable Fly", "equipment": ["cable"]},
    ],
    "pull-up": [
        {"name": "Lat Pulldown", "equipment": ["machine", "cable"]},
        {"name": "Assisted Pull-Up", "equipment": ["machine"]},
        {"name": "Cable Pullover", "equipment": ["cable"]},
        {"name": "Dumbbell Row", "equipment": ["dumbbell", "bench"]},
    ],
}


def get_substitutes(exercise_name: str) -> list[dict]:
    """Look up the raw substitution chain for an exercise by fuzzy name match."""
    lower = exercise_name.lower()
    for key, chain in SUBSTITUTION_CHAINS.items():
        if key in lower or lower in key:
            return chain
    return []


def classify_muscle_group(exercise_name: str) -> Optional[str]:
    """Use curated metadata for known movements, then preserve the legacy
    keyword fallback for free-text historical logs not in the catalogue."""
    curated_group = classify_exercise_group(exercise_name)
    if curated_group:
        return curated_group

    name_l = exercise_name.lower()
    if any(k in name_l for k in ["bench", "chest", "pec", "fly", "push up", "pushup", "dip"]):
        return "Chest"
    if any(k in name_l for k in ["pull", "row", "lat", "back", "deadlift", "chin"]):
        return "Back"
    if any(k in name_l for k in ["shoulder", "press", "delt", "lateral", "overhead", "ohp", "military"]):
        return "Shoulders"
    if any(k in name_l for k in ["curl", "tricep", "bicep", "arm", "hammer", "skullcrusher"]):
        return "Arms"
    if any(k in name_l for k in ["squat", "leg", "lunge", "calf", "quad", "hamstring", "glute", "hip", "rdl", "leg press"]):
        return "Legs"
    if any(k in name_l for k in ["plank", "crunch", "core", "ab", "cable crunch", "situp", "sit-up"]):
        return "Core"
    return None


# ── Injured body part -> muscle groups that should be avoided ──────────────
BODY_PART_TO_MUSCLE_GROUPS: dict[str, list[str]] = {
    "shoulder":  ["Shoulders", "Chest"],
    "elbow":     ["Arms", "Chest"],
    "wrist":     ["Arms"],
    "lower back":["Back", "Legs"],
    "back":      ["Back"],
    "knee":      ["Legs"],
    "hip":       ["Legs", "Back"],
    "ankle":     ["Legs"],
    "neck":      ["Shoulders", "Back"],
}


def filter_substitutes(
    exercise_name: str,
    available_equipment: Optional[list[str]] = None,
    injured_body_parts: Optional[list[str]] = None,
    reduce_cns: bool = False,
) -> list[dict]:
    """
    Filters the raw substitution chain by real constraints:
      - available_equipment: profile.equipment (e.g. ["dumbbell","bodyweight"]).
        None/empty means "no equipment filter applied" (constraint unknown,
        not assumed absent).
      - injured_body_parts: body_part values from injury_profiles for
        injuries with severity >= 4. Substitutes whose muscle group overlaps
        an injured body part are dropped.
      - reduce_cns: when True (low recovery / high fatigue), prefers
        bodyweight/machine options over barbell, since those carry less
        systemic CNS load for the same movement pattern.
    Returns the filtered, re-ordered list — empty if nothing fits, so the
    caller can say "no safe substitute found" rather than fabricate one.
    """
    candidates = list(get_substitutes(exercise_name))
    if not candidates:
        return []
    if available_equipment:
        owned = {e.lower() for e in available_equipment}
        candidates = [c for c in candidates if owned.intersection({e.lower() for e in c["equipment"]})]
    if injured_body_parts:
        blocked_groups: set[str] = set()
        for bp in injured_body_parts:
            bp_l = bp.lower()
            for key, groups in BODY_PART_TO_MUSCLE_GROUPS.items():
                if key in bp_l:
                    blocked_groups.update(groups)
        if blocked_groups:
            candidates = [
                c for c in candidates
                if not (classify_muscle_group(c["name"]) in blocked_groups)
            ]
    if reduce_cns:
        low_cns = {"bodyweight", "machine", "cable"}
        candidates = sorted(
            candidates,
            key=lambda c: 0 if low_cns.intersection({e.lower() for e in c["equipment"]}) else 1,
        )
    return candidates
