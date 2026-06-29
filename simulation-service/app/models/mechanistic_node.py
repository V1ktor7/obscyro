"""Mechanistic SEIR DAG node — the always-available root / baseline."""

from __future__ import annotations

from app.mechanistic import aggregate_summaries, run_ensemble
from app.models.base import BaseNode, NodeOutput, SimContext
from app.schemas import GraphNodeSpec
from app.uncertainty import quantile_bands


class MechanisticNode(BaseNode):
    type = "mechanistic_seir"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:
        all_daily, summaries, rep_units = run_ensemble(
            ctx.graph, ctx.params, ctx.seed, ctx.runs
        )
        bands = quantile_bands(all_daily)
        return NodeOutput(
            node_id=spec.id,
            node_type=self.type,
            kind="mechanistic",
            quantiles=bands,
            summary=aggregate_summaries(summaries),
            ensemble=all_daily,
            unit_infected=rep_units,
            fallback=False,
        )
