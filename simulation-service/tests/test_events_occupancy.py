"""Where a run starts, and what opening beds does.

Two failures that complete cleanly and flatter the network. A hospital that
meets a wave empty reports a comfortable peak where the real one overflowed; and
capacity added by an event that nobody can be admitted to makes "open fifty
beds" a decision with no consequence. Both produced plausible numbers, which is
why each has a test that reads the queue rather than the ceiling.
"""

from __future__ import annotations

import pytest

from app.events.domain import CareRequirement
from app.events.dynamics import Engine
from app.events.effects import Effect, Event, TemporalProfile
from app.events.ontology import load
from app.events.templates import POLICIES

ALWAYS = TemporalProfile(start=0, end=None, shape="step", peak=1.0)
CARE = {"hosp": CareRequirement(acuity="hosp", consumes={"lit": 1}, stay_ticks=10, mortality_per_unmet=0)}


def export(beds: dict[str, int], marked: dict[str, int] | None = None) -> dict:
    objects = []
    for site, n in beds.items():
        for i in range(n):
            props: dict = {"label": f"{site}-{i}"}
            if i < (marked or {}).get(site, 0):
                props["status"] = "occupied"
            objects.append({"id": f"{site}-lit-{i:04d}", "type": "Lit", "role": "space", "properties": props, "at": site})
    return {
        "environment": "test",
        "generated_at": "2026-11-13T00:00:00Z",
        "facilities": [{"id": site, "name": site, "location": [45.5, -73.5]} for site in beds],
        "objects": objects,
        "object_rules": {"unavailable_keys": ["status"], "unavailable_values": ["occupied"]},
        "populations": [{"id": "pop", "name": "Ville", "size": 100_000, "served_by": list(beds)}],
        "edges": [],
        "gaps": [],
    }


def arrivals(per_step: float) -> Effect:
    return Effect(
        id="arrivals", target="demand.volume", select={"population": ["pop"], "acuity": ["hosp"]},
        op="add", value=per_step, profile=ALWAYS,
    )


def run(ex: dict, effects: list[Effect], horizon: int = 30, **holes):
    state = load(ex, care_model=CARE, population_sizes={"pop": 100_000}, route_capacity=10, **holes)
    return Engine(state, Event(id="e", name="e", horizon=horizon, effects=effects), POLICIES["null"](state), 0).run()


def waiting(trajectory, tick: int) -> float:
    return sum(v.get("lit", 0.0) for v in trajectory.ticks[tick].waiting.values())


# --- the usual occupancy ---------------------------------------------------------


def test_every_site_starts_at_its_usual_occupancy() -> None:
    tr = run(export({"a": 200, "b": 40}), [], baseline_occupancy={"lit": 0.85})
    for site in ("a", "b"):
        assert tr.ticks[0].occupancy[site]["lit"] == pytest.approx(0.85)


def test_the_usual_occupancy_is_never_discharged() -> None:
    """They are not patients of the run, so the run does not send them home."""
    tr = run(export({"a": 200}), [], horizon=40, baseline_occupancy={"lit": 0.85})
    assert tr.ticks[39].occupancy["a"]["lit"] == pytest.approx(0.85)


def test_a_wave_meets_a_network_that_is_already_nearly_full() -> None:
    """Ten arrivals a step staying ten steps is a hundred beds: half of an empty
    two-hundred-bed hospital, and far more than the thirty left at 85 %."""
    empty = run(export({"a": 200}), [arrivals(10)])
    usual = run(export({"a": 200}), [arrivals(10)], baseline_occupancy={"lit": 0.85})
    assert waiting(empty, 29) == 0
    assert max(t.occupancy["a"]["lit"] for t in empty.ticks) < 0.7
    assert usual.ticks[29].occupancy["a"]["lit"] == pytest.approx(1.0)
    assert waiting(usual, 29) > 100


def test_beds_the_twin_already_marks_count_toward_the_share() -> None:
    """A floor, not an addition: 150 marked of 200 is 75 %, raised to 85 %, and a
    site already above the share keeps its own figure."""
    tr = run(export({"a": 200, "b": 100}, marked={"a": 150, "b": 95}), [], baseline_occupancy={"lit": 0.85})
    assert tr.ticks[0].occupancy["a"]["lit"] == pytest.approx(0.85)
    assert tr.ticks[0].occupancy["b"]["lit"] == pytest.approx(0.95)


