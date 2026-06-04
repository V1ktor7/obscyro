from __future__ import annotations

from functools import lru_cache

import numpy as np

from app.config import EMBEDDING_MODEL, TOP_K_CANDIDATES
from app.pg_index import search_span_pg
from app.schemas import CandidateOut, ConceptStatus


@lru_cache(maxsize=1)
def get_encoder():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBEDDING_MODEL)


def encode_texts(texts: list[str]) -> np.ndarray:
    model = get_encoder()
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vecs, dtype=np.float32)


def search_span(
    span: str, top_k: int = TOP_K_CANDIDATES
) -> tuple[list[CandidateOut], float, float, ConceptStatus, str | None]:
    return search_span_pg(span, top_k)
