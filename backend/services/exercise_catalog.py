"""Canonical exercise metadata shared by coaching, analytics and movement tools.

This is deliberately a curated catalogue, not an LLM-generated exercise list.
Unknown exercise names remain unknown instead of receiving invented anatomy.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Optional


@dataclass(frozen=True, slots=True)
class ExerciseDefinition:
    exercise_id: str
    name: str
    aliases: tuple[str, ...]
    movement_pattern: str
    equipment: tuple[str, ...]
    primary_group: str
    primary_muscles: tuple[str, ...]
    secondary_muscles: tuple[str, ...] = ()
    form_view: Optional[str] = None
    form_landmarks: tuple[str, ...] = ()


# Muscle keys align with the BodyParts3D/open-anatomy structure naming where
# applicable. Keys are IDs, not user-facing labels.
EXERCISES: tuple[ExerciseDefinition, ...] = (
    ExerciseDefinition("barbell_bench_press", "Barbell Bench Press", ("bench press", "flat bench", "barbell chest press"), "horizontal_push", ("barbell", "bench"), "Chest", ("chest_muscles_l", "chest_muscles_r"), ("triceps", "deltoid_l", "deltoid_r"), "side", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("incline_barbell_bench_press", "Incline Barbell Bench Press", ("incline bench press", "incline barbell press"), "incline_push", ("barbell", "bench"), "Chest", ("chest_muscles_l", "chest_muscles_r"), ("deltoid_l", "deltoid_r", "triceps"), "side", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("dumbbell_bench_press", "Dumbbell Bench Press", ("db bench press", "dumbbell chest press"), "horizontal_push", ("dumbbell", "bench"), "Chest", ("chest_muscles_l", "chest_muscles_r"), ("deltoid_l", "deltoid_r", "triceps"), "side", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("incline_dumbbell_press", "Incline Dumbbell Press", ("incline db press", "incline dumbbell bench press"), "incline_push", ("dumbbell", "bench"), "Chest", ("chest_muscles_l", "chest_muscles_r"), ("deltoid_l", "deltoid_r", "triceps"), "side", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("cable_fly", "Cable Fly", ("cable chest fly", "standing cable fly"), "horizontal_adduction", ("cable",), "Chest", ("chest_muscles_l", "chest_muscles_r"), ("deltoid_l", "deltoid_r")),
    ExerciseDefinition("push_up", "Push-Up", ("push up", "pushup", "press up"), "horizontal_push", ("bodyweight",), "Chest", ("chest_muscles_l", "chest_muscles_r"), ("triceps", "deltoid_l", "deltoid_r"), "side", ("shoulder", "elbow", "hip")),
    ExerciseDefinition("pull_up", "Pull-Up", ("pull up", "chin up", "chin-up"), "vertical_pull", ("bodyweight", "bar"), "Back", ("back_muscles_l", "back_muscles_r"), ("upper_arm_muscles_l", "upper_arm_muscles_r"), "front", ("shoulder", "elbow")),
    ExerciseDefinition("lat_pulldown", "Lat Pulldown", ("lat pull down", "wide grip pulldown"), "vertical_pull", ("cable", "machine"), "Back", ("back_muscles_l", "back_muscles_r"), ("upper_arm_muscles_l", "upper_arm_muscles_r"), "front", ("shoulder", "elbow")),
    ExerciseDefinition("barbell_row", "Barbell Row", ("bent over row", "bent-over barbell row", "barbell bent over row"), "horizontal_pull", ("barbell",), "Back", ("back_muscles_l", "back_muscles_r"), ("trapezius_l", "trapezius_r", "upper_arm_muscles_l", "upper_arm_muscles_r"), "side", ("shoulder", "elbow", "hip")),
    ExerciseDefinition("seated_cable_row", "Seated Cable Row", ("cable row", "seated row"), "horizontal_pull", ("cable",), "Back", ("back_muscles_l", "back_muscles_r"), ("trapezius_l", "trapezius_r", "upper_arm_muscles_l", "upper_arm_muscles_r"), "side", ("shoulder", "elbow", "hip")),
    ExerciseDefinition("face_pull", "Face Pull", ("rope face pull",), "horizontal_pull", ("cable",), "Shoulders", ("deltoid_l", "deltoid_r", "rotator_cuff_l", "rotator_cuff_r"), ("trapezius_l", "trapezius_r"), "front", ("shoulder", "elbow")),
    ExerciseDefinition("overhead_press", "Overhead Press", ("shoulder press", "military press", "barbell shoulder press", "ohp"), "vertical_push", ("barbell",), "Shoulders", ("deltoid_l", "deltoid_r"), ("triceps", "trapezius_l", "trapezius_r"), "side", ("shoulder", "elbow", "hip")),
    ExerciseDefinition("dumbbell_shoulder_press", "Dumbbell Shoulder Press", ("db shoulder press", "seated dumbbell press"), "vertical_push", ("dumbbell",), "Shoulders", ("deltoid_l", "deltoid_r"), ("triceps", "trapezius_l", "trapezius_r"), "front", ("shoulder", "elbow")),
    ExerciseDefinition("lateral_raise", "Lateral Raise", ("side lateral raise", "dumbbell lateral raise", "lateral raises"), "shoulder_abduction", ("dumbbell", "cable"), "Shoulders", ("deltoid_l", "deltoid_r"), ("trapezius_l", "trapezius_r"), "front", ("shoulder", "elbow")),
    ExerciseDefinition("barbell_curl", "Barbell Curl", ("bicep curl", "biceps curl", "standing barbell curl"), "elbow_flexion", ("barbell",), "Arms", ("upper_arm_muscles_l", "upper_arm_muscles_r"), ("forearm_muscles_l", "forearm_muscles_r"), "front", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("hammer_curl", "Hammer Curl", ("dumbbell hammer curl",), "elbow_flexion", ("dumbbell",), "Arms", ("upper_arm_muscles_l", "upper_arm_muscles_r"), ("forearm_muscles_l", "forearm_muscles_r"), "front", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("triceps_pushdown", "Triceps Pushdown", ("cable triceps pushdown", "rope pushdown", "tricep pushdown"), "elbow_extension", ("cable",), "Arms", ("upper_arm_muscles_l", "upper_arm_muscles_r"), ("forearm_muscles_l", "forearm_muscles_r"), "side", ("shoulder", "elbow", "wrist")),
    ExerciseDefinition("back_squat", "Back Squat", ("barbell squat", "squat", "high bar squat", "low bar squat"), "squat", ("barbell", "rack"), "Legs", ("quadriceps_l", "quadriceps_r", "gluteal_l", "gluteal_r"), ("hamstrings_l", "hamstrings_r", "back_muscles_l", "back_muscles_r"), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("front_squat", "Front Squat", ("barbell front squat",), "squat", ("barbell", "rack"), "Legs", ("quadriceps_l", "quadriceps_r", "gluteal_l", "gluteal_r"), ("hamstrings_l", "hamstrings_r"), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("goblet_squat", "Goblet Squat", ("dumbbell goblet squat", "kettlebell goblet squat"), "squat", ("dumbbell", "kettlebell"), "Legs", ("quadriceps_l", "quadriceps_r", "gluteal_l", "gluteal_r"), ("hamstrings_l", "hamstrings_r"), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("leg_press", "Leg Press", ("45 degree leg press", "machine leg press"), "squat", ("machine",), "Legs", ("quadriceps_l", "quadriceps_r", "gluteal_l", "gluteal_r"), ("hamstrings_l", "hamstrings_r")),
    ExerciseDefinition("romanian_deadlift", "Romanian Deadlift", ("rdl", "barbell rdl", "dumbbell romanian deadlift"), "hip_hinge", ("barbell", "dumbbell"), "Legs", ("hamstrings_l", "hamstrings_r", "gluteal_l", "gluteal_r"), ("back_muscles_l", "back_muscles_r"), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("conventional_deadlift", "Conventional Deadlift", ("deadlift", "barbell deadlift"), "hip_hinge", ("barbell",), "Legs", ("gluteal_l", "gluteal_r", "hamstrings_l", "hamstrings_r"), ("back_muscles_l", "back_muscles_r", "trapezius_l", "trapezius_r"), "side", ("shoulder", "hip", "knee", "ankle")),
    ExerciseDefinition("walking_lunge", "Walking Lunge", ("lunge", "dumbbell lunge", "walking lunges"), "lunge", ("bodyweight", "dumbbell"), "Legs", ("quadriceps_l", "quadriceps_r", "gluteal_l", "gluteal_r"), ("hamstrings_l", "hamstrings_r"), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("leg_extension", "Leg Extension", ("machine leg extension",), "knee_extension", ("machine",), "Legs", ("quadriceps_l", "quadriceps_r"), (), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("leg_curl", "Leg Curl", ("lying leg curl", "seated leg curl", "hamstring curl"), "knee_flexion", ("machine",), "Legs", ("hamstrings_l", "hamstrings_r"), ("calf_l", "calf_r"), "side", ("hip", "knee", "ankle")),
    ExerciseDefinition("hip_thrust", "Hip Thrust", ("barbell hip thrust", "glute bridge"), "hip_extension", ("barbell", "bench", "bodyweight"), "Legs", ("gluteal_l", "gluteal_r"), ("hamstrings_l", "hamstrings_r"), "side", ("shoulder", "hip", "knee")),
    ExerciseDefinition("calf_raise", "Standing Calf Raise", ("calf raise", "standing calf raise", "seated calf raise"), "ankle_plantarflexion", ("machine", "dumbbell", "bodyweight"), "Legs", ("calf_l", "calf_r"), ()),
    ExerciseDefinition("plank", "Plank", ("forearm plank", "front plank"), "anti_extension", ("bodyweight",), "Core", ("abdominal_muscles",), ("gluteal_l", "gluteal_r"), "side", ("shoulder", "hip", "ankle")),
    ExerciseDefinition("crunch", "Crunch", ("ab crunch", "floor crunch", "sit up", "sit-up"), "trunk_flexion", ("bodyweight",), "Core", ("abdominal_muscles",), (), "side", ("shoulder", "hip")),
)

_INDEX: dict[str, ExerciseDefinition] = {}


def normalize_exercise_name(value: str) -> str:
    """Normalize case and punctuation while preserving meaningful words."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).split())


def _build_index() -> dict[str, ExerciseDefinition]:
    index: dict[str, ExerciseDefinition] = {}
    for exercise in EXERCISES:
        for label in (exercise.name, *exercise.aliases):
            key = normalize_exercise_name(label)
            if key in index and index[key].exercise_id != exercise.exercise_id:
                raise ValueError(f"Duplicate exercise alias: {label!r}")
            index[key] = exercise
    return index


_INDEX = _build_index()


def resolve_exercise(name: str) -> Optional[ExerciseDefinition]:
    """Resolve an exact canonical name or known alias; never fuzzy-guess."""
    return _INDEX.get(normalize_exercise_name(name))


def classify_exercise_group(name: str) -> Optional[str]:
    """Return a curated primary training group for known exercises only."""
    exercise = resolve_exercise(name)
    return exercise.primary_group if exercise else None


def list_exercises() -> list[dict]:
    """JSON-safe public catalogue for authenticated app clients."""
    return [asdict(item) for item in EXERCISES]
