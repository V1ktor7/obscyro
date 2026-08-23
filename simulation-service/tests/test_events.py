"""What has to hold for the crisis layer to be worth trusting.

The acceptance criteria from the spec, one test each, plus the two that caught
real defects on the first run.
"""

from __future__ import annotations

import pytest

from app.events.domain import SPACE, STAFF, CareRequirement, Resource, SystemState
from app.events.dynamics import run
from app.events.effects import Effect, Event, TemporalProfile
from app.events.examples.system import toy_system
from app.events.templates import EVENTS, POLICIES
from app.events.harness import compare, evaluate, replicate
from app.events.policy import (
    Action,
    Comparison,
    Condition,
    Metric,
    Policy,
    Rule,
    null_policy,
)
from app.events.scoring import Objective


@pytest.fixture
def objective() -> Objective:
    return Objective(weights={"excess_deaths": 1.0})


# --- determinism ------------------------------------------------------------


@pytest.mark.parametrize("name", list(EVENTS))
def test_same_inputs_same_trajectory(name: str) -> None:
    """Same (system, event, policy, seed) → identical trajectory, always.

    Without this the comparison harness optimises the seed rather than the
    policy, and every result it produces is noise wearing a suit.
    """
    scenario = EVENTS[name](toy_system())
    policy = POLICIES["load-balance"](toy_system())
    a = run(toy_system(), scenario, policy, seed=7)
    b = run(toy_system(), scenario, policy, seed=7)
    assert a.model_dump() == b.model_dump()


def test_runs_do_not_contaminate_each_other() -> None:
    """Twenty policies against one system must not mutate it.

    `run` deep-copies for exactly this reason. If it stopped, the second policy
    would inherit the first one's damaged hospital and score better or worse for
    no reason anyone could see.
    """
    system = toy_system()
    before = system.facility("north").resources["icu_beds"].capacity
    run(system, EVENTS["flood"](toy_system()), POLICIES["load-balance"](toy_system()))
    assert system.facility("north").resources["icu_beds"].capacity == before


# --- replicates -------------------------------------------------------------


def test_the_engine_is_deterministic_and_replicates_are_therefore_vacuous(
    objective: Objective,
) -> None:
    """A tripwire, not a feature.

    `Engine` builds `np.random.default_rng(seed)` and never reads it, so nothing
    in a run is stochastic: different seeds give byte-identical trajectories.
    Everything downstream inherits that. `replicate(n=8)` runs the same
    trajectory eight times, `stdev` is 0, and `interval()` returns a band of
    zero width — measured on the real twin as well as here.

    This replaces a test that asserted `lo <= mean <= hi` and passed trivially
    on a degenerate interval: it guaranteed nothing while looking like it
    guaranteed a distribution.

    So the confidence interval the harness computes must not be rendered as
    one. When real stochasticity arrives — arrivals drawn from a distribution
    is the obvious first place — this test fails, and that failure is the
    signal to replace it with a genuine distribution test and to let the
    comparison table show a statistical range.
    """
    a = run(toy_system(), EVENTS["pandemic"](toy_system()), null_policy(), seed=1)
    b = run(toy_system(), EVENTS["pandemic"](toy_system()), null_policy(), seed=999)
    # The instruction lives in the assertion messages, not only in the
    # docstring: what a maintainer sees on a red CI is the message, and a test
    # that fails without saying what to do next gets deleted rather than
    # honoured.
    todo = (
        "The engine is no longer deterministic, which is good. Do NOT delete or "
        "weaken this test to get CI green. Instead: (1) replace it with a real "
        "distribution test — assert non-zero spread and a sensible interval; "
        "(2) only from that point may the comparison table render a statistical "
        "range, because until now `interval()` returned a band of zero width and "
        "showing it would have manufactured false precision."
    )

    # The seed is recorded on the trajectory, so compare what the run produced
    # rather than the label it carries.
    assert [t.model_dump() for t in a.ticks] == [t.model_dump() for t in b.ticks], todo

    r = replicate(toy_system(), EVENTS["pandemic"](toy_system()), null_policy(), objective, n=8)
    assert len(r.scores) == 8
    assert len(set(r.scores)) == 1, todo
    assert r.stdev == 0.0, todo
    lo, hi = r.interval()
    assert hi - lo == 0.0, todo


