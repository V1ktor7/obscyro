from app.contacts import build_contact_graph
from app.mechanistic import mulberry32, run_ensemble, run_single
from app.schemas import GraphLink, GraphNode, GraphPayload


def _ring(n: int = 20) -> GraphPayload:
    nodes = [GraphNode(id=f"p{i}", type="Person", properties={}) for i in range(n)]
    nodes.append(GraphNode(id="u", type="OrgUnit", properties={"kind": "ward"}))
    links = []
    for i in range(n):
        links.append(GraphLink(linkTypeName="contact", fromId=f"p{i}", toId=f"p{(i + 1) % n}"))
        links.append(GraphLink(linkTypeName="located_in", fromId=f"p{i}", toId="u"))
    return GraphPayload(nodes=nodes, links=links)


def test_mulberry32_is_deterministic():
    a = mulberry32(42)
    b = mulberry32(42)
    seq_a = [a() for _ in range(5)]
    seq_b = [b() for _ in range(5)]
    assert seq_a == seq_b
    assert all(0.0 <= x < 1.0 for x in seq_a)


def test_single_run_is_reproducible_for_same_seed():
    graph = build_contact_graph(_ring())
    params = {"r0": 3.0, "infectiousDays": 6, "incubationDays": 3, "horizonDays": 40}
    r1 = run_single(graph, params, mulberry32(123))
    r2 = run_single(graph, params, mulberry32(123))
    assert [d["I"] for d in r1.daily] == [d["I"] for d in r2.daily]


def test_ensemble_same_seed_same_summary():
    graph = build_contact_graph(_ring())
    params = {"r0": 3.0, "infectiousDays": 6, "horizonDays": 40, "runs": 10}
    a = run_ensemble(graph, params, 7, 10)
    b = run_ensemble(graph, params, 7, 10)
    assert a[1] == b[1]  # summaries identical


def test_outbreak_grows_with_transmissible_params():
    graph = build_contact_graph(_ring(30))
    params = {"r0": 4.0, "infectiousDays": 8, "incubationDays": 2, "horizonDays": 60}
    res = run_single(graph, params, mulberry32(1))
    assert res.summary["peakInfected"] >= 1
    assert 0.0 <= res.summary["attackRate"] <= 1.0


def test_unit_tracking_populates_predicted_metrics():
    graph = build_contact_graph(_ring(25))
    params = {"r0": 4.0, "infectiousDays": 8, "horizonDays": 60}
    res = run_single(graph, params, mulberry32(2), track_units=True)
    assert "u" in res.unit_infected
    assert res.unit_infected["u"]["cumulativeInfected"] >= 1
