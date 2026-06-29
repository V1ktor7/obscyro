"""Spatiotemporal GNN node (scaffold).

Intended: torch-geometric message passing over the contact graph with a temporal
head, capturing ward-to-ward spread structure the mean-field SEIR misses. Until a
model is trained, it transparently returns the mechanistic baseline.
"""

from __future__ import annotations

from app.models.base import BaseNode, NodeOutput, SimContext, fallback_output, first_mechanistic_input
from app.schemas import GraphNodeSpec


class GnnNode(BaseNode):
    type = "gnn_spatiotemporal"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:
        mech = first_mechanistic_input(ctx, spec)
        if mech is None:
            raise ValueError("gnn_spatiotemporal requires an upstream mechanistic node")
        return fallback_output(
            spec, self.type, mech, "untrained: torch-geometric GNN not fitted; using mechanistic"
        )

    def train(self, dataset, **kwargs) -> dict:
        # Scaffold: real training would build PyG Data objects from contact graphs
        # + per-day node states and fit a recurrent GNN. Requires torch-geometric.
        return {
            "status": "scaffold",
            "reason": "GNN training requires torch-geometric + historical node-state series",
        }
