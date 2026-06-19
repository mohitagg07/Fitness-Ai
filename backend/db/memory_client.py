"""
Memory Agent — long-term personal fact store, separate from the
guardrails/safety collection in chroma_client.py.

Stores freeform observations like:
  "User likes paneer", "User hates oats", "User misses workouts on Mondays",
  "User trains best in evenings", "User has knee discomfort"

These are retrieved and injected into the Coach Agent's context so
responses feel like they come from someone who actually remembers the
user, without needing a rigid schema for every possible preference.
"""
import uuid
import chromadb
from chromadb.utils import embedding_functions
from core.config import get_settings
from functools import lru_cache

settings = get_settings()

MEMORY_COLLECTION_NAME = "neurofit_user_memory"


@lru_cache()
def get_memory_chroma_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=settings.chroma_persist_dir)


def get_memory_collection():
    client = get_memory_chroma_client()
    ef = embedding_functions.DefaultEmbeddingFunction()
    return client.get_or_create_collection(
        name=MEMORY_COLLECTION_NAME,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


def remember(user_id: str, fact: str, category: str = "general") -> str:
    """
    Store a new long-term fact about a user.
    category examples: "food_preference", "schedule_pattern", "injury",
    "training_preference", "general"
    """
    collection = get_memory_collection()
    fact_id = str(uuid.uuid4())
    collection.add(
        ids=[fact_id],
        documents=[fact],
        metadatas=[{"user_id": user_id, "category": category}],
    )
    return fact_id


def recall(user_id: str, query_text: str, n_results: int = 5) -> list[str]:
    """
    Retrieve the most relevant long-term facts about this specific user
    given the current conversational context.
    """
    collection = get_memory_collection()

    # Guard: ChromaDB >=1.5 raises if n_results exceeds the number of
    # documents that match the `where` filter. A brand-new user has zero
    # stored memories on their first chat, so check first and short-circuit
    # instead of letting `.query()` throw (previously silently swallowed by
    # the caller's broad except block in coach_agent.py with no logging).
    try:
        existing = collection.get(where={"user_id": user_id}, limit=n_results)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Memory lookup failed for user {user_id}: {e}")
        return []

    available = len(existing.get("ids", []))
    if available == 0:
        return []

    try:
        results = collection.query(
            query_texts=[query_text],
            n_results=min(n_results, available),
            where={"user_id": user_id},
        )
        docs = results.get("documents") or [[]]
        return docs[0] if docs else []
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Memory recall query failed for user {user_id}: {e}")
        return []


def recall_all(user_id: str) -> list[dict]:
    """Return every stored fact for a user — used by a future 'memory' profile tab."""
    collection = get_memory_collection()
    results = collection.get(where={"user_id": user_id})
    facts = []
    for doc_id, doc, meta in zip(
        results.get("ids", []),
        results.get("documents", []),
        results.get("metadatas", []),
    ):
        facts.append({"id": doc_id, "fact": doc, "category": (meta or {}).get("category", "general")})
    return facts


def forget(user_id: str, fact_id: str) -> None:
    collection = get_memory_collection()
    collection.delete(ids=[fact_id], where={"user_id": user_id})
