from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _find(concepts: list, substring: str) -> dict:
    for c in concepts:
        if substring.lower() in c["span"].lower():
            return c
    raise AssertionError(f"No concept span matching {substring!r}: {[c['span'] for c in concepts]}")


def test_extract_concepts_tremblay(tremblay_note: dict) -> None:
    r = client.post("/extract/concepts", json=tremblay_note)
    assert r.status_code == 200
    concepts = r.json()["concepts"]
    assert len(concepts) >= 6

    chest = _find(concepts, "douleur thoracique")
    assert chest["code"] == "29857009"
    assert chest["status"] == "resolved"
    assert chest["margin"] >= 0.1

    dyspnea = _find(concepts, "essoufflement")
    assert dyspnea["code"] == "267036007"
    assert dyspnea["status"] == "resolved"

    dm = _find(concepts, "diabète")
    assert dm["code"] == "44054006"

    pen = _find(concepts, "pénicilline")
    assert pen["code"] == "294505008"

    potassium = _find(concepts, "potassium")
    assert potassium["code"] == "14140009"
    assert potassium["status"] == "flag"
    assert potassium["margin"] < 0.15


def test_no_spans_returns_empty() -> None:
    r = client.post(
        "/extract/concepts",
        json={"text": "xyzunknown foobar condition", "language": "en"},
    )
    assert r.status_code == 200
    assert r.json()["concepts"] == []


def test_flag_low_margin() -> None:
    r = client.post(
        "/extract/concepts",
        json={"text": "Potassium à 5,9 hémolysé", "language": "fr"},
    )
    assert r.status_code == 200
    concepts = r.json()["concepts"]
    assert any(c["status"] == "flag" for c in concepts)
