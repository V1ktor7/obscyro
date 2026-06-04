# Obscyro NLP — Clinical extraction

Standalone Python service: **concept extraction** (NER + multilingual embeddings + pgvector) and **context extraction** (rule-based ConText, FR+EN). No generative LLM.

**SNOMED matching uses only Obscyro Postgres** (`snomed.description_embeddings`). There is no local 12-concept seed or npz fallback.

## Prerequisites

Same database as the backend:

1. `docker compose up -d` in `backend/`
2. `npm run migrate` (includes `006_snomed_embeddings.sql`)
3. `npm run import:snomed` (full RF2 in `backend/data/snomed/`)
4. Populate vectors:

```bash
cd nlp-service
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt

cp .env.example .env
python scripts/populate_embeddings.py --language en --limit 50000
python scripts/populate_embeddings.py --language en --create-index
```

Full INT (~1.7M descriptions) takes hours:

```bash
python scripts/populate_embeddings.py --language en --drop-index --create-index
```

## Run

```bash
uvicorn app.main:app --reload --port 5000
```

Health: `GET http://localhost:5000/health` — expect `snomed_embedding_rows > 0`.

## APIs

| Endpoint | Purpose |
|----------|---------|
| `POST /extract/concepts` | NER spans → embed → pgvector cosine + margin → `resolved` / `flag` / `unresolved` |
| `POST /extract/contexts` | Structured context (assertion, subject, temporality, …) with triggers |
| `POST /extract` | Both + `decision` (`accept` / `flag` / `escalate`) |

### Example

```powershell
$body = @{
  text = "M. Beaulieu consulte pour des céphalées intenses. Il nie toute fièvre."
  language = "fr"
  destination = "problem_list"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://localhost:5000/extract" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body $body
```

## Config (`.env`)

- `DATABASE_URL` — **required**
- `RESOLVE_MIN`, `MARGIN_MIN`, `FLAG_MIN`, `PG_SEARCH_LIMIT`, `EMBEDDING_MODEL`

## Tests

Require Postgres with populated embeddings:

```bash
pytest -q
```

## Optional spaCy models

```bash
python -m spacy download fr_core_news_sm
```

Phrase detection works via lexicons + regex without spaCy.

## Phase 2

Wire into Obscyro Node API (`/v1/extract/*`) with auth.
