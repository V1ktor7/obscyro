import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://obscyro:obscyro_dev_password@localhost:5435/obscyro",
)


@pytest.fixture(scope="session", autouse=True)
def require_postgres_embeddings():
    try:
        from app.pg_index import pg_embedding_count

        if pg_embedding_count() == 0:
            pytest.skip(
                "snomed.description_embeddings is empty — run: "
                "npm run migrate && npm run import:snomed (backend), then "
                "python scripts/populate_embeddings.py --language en --limit 50000"
            )
    except Exception as exc:
        pytest.skip(f"Postgres SNOMED not available: {exc}")


@pytest.fixture
def tremblay_note() -> dict:
    path = Path(__file__).parent / "fixtures" / "tremblay.json"
    return json.loads(path.read_text(encoding="utf-8"))
