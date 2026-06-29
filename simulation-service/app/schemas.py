"""Pydantic contracts shared with the backend (backend builds these payloads).

Keep field names aligned with backend/src/services/ml-simulation.ts.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# Several DTOs carry a `model_type` field; opt out of pydantic's protected
# "model_" namespace so it does not warn.
_ALLOW_MODEL_FIELDS = ConfigDict(protected_namespaces=())

# ----------------------------------------------------------------------------
# Graph payload (scenario branch projection sent by the backend)
# ----------------------------------------------------------------------------


class GraphNode(BaseModel):
    id: str
    type: str
    properties: dict[str, Any] = Field(default_factory=dict)


class GraphLink(BaseModel):
    linkTypeName: str
    fromId: str
    toId: str


class GraphPayload(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    links: list[GraphLink] = Field(default_factory=list)


# ----------------------------------------------------------------------------
# Outbreak parameters (mirror backend OutbreakParams)
# ----------------------------------------------------------------------------


class OutbreakParams(BaseModel):
    beta: Optional[float] = None
    r0: Optional[float] = None
    incubationDays: Optional[int] = None
    infectiousDays: Optional[int] = None
    indexNodeIds: Optional[list[str]] = None
    isolationCapacity: Optional[int] = None
    runs: Optional[int] = None
    horizonDays: Optional[int] = None
    containThreshold: Optional[int] = None


class Intervention(BaseModel):
    """do-operator on the scenario graph (causal counterfactual)."""

    kind: Literal["none", "close_unit", "add_isolation_beds"] = "none"
    unitId: Optional[str] = None
    beds: Optional[int] = None


# ----------------------------------------------------------------------------
# Model DAG spec ("simulation graph")
# ----------------------------------------------------------------------------


class GraphNodeSpec(BaseModel):
    id: str
    type: str  # registered node type, e.g. "mechanistic_seir", "neural_ode_ude"
    inputs: list[str] = Field(default_factory=list)  # upstream node ids
    params: dict[str, Any] = Field(default_factory=dict)


class GraphSpec(BaseModel):
    nodes: list[GraphNodeSpec]
    output: Optional[str] = None  # node id whose quantiles are the ML output


# ----------------------------------------------------------------------------
# Requests
# ----------------------------------------------------------------------------


class ModelRef(BaseModel):
    id: Optional[str] = None
    version: Optional[str] = None


class SimulateRequest(BaseModel):
    scenario_id: Optional[str] = None
    seed: int = 1
    graph: GraphPayload
    params: OutbreakParams = Field(default_factory=OutbreakParams)
    graph_spec: Optional[GraphSpec] = None
    intervention: Optional[Intervention] = None
    model: Optional[ModelRef] = None


class TrainRequest(BaseModel):
    model_config = _ALLOW_MODEL_FIELDS

    model_type: str = "neural_ode_ude"
    name: str = "ude-coldstart"
    version: str = "0.1.0"
    seed: int = 1
    dataset_kind: Literal["synthetic", "history"] = "synthetic"
    graph: Optional[GraphPayload] = None
    params: OutbreakParams = Field(default_factory=OutbreakParams)
    samples: int = 64
    epochs: int = 50


# ----------------------------------------------------------------------------
# Responses
# ----------------------------------------------------------------------------


class DailyTrajectory(BaseModel):
    day: int
    S: float
    E: float
    I: float
    R: float
    isolationDemand: float


class OutbreakSummary(BaseModel):
    peakInfected: float
    peakIsolationDemand: float
    attackRate: float
    daysToContain: Optional[float] = None
    hcwInfections: float


class QuantileBands(BaseModel):
    p10: list[DailyTrajectory]
    p50: list[DailyTrajectory]
    p90: list[DailyTrajectory]


class FeatureImportance(BaseModel):
    feature: str
    importance: float


class MlBaselineError(BaseModel):
    rmse: float
    mae: float
    peakAbsError: float


class PredictedProperties(BaseModel):
    instanceId: str
    properties: dict[str, Any]


class ModelInfo(BaseModel):
    type: str
    id: Optional[str] = None
    version: Optional[str] = None
    fallback: bool = False
    fallback_reason: Optional[str] = None


class GraphTraceEntry(BaseModel):
    node: str
    type: str
    status: Literal["ok", "fallback", "error"]
    detail: Optional[str] = None


class SimulateResponse(BaseModel):
    engine: Literal["ml"] = "ml"
    model: ModelInfo
    seed: int
    horizonDays: int
    quantiles: QuantileBands
    baseline: QuantileBands
    summary: OutbreakSummary
    ml_baseline_error: MlBaselineError
    feature_importances: list[FeatureImportance]
    predicted_properties: list[PredictedProperties]
    graph_trace: list[GraphTraceEntry]


class TrainResponse(BaseModel):
    model_config = _ALLOW_MODEL_FIELDS

    model_type: str
    name: str
    version: str
    status: Literal["ready", "failed"]
    seed: int
    dataset_kind: str
    artifact_uri: Optional[str] = None
    metrics: dict[str, Any]


class ModelListEntry(BaseModel):
    model_config = _ALLOW_MODEL_FIELDS

    model_type: str
    name: str
    version: str
    artifact_uri: Optional[str] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
