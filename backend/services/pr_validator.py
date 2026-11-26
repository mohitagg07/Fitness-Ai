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


def find_new_personal_records(
    session_logs: list[dict],
    existing_records: list[dict],
) -> list[dict]:
    """
    Return the strongest new record for each exact exercise + rep-count pair.

    The database key is (user_id, exercise_name, reps), so a 1-rep max and a
    5-rep max are different records. Comparing only exercise_name can miss a
    genuine rep-specific record or compare it with an unrelated rep scheme.
    Warm-up filtering is intentionally handled by the caller so this helper
    can be tested independently of persistence.
    """
    existing_by_key: dict[tuple[str, int], float] = {}
    for record in existing_records:
        name = record.get("exercise_name")
        reps = record.get("reps")
        weight = record.get("weight_kg")
        if not name or reps is None or weight is None:
            continue
        key = (str(name), int(reps))
        existing_by_key[key] = max(
            float(weight),
            existing_by_key.get(key, float("-inf")),
        )

    best_by_key: dict[tuple[str, int], float] = {}
    for log in session_logs:
        name = log.get("exercise_name")
        reps = log.get("reps")
        weight = log.get("weight_kg")
        if not name or reps is None or weight is None:
            continue

        try:
            reps_value = int(reps)
            weight_value = float(weight)
        except (TypeError, ValueError):
            continue

        # Bodyweight-only sets remain in workout history and volume
        # calculations, but do not create a zero-kilogram external-load PR.
        if reps_value < 1 or weight_value <= 0:
            continue

        key = (str(name), reps_value)
        best_by_key[key] = max(weight_value, best_by_key.get(key, 0.0))

    candidates: list[dict] = []
    for (name, reps), weight in best_by_key.items():
        previous = existing_by_key.get((name, reps))
        if previous is None or weight > previous:
            candidates.append({
                "exercise_name": name,
                "weight_kg": weight,
                "reps": reps,
                "previous_pr_kg": previous,
            })

    return candidates

