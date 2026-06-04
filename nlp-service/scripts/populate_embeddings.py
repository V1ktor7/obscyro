#!/usr/bin/env python3
"""Populate snomed.description_embeddings from snomed.descriptions via pgvector."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.embeddings import encode_texts  # noqa: E402
from app.ids import EMBEDDING_DIM, FSN_TYPE_ID, SYNONYM_TYPE_ID  # noqa: E402

FETCH_SQL = """
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

COUNT_SQL = """
SELECT COUNT(*)::bigint
FROM snomed.descriptions d
JOIN snomed.concepts c ON c.id = d.concept_id
WHERE d.active = true
  AND c.active = true
  AND d.type_id IN (%s, %s)
  AND d.language_code = ANY(%s)
"""


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Embed SNOMED descriptions into Postgres")
    p.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres URL")
    p.add_argument("--language", default="en,fr", help="Comma-separated language codes")
    p.add_argument("--batch-size", type=int, default=512)
    p.add_argument("--limit", type=int, default=0, help="Max descriptions (0 = all)")
    p.add_argument(
        "--create-index",
        action="store_true",
        help="Create HNSW index after populate (slow on large tables)",
    )
    p.add_argument(
        "--drop-index",
        action="store_true",
        help="Drop HNSW index before populate for faster inserts",
    )
    return p.parse_args()


def vec_literal(vec) -> str:
    return "[" + ",".join(f"{float(x):.8f}" for x in vec.tolist()) + "]"


def main() -> None:
    args = parse_args()
    if not args.database_url:
        print("DATABASE_URL or --database-url required", file=sys.stderr)
        sys.exit(1)

    langs = [x.strip() for x in args.language.split(",") if x.strip()]
    import psycopg

    conn = psycopg.connect(args.database_url)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")

    if args.drop_index:
        conn.execute("DROP INDEX IF EXISTS snomed.description_embeddings_hnsw_idx")
        conn.commit()
        print("Dropped HNSW index (if existed)")

    with conn.cursor() as cur:
        cur.execute(COUNT_SQL, (SYNONYM_TYPE_ID, FSN_TYPE_ID, langs))
        total_available = int(cur.fetchone()[0])

    cap = args.limit if args.limit > 0 else total_available
    print(f"Descriptions to embed: {cap} (pool {total_available}, langs {langs})")

    last_id = 0
    inserted = 0
    t0 = time.time()

    while inserted < cap:
        batch_cap = min(args.batch_size, cap - inserted)
        with conn.cursor() as cur:
            cur.execute(
                FETCH_SQL,
                (SYNONYM_TYPE_ID, FSN_TYPE_ID, langs, last_id, batch_cap),
            )
            rows = cur.fetchall()

        if not rows:
            break

        terms = [r[2] for r in rows]
        vectors = encode_texts(terms)

        upsert = """
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

        with conn.cursor() as cur:
            for row, vec in zip(rows, vectors, strict=True):
                desc_id, concept_id, term, lang, type_id = row
                cur.execute(
                    upsert,
                    (desc_id, concept_id, term, lang, type_id, vec_literal(vec)),
                )
                last_id = desc_id
        conn.commit()

        inserted += len(rows)
        elapsed = time.time() - t0
        rate = inserted / elapsed if elapsed > 0 else 0
        print(f"  {inserted}/{cap} ({rate:.0f}/s, last_id={last_id})")

    if args.create_index:
        print("Creating HNSW index (may take several minutes)...")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS description_embeddings_hnsw_idx
            ON snomed.description_embeddings
            USING hnsw (embedding vector_cosine_ops)
            """
        )
        conn.commit()
        print("HNSW index ready")

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*)::bigint FROM snomed.description_embeddings")
        final = int(cur.fetchone()[0])

    conn.close()
    print(f"Done. snomed.description_embeddings rows: {final}")


if __name__ == "__main__":
    main()
