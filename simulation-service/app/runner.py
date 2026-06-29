"""Simulation orchestration: payload -> contact graph -> model DAG -> response.

Stateless. Never touches the DB; the backend owns the ontology and persistence.
"""

from __future__ import annotations

from app.config import (
    DEFAULT_HORIZON_DAYS,
    DEFAULT_RUNS,
    MAX_HORIZON_DAYS,
    MAX_RUNS,
)
from app.contacts import apply_intervention, build_contact_graph
from app.graph import default_graph_spec, execute_graph
from app.mechanistic import aggregate_summaries, run_ensemble
from app.models.base import NodeOutput, SimContext
from app.schemas import (
    DailyTrajectory,
    FeatureImportance,
    GraphTraceEntry,
    MlBaselineError,
    ModelInfo,
    OutbreakSummary,
    PredictedProperties,
    QuantileBands,
    SimulateRequest,
    SimulateResponse,
)
from app.uncertainty import ml_baseline_error, quantile_bands, sensitivity_feature_importances


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def _bands_model(bands: dict) -> QuantileBands:
    return QuantileBands(
        p10=[DailyTrajectory(**d) for d in bands["p10"]],
        p50=[DailyTrajectory(**d) for d in bands["p50"]],
        p90=[DailyTrajectory(**d) for d in bands["p90"]],
    )


def _predicted_properties(out: NodeOutput, model_meta: dict) -> list[PredictedProperties]:
    preds: list[PredictedProperties] = []
    for unit_id, metrics in out.unit_infected.items():
        preds.append(
            PredictedProperties(
                instanceId=unit_id,
                properties={
                    "predictedPeakInfected": metrics.get("peakInfected", 0),
                    "predictedCumulativeInfected": metrics.get("cumulativeInfected", 0),
                    "predictedPeakIsolationDemand": metrics.get("peakIsolationDemand", 0),
                },
            )
        )
    return preds


def simulate(req: SimulateRequest) -> SimulateResponse:
    graph = build_contact_graph(req.graph)

    params = req.params.model_dump()
    intervention = req.intervention
    graph, _meta = apply_intervention(graph, intervention)
    if intervention and intervention.kind == "add_isolation_beds":
        base_cap = params.get("isolationCapacity") or 0
        params["isolationCapacity"] = int(base_cap) + int(intervention.beds or 0)

    runs = _clamp(int(req.params.runs or DEFAULT_RUNS), 1, MAX_RUNS)
    horizon = _clamp(int(req.params.horizonDays or DEFAULT_HORIZON_DAYS), 1, MAX_HORIZON_DAYS)
    params["horizonDays"] = horizon

    spec = req.graph_spec or default_graph_spec()
    ctx = SimContext(
        graph=graph,
        params=params,
        seed=int(req.seed),
        runs=runs,
        horizon=horizon,
        model_ref=req.model.model_dump() if req.model else None,
    )

    chosen, trace = execute_graph(spec, ctx)

    # Mechanistic baseline = the mechanistic node in the DAG, else run one.
    baseline_out = next((o for o in ctx.outputs.values() if o.kind == "mechanistic"), None)
    if baseline_out is not None:
        baseline_bands = baseline_out.quantiles
        baseline_summary = baseline_out.summary
    else:
        all_daily, summaries, _ = run_ensemble(graph, params, int(req.seed), runs)
        baseline_bands = quantile_bands(all_daily)
        baseline_summary = aggregate_summaries(summaries)

    err = ml_baseline_error(chosen.quantiles.get("p50", []), baseline_bands.get("p50", []))
    importances = sensitivity_feature_importances(graph, params, int(req.seed))

    model_info = ModelInfo(
        type=chosen.node_type,
        id=(req.model.id if req.model else None),
        version=(req.model.version if req.model else None),
        fallback=chosen.fallback,
        fallback_reason=chosen.fallback_reason,
    )

    return SimulateResponse(
        engine="ml",
        model=model_info,
        seed=int(req.seed),
        horizonDays=horizon,
        quantiles=_bands_model(chosen.quantiles),
        baseline=_bands_model(baseline_bands),
        summary=OutbreakSummary(**chosen.summary),
        ml_baseline_error=MlBaselineError(**err),
        feature_importances=[FeatureImportance(**fi) for fi in importances],
        predicted_properties=_predicted_properties(chosen, model_info.model_dump()),
        graph_trace=trace,
    )
