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
# Cross-version safe import — see db/chroma_client.py for the full
# explanation. Newer chromadb releases moved/renamed this exception
# (reported missing from chromadb.errors entirely on some 0.5.x/1.x
# installs), so we try the documented path, fall back to an older
# internal location, and finally fall back to the generic ValueError
# chromadb raised for this case before the dedicated exception existed.
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

MEMORY_COLLECTION_NAME = "neurofit_user_memory"


@lru_cache()
def get_memory_chroma_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=settings.chroma_persist_dir)


@lru_cache()
def get_memory_collection():
    client = get_memory_chroma_client()
    # Same network-dependency concern as db/chroma_client.py — see
    # db/local_embeddings.py for why this isn't chromadb's
    # DefaultEmbeddingFunction. Cached with lru_cache so this only runs
    # once per process.
    ef = LocalHashEmbeddingFunction()
    return client.get_or_create_collection(
        name=MEMORY_COLLECTION_NAME,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


def _is_dimension_mismatch(e: Exception) -> bool:
    return isinstance(e, InvalidArgumentError) and "dimension" in str(e).lower()


def remember(user_id: str, fact: str, category: str = "general") -> str | None:
    """
    Store a new long-term fact about a user.
    category examples: "food_preference", "schedule_pattern", "injury",
    "training_preference", "general"

    Returns None on failure instead of raising — coach_agent.py already
    wraps its call to this in a try/except (a failed memory write should
    never break the chat response that triggered it), but this function
    fails safe on its own too in case anything else calls it directly.
    """
    try:
        collection = get_memory_collection()
        fact_id = str(uuid.uuid4())
        collection.add(
            ids=[fact_id],
            documents=[fact],
            metadatas=[{"user_id": user_id, "category": category}],
        )
        return fact_id
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        if _is_dimension_mismatch(e):
            logger.error(
                f"Memory collection has a stale embedding dimension from a "
                f"previous run and could not store a new memory for user "
                f"{user_id}. This collection holds real user data, so it is "
                f"not auto-rebuilt like the guardrails collection — delete "
                f"the '{MEMORY_COLLECTION_NAME}' collection from your "
                f"chroma_store manually (or wipe chroma_store entirely if "
                f"you don't need to keep existing memories) to fix this. ({e})"
            )
        else:
            logger.warning(f"Failed to store memory for user {user_id}: {e}")
        return None


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
