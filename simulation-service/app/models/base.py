"""SimNode protocol + execution context for the model DAG.

Each node consumes upstream NodeOutputs and produces its own. The mechanistic
node is the root; ML nodes (UDE, GNN, forecaster, surrogate, causal) build on
its ensemble and fall back to it transparently when untrained.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Protocol, runtime_checkable

from app.contacts import ContactGraph
from app.schemas import GraphNodeSpec


@dataclass
class SimContext:
    graph: ContactGraph
    params: dict
    seed: int
    runs: int
    horizon: int
    model_ref: Optional[dict] = None
    intervention_meta: dict = field(default_factory=dict)
    outputs: dict[str, "NodeOutput"] = field(default_factory=dict)


@dataclass
class NodeOutput:
    node_id: str
    node_type: str
    kind: str  # "mechanistic" | "ml"
    quantiles: dict  # {p10,p50,p90: [DailyTrajectory...]}
    summary: dict
    ensemble: Optional[list[list[dict]]] = None  # raw runs for downstream nodes
    unit_infected: dict[str, dict] = field(default_factory=dict)
    fallback: bool = False
    fallback_reason: Optional[str] = None
    extras: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class SimNode(Protocol):
    type: str

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput: ...


class BaseNode:
    """Default no-op training/persistence so scaffolded nodes satisfy the registry."""

    type: str = "base"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:  # pragma: no cover
        raise NotImplementedError

    def train(self, dataset: Any, **kwargs: Any) -> dict:
        return {"status": "noop", "reason": "node does not implement training"}

    def load(self, artifact_dir: Path) -> bool:
        return False

    def save(self, artifact_dir: Path) -> None:
        return None


def first_mechanistic_input(ctx: SimContext, spec: GraphNodeSpec) -> Optional[NodeOutput]:
    """Find an upstream mechanistic output to build on / fall back to."""
    for upstream_id in spec.inputs:
        out = ctx.outputs.get(upstream_id)
        if out is not None:
            return out
    # No explicit input: use any mechanistic node already executed.
    for out in ctx.outputs.values():
        if out.kind == "mechanistic":
            return out
    return None


def fallback_output(spec: GraphNodeSpec, node_type: str, mech: NodeOutput, reason: str) -> NodeOutput:
    """Transparently return the mechanistic baseline, tagged as a fallback."""
    return NodeOutput(
        node_id=spec.id,
        node_type=node_type,
        kind="ml",
        quantiles=mech.quantiles,
        summary=mech.summary,
        ensemble=mech.ensemble,
        unit_infected=mech.unit_infected,
        fallback=True,
        fallback_reason=reason,
    )
