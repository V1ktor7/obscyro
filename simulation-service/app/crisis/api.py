"""HTTP surface for the crisis layer.

Thin on purpose. The engine is a pure function of its input, so an endpoint here
should do three things and stop: load the twin, fit the templates to it, and run
the comparison. Anything cleverer belongs in a module that can be tested without
a web server.

The one piece of judgement this file does exercise is which failures are a 422
rather than a 500. A twin with no capacity, no catchment, or an activity nothing
provides will *run* — it just produces a tidy table of zeroes in which every
policy ties for first place. Those are the answers most likely to be believed
and least likely to be true, so they are refused with the reason attached.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.crisis.domain import CareRequirement, SystemState
from app.crisis.events import (
    CapacityPerturbation,
    ConnectivityPerturbation,
    DemandPerturbation,
    Scenario,
)
from app.crisis.harness import compare
from app.crisis.ontology import OntologyExport, UnrunnableExport, load
from app.crisis.scoring import Objective
from app.crisis.templates import POLICIES, SCENARIOS, care_model_for

router = APIRouter(prefix="/crisis", tags=["crisis"])

# A care requirement that consumes nothing. Used only to get the loader past its
# "no care model" check on the first pass, so the real model can be built
# against the activities the twin turns out to have. It is never run.
_PROBE = CareRequirement(acuity="_probe", consumes={}, mortality_per_unmet=0.0)


class CompareRequest(BaseModel):
    system: OntologyExport
    # Either a template name, or an event composed by hand. A template is just
    # a generator that produces the second thing, so accepting both costs one
    # branch and removes the ceiling: three canned crises is a demo, not a
    # platform.
    scenario: str | None = None
    event: Scenario | None = None
    policies: list[str] = Field(min_length=1)
    seed: int | None = None
    # The two facts the ontology cannot hold. Both default to nothing, and both
    # are checked before the run rather than silently zeroed.
    population_sizes: dict[str, float] = Field(default_factory=dict)
    route_capacity: float = 0.0
    # Deaths per unmet critical patient per tick. Surfaced as a request field
    # because it is the number the whole result is most sensitive to, and it
    # should be visible to whoever reads the answer.
    mortality: float = 0.15
    census_acuity: str | None = None
    replicates: int = 1


class CompareResponse(BaseModel):
    scenario: dict[str, Any]
    rows: list[dict[str, Any]]
    facilities: int
    horizon: int
    activities: list[str]
    weights: dict[str, float]


def _reject_effects_that_hit_nothing(scenario: Scenario, state: SystemState) -> None:
    """Refuse an event aimed at things the twin does not contain.

    A hand-composed effect is written against ids a person picked, and a
    mistyped or stale one is *silently inert*: the run completes, nothing
    happens, and the event appears to have been survived. That is the most
    dangerous output this service can produce, because it is indistinguishable
    from resilience.

    Templates cannot trip this — they generate their targets from the state —
    so the cost falls entirely on the case that needs it.
    """
    known_activities = {
        a for f in state.facilities.values() for r in f.resources.values() for a in r.enables
    }
    known_categories = {
        r.category for f in state.facilities.values() for r in f.resources.values()
    }
    edges = {(e.source, e.target) for e in state.network.all_edges()}
    problems: list[str] = []

    for p in scenario.perturbations:
        if isinstance(p, DemandPerturbation):
            missing = [t for t in p.targets if t not in state.populations]
            if missing:
                problems.append(f"{p.id}: no population {', '.join(missing)}")
            if not p.acuity_mix:
                problems.append(f"{p.id}: no acuity mix, so it produces no patients")
        elif isinstance(p, CapacityPerturbation):
            missing = [f for f in p.facilities if f not in state.facilities]
            if missing:
                problems.append(f"{p.id}: no facility {', '.join(missing)}")
            if p.category and p.category not in known_categories:
                problems.append(
                    f"{p.id}: nothing in this twin is {p.category!r} "
                    f"(has: {', '.join(sorted(known_categories)) or 'nothing'})"
                )
            unknown_res = [r for r in p.resources if r not in known_activities]
            if unknown_res:
                problems.append(f"{p.id}: no resource {', '.join(unknown_res)}")
            if p.multiplier is None and p.absolute is None:
                problems.append(f"{p.id}: sets neither a multiplier nor an absolute value")
        elif isinstance(p, ConnectivityPerturbation):
            missing_e = [f"{s}→{t}" for s, t in p.edges if (s, t) not in edges]
            if missing_e:
                problems.append(f"{p.id}: no route {', '.join(missing_e)}")

    if not scenario.perturbations:
        problems.append("the event has no effects, so it is indistinguishable from a normal day")
    if problems:
        raise HTTPException(422, "This event would do nothing. " + "; ".join(problems) + ".")


@router.get("/catalogue")
def catalogue() -> dict[str, list[str]]:
    """What can be run, without needing a twin to ask.

    Lets the UI populate its menus before any environment is chosen, and keeps
    the names in one place rather than duplicated into TypeScript.
    """
    return {"scenarios": sorted(SCENARIOS), "policies": sorted(POLICIES)}


@router.post("/compare", response_model=CompareResponse)
def compare_route(req: CompareRequest) -> CompareResponse:
    if (req.scenario is None) == (req.event is None):
        raise HTTPException(
            422,
            "Send exactly one of `scenario` (a template name) or `event` (a composed "
            "event). Sending both leaves it to this endpoint to decide which one the "
            "caller meant.",
        )
    if req.scenario is not None and req.scenario not in SCENARIOS:
        raise HTTPException(
            422, f"Unknown event {req.scenario!r}. Available: {', '.join(sorted(SCENARIOS))}."
        )
    unknown = [p for p in req.policies if p not in POLICIES]
    if unknown:
        raise HTTPException(
            422,
            f"Unknown response(s) {', '.join(unknown)}. Available: {', '.join(sorted(POLICIES))}.",
        )

    # The care model needs the loaded state to know which activities exist, and
    # the loader needs a care model to check against — so load once with an
    # empty model held back from validation, then build the real one.
    try:
        probe = load(
            req.system,
            care_model={"_probe": _PROBE},
            population_sizes=req.population_sizes,
            route_capacity=req.route_capacity or None,
        )
        model = care_model_for(probe, mortality=req.mortality)
        state = load(
            req.system,
            care_model=model,
            population_sizes=req.population_sizes,
            route_capacity=req.route_capacity or None,
            census_acuity=req.census_acuity,
        )
    except UnrunnableExport as exc:
        raise HTTPException(422, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    scenario = req.event if req.event is not None else SCENARIOS[req.scenario or ""](state)
    _reject_effects_that_hit_nothing(scenario, state)
    policies = [POLICIES[p](state) for p in req.policies]

    # Cost is weighted at roughly two dollars per micro-life so it registers
    # without dominating. It is a placeholder for a number the customer owns,
    # and it is returned in the response so nobody has to read this file to
    # find out what it was.
    weights = {"excess_deaths": 1.0, "response_cost": 0.000002}
    rows = compare(
        state,
        scenario,
        policies,
        Objective(weights=weights),
        replicates=max(1, req.replicates),
        base_seed=req.seed or 0,
    )

    activities = sorted(
        {a for f in state.facilities.values() for r in f.resources.values() for a in r.enables}
    )
    return CompareResponse(
        scenario={
            "id": scenario.id,
            "name": scenario.name,
            "description": scenario.description,
            "perturbations": [p.id for p in scenario.perturbations],
            "composed": req.event is not None,
        },
        rows=rows,
        facilities=len(state.facilities),
        horizon=scenario.horizon,
        activities=activities,
        weights=weights,
    )
