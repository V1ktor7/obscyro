"""Declarative model DAG + topological executor (the "simulation graph").

A GraphSpec lists nodes with their upstream inputs. The executor topologically
sorts them, runs each, and stores its NodeOutput in the shared SimContext so
downstream nodes can consume it.
"""

from __future__ import annotations

from app.models.base import NodeOutput, SimContext
from app.registry import create_node
from app.schemas import GraphNodeSpec, GraphSpec, GraphTraceEntry


def default_graph_spec() -> GraphSpec:
    """Mechanistic root -> UDE forecaster. Output = UDE quantiles."""
    return GraphSpec(
        nodes=[
            GraphNodeSpec(id="seir", type="mechanistic_seir", inputs=[]),
            GraphNodeSpec(id="ude", type="neural_ode_ude", inputs=["seir"]),
        ],
        output="ude",
    )


def _toposort(nodes: list[GraphNodeSpec]) -> list[GraphNodeSpec]:
    by_id = {n.id: n for n in nodes}
    visited: dict[str, int] = {}  # 0=visiting, 1=done
    order: list[GraphNodeSpec] = []

    def visit(node: GraphNodeSpec) -> None:
        mark = visited.get(node.id)
        if mark == 1:
            return
        if mark == 0:
            raise ValueError(f"cycle detected in simulation graph at node {node.id}")
        visited[node.id] = 0
        for dep in node.inputs:
            if dep in by_id:
                visit(by_id[dep])
        visited[node.id] = 1
        order.append(node)

    for n in nodes:
        visit(n)
    return order


def execute_graph(spec: GraphSpec, ctx: SimContext) -> tuple[NodeOutput, list[GraphTraceEntry]]:
    if not spec.nodes:
        raise ValueError("graph spec has no nodes")

    order = _toposort(spec.nodes)
    trace: list[GraphTraceEntry] = []
    last: NodeOutput | None = None

    for node_spec in order:
        node = create_node(node_spec.type)
        try:
            out = node.run(ctx, node_spec)
        except Exception as exc:  # noqa: BLE001 - surface as trace, keep DAG resilient
            trace.append(
                GraphTraceEntry(node=node_spec.id, type=node_spec.type, status="error", detail=str(exc))
            )
            raise
        ctx.outputs[node_spec.id] = out
        trace.append(
            GraphTraceEntry(
                node=node_spec.id,
                type=node_spec.type,
                status="fallback" if out.fallback else "ok",
                detail=out.fallback_reason,
            )
        )
        last = out

    output_id = spec.output or order[-1].id
    chosen = ctx.outputs.get(output_id, last)
    assert chosen is not None
    return chosen, trace
