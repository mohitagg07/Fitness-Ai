"""
Habit Memory — VYRN

The roadmap wants the coach to actually remember, and USE, things like
"hates cardio," "shoulder pain," "likes supersets," "home gym." Injury
data already has a real structured table (injury_profiles) that
program_rewriter.py's swap logic already reads via
filter_substitutes(injured_body_parts=...). What's been missing is the
same treatment for the free-text facts coach_agent.py already stores via
db.memory_client.remember() — those sit in ChromaDB as plain sentences
and get recalled for chat, but nothing turns them into a structured
signal another agent can act on.

This module is that bridge: a lightweight, deterministic keyword
classifier over the user's own stored memory facts (recall_all()) —
NOT an LLM guessing intent, so results are auditable and reproducible.
It only recognizes patterns it has explicit rules for; anything it
doesn't recognize is left out rather than guessed at.
"""
from __future__ import annotations

# Keyword → normalized exercise-type tag. Checked against memory facts
# after a dislike/avoid cue is found in the same sentence.
EXERCISE_TYPE_KEYWORDS = {
    "cardio": ["cardio"],
    "running": ["running", "treadmill", "jogging"],
    "hiit": ["hiit", "high intensity interval"],
    "burpees": ["burpee"],
    "cycling": ["cycling", "spin class", "spinning"],
}

DISLIKE_CUES = ["hate", "hates", "dislike", "dislikes", "avoid", "avoids", "don't like", "doesn't like", "can't stand"]
LIKE_CUES = ["love", "loves", "like", "likes", "prefer", "prefers", "enjoy", "enjoys"]

FORMAT_KEYWORDS = {
    "supersets": ["superset"],
    "dropsets": ["dropset", "drop set"],
    "circuits": ["circuit training", "circuits"],
    "straight_sets": ["straight sets"],
}

EQUIPMENT_CONTEXT_KEYWORDS = {
    "home_gym": ["home gym"],
    "no_gym_access": ["no gym", "no gym access", "can't get to a gym", "cant get to a gym"],
    "dumbbells_only": ["dumbbells only", "only dumbbells", "just dumbbells"],
    "bodyweight_only": ["bodyweight only", "no equipment"],
}

TIME_KEYWORDS = {
    "evening": ["evening workout", "evenings", "after work"],
    "morning": ["morning workout", "mornings", "before work"],
}


def _sentence_has_any(text: str, cues: list[str]) -> bool:
    return any(c in text for c in cues)


def extract_structured_preferences(user_id: str) -> dict:
    """
    Reads every stored freeform memory fact for the user and classifies
    them into structured buckets. Returns has_data: False (empty buckets)
    for a user with no matching facts yet — never invents a preference.
    """
    from db.memory_client import recall_all

    try:
        facts = recall_all(user_id)
    except Exception:
        facts = []

    dislikes: set[str] = set()
    likes: set[str] = set()
    formats_preferred: set[str] = set()
    equipment_context: set[str] = set()
    time_context: set[str] = set()
    matched_facts: list[dict] = []

    for f in facts:
        text = (f.get("fact") or "").lower()
        if not text:
            continue
        matched_this_fact = False

        has_dislike_cue = _sentence_has_any(text, DISLIKE_CUES)
        has_like_cue = _sentence_has_any(text, LIKE_CUES)

        for tag, keywords in EXERCISE_TYPE_KEYWORDS.items():
            if any(k in text for k in keywords):
                if has_dislike_cue:
                    dislikes.add(tag)
                    matched_this_fact = True
                elif has_like_cue:
                    likes.add(tag)
                    matched_this_fact = True

        for tag, keywords in FORMAT_KEYWORDS.items():
            if any(k in text for k in keywords):
                # Format mentions ("I do supersets") are useful even without
                # an explicit like/dislike cue, unlike exercise-type
                # avoidance which needs the cue to mean anything — but skip
                # if phrased as a dislike ("I hate dropsets").
                if has_dislike_cue:
                    continue
                formats_preferred.add(tag)
                matched_this_fact = True

        for tag, keywords in EQUIPMENT_CONTEXT_KEYWORDS.items():
            if any(k in text for k in keywords):
                equipment_context.add(tag)
                matched_this_fact = True

        for tag, keywords in TIME_KEYWORDS.items():
            if any(k in text for k in keywords):
                time_context.add(tag)
                matched_this_fact = True

        if matched_this_fact:
            matched_facts.append({"fact": f.get("fact"), "category": f.get("category")})

    return {
        "has_data": bool(dislikes or likes or formats_preferred or equipment_context or time_context),
        "dislikes": sorted(dislikes),
        "likes": sorted(likes),
        "formats_preferred": sorted(formats_preferred),
        "equipment_context": sorted(equipment_context),
        "time_context": sorted(time_context),
        "matched_facts": matched_facts,
        "total_memories_scanned": len(facts),
    }
