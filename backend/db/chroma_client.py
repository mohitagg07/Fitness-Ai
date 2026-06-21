"""
ChromaDB — biomechanical guardrails vector store.
Injects relevant safety rules into every LLM prompt via RAG.

FIX (2025): The self-heal logic for stale embedding dimensions was catching
InvalidArgumentError, but newer ChromaDB versions (>=0.5) raise a plain
Exception / ValueError with "dimension" in the message instead of
InvalidArgumentError. Fixed to catch both. Also added a nuclear fallback:
delete the entire chroma_store directory and start fresh if the collection
is irrecoverably corrupt. The lru_cache is also cleared so the next call
rebuilds cleanly.
"""
import chromadb
import logging
import shutil
import os

logger = logging.getLogger(__name__)

# Cross-version safe import for InvalidArgumentError
try:
    from chromadb.errors import InvalidArgumentError
except ImportError:
    try:
        from chromadb.api.types import InvalidArgumentError
    except ImportError:
        InvalidArgumentError = ValueError

from core.config import get_settings
from db.local_embeddings import LocalHashEmbeddingFunction
from functools import lru_cache

settings = get_settings()

GUARDRAIL_DOCS = [
    {
        "id": "shoulder_overhead_barbell",
        "content": "SAFETY RULE: Barbell Overhead Press is HIGH RISK for users with shoulder clicking or subacromial impingement. REPLACE WITH: Seated Neutral-Grip DB Press (opens joint space) or Landmine Press. Scapular-plane lateral raises (30° forward) instead of strict side laterals.",
        "tags": ["left_shoulder", "right_shoulder", "shoulder_clicking", "subacromial_impingement", "overhead_press"],
    },
    {
        "id": "shoulder_bench_hyperextension",
        "content": "SAFETY RULE: Deep barbell bench press ROM causing anterior delt strain. REPLACE WITH: Stop-2-inches press (bar never touches chest), DB Bench (natural wrist rotation), Floor Press. Never allow elbow flare beyond 45°.",
        "tags": ["left_shoulder", "right_shoulder", "anterior_delt_strain", "bench_press"],
    },
    {
        "id": "spinal_deadlift_compression",
        "content": "SAFETY RULE: Conventional Deadlift causes lumbar axial compression. MANDATORY PROTOCOL: (1) 360° intra-abdominal pressure. (2) Lats packed tight. (3) Immediately after final set: 2-minute dead hang for disc rehydration. (4) Follow with chest-supported rows only.",
        "tags": ["lower_back", "lumbar", "deadlift", "axial_compression"],
    },
    {
        "id": "spinal_squat_compression",
        "content": "SAFETY RULE: Barbell Squat causes significant spinal compression. PROTOCOL: (1) Mandatory belt above 85% 1RM. (2) 3-second controlled descent. (3) Post-squat: leg extensions and leg press only. (4) 2-minute dead hang at session end.",
        "tags": ["lower_back", "lumbar", "squat", "axial_compression", "knee"],
    },
    {
        "id": "lower_back_free_rows",
        "content": "SAFETY RULE: Free-standing barbell rows after heavy Deadlifts or Squats are PROHIBITED. Spinal erectors are pre-fatigued. REPLACE WITH: Chest-Supported Row, Single-Arm DB Row with knee braced, Seated Cable Row with back support.",
        "tags": ["lower_back", "lumbar", "barbell_row", "spinal_erector", "post_deadlift"],
    },
    {
        "id": "knee_pain_squat",
        "content": "SAFETY RULE: Knee pain detected. MODIFY SQUATS: Reduce depth to parallel only, widen stance 10-15°. REPLACE: Bulgarian Split Squat → Leg Press, Jump Squats → Leg Extensions only. No direct knee flexion under heavy load.",
        "tags": ["left_knee", "right_knee", "knee_pain", "squat", "lunge"],
    },
    {
        "id": "wrist_pain_pressing",
        "content": "SAFETY RULE: Wrist pain during pressing. PROTOCOL: Neutral grip preferred. Wrist wraps mandatory for all pressing above 60% 1RM. REPLACE: Straight-bar curls → EZ-bar curls. Flat barbell bench → DB bench or neutral-grip machine press.",
        "tags": ["left_wrist", "right_wrist", "wrist_pain", "bench_press", "curls"],
    },
    {
        "id": "cns_fatigue_high",
        "content": "CNS FATIGUE PROTOCOL: User shows high fatigue score. IMMEDIATE ACTION: (1) Remove all remaining compound free-weight movements. (2) Replace with machine-only, fixed-track isolation. (3) Reduce volume by 40%. (4) Cap session at 45 minutes. (5) Mandatory rest day tomorrow.",
        "tags": ["cns_fatigue", "overtraining", "rpe_10", "burnout", "exhausted"],
    },
    {
        "id": "acute_pain_emergency",
        "content": "EMERGENCY PROTOCOL: SHARP PAIN, POP, SNAP, TORE, or INJURED reported. IMMEDIATELY: (1) TERMINATE WORKOUT. (2) Do not suggest any exercises. (3) Display R.I.C.E protocol. (4) Recommend consulting a doctor before returning to training.",
        "tags": ["sharp_pain", "injury", "pop", "snap", "tore", "torn", "acute_injury"],
    },
    {
        "id": "post_workout_nutrition",
        "content": "RECOVERY PROTOCOL: After heavy training (Deadlift/Squat day): (1) Protein within 15 minutes. Solid food after 45-60 min on deadlift days. (2) Omega-3 with next meal for joint lubrication. (3) Magnesium 300mg before bed for CNS recovery.",
        "tags": ["post_workout", "nutrition", "recovery", "protein", "deadlift_day"],
    },
    {
        "id": "deload_protocol",
        "content": "DELOAD PROTOCOL: 3+ weeks at high intensity OR CNS fatigue score above 7. DELOAD WEEK: (1) Drop all weights to 65-70% of working weight. (2) Max 3 working sets per exercise. (3) No sets to failure. (4) Reduce session to 45 minutes. (5) No new PRs attempted.",
        "tags": ["deload", "recovery_week", "overtraining", "high_fatigue"],
    },
    {
        "id": "ai_safety_disclaimer",
        "content": "AI SAFETY RULE: The AI coach provides guidance based on logged data and general principles. For acute injuries, unusual pain, or medical concerns, always consult a qualified healthcare professional. The AI cannot diagnose injuries or replace medical advice.",
        "tags": ["disclaimer", "medical", "safety", "ai_limitations"],
    },
]


