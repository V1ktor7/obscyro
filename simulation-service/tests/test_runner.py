"""End-to-end DB-free contract test for the /simulate orchestration."""

from app.runner import simulate
from app.schemas import (
    GraphLink,
    GraphNode,
    GraphPayload,
    Intervention,
    OutbreakParams,
    SimulateRequest,
)


def _payload(n: int = 24) -> GraphPayload:
    nodes = [GraphNode(id=f"p{i}", type="Person", properties={}) for i in range(n)]
    nodes.append(GraphNode(id="u", type="OrgUnit", properties={"kind": "ward"}))
    links = []
    for i in range(n):
        links.append(GraphLink(linkTypeName="contact", fromId=f"p{i}", toId=f"p{(i + 1) % n}"))
        links.append(GraphLink(linkTypeName="located_in", fromId=f"p{i}", toId="u"))
    return GraphPayload(nodes=nodes, links=links)


def test_simulate_returns_full_contract():
    req = SimulateRequest(
        seed=5,
        graph=_payload(),
        params=OutbreakParams(r0=3.0, infectiousDays=6, horizonDays=40, runs=12),
    )
    res = simulate(req)
    assert res.engine == "ml"
    assert len(res.quantiles.p50) == 41  # day 0..40 inclusive
    assert len(res.baseline.p50) == 41
    assert res.ml_baseline_error.rmse >= 0.0
    assert res.feature_importances
    assert abs(sum(fi.importance for fi in res.feature_importances) - 1.0) < 1e-6
    # Predicted properties projected onto the OrgUnit.
    assert any(p.instanceId == "u" for p in res.predicted_properties)


def test_simulate_is_reproducible():
    req = SimulateRequest(seed=11, graph=_payload(), params=OutbreakParams(r0=3.2, horizonDays=30, runs=8))
    a = simulate(req)
    b = simulate(req)
    assert [d.I for d in a.quantiles.p50] == [d.I for d in b.quantiles.p50]


def test_close_unit_intervention_reduces_or_equals_spread():
    base = simulate(
        SimulateRequest(seed=3, graph=_payload(), params=OutbreakParams(r0=4.0, horizonDays=50, runs=12))
    )
    closed = simulate(
        SimulateRequest(
            seed=3,
            graph=_payload(),
            params=OutbreakParams(r0=4.0, horizonDays=50, runs=12),
            intervention=Intervention(kind="close_unit", unitId="u"),
        )
    )
    # Cohorting the unit removes contact edges, so peak should not increase.
    assert closed.summary.peakInfected <= base.summary.peakInfected
