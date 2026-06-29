# Obscyro backend — production deploy runbook

## Services (Railway recommended)

1. **Postgres** — provision a Railway Postgres plugin; copy `DATABASE_URL`.
2. **Backend** (this folder) — deploy with `backend/Dockerfile` + `railway.json`.
3. **NLP service** (`nlp-service/`) — deploy separately; set `NLP_SERVICE_URL` on the backend.
4. **Simulation service** (`simulation-service/`) — deploy separately; set `SIM_SERVICE_URL` on the backend. Optional: when unset, the ML `/simulate` route falls back to the in-process mechanistic SEIR baseline.

## Backend environment variables

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `postgresql://...` from Railway Postgres |
| `PORT` | `4000` |
| `HOST` | `0.0.0.0` |
| `NLP_SERVICE_URL` | `https://your-nlp.up.railway.app` |
| `SIM_SERVICE_URL` | `https://your-sim.up.railway.app` (optional; falls back to in-process mechanistic SEIR when unset) |
| `PUBLIC_API_URL` | `https://your-api.up.railway.app` (used in webhook URLs) |
| `CORS_ORIGINS` | `https://obscyro.vercel.app,https://obscyro.com` |

### Optional feature tunables (safe defaults; override only to tune)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TWIN_SSE_INTERVAL_MS` | `5000` | Live twin SSE recompute cadence |
| `METRICS_SSE_INTERVAL_MS` | `5000` | Live metrics SSE recompute cadence |
| `SSE_HEARTBEAT_MS` | `15000` | SSE keep-alive heartbeat cadence |
| `SSE_RETRY_MS` | `3000` | Client reconnect backoff hint (`retry:`) |
| `LIST_DEFAULT_LIMIT` | `100` | Default page size for list endpoints |
| `LIST_MAX_LIMIT` | `500` | Hard ceiling for list page size |
| `ROLLUP_INSTANCE_CAP` | `50000` | Max rows loaded for rollups/clones/scans |
| `SIM_MAX_RUNS` | `200` | Monte-Carlo simulation run ceiling |
| `SIM_SERVICE_URL` | _(unset)_ | Hybrid ML simulation-service base URL; falls back to mechanistic SEIR when unset |
| `SIM_SERVICE_TIMEOUT_MS` | `60000` | Upstream timeout for simulation-service calls |
| `SIM_DEFAULT_GRAPH` | _(unset)_ | Optional default model-DAG JSON for ML `/simulate` |
| `DQ_ANOMALY_ENABLED` | `true` | Enable L6 statistical anomaly layer |
| `DQ_IQR_K` | `3.0` | Tukey IQR fence multiplier (L6) |
| `DQ_ZSCORE_THRESHOLD` | `5.0` | Robust z-score threshold (L6) |
| `DQ_ANOMALY_MIN_SAMPLE` | `12` | Min same-type samples before L6 runs |

> Migrations: run `npm run migrate` after deploy to apply `019_production_hardening.sql`
> (twin alert de-duplication index, incremental-scan cursor table, score-spec default
> column, and hot-query indexes).

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
