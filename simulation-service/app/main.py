from __future__ import annotations

from fastapi import FastAPI

from app.registry import list_artifacts, registered_types
from app.runner import simulate
from app.schemas import (
    ModelListEntry,
    SimulateRequest,
    SimulateResponse,
    TrainRequest,
    TrainResponse,
)

app = FastAPI(
    title="Obscyro Simulation — hybrid ML digital-twin simulation",
    description=(
        "Ontology-bound, scenario-branched, hybrid simulation: composable model DAG "
        "(mechanistic SEIR + physics-informed Neural-ODE/UDE, with GNN/TFT/surrogate/"
        "causal nodes registered with mechanistic fallback). Stateless compute; the "
        "backend owns the ontology and persistence."
    ),
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    """Liveness probe — must not block on model load. Lists available node types."""
    return {"status": "ok", "node_types": registered_types()}


@app.post("/simulate", response_model=SimulateResponse)
def simulate_route(req: SimulateRequest) -> SimulateResponse:
    return simulate(req)


@app.get("/models", response_model=list[ModelListEntry])
def models_route() -> list[ModelListEntry]:
    entries: list[ModelListEntry] = []
    for meta in list_artifacts():
        entries.append(
            ModelListEntry(
                model_type=meta.get("model_type", "unknown"),
                name=meta.get("name", "unknown"),
                version=meta.get("version", "unknown"),
                artifact_uri=meta.get("artifact_uri"),
                metrics=meta.get("metrics", {}),
            )
        )
    return entries


@app.post("/train", response_model=TrainResponse)
def train_route(req: TrainRequest) -> TrainResponse:
    """Cold-start training entrypoint. Heavy training is normally run via
    scripts/train_cold_start.py; this endpoint performs a lightweight synthetic
    cold-start fit when torch is available, else returns a scaffold result.
    """
    from app.training import run_training

    return run_training(req)
