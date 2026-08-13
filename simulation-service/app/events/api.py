"""HTTP surface for the event layer.

Thin on purpose. The engine is a pure function of its input, so an endpoint here
should do three things and stop: load the twin, fit the templates to it, and run
the comparison. Anything cleverer belongs in a module that can be tested without
a web server.

The judgement this file does exercise is which failures are a 422 rather than a
500. A twin with no capacity, no catchment, or an activity nothing provides will
*run* — it just produces a tidy table of zeroes in which every response ties for
first place. Those are the answers most likely to be believed and least likely
to be true, so they are refused with the reason attached.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.events.domain import CareRequirement, SystemState
from app.events.effects import Event
from app.events.harness import compare
from app.events.ontology import OntologyExport, UnrunnableExport, load
from app.events.scoring import Objective
from app.events.targets import CATALOGUE
from app.events.templates import EVENTS, POLICIES, care_model_for

router = APIRouter(prefix="/events", tags=["events"])

# A care requirement that consumes nothing. Used only to get the loader past its
# "no care model" check on the first pass, so the real model can be built
# against the activities the twin turns out to have. It is never run.
_PROBE = CareRequirement(acuity="_probe", consumes={}, mortality_per_unmet=0.0)


class CompareRequest(BaseModel):
    system: OntologyExport
    # Either a template name, or an event composed by hand. A template is just a
    # generator that produces the second thing, so accepting both costs one
    # branch and removes the ceiling: three canned events is a demo.
    template: str | None = None
    event: Event | None = None
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
    event: dict[str, Any]
    rows: list[dict[str, Any]]
    facilities: int
    horizon: int
    activities: list[str]
    weights: dict[str, float]


@router.get("/catalogue")
def catalogue() -> dict[str, Any]:
    """What can be run and what can be perturbed.

    `targets` is the whole point of the design: the composer builds its form
    from this list rather than from a hard-coded set of effect kinds, so adding
    something perturbable makes it appear in the UI with no front-end change.
    Each entry carries its own composition law, which is the part an author must
    not be allowed to choose — see `targets.py`.
    """
    return {
        "templates": sorted(EVENTS),
        "policies": sorted(POLICIES),
        "targets": [t.model_dump() for t in CATALOGUE],
    }


def _reject_effects_that_hit_nothing(event: Event, state: SystemState) -> None:
    """Refuse an event aimed at things the twin does not contain.

    A hand-composed effect is written against ids a person picked, and a
    mistyped or stale one is *silently inert*: the run completes, nothing
    happens, and the event appears to have been survived. That is the most
    dangerous output this service can produce, because it is indistinguishable
    from resilience.

    Templates cannot trip this — they generate their selections from the state —
    so the cost falls entirely on the case that needs it.
    """
    known = {
        "facility": set(state.facilities),
        "population": set(state.populations),
        "acuity": set(state.care_model),
        "activity": {
            a for f in state.facilities.values() for r in f.resources.values() for a in r.enables
        },
        "category": {r.category for f in state.facilities.values() for r in f.resources.values()},
        "route": {f"{e.source}>{e.target}" for e in state.network.all_edges()},
    }
    problems: list[str] = []

    if not event.effects:
        problems.append("it has no effects, so it is indistinguishable from a normal day")

    for e in event.effects:
        for dimension, chosen in e.select.items():
            missing = [v for v in chosen if v not in known.get(dimension, set())]
            if missing:
                have = known.get(dimension, set())
                problems.append(
                    f"{e.id}: no {dimension} {', '.join(missing)} "
                    f"(has: {', '.join(sorted(have)) if have else 'none'})"
                )
        if e.op == "multiply" and e.value == 1:
            problems.append(f"{e.id}: multiplies by 1, which changes nothing")
        if e.profile.peak <= 0:
            problems.append(f"{e.id}: has a peak of zero, so it never bites")
        if e.profile.end is not None and e.profile.end < e.profile.start:
            problems.append(
                f"{e.id}: ends at step {e.profile.end}, before it starts at {e.profile.start}"
            )
        if e.profile.start >= event.horizon:
            problems.append(
                f"{e.id}: starts at step {e.profile.start}, after the run ends "
                f"at {event.horizon}"
            )

    if problems:
        raise HTTPException(422, "This event would do nothing. " + "; ".join(problems) + ".")


@router.post("/compare", response_model=CompareResponse)
def compare_route(req: CompareRequest) -> CompareResponse:
    if (req.template is None) == (req.event is None):
        raise HTTPException(
            422,
            "Send exactly one of `template` (a shipped name) or `event` (a composed "
            "event). Sending both leaves it to this endpoint to decide which one the "
            "caller meant.",
        )
    if req.template is not None and req.template not in EVENTS:
        raise HTTPException(
            422, f"Unknown template {req.template!r}. Available: {', '.join(sorted(EVENTS))}."
        )
    unknown = [p for p in req.policies if p not in POLICIES]
    if unknown:
        raise HTTPException(
            422,
            f"Unknown response(s) {', '.join(unknown)}. Available: {', '.join(sorted(POLICIES))}.",
        )

    # The care model needs the loaded state to know which activities exist, and
    # the loader needs a care model to check against — so load once with a probe
    # held back from validation, then build the real one.
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

    event = req.event if req.event is not None else EVENTS[req.template or ""](state)
    _reject_effects_that_hit_nothing(event, state)
    policies = [POLICIES[p](state) for p in req.policies]

    # Cost is weighted at roughly two dollars per micro-life so it registers
    # without dominating. It is a placeholder for a number the customer owns,
    # and it is returned in the response so nobody has to read this file to
    # find out what it was.
    weights = {"excess_deaths": 1.0, "response_cost": 0.000002}
    rows = compare(
        state,
        event,
        policies,
        Objective(weights=weights),
        replicates=max(1, req.replicates),
        base_seed=req.seed or 0,
    )

    activities = sorted(
        {a for f in state.facilities.values() for r in f.resources.values() for a in r.enables}
    )
    return CompareResponse(
        event={
            "id": event.id,
            "name": event.name,
            "description": event.description,
            "effects": [e.id for e in event.effects],
            "composed": req.event is not None,
        },
        rows=rows,
        facilities=len(state.facilities),
        horizon=event.horizon,
        activities=activities,
        weights=weights,
    )
