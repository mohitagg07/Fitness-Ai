from services.exercise_catalog import (
    EXERCISES,
    classify_exercise_group,
    normalize_exercise_name,
    resolve_exercise,
)
from services.exercise_library import classify_muscle_group


def test_catalog_aliases_resolve_to_same_canonical_exercise():
    assert resolve_exercise("DB BENCH PRESS").exercise_id == "dumbbell_bench_press"
    assert resolve_exercise("dumbbell bench press").name == "Dumbbell Bench Press"
    assert resolve_exercise("rdl").exercise_id == "romanian_deadlift"


def test_catalog_does_not_fuzzy_guess_unknown_exercises():
    assert resolve_exercise("some made up chest press variation") is None
    assert classify_exercise_group("some made up chest press variation") is None


def test_catalog_has_unique_ids_and_aliases_never_cross_exercises():
    ids = [exercise.exercise_id for exercise in EXERCISES]
    assert len(ids) == len(set(ids))
    alias_owner = {}
    for exercise in EXERCISES:
        for alias in (exercise.name, *exercise.aliases):
            normalized = normalize_exercise_name(alias)
            assert normalized not in alias_owner or alias_owner[normalized] == exercise.exercise_id
            alias_owner[normalized] = exercise.exercise_id


def test_form_metadata_is_only_attached_to_curated_exercises():
    bench = resolve_exercise("Bench Press")
    assert bench.form_view == "side"
    assert {"shoulder", "elbow", "wrist"} <= set(bench.form_landmarks)
    assert resolve_exercise("custom machine thing") is None


def test_exercise_metadata_uses_named_anatomy_structures():
    squat = resolve_exercise("Back Squat")
    assert {"quadriceps_l", "quadriceps_r", "gluteal_l", "gluteal_r"} <= set(squat.primary_muscles)


def test_legacy_exercise_names_keep_the_existing_analytics_fallback():
    # Free-text exercise names written before the catalogue existed still work.
    assert classify_muscle_group("Cable Chest Press Machine") == "Chest"
    assert classify_muscle_group("Unmapped Rope Curl Variation") == "Arms"