# --- extensibility: new data, no engine change ------------------------------


def test_new_resource_type_needs_no_engine_change() -> None:
    """A resource the engine has never heard of must constrain care normally.

    `oxygen` appears in no module under `app/crisis`. If this test needs an
    engine edit to pass, the platform claim is false.
    """
    system = toy_system()
    for fid in ("north", "south"):
        system.facility(fid).resources["oxygen"] = Resource(
            id="oxygen", category="stuff", quantity=5, capacity=5,
            enables=frozenset({"oxygen_supply"}),
        )
    system.care_model["critical"] = CareRequirement(
        acuity="critical",
        consumes={"icu_bed": 1.0, "nurse": 0.5, "ventilator": 1.0, "oxygen_supply": 1.0},
        mortality_per_unmet=0.15,
        stay_ticks=5,
    )
    t = run(system, EVENTS["pandemic"](toy_system()), null_policy())
    # Only ten units of oxygen exist across the network, so a wave of critical
    # cases cannot possibly all be served.
    assert sum(x.unmet.get("critical", 0.0) for x in t.ticks) > 0


def test_new_crisis_type_is_only_data() -> None:
    """A crisis nobody anticipated — a strike — expressed in the same verbs."""
    strike = Event(
        id="strike",
        name="Nursing strike",
        horizon=20,
        effects=[
            Effect(
                id="walkout",
                target="resource.capacity",
                select={"facility": ["north", "south", "clinic"], "category": [STAFF]},
                op="multiply",
                value=0.35,
                profile=TemporalProfile(start=3, end=14, shape="step", peak=1.0),
            ),
            Effect(
                id="usual-critical",
                target="demand.volume",
                select={"population": ["city"], "acuity": ["critical"]},
                op="add",
                value=3,
                profile=TemporalProfile(start=0, end=20, shape="step", peak=1.0),
            ),
            Effect(
                id="usual-routine",
                target="demand.volume",
                select={"population": ["city"], "acuity": ["routine"]},
                op="add",
                value=27,
                profile=TemporalProfile(start=0, end=20, shape="step", peak=1.0),
            ),
        ],
    )
    t = run(toy_system(), strike, null_policy())
    assert t.deaths > 0


# --- auditability -----------------------------------------------------------


def test_every_fired_rule_carries_its_reason() -> None:
    """"Why did the model do that" must have a concrete answer.

    Not "occupancy > 0.9" but the reading that tripped it, at the moment it
    tripped — otherwise the trace proves a rule exists, not that it applied.
    """
    t = run(toy_system(), EVENTS["pandemic"](toy_system()), POLICIES["load-balance"](toy_system()), seed=1)
    fired = [f for x in t.ticks for f in x.fired]
    assert fired, "expected at least one rule to fire in a pandemic"
    for f in fired:
        assert f.rule_id
        assert "=" in f.because and any(op in f.because for op in (">", "<", "="))


def test_conflicting_rules_resolve_by_priority_deterministically() -> None:
    high = Rule(
        id="a-high",
        condition=Condition(always=True),
        action=Action(kind="surge_resource", target="north", resource="nurses", amount=5),
        priority=50,
    )
    low = Rule(
        id="b-low",
        condition=Condition(always=True),
        action=Action(kind="surge_resource", target="north", resource="nurses", amount=99),
        priority=1,
    )
    # Declared in the losing order on purpose: ordering must come from priority,
    # not from how the list happened to be written.
    policy = Policy(id="conflict", rules=[low, high])
    t = run(toy_system(), EVENTS["pandemic"](toy_system()), policy)
    first = t.ticks[0]
    assert [f.rule_id for f in first.fired] == ["a-high"]
    assert any("b-low" in s for s in first.suppressed)


