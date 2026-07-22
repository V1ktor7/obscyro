import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEXICON_DIR = ROOT / "lexicons"

EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
)

RESOLVE_MIN = float(os.getenv("RESOLVE_MIN", "0.87"))
MARGIN_MIN = float(os.getenv("MARGIN_MIN", "0.015"))
FLAG_MIN = float(os.getenv("FLAG_MIN", "0.55"))

CONTEXT_WINDOW_CHARS = int(os.getenv("CONTEXT_WINDOW_CHARS", "160"))
CONTEXT_TRIGGER_CONF = float(os.getenv("CONTEXT_TRIGGER_CONF", "0.95"))
CONTEXT_DEFAULT_CONF = float(os.getenv("CONTEXT_DEFAULT_CONF", "0.9"))

TOP_K_CANDIDATES = int(os.getenv("TOP_K_CANDIDATES", "5"))
DECISION_ACCEPT_CONTEXT_MIN = float(os.getenv("DECISION_ACCEPT_CONTEXT_MIN", "0.85"))

PG_SEARCH_LIMIT = int(os.getenv("PG_SEARCH_LIMIT", "30"))

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
SNOMED_SOURCE = "postgres"


def require_database_url() -> str:
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is required. nlp-service uses Obscyro Postgres SNOMED only "
            "(snomed.description_embeddings). See nlp-service/README.md."
        )
    return DATABASE_URL
