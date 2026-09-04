"""HTTP surface for the lab.

Stateless, like the rest of this service: it fits, scores and predicts, and
hands the artifact back. The backend owns persistence — so a model outlives a
restart because it was stored beside the ontology it was trained on, not because
this process remembered it.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.lab import sandbox, tabular

router = APIRouter(prefix="/lab", tags=["lab"])


class TrainRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(..., max_length=200_000)
    target: str
    features: list[str]
    estimator: str
    params: dict[str, Any] = Field(default_factory=dict)
    split: Literal["random", "chronological"] = "random"
    test_size: float = Field(0.25, gt=0.05, lt=0.6)
    time_column: str | None = None


class TrainResponse(BaseModel):
    task: str
    estimator: str
    params: dict[str, Any]
    metrics: dict[str, float]
    baseline: dict[str, float]
    importances: list[dict[str, Any]]
    n_train: int
    n_test: int
    dropped_rows: int
    numeric_features: list[str]
    categorical_features: list[str]
    split: str
    classes: list[str]
    warnings: list[str]
    artifact_b64: str


class PredictRequest(BaseModel):
    artifact_b64: str
    rows: list[dict[str, Any]] = Field(..., max_length=100_000)


class CellRequest(BaseModel):
    code: str = Field(..., max_length=200_000)
    rows: list[dict[str, Any]] = Field(default_factory=list, max_length=200_000)
    timeout_s: int = Field(sandbox.DEFAULT_TIMEOUT_S, ge=1, le=sandbox.MAX_TIMEOUT_S)


@router.get("/estimators")
def estimators() -> list[dict[str, Any]]:
    """What the picker offers, with the defaults it should pre-fill."""
    return tabular.catalogue()


@router.post("/infer-task")
def infer(values: list[Any]) -> dict[str, str]:
    """Whether a column is something to measure or something to name."""
    return {"task": tabular.infer_task(values)}


@router.post("/train", response_model=TrainResponse)
def train(req: TrainRequest) -> TrainResponse:
    try:
        out = tabular.train(
            rows=req.rows,
            target=req.target,
            features=req.features,
            estimator=req.estimator,
            params=req.params,
            split=req.split,
            test_size=req.test_size,
            time_column=req.time_column,
        )
    except ValueError as exc:
        # Every refusal in `tabular` is a sentence written for the person who
        # chose the columns, so it is passed through rather than replaced by a
        # generic 400 that sends them back to guessing.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return TrainResponse(**out.__dict__)


@router.post("/predict")
def predict(req: PredictRequest) -> dict[str, Any]:
    try:
        return {"predictions": tabular.predict(req.artifact_b64, req.rows)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - corrupt artifact
        raise HTTPException(status_code=400, detail="Modèle illisible.") from exc


@router.post("/cell")
def cell(req: CellRequest) -> dict[str, Any]:
    """Run a user's Python against their rows.

    See `sandbox` for what this does and does not contain. The short version:
    the child cannot read this process's credentials, and everything else about
    the container is shared.
    """
    out = sandbox.run_cell(req.code, req.rows, timeout_s=req.timeout_s)
    return {
        "ok": out.ok,
        "stdout": out.stdout,
        "stderr": out.stderr,
        "result": out.result,
        "durationMs": out.duration_ms,
        "timedOut": out.timed_out,
    }