def test_an_effect_on_the_ward_does_not_hand_the_usual_occupancy_back() -> None:
    """Object effects rebuild a ward from its instances, and no instance says
    which beds the usual patients are in."""
    closes_ten = Effect(
        id="closed", target="object.property", select={"object_type": ["Lit"], "facility": ["a"]},
        property_key="status", op="set", value="occupied", reach=10,
        profile=TemporalProfile(start=2, end=5, shape="step", peak=1.0),
    )
    tr = run(export({"a": 200}), [closes_ten], horizon=10, baseline_occupancy={"lit": 0.85})
    assert tr.ticks[1].occupancy["a"]["lit"] == pytest.approx(0.85)
    assert tr.ticks[3].occupancy["a"]["lit"] == pytest.approx(0.90)
    assert tr.ticks[8].occupancy["a"]["lit"] == pytest.approx(0.85)


def test_a_share_that_cannot_mean_anything_is_refused() -> None:
    with pytest.raises(ValueError, match="from 0 to 1"):
        run(export({"a": 20}), [], baseline_occupancy={"lit": 85})
    with pytest.raises(ValueError, match="no site provides"):
        run(export({"a": 20}), [], baseline_occupancy={"civiere": 0.5})


def test_no_share_changes_nothing() -> None:
    plain = run(export({"a": 200}), [arrivals(10)])
    explicit = run(export({"a": 200}), [arrivals(10)], baseline_occupancy=None)
    assert [t.occupancy for t in plain.ticks] == [t.occupancy for t in explicit.ticks]


# --- capacity an event adds --------------------------------------------------------


def test_beds_opened_by_an_event_can_be_admitted_to() -> None:
    """Twenty arrivals a step against a hundred beds is a queue from the fifth
    step. Fifty more beds from step 10 must take patients, not merely raise the
    ceiling the same queue is measured against."""
    opens = Effect(
        id="wing", target="resource.capacity", select={"facility": ["a"], "activity": ["lit"]},
        op="add", value=50, profile=TemporalProfile(start=10, end=None, shape="step", peak=1.0),
    )
    without = run(export({"a": 100}), [arrivals(20)], horizon=20)
    with_wing = run(export({"a": 100}), [arrivals(20), opens], horizon=20)
    assert waiting(with_wing, 9) == pytest.approx(waiting(without, 9))
    assert waiting(with_wing, 10) < waiting(without, 10) - 40
    assert sum(t.served.get("hosp", 0) for t in with_wing.ticks) > sum(t.served.get("hosp", 0) for t in without.ticks) + 50


def test_opened_beds_arrive_empty_once() -> None:
    """The gain is counted when it opens, not again on every step it stays open."""
    opens = Effect(
        id="wing", target="resource.capacity", select={"facility": ["a"], "activity": ["lit"]},
        op="add", value=50, profile=TemporalProfile(start=2, end=None, shape="step", peak=1.0),
    )
    tr = run(export({"a": 100}), [opens], horizon=8)
    assert [round(t.occupancy["a"]["lit"], 6) for t in tr.ticks] == [0.0] * 8


def test_beds_open_on_top_of_the_usual_occupancy() -> None:
    """85 of 100 held, fifty opened: 85 of 150 in use, and fifty to admit to."""
    opens = Effect(
        id="wing", target="resource.capacity", select={"facility": ["a"], "activity": ["lit"]},
        op="add", value=50, profile=ALWAYS,
    )
    tr = run(export({"a": 100}), [opens], horizon=3, baseline_occupancy={"lit": 0.85})
    assert tr.ticks[0].occupancy["a"]["lit"] == pytest.approx(85 / 150)


def test_a_capacity_cut_still_behaves_as_it_did() -> None:
    """Only gains above the usual capacity changed; a cut and its recovery are
    left exactly as they were."""
    cut = Effect(
        id="cut", target="resource.capacity", select={"facility": ["a"], "activity": ["lit"]},
        op="multiply", value=0.5, profile=TemporalProfile(start=2, end=4, shape="step", peak=1.0),
    )
    tr = run(export({"a": 100}), [cut], horizon=8)
    assert [round(t.occupancy["a"]["lit"], 6) for t in tr.ticks] == [0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5]
