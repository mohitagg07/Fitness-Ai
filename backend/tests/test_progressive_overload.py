from services.progressive_overload import recommend_progression


def _session(reps: list[int], rpe: float = 7.0, load: float = 40.0, date: str = "2026-11-27"):
    return {
        "session_date": date,
        "sets": [
            {"reps": value, "weight_kg": load, "rpe": rpe}
            for value in reps
        ],
    }


def test_progression_requires_two_successful_rated_exposures() -> None:
    single = recommend_progression([_session([12, 12, 12])], "8-12", 40)
    assert single["recommendation"] == "maintain"
    assert single["recommended_load_kg"] == 40

    two = recommend_progression([
        _session([12, 12, 12], date="2026-11-27"),
        _session([12, 12, 12], date="2026-11-24"),
    ], "8-12", 40)
    assert two["recommendation"] == "increase"
    assert two["recommended_load_kg"] == 41


def test_progression_reduces_load_after_high_effort_and_low_reps() -> None:
    result = recommend_progression([
        _session([6, 7, 6], rpe=9.5),
        _session([6, 7, 6], rpe=9.5, date="2026-11-24"),
    ], "8-12", 40)
    assert result["recommendation"] == "reduce"
    assert result["recommended_load_kg"] == 38


def test_progression_never_increases_load_without_effort_ratings() -> None:
    result = recommend_progression([
        {
            "sets": [
                {"reps": 12, "weight_kg": 40, "rpe": None},
                {"reps": 12, "weight_kg": 40, "rpe": None},
            ]
        },
        {
            "sets": [
                {"reps": 12, "weight_kg": 40, "rpe": None},
                {"reps": 12, "weight_kg": 40, "rpe": None},
            ]
        },
    ], "8-12", 40)
    assert result["recommendation"] == "maintain"
    assert result["recommended_load_kg"] == 40


def test_bodyweight_progression_uses_rep_work_not_fake_external_load() -> None:
    result = recommend_progression([
        _session([12, 12, 12], load=0),
        _session([12, 12, 12], load=0, date="2026-11-24"),
    ], "8-12", 0)
    assert result["recommendation"] == "maintain"
    assert result["recommended_load_kg"] == 0
    assert "bodyweight" in result["reason"].lower()
