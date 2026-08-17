"""Distance decides three things, and each of them can be wrong on its own.

An event that reaches nothing, arrives everywhere at once, or lands hardest
where the data is thinnest all produce a run that finishes cleanly and reads as
a finding. These pin the parts.
"""

from __future__ import annotations

import pytest

from app.events.domain import CareRequirement
from app.events.dynamics import Engine
from app.events.effects import Effect, Event, TemporalProfile
from app.events.geo import Spatial, distance_km
from app.events.ontology import load
from app.events.policy import null_policy
from app.events.templates import care_model_for
from tests.test_events_ontology import export

MONTREAL = (45.5017, -73.5673)
# Due north of Montreal, close enough to 90 km for a front to take three steps
# at 30 km a step.
NORTH_90 = (46.3100, -73.5673)
QUEBEC = (46.8139, -71.2080)


def two_places(a=MONTREAL, b=NORTH_90):
    ex = export()
    ex["facilities"][0]["location"] = list(a) if a else None
    ex["facilities"][1]["location"] = list(b) if b else None
    sizes = {"pop:site-1": 50_000}
    probe = load(
        ex,
        care_model={"_p": CareRequirement(acuity="_p", consumes={})},
        population_sizes=sizes,
        route_capacity=10,
    )
    return load(ex, care_model=care_model_for(probe), population_sizes=sizes, route_capacity=10)


def capacities(effect, ticks, state=None):
    s = state or two_places()
    e = Engine(s, Event(id="ev", horizon=30, effects=[effect]), null_policy(), 0)
    out = []
    for t in ticks:
        e._apply_perturbations(t)
        out.append(
            (
                s.facility("unit-a").resources["lit"].capacity,
                s.facility("unit-b").resources["lit"].capacity if
                "lit" in s.facility("unit-b").resources else 0,
            )
        )
    return out


def flood(**spatial):
    return Effect(
        id="inondation",
        target="resource.capacity",
        op="multiply",
        value=0.0,
        spatial=Spatial(**spatial),
        profile=TemporalProfile(start=0, end=25, shape="step", peak=1.0),
    )


# --- the measurement --------------------------------------------------------


def test_distance_is_great_circle_not_flat() -> None:
    """A health region spans degrees, and the flat error there is the
    difference between a site being inside a radius and outside it."""
    assert distance_km(MONTREAL, QUEBEC) == pytest.approx(233, abs=5)
    assert distance_km(MONTREAL, MONTREAL) == 0


# --- the three jobs ---------------------------------------------------------


def test_a_radius_keeps_the_event_out_of_what_it_does_not_reach() -> None:
    # 90 km away, radius 50: the second site is simply not in it.
    assert capacities(flood(epicentre=MONTREAL, radius_km=50), [0]) == [(0, 30)]


def test_a_front_arrives_later_the_further_out_it_goes() -> None:
    """"Not everywhere at once" without simulating anything travelling.

    90 km at 30 km a step is three steps out, so the far site holds until the
    step the front reaches it — and nothing in the model moved.
    """
    out = capacities(flood(epicentre=MONTREAL, speed_km_per_step=30), [0, 1, 2, 3])
    assert [near for near, _ in out] == [0, 0, 0, 0]
    far = [f for _, f in out]
    assert far[0] == 30 and far[1] == 30
    assert far[2] == 0 and far[3] == 0


def test_without_a_speed_the_whole_area_is_reached_at_once() -> None:
    """Right for a power cut, wrong for a flood — so it is a choice, not a
    default that happens to be one of the two."""
    assert capacities(flood(epicentre=MONTREAL, radius_km=200), [0]) == [(0, 0)]


def test_intensity_falls_off_with_distance() -> None:
    """A blast that is as strong at the edge as at the centre is a radius, not a
    falloff, and the two are different events."""
    e = flood(epicentre=MONTREAL, radius_km=200, falloff="linear")
    assert e.magnitude_for(0, MONTREAL) == pytest.approx(1.0)
    # 90 of 200 km out, so a bit over half the strength survives.
    assert e.magnitude_for(0, NORTH_90) == pytest.approx(0.55, abs=0.05)
    # `steep` spends most of the strength close to the source, so at the same
    # distance less of it survives.
    steep = flood(epicentre=MONTREAL, radius_km=200, falloff="steep")
    assert steep.magnitude_for(0, NORTH_90) < e.magnitude_for(0, NORTH_90)
    # Neither leaves a cliff at the boundary: a radius is where an effect stops,
    # and a falloff that still had half its strength there would make the two
    # settings contradict each other.
    edge = (MONTREAL[0] + 200 / 111.0, MONTREAL[1])
    assert e.magnitude_for(0, edge) == pytest.approx(0.0, abs=0.02)
    assert steep.magnitude_for(0, edge) == pytest.approx(0.0, abs=0.02)


# --- the failure that would be believed -------------------------------------


def test_a_place_with_no_coordinates_is_excluded_not_assumed_central() -> None:
    """Four of the twenty-one units in the real twin carry no location.

    Treating them as ground zero would put the worst of every event exactly
    where the data is thinnest, and the map would look most convincing where it
    knows least.
    """
    s = two_places(a=MONTREAL, b=None)
    assert capacities(flood(epicentre=MONTREAL, radius_km=5000), [0], state=s) == [(0, 30)]


def test_an_epicentre_on_a_placeless_target_is_refused() -> None:
    """Arrivals into a population have no coordinates.

    Accepting an epicentre there and ignoring it would let someone believe the
    event had been narrowed to a district when it had not.
    """
    import pydantic

    with pytest.raises(pydantic.ValidationError, match="has no location"):
        Effect(
            id="x",
            target="demand.incidence",
            op="add",
            value=1.0,
            spatial=Spatial(epicentre=MONTREAL),
        )


def test_geography_reaches_the_objects_too() -> None:
    """One effect can flatten a ward at the epicentre and leave one an hour away
    untouched — the objects carry the change, so distance has to reach them."""
    s = two_places()
    marked = Effect(
        id="contamination",
        target="object.property",
        property_key="status",
        select={"object_type": ["Lit"]},
        op="set",
        value="occupied",
        spatial=Spatial(epicentre=MONTREAL, radius_km=50),
        profile=TemporalProfile(start=0, end=20, shape="step", peak=1.0),
    )
    e = Engine(s, Event(id="ev", horizon=20, effects=[marked]), null_policy(), 0)
    e._apply_perturbations(1)
    assert s.facility("unit-a").resources["lit"].quantity == 0
    # 90 km out, radius 50: its beds are untouched.
    assert s.facility("unit-b").resources["lit"].quantity == 30
