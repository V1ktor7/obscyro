# Obscyro Simulation Service

Stateless, ontology-bound, scenario-branched **hybrid ML simulation** for the
Obscyro digital twin. It runs a composable **model DAG** ("simulation graph") and
returns quantile forecasts, an ML-vs-mechanistic baseline error, feature
importances, and per-unit predicted properties. The **backend owns the ontology
and all persistence** — this service never touches the database (mirrors the
`nlp-service` proxy pattern).

## Architecture

```
FE SimulationView ──POST /scenarios/:id/simulate──▶ backend (Fastify)
                                                      │ loadScenarioCopy (Postgres branch)
                                                      ▼
                                          POST /simulate (this service)
                                          model DAG: SEIR ▶ UDE (+fallback nodes)
                                                      │ quantiles, baseline, error,
                                                      │ feature importances, predicted props
                                                      ▼
                                            backend writes predicted_properties +
                                            provenance, persists simulation_run
```

## Model DAG nodes

| type | status | notes |
|------|--------|-------|
| `mechanistic_seir` | **runnable** | Faithful port of the backend SEIR (bit-exact `mulberry32`). Always-available baseline + cold-start data generator. |
| `neural_ode_ude` | **runnable** | Physics-informed Neural-ODE/UDE (torch + torchdiffeq). Zero-residual cold-start reduces **exactly** to mechanistic SEIR. Applies a learned residual when a trained artifact exists. |
| `gnn_spatiotemporal` | scaffold | torch-geometric; mechanistic fallback until trained. |
| `forecaster_tft` | scaffold | pytorch-forecasting TFT/DeepAR; mechanistic MC-quantile fallback. |
| `surrogate` | scaffold | fast emulator; mechanistic fallback. |
| `causal_counterfactual` | **runnable** | Real structural do-intervention (close unit / add isolation beds) via mechanistic re-run; EconML/DoWhy uplift is the scaffolded extension. |

Heavy DL libraries are **lazy-imported**, so the service boots and `/health` +
mechanistic `/simulate` work even when `torch` et al. are absent (nodes
transparently fall back to the mechanistic baseline, tagged `fallback`).

## Endpoints

- `GET /health` — liveness + registered node types.
- `POST /simulate` — run the model DAG on a scenario-branch graph payload.
- `POST /train` — lightweight cold-start UDE fit (synthetic data).
- `GET /models` — list trained artifacts under `MODEL_DIR`.

## Local development

```bash
cd simulation-service
python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 5100
```

### Tests (CPU, no torch required)

```bash
pip install pytest
pytest
```

Covers mechanistic determinism, DAG topo-sort/execution, and UDE cold-start
equivalence (`UDE == mechanistic` without an artifact).

### Train the cold-start UDE (optional, needs the ML stack)

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-ml.txt
python scripts/train_cold_start.py --name ude-coldstart --version 0.1.0 --samples 64 --epochs 50
```

The artifact lands in `MODEL_DIR/ude-coldstart/0.1.0/`; pass `model.id` +
`model.version` in `/simulate` to use it.

## Wiring it to the backend

Set `SIM_SERVICE_URL` in the backend env to this service's URL. When unset, the
backend returns `503 SIM_UNAVAILABLE`; when the service is unreachable, the
backend falls back to its in-process mechanistic SEIR so `/simulate` still
returns a baseline.
