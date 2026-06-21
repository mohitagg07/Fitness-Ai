"""
Memory Agent — long-term personal fact store, separate from the
guardrails/safety collection in chroma_client.py.

Stores freeform observations like:
  "User likes paneer", "User hates oats", "User misses workouts on Mondays",
  "User trains best in evenings", "User has knee discomfort"

These are retrieved and injected into the Coach Agent's context so
responses feel like they come from someone who actually remembers the
user, without needing a rigid schema for every possible preference.

FIX (2026): This collection previously had no self-heal logic, unlike
guardrails collection. If neurofit_user_memory was ever created with a
different embedding function (e.g. an older build that used chromadb's
384-dim DefaultEmbeddingFunction) and the project later switched to the
256-dim LocalHashEmbeddingFunction, every write would silently fail with
"Embedding dimension 256 does not match collection dimensionality 384" —
remember() swallowed it and returned None, so memory looked "on" in the
chat response but nothing was ever actually persisted. get_memory_collection()
now probes on first use and self-heals exactly like get_guardrail_collection()
does in chroma_client.py, instead of requiring a manual chroma_store wipe.
"""
import logging
import uuid
from functools import lru_cache

import chromadb

from core.config import get_settings
from db.local_embeddings import LocalHashEmbeddingFunction

logger = logging.getLogger(__name__)
settings = get_settings()

MEMORY_COLLECTION_NAME = "neurofit_user_memory"


def _is_stale_collection_error(e: Exception) -> bool:
    """Detect a collection that was built under a different embedding setup
    than the one we're using now. Covers two failure modes seen across
    ChromaDB versions:
      1. Legacy: get_or_create_collection() succeeds, but a later query()/
         add() raises a plain dimension-mismatch error against the HNSW
         index (e.g. "Embedding dimension 256 does not match collection
         dimensionality 384" — the exact error from production logs here).
      2. Current (chromadb >=1.x): get_or_create_collection() itself raises
         immediately, comparing the embedding function identity persisted
         in the collection's config against the one just passed in (e.g.
         "Embedding function conflict... new: local_hash_embedding vs
         persisted: default")."""
    msg = str(e).lower()
    if "dimension" in msg and ("match" in msg or "expect" in msg or "got" in msg):
        return True
    if "embedding function" in msg and ("conflict" in msg or "persisted" in msg):
        return True
    return False


@lru_cache()
def get_memory_chroma_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=settings.chroma_persist_dir)


def _rebuild_memory_collection(client: chromadb.PersistentClient, ef: LocalHashEmbeddingFunction):
    """Delete and recreate just the neurofit_user_memory collection.
    Scoped to this collection only — does NOT touch repmind_guardrails,
    so a memory-side dimension fix never re-triggers a guardrails reseed."""
    logger.warning(
        f"Rebuilding stale '{MEMORY_COLLECTION_NAME}' collection. Any facts "
        f"stored under the previous embedding setup are unrecoverable and "
        f"will need to be re-learned through conversation."
    )
    try:
        client.delete_collection(MEMORY_COLLECTION_NAME)
    except Exception as del_err:
        # Collection may not exist yet, or may already be mid-corruption —
        # either way, get_or_create_collection below is the real recovery step.
        logger.debug(f"delete_collection during memory rebuild: {del_err}")

    return client.get_or_create_collection(
        name=MEMORY_COLLECTION_NAME,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


@lru_cache()
def get_memory_collection():
    """
    Returns the user-memory collection. Self-heals a stale embedding setup
    from a previous run, the same way get_guardrail_collection() does in
    chroma_client.py — but guards BOTH places a stale collection can throw:
    construction (client.get_or_create_collection) and the dummy probe
    query, since which one fires depends on the installed chromadb version.
    Cached with lru_cache — this only runs once per process. If a rebuild
    happens, the cache is cleared so the next call re-probes against the
    fresh collection instead of reusing a stale reference.
    """
    client = get_memory_chroma_client()
    ef = LocalHashEmbeddingFunction()

    try:
        collection = client.get_or_create_collection(
            name=MEMORY_COLLECTION_NAME,
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )
    except Exception as e:
        if not _is_stale_collection_error(e):
            raise
        logger.warning(
            f"Memory collection rejected at construction time — "
            f"attempting self-heal. ({e})"
        )
        collection = _rebuild_memory_collection(client, ef)
        get_memory_collection.cache_clear()
        return collection

    try:
        collection.query(query_texts=["dimension check"], n_results=1)
    except Exception as e:
        if _is_stale_collection_error(e):
            logger.warning(
                f"Memory collection has a stale embedding dimension — "
                f"attempting self-heal. ({e})"
            )
            collection = _rebuild_memory_collection(client, ef)
            # Verify the rebuild actually fixed it; let this raise if not —
            # remember()/recall() wrap their calls in try/except and fail
            # safe, so a hard failure here surfaces in logs instead of
            # silently masking a deeper chroma_store problem.
            collection.query(query_texts=["dimension check"], n_results=1)
            get_memory_collection.cache_clear()
        elif "no documents" not in str(e).lower():
            logger.warning(f"Memory collection probe warning: {e}")

    return collection


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
        if _is_stale_collection_error(e):
            # Self-heal in get_memory_collection() already tried once this
            # call; if we're still here, the rebuild itself failed (e.g. a
            # locked/corrupt chroma_store directory) and needs manual
            # attention rather than another silent retry.
            logger.error(
                f"Memory collection self-heal failed — could not store a "
                f"new memory for user {user_id} even after rebuild attempt. "
                f"chroma_store may be corrupt; consider wiping it entirely. ({e})"
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
        logger.warning(f"Memory lookup failed for user {user_id}: {e}")
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
        logger.warning(f"Memory recall query failed for user {user_id}: {e}")
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