"""Probabilistic forecaster node (TFT/DeepAR scaffold).

Intended: pytorch-forecasting TemporalFusionTransformer trained on historical
twin time-series, emitting native quantile forecasts. Until trained, returns the
mechanistic Monte-Carlo quantile bands (which are already probabilistic).
"""

from __future__ import annotations

from app.models.base import BaseNode, NodeOutput, SimContext, fallback_output, first_mechanistic_input
from app.schemas import GraphNodeSpec


class ForecasterNode(BaseNode):
    type = "forecaster_tft"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:
        mech = first_mechanistic_input(ctx, spec)
        if mech is None:
            raise ValueError("forecaster_tft requires an upstream mechanistic node")
        return fallback_output(
            spec, self.type, mech, "untrained: TFT/DeepAR not fitted; using mechanistic MC quantiles"
        )

    def train(self, dataset, **kwargs) -> dict:
        return {
            "status": "scaffold",
            "reason": "TFT training requires pytorch-forecasting + historical twin series",
        }
