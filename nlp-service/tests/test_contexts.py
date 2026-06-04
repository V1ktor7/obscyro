from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_extract_contexts_tremblay(tremblay_note: dict) -> None:
    cr = client.post("/extract/concepts", json=tremblay_note)
    assert cr.status_code == 200
    concepts = [{"span": c["span"], "code": c["code"]} for c in cr.json()["concepts"]]

    r = client.post(
        "/extract/contexts",
        json={
            "text": tremblay_note["text"],
            "language": "fr",
            "concepts": concepts,
        },
    )
    assert r.status_code == 200
    contexts = {c["span"]: c for c in r.json()["contexts"]}

    dysp = next(c for c in contexts.values() if "essoufflement" in c["span"].lower())
    assert dysp["context"]["assertion"]["value"] == "negated"
    assert dysp["context"]["assertion"]["trigger"] is not None

    father = next(
        c for c in contexts.values() if "père" in c["span"].lower() or "infarctus" in c["span"].lower() and "père" in c["span"]
    )
    assert father["context"]["subject"]["value"] == "family"

    rule_out = next(
        c for c in contexts.values() if "écarter" in c["span"].lower()
    )
    assert rule_out["context"]["assertion"]["value"] in ("uncertain", "negated")
    assert rule_out["context"]["certainty"]["value"] == "differential"

    pen = next(c for c in contexts.values() if "pénicilline" in c["span"].lower())
    assert pen["context"]["assertion"]["value"] == "negated"


def test_extract_combined(tremblay_note: dict) -> None:
    r = client.post(
        "/extract",
        json={**tremblay_note, "destination": "problem_list"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["destination"] == "problem_list"
    assert len(body["results"]) >= 6
    escalated = [x for x in body["results"] if x["decision"] == "escalate"]
    assert any("potassium" in x["span"].lower() or "écarter" in x["span"].lower() for x in escalated)
