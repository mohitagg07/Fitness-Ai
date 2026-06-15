"""
ChromaDB setup — stores biomechanical guardrails as vector embeddings.
The LangChain RAG retriever queries this collection on every workout generation
to inject relevant safety rules into the LLM prompt automatically.
"""
import chromadb
from chromadb.utils import embedding_functions
from core.config import get_settings
from functools import lru_cache

settings = get_settings()

# ─── Guardrail documents ──────────────────────────────────────────────────────
# Each document has:
#   - page_content: The rule text injected into the LLM prompt
#   - metadata.tags: Used to filter retrieval by joint/body part
#   - metadata.safe_alternatives: JSON list of replacement exercises

GUARDRAIL_DOCS = [
    {
        "id": "shoulder_overhead_barbell",
        "content": "SAFETY RULE: Barbell Overhead Press is HIGH RISK for users with shoulder clicking or subacromial impingement. REPLACE WITH: Seated Neutral-Grip DB Press (opens joint space) or Landmine Press. Scapular-plane lateral raises (30° forward V-path) instead of strict side laterals.",
        "tags": ["left_shoulder", "right_shoulder", "shoulder_clicking", "subacromial_impingement", "overhead_press"],
    },
    {
        "id": "shoulder_bench_hyperextension",
        "content": "SAFETY RULE: Deep barbell bench press ROM causing anterior delt strain. REPLACE WITH: Stop-2-inches press (bar never touches chest), DB Bench (natural wrist rotation), Floor Press. Never allow elbow flare beyond 45°.",
        "tags": ["left_shoulder", "right_shoulder", "anterior_delt_strain", "bench_press", "acromioclavicular"],
    },
    {
        "id": "spinal_deadlift_compression",
        "content": "SAFETY RULE: Conventional Deadlift causes lumbar axial compression. MANDATORY PROTOCOL: (1) Outward core bracing — 360° intra-abdominal pressure against waistband. (2) Lats packed tight — 'protect your armpits'. (3) Immediately after final set: 2-minute dead hang from pull-up bar for disc rehydration. (4) Follow with chest-supported rows only — no free-standing rows post-deadlift.",
        "tags": ["lower_back", "lumbar", "deadlift", "axial_compression", "spinal_erector"],
    },
    {
        "id": "spinal_squat_compression",
        "content": "SAFETY RULE: Barbell Squat causes significant spinal compression. PROTOCOL: (1) Mandatory belt use above 85% 1RM. (2) 3-second controlled descent to distribute load. (3) Post-squat: leg extensions and leg press only — no additional axial loading in same session. (4) 2-minute dead hang at session end.",
        "tags": ["lower_back", "lumbar", "squat", "axial_compression", "knee"],
    },
    {
        "id": "lower_back_free_rows",
        "content": "SAFETY RULE: Free-standing barbell rows after heavy Deadlifts or Squats are PROHIBITED. Spinal erectors are pre-fatigued. REPLACE WITH: Chest-Supported Row (bench at 15-30° incline, chest pinned), Single-Arm DB Row with knee and hand braced on bench, Seated Cable Row with back support.",
        "tags": ["lower_back", "lumbar", "barbell_row", "spinal_erector", "post_deadlift"],
    },
    {
        "id": "knee_pain_squat",
        "content": "SAFETY RULE: Knee pain detected. MODIFY SQUATS: Reduce depth to parallel only, widen stance 10-15°, use heel elevation if available. REPLACE high-risk movements: Bulgarian Split Squat → Leg Press, Jump Squats → Leg Extensions only. No direct knee flexion under heavy load.",
        "tags": ["left_knee", "right_knee", "knee_pain", "squat", "lunge", "split_squat"],
    },
    {
        "id": "wrist_pain_pressing",
        "content": "SAFETY RULE: Wrist pain during pressing. PROTOCOL: Neutral grip preferred (DB, EZ-bar, Neutral-grip handles). Wrist wraps mandatory for all pressing above 60% 1RM. REPLACE: Straight-bar curls → EZ-bar curls. Flat barbell bench → DB bench or neutral-grip machine press.",
        "tags": ["left_wrist", "right_wrist", "wrist_pain", "bench_press", "curls"],
    },
    {
        "id": "cns_fatigue_high",
        "content": "CNS FATIGUE PROTOCOL: User has logged RPE 9-10 on a compound movement or reports feeling 'burnt out', 'exhausted', or 'CNS fried'. IMMEDIATE ACTION: (1) Remove all remaining compound free-weight movements. (2) Replace with machine-only, fixed-track isolation. (3) Reduce volume by 40%. (4) Cap session at 45 minutes. (5) Mandatory rest day tomorrow.",
        "tags": ["cns_fatigue", "overtraining", "rpe_10", "burnout", "exhausted"],
    },
    {
        "id": "acute_pain_emergency",
        "content": "EMERGENCY PROTOCOL: User has reported SHARP PAIN, POP, SNAP, TORE, or INJURED. IMMEDIATELY: (1) TERMINATE WORKOUT. (2) Do not suggest any exercises. (3) Display R.I.C.E protocol: Rest — stop activity immediately. Ice — apply ice 20 min every hour. Compression — wrap the area. Elevation — raise above heart level. (4) Recommend consulting a doctor before returning to training.",
        "tags": ["sharp_pain", "injury", "pop", "snap", "tore", "torn", "acute_injury"],
    },
    {
        "id": "post_workout_nutrition",
        "content": "RECOVERY PROTOCOL: Immediately after heavy training (Deadlift/Squat day): (1) Biozyme protein — 1 scoop within 15 minutes. Solid food only after 45-60 min on deadlift days (heavy pulls divert blood from gut). (2) Omega-3 fish oil — take with next solid meal for joint lubrication. (3) Magnesium Glycinate 300mg before bed for CNS recovery and deep sleep.",
        "tags": ["post_workout", "nutrition", "recovery", "protein", "deadlift_day"],
    },
    {
        "id": "deload_protocol",
        "content": "DELOAD PROTOCOL: User has been training 3+ weeks at high intensity OR shows CNS fatigue score above 7. DELOAD WEEK: (1) Drop all weights to 65-70% of working weight. (2) Max 3 working sets per exercise. (3) No sets to failure. (4) Reduce session duration to 45 minutes. (5) No new PRs attempted. Purpose: flush accumulated fatigue, consolidate adaptations.",
        "tags": ["deload", "recovery_week", "overtraining", "high_fatigue", "week_4"],
    },
]


