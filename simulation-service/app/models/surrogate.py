"""Surrogate emulator node (scaffold).

Intended: a fast neural emulator trained to reproduce the mechanistic/UDE output
across the parameter space, for sub-second what-if sweeps. Until trained, returns
the mechanistic baseline directly (already fast for these graph sizes).
"""

from __future__ import annotations

from app.models.base import BaseNode, NodeOutput, SimContext, fallback_output, first_mechanistic_input
from app.schemas import GraphNodeSpec


class SurrogateNode(BaseNode):
    type = "surrogate"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:
        mech = first_mechanistic_input(ctx, spec)
        if mech is None:
            raise ValueError("surrogate requires an upstream mechanistic node")
        return fallback_output(
            spec, self.type, mech, "untrained: surrogate emulator not fitted; using mechanistic"
        )

    def train(self, dataset, **kwargs) -> dict:
        return {
            "status": "scaffold",
            "reason": "surrogate training requires a parameter-sweep dataset from the mechanistic model",
        }
