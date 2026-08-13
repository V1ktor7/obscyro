"""The bridge from a real twin to a runnable world.

Every test here guards a failure that produces a *believable* answer rather than
an error — a table of zeroes, a policy that ties with doing nothing, a
catastrophe caused by a spelling difference. Those are the ones that get quoted
in a meeting.
"""

from __future__ import annotations

import pytest

from app.crisis.domain import SPACE, STAFF
from app.crisis.ontology import UnrunnableExport, load
from app.crisis.templates import POLICIES, SCENARIOS, care_model_for


def export(**over) -> dict:
    """A two-unit twin shaped exactly like the backend's export."""
    base = {
        "environment": "prod",
        "generated_at": "2026-08-12T00:00:00Z",
        "facilities": [
            {
                "id": "unit-a",
                "name": "Urgence",
                "location": [45.5, -73.5],
                "resources": {
                    "lit": {"id": "lit", "category": SPACE, "quantity": 20,
                            "capacity": 48, "enables": ["lit"]},
                    "infirmiere": {"id": "infirmiere", "category": STAFF, "quantity": 12,
                                   "capacity": 12, "enables": ["infirmiere"]},
                },
                "census": {"patient": 28},
            },
            {
                "id": "unit-b",
                "name": "Médecine",
                "location": None,
                "resources": {
                    "lit": {"id": "lit", "category": SPACE, "quantity": 30,
                            "capacity": 30, "enables": ["lit"]},
                },
                "census": {},
            },
        ],
        "populations": [
            {"id": "pop:site-1", "name": "Notre-Dame", "size": 0,
             "served_by": ["unit-a", "unit-b"]},
        ],
        "edges": [
            {"source": "unit-a", "target": "unit-b", "kind": "transfer",
             "capacity": 0, "via": "transfer_to"},
        ],
        "gaps": [],
    }
    base.update(over)
    return base


def runnable(**over):
    ex = export(**over)
    probe = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 50_000},
                 route_capacity=10)
    return load(ex, care_model=care_model_for(probe),
                population_sizes={"pop:site-1": 50_000}, route_capacity=10)


def _any_model():
    from app.crisis.domain import CareRequirement

    return {"_probe": CareRequirement(acuity="_probe", consumes={})}


# --- the twin arrives intact ------------------------------------------------


def test_the_ontology_names_survive_the_crossing() -> None:
    """A French twin needs no translation table.

    The engine matches demand against activities, so `lit` has to stay `lit` all
    the way through. If anything in the loader normalised it to `bed`, every
    patient would go unserved and the model would report a massacre caused by a
    dictionary.
    """
    s = runnable()
    assert s.available_for("unit-a", "lit") == 20
    assert s.capacity_of("unit-a", activity="lit") == 48
    assert s.facility("unit-a").location == (45.5, -73.5)


def test_occupied_beds_arrive_occupied() -> None:
    """48 beds with 28 taken must not start the run as 48 free ones.

    An export that reset occupancy would flatter every policy by the same 28
    beds and rank them wrongly — the crisis would begin in a hospital that does
    not exist.
    """
    s = runnable()
    assert s.occupancy_ratio("unit-a", activity="lit") == pytest.approx(28 / 48)


def test_census_is_left_out_unless_an_acuity_is_named() -> None:
    """Who the current patients are is an assumption, so it is the caller's.

    Left unnamed they simply hold their beds forever; named, they are admitted
    at that acuity and will eventually discharge and free capacity. Both are
    defensible; picking one silently is not.
    """
    assert runnable().census == {}
    ex = export()
    s = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 1},
             route_capacity=1, census_acuity="routine")
    assert s.census["unit-a"]["routine"] == 28


# --- the refusals -----------------------------------------------------------


def test_a_twin_with_no_capacity_is_refused() -> None:
    """The quiet failure this whole module exists to prevent.

    No object type carries a crisis role, so nothing has capacity, so nobody can
    be turned away, so nobody dies and every policy scores zero. The table looks
    perfect and means nothing.
    """
    hollow = export(facilities=[
        {"id": "unit-a", "name": "Urgence", "location": None, "resources": {}, "census": {}},
    ])
    with pytest.raises(UnrunnableExport, match="crisis role"):
        load(hollow, care_model=_any_model(), population_sizes={"pop:site-1": 10})


