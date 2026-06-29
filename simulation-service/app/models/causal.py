"""Causal / counterfactual node.

Scaffolded for EconML/DoWhy uplift estimation, but already meaningful: it runs a
real structural do-intervention (close a unit / add isolation beds) by editing
the contact graph + params and re-running the mechanistic SEIR, then reports the
counterfactual delta vs the upstream (no-intervention) mechanistic baseline.
"""

from __future__ import annotations

from app.contacts import apply_intervention
from app.mechanistic import aggregate_summaries, run_ensemble
from app.models.base import BaseNode, NodeOutput, SimContext, first_mechanistic_input
from app.schemas import GraphNodeSpec, Intervention
from app.uncertainty import quantile_bands


class CausalNode(BaseNode):
    type = "causal_counterfactual"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:
        mech = first_mechanistic_input(ctx, spec)
        if mech is None:
            raise ValueError("causal_counterfactual requires an upstream mechanistic node")

        intervention = Intervention(**spec.params) if spec.params else Intervention()
        if intervention.kind == "none":
            return NodeOutput(
                node_id=spec.id,
                node_type=self.type,
                kind="ml",
                quantiles=mech.quantiles,
                summary=mech.summary,
                ensemble=mech.ensemble,
                unit_infected=mech.unit_infected,
                fallback=True,
                fallback_reason="no intervention specified; identity counterfactual",
                extras={"intervention": "none"},
            )

        graph2, meta = apply_intervention(ctx.graph, intervention)
        params2 = dict(ctx.params)
        if intervention.kind == "add_isolation_beds":
            base_cap = params2.get("isolationCapacity") or 0
            params2["isolationCapacity"] = int(base_cap) + int(intervention.beds or 0)

        all_daily, summaries, rep_units = run_ensemble(graph2, params2, ctx.seed, ctx.runs)
        bands = quantile_bands(all_daily)
        summary = aggregate_summaries(summaries)

        base_peak = float(mech.summary.get("peakInfected") or 0)
        cf_peak = float(summary.get("peakInfected") or 0)
        return NodeOutput(
            node_id=spec.id,
            node_type=self.type,
            kind="ml",
            quantiles=bands,
            summary=summary,
            ensemble=all_daily,
            unit_infected=rep_units,
            fallback=False,
            extras={
                "intervention": meta,
                "peakInfectedBaseline": base_peak,
                "peakInfectedCounterfactual": cf_peak,
                "peakInfectedReduction": base_peak - cf_peak,
            },
        )

    def train(self, dataset, **kwargs) -> dict:
        return {
            "status": "scaffold",
            "reason": "uplift estimation requires EconML/DoWhy + observational treatment data",
        }
