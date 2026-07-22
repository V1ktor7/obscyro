"""Self-populating SNOMED embeddings.

On boot, if snomed.description_embeddings is (near) empty while
snomed.descriptions has data, start a background thread that embeds
descriptions into pgvector — the same upsert loop as
scripts/populate_embeddings.py, but running inside the service so prod
fixes itself without shell access to the database.

Resume-safe: the fetch cursor starts after MAX(description_id) already
embedded, and writes are ON CONFLICT upserts, so a redeploy mid-run just
continues where it left off. Progress is exposed via /health.
"""

from __future__ import annotations

import os
import threading
import time

from app.ids import FSN_TYPE_ID, SYNONYM_TYPE_ID

_FETCH_SQL = """
SELECT d.id, d.concept_id, d.term, d.language_code, d.type_id
FROM snomed.descriptions d
JOIN snomed.concepts c ON c.id = d.concept_id
WHERE d.active = true
  AND c.active = true
  AND d.type_id IN (%s, %s)
  AND d.language_code = ANY(%s)
  AND d.id > %s
ORDER BY d.id
LIMIT %s
"""

_UPSERT_SQL = """
INSERT INTO snomed.description_embeddings
    (description_id, concept_id, term, language_code, type_id, embedding)
VALUES (%s, %s, %s, %s, %s, %s::vector)
ON CONFLICT (description_id) DO UPDATE SET
    concept_id = EXCLUDED.concept_id,
    term = EXCLUDED.term,
    language_code = EXCLUDED.language_code,
    type_id = EXCLUDED.type_id,
    embedding = EXCLUDED.embedding
"""

# Populate state surfaced in /health.
progress: dict = {"state": "idle", "inserted": 0, "target": 0, "error": None}

_lock = threading.Lock()
_started = False


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _vec_literal(vec) -> str:
    return "[" + ",".join(f"{float(x):.8f}" for x in vec.tolist()) + "]"


def _connect():
    import psycopg

    from app.config import require_database_url

    return psycopg.connect(require_database_url())


def _run(langs: list[str], limit: int, batch_size: int, pause_s: float) -> None:
    from app.embeddings import encode_texts

    try:
        conn = _connect()
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.commit()

        with conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(MAX(description_id), 0)::bigint FROM snomed.description_embeddings"
            )
            last_id = int(cur.fetchone()[0])

        progress.update(state="running", target=limit)
        inserted = 0

        while inserted < limit:
            batch_cap = min(batch_size, limit - inserted)
            with conn.cursor() as cur:
                cur.execute(
                    _FETCH_SQL,
                    (SYNONYM_TYPE_ID, FSN_TYPE_ID, langs, last_id, batch_cap),
                )
                rows = cur.fetchall()
            if not rows:
                break

            vectors = encode_texts([r[2] for r in rows])
            with conn.cursor() as cur:
                for row, vec in zip(rows, vectors):
                    desc_id, concept_id, term, lang, type_id = row
                    cur.execute(
                        _UPSERT_SQL,
                        (desc_id, concept_id, term, lang, type_id, _vec_literal(vec)),
                    )
                    last_id = desc_id
            conn.commit()

            inserted += len(rows)
            progress.update(inserted=inserted)
            # Yield CPU between batches so live extract requests stay responsive.
            time.sleep(pause_s)

        # HNSW index makes search fast once the bulk load is in.
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS description_embeddings_hnsw_idx
                ON snomed.description_embeddings
                USING hnsw (embedding vector_cosine_ops)
                """
            )
        conn.commit()
        conn.close()
        progress.update(state="done")
    except Exception as exc:  # pragma: no cover — surfaced via /health
        progress.update(state="error", error=str(exc)[:300])


def start_auto_populate() -> None:
    """Kick off background population when the embeddings table is empty.

    Controlled by env: AUTO_POPULATE_EMBEDDINGS=0 disables; POPULATE_LANGS
    (default "en,fr"), POPULATE_LIMIT (default 50000), POPULATE_BATCH
    (default 256), POPULATE_MIN_ROWS (default 1000 — skip when the table
    already has at least this many rows).
    """
    global _started
    with _lock:
        if _started:
            return
        _started = True

    if os.getenv("AUTO_POPULATE_EMBEDDINGS", "1") == "0":
        return

    try:
        from app.pg_index import pg_embedding_count

        existing = pg_embedding_count()
    except Exception as exc:
        progress.update(state="error", error=f"count failed: {str(exc)[:200]}")
        return

    min_rows = _env_int("POPULATE_MIN_ROWS", 1000)
    if existing >= min_rows:
        progress.update(state="done", inserted=existing)
        return

    langs = [
        x.strip()
        for x in os.getenv("POPULATE_LANGS", "en,fr").split(",")
        if x.strip()
    ]
    limit = _env_int("POPULATE_LIMIT", 50_000)
    batch = _env_int("POPULATE_BATCH", 256)
    pause = float(os.getenv("POPULATE_PAUSE_S", "0.05"))

    thread = threading.Thread(
        target=_run,
        args=(langs, limit, batch, pause),
        name="populate-embeddings",
        daemon=True,
    )
    progress.update(state="starting", target=limit)
    thread.start()