# --- the defects the first run surfaced -------------------------------------


def test_occupancy_can_be_read_per_activity() -> None:
    """A full ICU inside a half-empty hospital has to be visible.

    Ten ICU beds among sixty ward beds: aggregating the `space` category reports
    44% while every critical patient is turned away. The example policies were
    written against the category and never fired once.
    """
    s = toy_system()
    s.consume("north", "icu_bed", 10)
    assert s.occupancy_ratio("north", activity="icu_bed") == pytest.approx(1.0)
    assert s.occupancy_ratio("north", category=SPACE) < 0.2


def test_destroyed_is_distinguishable_from_empty() -> None:
    """Zero capacity gives zero occupancy, which is also what an idle building
    reports. A policy that must tell them apart reads capacity."""
    s = toy_system()
    for r in s.facility("clinic").resources.values():
        r.capacity = 0.0
        r.quantity = 0.0
    assert s.occupancy_ratio("clinic", category=SPACE) == 0.0
    assert s.capacity_of("clinic") == 0.0
    assert s.capacity_of("north") > 0.0


# --- the product claim ------------------------------------------------------


def test_a_policy_beats_doing_nothing(objective: Objective) -> None:
    system, scenario = toy_system(), EVENTS["pandemic"](toy_system())
    _t0, base = evaluate(system, scenario, null_policy(), objective)
    _t1, best = evaluate(system, scenario, POLICIES["surge-and-balance"](toy_system()), objective)
    assert best.scalar < base.scalar


def test_the_best_response_differs_by_event(objective: Objective) -> None:
    """The reason the product exists.

    In a flood the cheap move wins: evacuate along the routes that still work.
    In a pandemic it does not, because every neighbour is full too and only
    buying capacity helps. If one response won everywhere, nobody would need to
    simulate anything.
    """
    policies = [
        null_policy(),
        POLICIES["load-balance"](toy_system()),
        POLICIES["surge-and-balance"](toy_system()),
    ]
    flood = compare(toy_system(), EVENTS["flood"](toy_system()), policies, objective)
    pandemic = compare(toy_system(), EVENTS["pandemic"](toy_system()), policies, objective)

    assert flood[0]["policy"] == "load-balance"
    assert pandemic[0]["policy"] == "surge-and-balance"

    # Acting has to beat inaction *somewhere*, or the tool has nothing to say.
    # It is deliberately not asserted that every response beats inaction in
    # every event: surging during a flood raises occupancy just enough to stop
    # the evacuation rule firing, and ends marginally worse than standing
    # still. That is a real property of a badly matched response, and the old
    # form of this test — "null must come last" — asserted precisely the belief
    # this product exists to challenge.
    for rows in (flood, pandemic):
        baseline = next(r["excess_deaths"] for r in rows if r["policy"] == "null")
        assert rows[0]["excess_deaths"] < baseline

    # An order of magnitude, not a decimal place. An earlier form asserted a
    # factor of exactly ten and failed at 9.93 — a threshold measuring the toy
    # network's arithmetic rather than the claim, which is that moving patients
    # is cheap and buying capacity is not.
    flood_cost = {r["policy"]: r["response_cost"] for r in flood}
    assert flood_cost["load-balance"] * 5 < flood_cost["surge-and-balance"]


# --- who a patient can actually be sent to ----------------------------------


