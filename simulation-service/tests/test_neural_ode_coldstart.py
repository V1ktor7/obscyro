"""UDE cold-start equivalence: with no trained artifact, the UDE node must return
exactly the mechanistic baseline (zero-residual reduces to mechanistic SEIR).
CPU-only; does not require torch.
"""

from app.contacts import build_contact_graph
from app.graph import execute_graph
from app.models.base import SimContext
from app.models.mechanistic_node import MechanisticNode
from app.models.neural_ode import NeuralOdeNode
from app.schemas import GraphLink, GraphNode, GraphNodeSpec, GraphPayload, GraphSpec


def _graph() -> GraphPayload:
    nodes = [GraphNode(id=f"p{i}", type="Person", properties={}) for i in range(18)]
    links = [GraphLink(linkTypeName="contact", fromId=f"p{i}", toId=f"p{(i + 1) % 18}") for i in range(18)]
    return GraphPayload(nodes=nodes, links=links)


def _ctx() -> SimContext:
    return SimContext(
        graph=build_contact_graph(_graph()),
        params={"r0": 3.5, "infectiousDays": 7, "horizonDays": 40},
        seed=99,
        runs=12,
        horizon=40,
    )


def test_ude_coldstart_equals_mechanistic():
    ctx = _ctx()
    mech = MechanisticNode().run(ctx, GraphNodeSpec(id="seir", type="mechanistic_seir"))
    ctx.outputs["seir"] = mech
    ude = NeuralOdeNode().run(ctx, GraphNodeSpec(id="ude", type="neural_ode_ude", inputs=["seir"]))

    assert ude.fallback is True
    assert "cold-start" in (ude.fallback_reason or "")
    assert ude.quantiles["p50"] == mech.quantiles["p50"]
    assert ude.summary == mech.summary


def test_full_dag_coldstart_matches_baseline():
    spec = GraphSpec(
        nodes=[
            GraphNodeSpec(id="seir", type="mechanistic_seir"),
            GraphNodeSpec(id="ude", type="neural_ode_ude", inputs=["seir"]),
        ],
        output="ude",
    )
    ctx = _ctx()
    chosen, _ = execute_graph(spec, ctx)
    baseline = ctx.outputs["seir"]
    assert chosen.quantiles["p50"] == baseline.quantiles["p50"]