def test_a_twin_with_no_catchment_is_refused() -> None:
    with pytest.raises(UnrunnableExport, match="size 0"):
        load(export(), care_model=_any_model())


def test_a_care_model_nothing_provides_is_refused() -> None:
    """A naming mismatch must not be reported as a shortage.

    If the scenario asks for `icu_bed` and the twin offers `lit`, every patient
    goes unserved. That is indistinguishable from a real collapse unless
    somebody checks, and nobody checks a number that confirms their fears.
    """
    from app.crisis.domain import CareRequirement

    mismatched = {"critical": CareRequirement(acuity="critical", consumes={"icu_bed": 1.0})}
    with pytest.raises(UnrunnableExport, match="naming mismatch"):
        load(export(), care_model=mismatched, population_sizes={"pop:site-1": 50_000})


def test_edges_to_nowhere_are_dropped() -> None:
    """A route into a non-facility would be a hole patients fall into."""
    ex = export(edges=[
        {"source": "unit-a", "target": "ghost", "kind": "transfer", "capacity": 5, "via": "x"},
    ])
    s = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 10}, route_capacity=5)
    assert s.network.all_edges() == []


# --- the templates fit whatever they are given ------------------------------


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_every_crisis_template_targets_real_ids(name: str) -> None:
    """Templates exist because a real twin names its wards with UUIDs.

    A perturbation aimed at a facility that is not there is silently inert: the
    run completes, nothing happens, and the crisis appears to have been survived.
    """
    s = runnable()
    scenario = SCENARIOS[name](s)
    assert scenario.perturbations, f"{name} produced no perturbation"
    for p in scenario.perturbations:
        for fid in getattr(p, "facilities", []):
            assert fid in s.facilities
        for pid in getattr(p, "targets", []):
            assert pid in s.populations


def test_a_policy_template_reads_the_real_network() -> None:
    s = runnable()
    lb = POLICIES["load-balance"](s)
    assert [r.action.source for r in lb.rules] == ["unit-a"]
    assert [r.action.target for r in lb.rules] == ["unit-b"]


def test_a_network_with_no_routes_yields_a_policy_with_no_rules() -> None:
    """Truthful, not an error: nothing can be transferred, so nothing is."""
    ex = export(edges=[])
    probe = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 50_000})
    s = load(ex, care_model=care_model_for(probe), population_sizes={"pop:site-1": 50_000})
    assert POLICIES["load-balance"](s).rules == []


def test_the_care_model_only_requires_what_every_unit_has() -> None:
    """One unit has nurses and the other does not, so nursing is left out.

    A global care model is applied at every facility, so requiring a nurse makes
    the unit that has none unable to treat anybody — `servable` is capped by the
    scarcest input and the scarcest input is zero. That unit then reads as a
    death trap and transfers into it kill people, because of a missing
    declaration rather than a missing nurse.
    """
    s = runnable()
    model = care_model_for(s)
    assert set(model) == {"critical", "urgent", "routine"}
    assert model["critical"].consumes == {"lit": 1.0}


def test_staff_is_required_once_every_unit_has_some() -> None:
    ex = export()
    ex["facilities"][1]["resources"]["infirmiere"] = {
        "id": "infirmiere", "category": STAFF, "quantity": 6,
        "capacity": 6, "enables": ["infirmiere"],
    }
    probe = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 50_000})
    assert "infirmiere" in care_model_for(probe)["critical"].consumes


def test_routine_deaths_are_not_zero() -> None:
    """Otherwise every optimiser learns to abandon routine care for free."""
    assert care_model_for(runnable())["routine"].mortality_per_unmet > 0


# --- the defects the first real twin surfaced -------------------------------


def test_the_dead_leave_the_queue() -> None:
    """Otherwise one unserved patient dies again every tick, forever.

    The toll is then bounded by the horizon rather than by how many people
    arrived, the backlog becomes a debt no response can pay down, and every
    policy scores within a rounding error of doing nothing — which is exactly
    what the first run against a real twin produced.
    """
    from app.crisis.dynamics import run

    s = runnable()
    scenario = SCENARIOS["pandemic"](s)
    t = run(s, scenario, POLICIES["null"](s), seed=0)
    arrived = sum(sum(x.arrivals.values()) for x in t.ticks)
    assert 0 < t.deaths <= arrived