def _catchment_system(*, capable: int, incapable: int) -> SystemState:
    """One population served by `capable` hospitals and `incapable` places that
    hold no acute bed at all — the shape of a real health region."""
    from app.events.domain import Facility
    from app.events.examples.system import NetworkxBackend

    facilities: dict[str, Facility] = {}
    for i in range(capable):
        facilities[f"hosp{i}"] = Facility(
            id=f"hosp{i}",
            name=f"Hospital {i}",
            resources={
                "beds": Resource(
                    id="beds", category=SPACE, quantity=500, capacity=500,
                    enables=frozenset({"acute_bed"}),
                )
            },
        )
    for i in range(incapable):
        facilities[f"home{i}"] = Facility(
            id=f"home{i}",
            name=f"Nursing home {i}",
            resources={
                "places": Resource(
                    id="places", category=SPACE, quantity=90, capacity=90,
                    enables=frozenset({"long_stay_place"}),
                )
            },
        )
    net = NetworkxBackend()
    for fid in facilities:
        net.add_node(fid)
    from app.events.domain import Population

    return SystemState(
        facilities=facilities,
        populations={
            "region": Population(id="region", size=200_000, served_by=list(facilities))
        },
        care_model={
            "acute": CareRequirement(
                acuity="acute", consumes={"acute_bed": 1.0}, mortality_per_unmet=0.0,
                stay_ticks=3,
            )
        },
        network=net,
    )


def _steady_demand(per_thousand: float, horizon: int = 10) -> Event:
    return Event(
        id="demand",
        name="Steady demand",
        horizon=horizon,
        effects=[
            Effect(
                id="d",
                target="demand.incidence",
                select={"acuity": ["acute"]},
                op="add",
                value=per_thousand,
                profile=TemporalProfile(start=0, end=horizon, shape="step", peak=1.0),
            )
        ],
    )


def test_acute_demand_is_not_queued_at_places_with_no_acute_bed() -> None:
    """The defect this replaced: on the Montréal twin 34 of 190 installations
    hold an acute bed, and an even split across the catchment sent 82% of
    hospital demand to nursing homes where it queued for the whole run. The
    result read 223,317 patient-days unserved out of 6,584 arrivals and every
    policy scored identically, because the number was measuring the routing.

    Capacity here is ample, so a correct allocation serves everyone.
    """
    state = _catchment_system(capable=2, incapable=9)
    traj = run(state, _steady_demand(0.05), null_policy(), seed=0)
    unmet = sum(sum(t.unmet.values()) for t in traj.ticks)
    served = sum(sum(t.served.values()) for t in traj.ticks)
    assert served > 0
    assert unmet == pytest.approx(0.0, abs=1e-9)


def test_a_catchment_with_no_capable_facility_still_shows_its_patients() -> None:
    """Dropping them would make a territory with no hospital look like a
    territory with no patients. Rivière-des-Prairies — Anjou has 0 of 17, and
    211,308 people behind it."""
    state = _catchment_system(capable=0, incapable=5)
    traj = run(state, _steady_demand(0.05), null_policy(), seed=0)
    assert sum(sum(t.arrivals.values()) for t in traj.ticks) > 0
    assert sum(sum(t.unmet.values()) for t in traj.ticks) > 0


def test_a_full_hospital_is_still_where_an_acute_patient_belongs() -> None:
    """Capability, not availability. Excluding a hospital because it is full
    would send its overflow to a nursing home, which is worse than a queue."""
    state = _catchment_system(capable=1, incapable=3)
    for r in state.facilities["hosp0"].resources.values():
        r.quantity = 0
    traj = run(state, _steady_demand(0.05), null_policy(), seed=0)
    assert sum(sum(t.unmet.values()) for t in traj.ticks) > 0
    assert sum(sum(t.served.values()) for t in traj.ticks) == pytest.approx(0.0, abs=1e-9)


def test_an_event_that_carries_nothing_is_refused() -> None:
    """How a field-name mismatch stayed invisible: the platform sent the effects
    under a key pydantic did not know, they were dropped without a word, every
    policy tied at zero, and the run reported a clean result for a question
    nobody had asked. An event that does nothing is not a scenario survived.
    """
    from fastapi import HTTPException

    from app.events.api import _reject_effects_that_hit_nothing

    with pytest.raises(HTTPException) as caught:
        _reject_effects_that_hit_nothing(
            Event(id="empty", name="Empty", horizon=10, effects=[]), toy_system()
        )
    assert caught.value.status_code == 422
    assert "no effects" in str(caught.value.detail)


