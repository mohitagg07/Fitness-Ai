"""
Local embedding function for ChromaDB collections.

WHY THIS EXISTS:
chromadb.utils.embedding_functions.DefaultEmbeddingFunction lazily downloads
an ONNX model (~80MB) from an S3 bucket the *first time* it's used —
inside the request path of /api/coach/chat (via query_guardrails) and
/api/coach's memory recall (via memory_client). If that download is slow,
interrupted, or blocked (flaky connections, corporate proxies, networks
that restrict S3), it raises a ValueError ("does not match expected
SHA256 hash") that was previously unhandled in retrieve_guardrails_node,
turning a network hiccup into a 500 on every single chat message —
including ones where the Groq call itself would have worked fine.

This module replaces it with a small, fully local, dependency-free
embedding: a hashed bag-of-words vector (similar in spirit to the
"hashing trick" used in scikit-learn's HashingVectorizer). It needs no
network access, no extra packages, and no model download, ever.

This is NOT a general-purpose semantic embedding — it won't catch
paraphrases the way a real sentence-transformer would. For this
project's actual use case (matching against ~12 fixed, keyword-rich
safety documents, where injury tags already do the precise matching and
this only needs to catch loose keyword overlap as a second signal) that
trade-off is the right one: a vector store that always works beats a
more "semantic" one that sometimes throws a 500.
"""
import hashlib
import math
import re
from typing import Any, Dict, List

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_DIMENSIONS = 256  # fixed vector length Chroma's HNSW index is built around

# Small, fixed synonym map for this project's domain vocabulary. The
# guardrail document set is a hand-written list of ~12 fitness-safety
# rules (see chroma_client.GUARDRAIL_DOCS) — not an open-ended corpus —
# so a short hand-tuned map covers the realistic vocabulary gap between
# how a user phrases something ("deadlifted", "my back is tight") and
# how the rules are written ("deadlift", "lumbar", "axial compression")
# far more reliably than a generic stemmer would, with zero added
# dependencies or network calls.
_SYNONYMS: Dict[str, List[str]] = {
    "deadlifted": ["deadlift"],
    "deadlifting": ["deadlift"],
    "squatted": ["squat"],
    "squatting": ["squat"],
    "pressed": ["press"],
    "pressing": ["press"],
    "benched": ["bench", "press"],
    "rowed": ["row"],
    "rowing": ["row"],
    "back": ["lumbar", "spinal", "lower_back"],
    "spine": ["lumbar", "spinal"],
    "tight": ["compression", "strain"],
    "sore": ["strain", "fatigue"],
    "ache": ["pain", "strain"],
    "aching": ["pain", "strain"],
    "hurts": ["pain"],
    "hurting": ["pain"],
    "clicking": ["click"],
    "popped": ["pop", "tore"],
    "torn": ["tore"],
    "tired": ["fatigue", "exhausted"],
    "exhausted": ["fatigue", "overtraining"],
    "wrists": ["wrist"],
    "knees": ["knee"],
    "shoulders": ["shoulder"],
}


def _expand_synonyms(tokens: List[str]) -> List[str]:
    expanded = list(tokens)
    for token in tokens:
        expanded.extend(_SYNONYMS.get(token, []))
    return expanded


def _tokenize(text: str) -> List[str]:
    return _expand_synonyms(_TOKEN_RE.findall(text.lower()))


def _hash_index(token: str, dimensions: int = _DIMENSIONS) -> int:
    # Stable across processes/restarts, unlike Python's built-in hash()
    # which is salted per-run unless PYTHONHASHSEED is fixed.
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return int(digest, 16) % dimensions


def embed_text(text: str, dimensions: int = _DIMENSIONS) -> List[float]:
    """Hashed bag-of-words embedding, L2-normalized so cosine similarity
    behaves the way ChromaDB's hnsw:space="cosine" collections expect."""
    vector = [0.0] * dimensions
    tokens = _tokenize(text)
    if not tokens:
        # Avoid an all-zero vector — ChromaDB/hnswlib chokes on normalizing
        # a zero vector for cosine space. A tiny constant epsilon vector is
        # a harmless, deterministic stand-in for "empty document".
        vector[0] = 1e-6
        return vector

    for token in tokens:
        vector[_hash_index(token, dimensions)] += 1.0

    norm = math.sqrt(sum(v * v for v in vector))
    if norm > 0:
        vector = [v / norm for v in vector]
    return vector


class LocalHashEmbeddingFunction:
    """Drop-in replacement for chromadb's DefaultEmbeddingFunction.
    Implements the EmbeddingFunction protocol Chroma expects:
    __call__, name(), get_config(), build_from_config()."""

    def __call__(self, input: List[str]) -> List[List[float]]:
        return [embed_text(doc) for doc in input]

    def embed_query(self, input: List[str]) -> List[List[float]]:
        return self.__call__(input)

    def name(self) -> str:
        return "local_hash_embedding"

    def get_config(self) -> Dict[str, Any]:
        return {"dimensions": _DIMENSIONS}

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "LocalHashEmbeddingFunction":
        return LocalHashEmbeddingFunction()

    def default_space(self) -> str:
        return "cosine"

    def supported_spaces(self) -> List[str]:
        return ["cosine", "l2", "ip"]
