# Obscyro backend — production deploy runbook

## Services (Railway recommended)

1. **Postgres** — provision a Railway Postgres plugin; copy `DATABASE_URL`.
2. **Backend** (this folder) — deploy with `backend/Dockerfile` + `railway.json`.
3. **NLP service** (`nlp-service/`) — deploy separately; set `NLP_SERVICE_URL` on the backend.

## Backend environment variables

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `postgresql://...` from Railway Postgres |
| `PORT` | `4000` |
| `HOST` | `0.0.0.0` |
| `NLP_SERVICE_URL` | `https://your-nlp.up.railway.app` |
| `PUBLIC_API_URL` | `https://your-api.up.railway.app` (used in webhook URLs) |
| `CORS_ORIGINS` | `https://obscyro.vercel.app,https://obscyro.com` |

## Frontend (Vercel)

Set `NEXT_PUBLIC_API_URL` to the backend public URL (same as `PUBLIC_API_URL`).

## First-time database setup (fresh SNOMED import)

Run from a machine with network access to production Postgres and the RF2 files in `backend/data/snomed/`:

```bash
cd backend
cp .env.example .env   # set DATABASE_URL to production

npm run migrate
# Migrations 001–009 including auth, ingestion, ontology

# Full SNOMED RF2 import (hours, ~multi-GB)
npm run import:snomed

npm run build:tc
```

## Embeddings (NLP service)

Point `nlp-service/.env` at the same `DATABASE_URL`, then:

```bash
cd nlp-service
pip install -r requirements.txt
python scripts/populate_embeddings.py --language en --drop-index --create-index
```

Full INT descriptions take hours. `/v1/extract/concepts` requires populated `snomed.description_embeddings`.

## Studio account

Migration `007_auth_login_keys.sql` seeds:

- Email: `victormorency7@gmail.com`
- Access code: `Normalize120$` (change via SQL `crypt()` after deploy)

Sign in at `/sign-in`, then **Create API key** from the platform (full secret shown once).

## Verify

```bash
curl https://your-api/health
curl https://your-api/v1/health
curl -X POST https://your-api/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email":"victormorency7@gmail.com","code":"Normalize120$"}'
```