def test_the_engine_reads_effects_under_the_name_the_platform_sends() -> None:
    """The mismatch itself. `perturbations` is silently dropped, so this pins
    the one key both sides have to agree on."""
    payload = {
        "id": "e",
        "name": "n",
        "horizon": 10,
        "effects": [
            {
                "id": "a",
                "target": "demand.incidence",
                "select": {"acuity": ["critical"]},
                "op": "add",
                "value": 0.05,
                "profile": {"start": 0, "end": 10, "shape": "step", "peak": 1.0},
            }
        ],
    }
    assert len(Event.model_validate(payload).effects) == 1


# --- what the map is allowed to read ----------------------------------------


def _mixed_hospital() -> SystemState:
    """One hospital with a small acute ward and a large long-stay wing — the
    shape that made the category-wide reading useless."""
    from app.events.domain import Facility, Population
    from app.events.examples.system import NetworkxBackend

    f = Facility(
        id="h",
        name="Hôpital",
        resources={
            "acute": Resource(
                id="acute", category=SPACE, quantity=20, capacity=20,
                enables=frozenset({"acute_bed"}),
            ),
            "longstay": Resource(
                id="longstay", category=SPACE, quantity=300, capacity=300,
                enables=frozenset({"long_stay_place"}),
            ),
        },
    )
    net = NetworkxBackend()
    net.add_node("h")
    return SystemState(
        facilities={"h": f},
        populations={"r": Population(id="r", size=100_000, served_by=["h"])},
        care_model={
            "acute": CareRequirement(
                acuity="acute", consumes={"acute_bed": 1.0}, mortality_per_unmet=0.0,
                stay_ticks=5,
            )
        },
        network=net,
    )


def test_occupancy_is_reported_per_activity_not_per_category() -> None:
    """The defect: twenty acute beds full and three hundred long-stay places
    empty reported 6% on the category. A map coloured from that number shows a
    calm hospital while its ward is turning people away.
    """
    state = _mixed_hospital()
    traj = run(state, _steady_demand(1.0, horizon=12), null_policy(), seed=0)
    last = traj.ticks[-1].occupancy["h"]
    assert set(last) == {"acute_bed", "long_stay_place"}
    assert last["acute_bed"] == pytest.approx(1.0, abs=1e-6)
    assert last["long_stay_place"] == pytest.approx(0.0, abs=1e-6)


def test_peak_occupancy_sees_the_thing_that_is_full() -> None:
    # Averaged over the category this run peaked around 6%, which is the reading
    # that made every policy look equally comfortable.
    from app.events.scoring import _OBJECTIVES

    traj = run(_mixed_hospital(), _steady_demand(1.0, horizon=12), null_policy(), seed=0)
    peak, _ = _OBJECTIVES["peak_occupancy"](traj)
    assert peak == pytest.approx(1.0, abs=1e-6)


def test_the_queue_is_recorded_beside_what_it_is_waiting_for() -> None:
    """Occupancy alone cannot tell a full ward with nobody waiting from a full
    ward with forty people in the corridor, and those are different emergencies.
    """
    traj = run(_mixed_hospital(), _steady_demand(1.0, horizon=12), null_policy(), seed=0)
    waiting = traj.ticks[-1].waiting["h"]
    assert waiting["acute_bed"] > 0
    assert "long_stay_place" not in waiting


def test_a_facility_with_nobody_waiting_records_no_queue() -> None:
    traj = run(_catchment_system(capable=1, incapable=0), _steady_demand(0.001), null_policy(), seed=0)
    assert all(not t.waiting for t in traj.ticks)
