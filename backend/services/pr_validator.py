"""
PR Validation Service — Anti-Hallucination Weight Cap

LLMs can suggest unsafe weights. This service:
1. Caps suggestions at 105% of the user's verified PR
2. Validates logged weights against historical records
3. Flags unusually large jumps for review
"""


def get_max_allowed_weight(exercise_name: str, prs: dict, cap_pct: float = 1.05) -> float | None:
    """
    Returns the maximum weight the AI is allowed to suggest for a given exercise.
    Returns None if no PR exists (no cap applied — user is establishing baseline).
    """
    name_lower = exercise_name.lower()
    for pr_exercise, pr_weight in prs.items():
        if pr_exercise.lower() in name_lower or name_lower in pr_exercise.lower():
            return round(pr_weight * cap_pct, 1)
    return None


def validate_logged_weight(exercise_name: str, weight_kg: float, prs: dict) -> dict:
    """
    Validates a user-logged weight against their PR history.
    Returns: {valid: bool, message: str, pr_broken: bool}
    """
    max_allowed = get_max_allowed_weight(exercise_name, prs, cap_pct=1.10)

    if max_allowed is None:
        return {"valid": True, "message": "First time logging — establishing baseline.", "pr_broken": False}

    current_pr = None
    for pr_exercise, pr_weight in prs.items():
        if pr_exercise.lower() in exercise_name.lower() or exercise_name.lower() in pr_exercise.lower():
            current_pr = pr_weight
            break

    if weight_kg > max_allowed:
        return {
            "valid": False,
            "message": f"⚠️ Weight {weight_kg}kg exceeds safe progression cap ({max_allowed}kg). Reduce and retest.",
            "pr_broken": False,
        }

    if current_pr and weight_kg > current_pr:
        return {
            "valid": True,
            "message": f"🏆 NEW PR! {exercise_name}: {weight_kg}kg (previous: {current_pr}kg)",
            "pr_broken": True,
            "new_pr": weight_kg,
        }

    return {"valid": True, "message": "Weight within safe range.", "pr_broken": False}