def _is_dimension_error(e: Exception) -> bool:
    """Detect embedding dimension mismatch across all ChromaDB versions."""
    msg = str(e).lower()
    return "dimension" in msg and ("match" in msg or "expect" in msg or "got" in msg)


def _nuke_and_rebuild_collection():
    """
    Last-resort recovery: wipe the chroma_store directory entirely and
    return a fresh, empty collection. Called only when the dimension mismatch
    can't be healed via delete_collection alone (can happen if ChromaDB's
    internal HNSW index files are also stale).
    """
    persist_dir = settings.chroma_persist_dir
    logger.warning(
        f"Nuking stale chroma_store at '{persist_dir}' and rebuilding. "
        f"This is a one-time recovery — all stored embeddings will be reseeded."
    )
    # Clear lru_cache so get_chroma_client() returns a fresh client next call
    get_chroma_client.cache_clear()
    get_guardrail_collection.cache_clear()

    try:
        if os.path.exists(persist_dir):
            shutil.rmtree(persist_dir)
    except Exception as rm_err:
        logger.error(f"Could not delete chroma_store: {rm_err}")

    ef = LocalHashEmbeddingFunction()
    client = chromadb.PersistentClient(path=persist_dir)
    collection = client.get_or_create_collection(
        name=settings.chroma_collection_name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )
    return collection


@lru_cache()
def get_chroma_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=settings.chroma_persist_dir)


@lru_cache()
def get_guardrail_collection():
    """
    Returns the guardrails collection. Self-heals a stale embedding dimension
    from a previous run in two stages:
      1. Try delete_collection + recreate (fast path).
      2. If that still fails, nuke the whole chroma_store directory (nuclear path).
    Cached with lru_cache — the dimension check only runs once per process.
    """
    client = get_chroma_client()
    ef = LocalHashEmbeddingFunction()
    collection = client.get_or_create_collection(
        name=settings.chroma_collection_name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )

    # Probe with a dummy query to detect a stale dimension mismatch.
    try:
        collection.query(query_texts=["dimension check"], n_results=1)
    except Exception as e:
        if _is_dimension_error(e):
            logger.warning(
                f"Guardrails collection has stale embedding dimension — "
                f"attempting fast-path rebuild. ({e})"
            )
            try:
                client.delete_collection(settings.chroma_collection_name)
                collection = client.get_or_create_collection(
                    name=settings.chroma_collection_name,
                    embedding_function=ef,
                    metadata={"hnsw:space": "cosine"},
                )
                seed_guardrails(collection=collection)
                # Verify the rebuild worked
                collection.query(query_texts=["dimension check"], n_results=1)
            except Exception as e2:
                if _is_dimension_error(e2):
                    # Fast path didn't work — go nuclear
                    collection = _nuke_and_rebuild_collection()
                    seed_guardrails(collection=collection)
                else:
                    raise
        # Non-dimension errors on an empty collection are harmless (no docs yet)
        elif "no documents" not in str(e).lower():
            logger.warning(f"Guardrails collection probe warning: {e}")

    return collection


def seed_guardrails(collection=None):
    if collection is None:
        collection = get_guardrail_collection()
    existing = collection.get()["ids"]

    docs_to_add = [d for d in GUARDRAIL_DOCS if d["id"] not in existing]
    if not docs_to_add:
        logger.debug("ChromaDB already seeded — skipping.")
        return

    collection.add(
        ids=[d["id"] for d in docs_to_add],
        documents=[d["content"] for d in docs_to_add],
        metadatas=[{"tags": ",".join(d["tags"])} for d in docs_to_add],
    )
    logger.info(f"Seeded {len(docs_to_add)} guardrail documents into ChromaDB.")


def query_guardrails(query_text: str, injury_tags: list = None, n_results: int = 4) -> list:
    """
    Returns the most relevant safety guardrail documents for this query.
    Never raises — any failure returns [] so the coach degrades gracefully.
    """
    try:
        collection = get_guardrail_collection()

        emergency_keywords = ["sharp pain", "pop", "snap", "tore", "injured", "hurt badly"]
        if any(kw in query_text.lower() for kw in emergency_keywords):
            emergency = collection.get(ids=["acute_pain_emergency"])
            if emergency["documents"]:
                return emergency["documents"]

        results = collection.query(
            query_texts=[query_text],
            n_results=min(n_results, max(1, collection.count())),
            where=None,
        )
        docs = results.get("documents") or [[]]
        return docs[0] if docs else []
    except Exception as e:
        logger.warning(f"Guardrails query failed, continuing without them: {e}")
        return []