@lru_cache()
def get_chroma_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=settings.chroma_persist_dir)


def get_guardrail_collection():
    client = get_chroma_client()
    ef = embedding_functions.DefaultEmbeddingFunction()
    collection = client.get_or_create_collection(
        name=settings.chroma_collection_name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )
    return collection


def seed_guardrails():
    """Seed the vector DB with all biomechanical guardrail documents."""
    collection = get_guardrail_collection()
    existing = collection.get()["ids"]

    docs_to_add = [d for d in GUARDRAIL_DOCS if d["id"] not in existing]
    if not docs_to_add:
        print("ChromaDB already seeded — skipping.")
        return

    collection.add(
        ids=[d["id"] for d in docs_to_add],
        documents=[d["content"] for d in docs_to_add],
        metadatas=[{"tags": ",".join(d["tags"])} for d in docs_to_add],
    )
    print(f"Seeded {len(docs_to_add)} guardrail documents into ChromaDB.")


def query_guardrails(query_text: str, injury_tags: list[str] = None, n_results: int = 4) -> list[str]:
    """
    Retrieve relevant safety rules for the given query + user injury profile.
    Always includes emergency protocol query separately to catch injury keywords.
    """
    collection = get_guardrail_collection()

    # Always check for emergency keywords first
    emergency_keywords = ["sharp pain", "pop", "snap", "tore", "injured", "hurt badly"]
    if any(kw in query_text.lower() for kw in emergency_keywords):
        emergency = collection.get(ids=["acute_pain_emergency"])
        if emergency["documents"]:
            return emergency["documents"]  # Return ONLY emergency protocol

    results = collection.query(
        query_texts=[query_text],
        n_results=n_results,
        where=None,  # Could filter by injury tags if needed
    )
    return results["documents"][0] if results["documents"] else []
