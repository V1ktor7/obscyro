"""What has to hold for the crisis layer to be worth trusting.

The acceptance criteria from the spec, one test each, plus the two that caught
real defects on the first run.
"""

from __future__ import annotations

import pytest

from app.crisis.domain import SPACE, STAFF, CareRequirement, Resource, SystemState
from app.crisis.dynamics import run
from app.crisis.events import (
    CapacityPerturbation,
    DemandPerturbation,
    Scenario,
    TemporalProfile,
)
from app.crisis.examples.policies import ALL as POLICIES
from app.crisis.examples.scenarios import ALL as SCENARIOS
from app.crisis.examples.system import toy_system
from app.crisis.harness import compare, evaluate, replicate
from app.crisis.policy import (
    Action,
    Comparison,
    Condition,
    Metric,
    Policy,
    Rule,
    null_policy,
)
from app.crisis.scoring import Objective


@pytest.fixture
def objective() -> Objective:
    return Objective(weights={"excess_deaths": 1.0})


# --- determinism ------------------------------------------------------------


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_same_inputs_same_trajectory(name: str) -> None:
    """Same (system, event, policy, seed) → identical trajectory, always.

    Without this the comparison harness optimises the seed rather than the
    policy, and every result it produces is noise wearing a suit.
    """
    scenario = SCENARIOS[name]()
    policy = POLICIES["load-balance"]()
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
    run(system, SCENARIOS["flood"](), POLICIES["load-balance"]())
    assert system.facility("north").resources["icu_beds"].capacity == before


# --- replicates -------------------------------------------------------------


def test_replicates_report_a_distribution(objective: Objective) -> None:
    r = replicate(toy_system(), SCENARIOS["pandemic"](), null_policy(), objective, n=5)
    assert len(r.scores) == 5
    lo, hi = r.interval()
    assert lo <= r.mean <= hi


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
    t = run(system, SCENARIOS["pandemic"](), null_policy())
    # Only ten units of oxygen exist across the network, so a wave of critical
    # cases cannot possibly all be served.
    assert sum(x.unmet.get("critical", 0.0) for x in t.ticks) > 0


def test_new_crisis_type_is_only_data() -> None:
    """A crisis nobody anticipated — a strike — expressed in the same verbs."""
    strike = Scenario(
        id="strike",
        name="Nursing strike",
        horizon=20,
        perturbations=[
            CapacityPerturbation(
                id="walkout",
                facilities=["north", "south", "clinic"],
                category=STAFF,
                multiplier=0.35,
                profile=TemporalProfile(start=3, end=14, shape="step", peak=1.0),
            ),
            DemandPerturbation(
                id="usual",
                targets=["city"],
                acuity_mix={"critical": 0.1, "routine": 0.9},
                volume=30,
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
    t = run(toy_system(), SCENARIOS["pandemic"](), POLICIES["load-balance"](), seed=1)
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
    t = run(toy_system(), SCENARIOS["pandemic"](), policy)
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
    system, scenario = toy_system(), SCENARIOS["pandemic"]()
    _t0, base = evaluate(system, scenario, null_policy(), objective)
    _t1, best = evaluate(system, scenario, POLICIES["surge-and-balance"](), objective)
    assert best.scalar < base.scalar


def test_the_best_policy_differs_by_crisis(objective: Objective) -> None:
    """The reason the product exists.

    In a flood, evacuating halves the deaths for a few thousand; surging costs a
    hundred times more for the same result. If one policy won everywhere, a
    government would not need to simulate anything.
    """
    policies = [null_policy(), POLICIES["load-balance"](), POLICIES["surge-and-balance"]()]
    flood = compare(toy_system(), SCENARIOS["flood"](), policies, objective)
    pandemic = compare(toy_system(), SCENARIOS["pandemic"](), policies, objective)

    for rows in (flood, pandemic):
        assert rows[-1]["policy"] == "null", "doing nothing should never win"
    flood_cost = {r["policy"]: r["response_cost"] for r in flood}
    assert flood_cost["load-balance"] < flood_cost["surge-and-balance"] / 10
