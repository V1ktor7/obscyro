from __future__ import annotations

from functools import lru_cache

from app.config import FLAG_MIN, MARGIN_MIN, PG_SEARCH_LIMIT, RESOLVE_MIN, TOP_K_CANDIDATES
from app.schemas import CandidateOut, ConceptStatus


def _database_url() -> str:
    from app.config import require_database_url

    return require_database_url()


@lru_cache(maxsize=4096)
def get_concept_display(code: str) -> str | None:
    if not code:
        return None
    sql = """
        SELECT MIN(term)
        FROM snomed.description_embeddings
        WHERE concept_id = %s::bigint
    """
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (code,))
                row = cur.fetchone()
                return str(row[0]) if row and row[0] else None
    except Exception:
        return None


def _connect():
    import psycopg

    return psycopg.connect(_database_url())


def pg_embedding_count() -> int:
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*)::bigint FROM snomed.description_embeddings")
            row = cur.fetchone()
            return int(row[0]) if row else 0


def pg_health_ok() -> bool:
    try:
        return pg_embedding_count() > 0
    except Exception:
        return False


def search_span_pg(span: str, top_k: int = TOP_K_CANDIDATES) -> tuple[
    list[CandidateOut],
    float,
    float,
    ConceptStatus,
    str | None,
]:
    from app.embeddings import encode_texts

    qvec = encode_texts([span])[0]
    vec_literal = "[" + ",".join(f"{x:.8f}" for x in qvec.tolist()) + "]"
    limit = max(PG_SEARCH_LIMIT, top_k * 6)

    sql = """
        SELECT
            concept_id::text,
            term,
            1 - (embedding <=> %s::vector) AS cosine
        FROM snomed.description_embeddings
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (vec_literal, vec_literal, limit))
            rows = cur.fetchall()

    seen_codes: set[str] = set()
    deduped: list[CandidateOut] = []
    for concept_id, term, cosine in rows:
        if concept_id in seen_codes:
            continue
        seen_codes.add(concept_id)
        score = round(float(cosine), 4)
        deduped.append(
            CandidateOut(
                code=concept_id,
                display=str(term),
                cosine=score,
            )
        )
        if len(deduped) >= top_k:
            break

    if not deduped:
        return [], 0.0, 0.0, "unresolved", None

    top_cos = deduped[0].cosine
    second_cos = deduped[1].cosine if len(deduped) > 1 else 0.0
    margin = round(top_cos - second_cos, 4)

    if top_cos < FLAG_MIN:
        status: ConceptStatus = "unresolved"
        code = None
    elif top_cos >= RESOLVE_MIN and margin >= MARGIN_MIN:
        status = "resolved"
        code = deduped[0].code
    else:
        status = "flag"
        code = deduped[0].code

    return deduped, top_cos, margin, status, code
