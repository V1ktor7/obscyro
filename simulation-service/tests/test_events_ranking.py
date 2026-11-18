"""How responses are ranked against each other.

The ranking used to be one weighted sum: a death, and a dollar at two millionths
of one. On a twin whose care model declares no deaths every response tied on the
first term, so the order was the order of their cost — and doing nothing, which
costs nothing, came first every time, whatever it left undelivered. It read as a
recommendation and was an artefact of a weight nobody had chosen.

Ranked now on counts in order: deaths, then care not delivered, then cost.
"""

from __future__ import annotations

import pytest

from app.events.api import RANK_BY, CompareRequest, compare_route
from app.events.domain import CareRequirement
from app.events.effects import Effect, Event, TemporalProfile
from app.events.harness import TIE, compare, decided_by, rank
from app.events.ontology import OntologyExport, load
from app.events.scoring import Objective
from app.events.templates import POLICIES

ALWAYS = TemporalProfile(start=0, end=None, shape="step", peak=1.0)


def row(policy: str, deaths: float, unmet: float, cost: float) -> dict:
    return {"policy": policy, "excess_deaths": deaths, "unmet_care": unmet, "response_cost": cost}


def order(rows: list[dict]) -> list[str]:
    return [r["policy"] for r in rows]


# --- the rule ----------------------------------------------------------------------


def test_deaths_come_first_whatever_the_rest_says() -> None:
    rows = [row("nothing", 12, 0, 0), row("costly", 3, 900, 5_000_000), row("middling", 7, 10, 100)]
    assert order(rank(rows, RANK_BY)) == ["costly", "middling", "nothing"]


def test_level_on_deaths_the_care_not_delivered_decides() -> None:
    rows = [row("nothing", 0, 25_561, 0), row("transfers", 0, 14_186, 56_000), row("surge", 0, 14_186, 757_000)]
    ranked = rank(rows, RANK_BY)
    # Doing nothing is free and leaves the most undelivered: last, not first.
    assert order(ranked) == ["transfers", "surge", "nothing"]
    assert decided_by(ranked, RANK_BY) == "response_cost"


def test_a_gap_under_half_a_person_is_not_a_gap() -> None:
    assert TIE == 0.5
    rows = [row("a", 3.4, 100, 0), row("b", 3.0, 500, 0)]
    # 0.4 of a death apart: level, so the care not delivered decides.
    assert order(rank(rows, RANK_BY)) == ["a", "b"]
    rows = [row("a", 3.6, 100, 0), row("b", 3.0, 500, 0)]
    assert order(rank(rows, RANK_BY)) == ["b", "a"]


def test_level_is_judged_against_the_neighbour() -> None:
    """Three responses a third of a death apart are one group, not two."""
    rows = [row("a", 1.0, 30, 0), row("b", 1.4, 20, 0), row("c", 1.8, 10, 0)]
    assert order(rank(rows, RANK_BY)) == ["c", "b", "a"]


def test_level_on_everything_keeps_the_order_given_and_names_no_winner() -> None:
    rows = [row("nothing", 0, 100, 0), row("other", 0, 100.2, 0.3)]
    ranked = rank(rows, RANK_BY)
    assert order(ranked) == ["nothing", "other"]
    assert decided_by(ranked, RANK_BY) is None
    assert decided_by(ranked[:1], RANK_BY) is None


def test_the_count_that_decided_first_place_is_named() -> None:
    assert decided_by(rank([row("a", 5, 0, 0), row("b", 2, 0, 0)], RANK_BY), RANK_BY) == "excess_deaths"
    assert decided_by(rank([row("a", 0, 90, 0), row("b", 0, 20, 9)], RANK_BY), RANK_BY) == "unmet_care"


def test_a_missing_count_reads_as_zero_rather_than_failing() -> None:
    rows = [{"policy": "a", "excess_deaths": 2}, {"policy": "b"}]
    assert order(rank(rows, RANK_BY)) == ["b", "a"]


# --- on a run ----------------------------------------------------------------------


def export(beds: int) -> dict:
    return {
        "environment": "test",
        "generated_at": "2026-11-13T00:00:00Z",
        "facilities": [{"id": "a", "name": "a", "location": [45.5, -73.5]}],
        "objects": [
            {"id": f"a-lit-{i:04d}", "type": "Lit", "role": "space", "properties": {"label": f"a-{i}"}, "at": "a"}
            for i in range(beds)
        ],
        "object_rules": {"unavailable_keys": ["status"], "unavailable_values": ["occupied"]},
        "populations": [{"id": "pop", "name": "Ville", "size": 100_000, "served_by": ["a"]}],
        "edges": [],
        "gaps": [],
    }


#: Nobody dies of waiting in this care model: the case the old ranking got wrong.
NO_DEATHS = {"hosp": CareRequirement(acuity="hosp", consumes={"lit": 1}, stay_ticks=10, mortality_per_unmet=0)}
WAVE = [
    Effect(id="arrivals", target="demand.volume", select={"population": ["pop"], "acuity": ["hosp"]}, op="add", value=20, profile=ALWAYS)
]


def test_with_no_deaths_declared_doing_nothing_no_longer_wins_on_price() -> None:
    state = load(export(100), care_model=NO_DEATHS, population_sizes={"pop": 100_000}, route_capacity=10)
    event = Event(id="e", name="e", horizon=30, effects=WAVE)
    policies = [POLICIES["null"](state), POLICIES["surge-and-balance"](state)]
    objective = Objective(weights={"excess_deaths": 1.0, "response_cost": 0.000002})

    by_score = compare(state, event, policies, objective)
    # The old rule: level on deaths, so the cheaper one wins — though it leaves
    # far more care undelivered.
    assert order(by_score) == ["null", "surge-and-balance"]
    assert by_score[0]["excess_deaths"] == by_score[1]["excess_deaths"] == 0
    assert by_score[0]["unmet_care"] > by_score[1]["unmet_care"] + 100
    assert by_score[0]["response_cost"] == 0 < by_score[1]["response_cost"]

    ranked = compare(state, event, policies, objective, rank_by=RANK_BY)
    assert order(ranked) == ["surge-and-balance", "null"]
    assert decided_by(ranked, RANK_BY) == "unmet_care"
    # The same runs, the same figures: only the order changed.
    assert {r["policy"]: r["unmet_care"] for r in ranked} == {r["policy"]: r["unmet_care"] for r in by_score}


def test_the_endpoint_says_how_it_ranked() -> None:
    req = CompareRequest(
        system=OntologyExport.model_validate(export(100)),
        event=Event(
            id="e", name="e", horizon=30,
            # No severity named: the care model here is the engine's default one.
            effects=[Effect(id="arrivals", target="demand.volume", select={"population": ["pop"]}, op="add", value=20, profile=ALWAYS)],
        ),
        policies=["null", "surge-and-balance"],
        population_sizes={"pop": 100_000},
        route_capacity=10,
        mortality=0,
    )
    res = compare_route(req)
    assert res.ranking["by"] == ["excess_deaths", "unmet_care", "response_cost"]
    assert res.ranking["tie_below"] == pytest.approx(0.5)
    assert all(r["excess_deaths"] == 0 for r in res.rows)
    # Whoever is first is first for a stated reason, or nobody is.
    first, second = res.rows[0], res.rows[1]
    decided = res.ranking["decided_by"]
    if decided is None:
        assert all(abs(first[k] - second[k]) <= 0.5 for k in RANK_BY)
    else:
        assert second[decided] - first[decided] > 0.5
    # And doing nothing is not first merely for being free.
    if first["policy"] == "null":
        assert first["unmet_care"] <= second["unmet_care"] + 0.5