def test_a_transfer_moves_the_sickest_not_the_longest_queue() -> None:
    """Sending routine cases down the only road out kills the critical ones.

    They take the beds at the far end, and the critical patients they displace
    there die — so the policy scores *worse* than doing nothing while its trace
    shows a rule firing and patients moving, which reads as working.
    """
    from app.crisis.dynamics import _transfer
    from app.crisis.policy import Action, Friction

    s = runnable()
    s.backlog["unit-a"] = {"routine": 100.0, "critical": 4.0}
    moved = _transfer(
        s,
        Action(kind="transfer", source="unit-a", target="unit-b", amount=10,
               friction=Friction(effectiveness=1.0)),
        engine=None,  # type: ignore[arg-type]
    )
    assert moved == 4.0
    assert s.backlog["unit-b"] == {"critical": 4.0}


def test_surging_follows_the_constraint_as_it_moves() -> None:
    """A ward short of nurses that becomes short of beds must stop hiring nurses.

    Choosing the binding constraint once, when the policy is built, spent 1.2 M
    on nurses at a facility that had been bed-bound for forty ticks — and the
    trace looked healthy the whole time.
    """
    s = runnable()
    surging = [r for r in POLICIES["surge-and-balance"](s).rules
               if r.action.kind == "surge_resource" and r.action.target == "unit-a"]
    assert {r.action.resource for r in surging} == {"lit", "infirmiere"}


# --- events composed by hand ------------------------------------------------


def test_an_event_can_remove_demand_as_well_as_add_it() -> None:
    """A vaccination campaign is a fact about the world, not a response.

    With demand pinned non-negative the only expressible events are ones that
    make things worse, and anything protective has to masquerade as a policy —
    which then shows up in the response cost and gets ranked against the very
    thing it is not.
    """
    from app.crisis.events import DemandPerturbation, Scenario, TemporalProfile

    wave = DemandPerturbation(
        id="wave", targets=["p"], acuity_mix={"critical": 1.0}, volume=100,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    vaccination = DemandPerturbation(
        id="vaccination", targets=["p"], acuity_mix={"critical": 1.0}, volume=-40,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    assert Scenario(id="s", perturbations=[wave]).demand(2)[("p", "critical")] == 100
    net = Scenario(id="s", perturbations=[wave, vaccination]).demand(2)
    assert net[("p", "critical")] == 60


def test_prevention_cannot_go_below_zero_arrivals() -> None:
    """Otherwise a facility carries a negative queue that later swallows real
    patients, and the run reports fewer arrivals than actually happened."""
    from app.crisis.events import DemandPerturbation, Scenario, TemporalProfile

    over = DemandPerturbation(
        id="over", targets=["p"], acuity_mix={"critical": 1.0}, volume=-500,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    small = DemandPerturbation(
        id="small", targets=["p"], acuity_mix={"critical": 1.0}, volume=10,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    assert Scenario(id="s", perturbations=[small, over]).demand(2) == {}


def test_an_effect_is_parsed_as_the_kind_it_declares() -> None:
    """The three share enough fields to be confused over the wire.

    A capacity effect read as connectivity would apply to nothing at all, and
    the run would simply look uneventful.
    """
    from app.crisis.events import CapacityPerturbation, Scenario

    s = Scenario.model_validate({
        "id": "e",
        "perturbations": [
            {"id": "c", "kind": "capacity", "facilities": ["unit-a"], "category": SPACE,
             "multiplier": 0.5, "profile": {"start": 1, "end": 5, "shape": "step", "peak": 1.0}},
        ],
    })
    assert isinstance(s.perturbations[0], CapacityPerturbation)


# --- end to end -------------------------------------------------------------


def test_a_real_twin_runs_and_a_policy_beats_doing_nothing() -> None:
    from app.crisis.harness import compare
    from app.crisis.scoring import Objective

    s = runnable()
    rows = compare(
        s,
        SCENARIOS["pandemic"](s),
        [POLICIES["null"](s), POLICIES["load-balance"](s), POLICIES["surge-and-balance"](s)],
        Objective(weights={"excess_deaths": 1.0}),
    )
    assert rows[-1]["policy"] == "null", "doing nothing should never win"
    assert rows[0]["excess_deaths"] < rows[-1]["excess_deaths"]
