import pytest

from app.contacts import build_contact_graph
from app.graph import _toposort, default_graph_spec, execute_graph
from app.models.base import SimContext
from app.schemas import GraphLink, GraphNode, GraphNodeSpec, GraphPayload, GraphSpec


def _graph() -> GraphPayload:
    nodes = [GraphNode(id=f"p{i}", type="Person", properties={}) for i in range(12)]
    links = [GraphLink(linkTypeName="contact", fromId=f"p{i}", toId=f"p{(i + 1) % 12}") for i in range(12)]
    return GraphPayload(nodes=nodes, links=links)


def _ctx() -> SimContext:
    return SimContext(
        graph=build_contact_graph(_graph()),
        params={"r0": 3.0, "infectiousDays": 6, "horizonDays": 30},
        seed=1,
        runs=8,
        horizon=30,
    )


def test_toposort_orders_dependencies_first():
    spec = default_graph_spec()
    order = _toposort(spec.nodes)
    ids = [n.id for n in order]
    assert ids.index("seir") < ids.index("ude")


def test_toposort_detects_cycle():
    nodes = [
        GraphNodeSpec(id="a", type="mechanistic_seir", inputs=["b"]),
        GraphNodeSpec(id="b", type="neural_ode_ude", inputs=["a"]),
    ]
    with pytest.raises(ValueError):
        _toposort(nodes)


def test_execute_default_graph_returns_ude_output():
    chosen, trace = execute_graph(default_graph_spec(), _ctx())
    assert chosen.node_type == "neural_ode_ude"
    assert {t.node for t in trace} == {"seir", "ude"}
    assert "p50" in chosen.quantiles


def test_execute_single_mechanistic_node():
    spec = GraphSpec(nodes=[GraphNodeSpec(id="seir", type="mechanistic_seir")], output="seir")
    chosen, trace = execute_graph(spec, _ctx())
    assert chosen.kind == "mechanistic"
    assert len(trace) == 1
