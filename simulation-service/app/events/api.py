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
from app.events.collect import Dataset, collect
from app.events.dynamics import run
from app.events.harness import compare
from app.events.mechanics import ContradictoryCareModel, care_model_from
from app.events.ontology import OntologyExport, UnrunnableExport, load
from app.events.scoring import Objective
from app.events.policy import Policy
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
    # Shipped responses, by name.
    policies: list[str] = Field(default_factory=list)
    # Responses written by the institution, sent whole.
    #
    # A `Policy` is already inspectable data — a typed condition tree, four
    # kinds of action, and the frictions that stop every response from looking
    # free and instant. Nothing about it needed to live in this service; it was
    # simply unreachable, because the only way in was a name in a dictionary of
    # three. The same argument the composer makes for events: adding a kind of
    # response should mean writing one of these, not editing the engine.
    custom_policies: list[Policy] = Field(default_factory=list)
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
    # Which tables of the run to hand back. Empty means none, which is the
    # default because a trajectory is far larger than the summary and most
    # callers want the ranking.
    collect: list[str] = Field(default_factory=list)


class CompareResponse(BaseModel):
    event: dict[str, Any]
    rows: list[dict[str, Any]]
    facilities: int
    horizon: int
    activities: list[str]
    weights: dict[str, float]
    # Tables of what actually happened, when asked for. Produced from the same
    # run that produced `rows`, never a second one: a download that re-ran the
    # simulation could disagree with the summary it sits beneath.
    datasets: list[Dataset] = Field(default_factory=list)


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


def _arithmetic_problems(effect, prop: str, state: SystemState) -> list[str]:
    """Why this effect cannot multiply or add to this property.

    Checked here, before the run, rather than left to raise mid-tick. The engine
    would refuse it eventually — `apply_property` will not do arithmetic on a
    declared state — but by then a partially-applied trajectory exists and the
    caller gets a 500 for what is a question about the ontology.

    An *undeclared* number is refused too, and this is the point of the whole
    change: the engine used to answer this question on the institution's behalf
    by shipping a catalogue of quantities it had invented. It no longer does, so
    the honest response to "multiply this by 0.5" when nobody has said whether
    the value rebuilds or accumulates is to say so and name where to fix it.
    """
    schema = state.property_schema
    # `set` reads no prior value, so composition does not arise. Guarded here
    # rather than at the call site so the function is safe to call with any
    # operation and cannot be defeated by a second caller forgetting.
    if schema is None or effect.op == "set":
        return []

    # Which types this effect can actually land on, so the message names the one
    # that is short a declaration rather than the whole ontology.
    chosen = effect.select.get("object_type") or []
    hit = {
        getattr(o, "type", "")
        for o in state.objects.values()
        if not chosen or getattr(o, "type", "") in chosen
    }

    problems: list[str] = []
    for type_name in sorted(hit):
        declared = schema.find(type_name, prop)
        if declared is None:
            # Nothing declares it at all. Distinct from "declared and ambiguous":
            # the fix is to add the property, not to classify it.
            continue
        if declared.behaviour == "state":
            problems.append(
                f"{effect.id}: {prop!r} on {type_name} is declared a state, so it can "
                f"be set, not {effect.op}"
            )
        elif declared.behaviour is None:
            problems.append(
                f"{effect.id}: {prop!r} on {type_name} has no declared behaviour, so "
                f"there is no way to tell whether {effect.op} should compose against a "
                f"value that rebuilds each step or one that accumulates. Declare it on "
                f"the object type, or use 'set'"
            )
    return problems


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
    # An event with no effects at all is the same failure one step earlier, and
    # it is how a field-name mismatch between this service and its caller stayed
    # invisible: the platform sent the effects under a key pydantic did not
    # know, they were dropped without a word, every policy tied at zero, and the
    # run reported a clean result for a question nobody had asked.
    if not event.effects:
        raise HTTPException(
            422,
            f"Event {event.id!r} carries no effects, so the run would perturb nothing "
            "and every response would score identically. An event that does nothing is "
            "not a scenario the twin survived.",
        )

    known = {
        "facility": set(state.facilities),
        "population": set(state.populations),
        "acuity": set(state.care_model),
        "activity": {
            a for f in state.facilities.values() for r in f.resources.values() for a in r.enables
        },
        "category": {r.category for f in state.facilities.values() for r in f.resources.values()},
        "route": {f"{e.source}>{e.target}" for e in state.network.all_edges()},
        "object_type": {getattr(o, "type", "") for o in state.objects.values()},
    }
    # Which properties the instances actually carry. An effect naming one that
    # exists nowhere is inert in the most convincing way available: it selects
    # real objects, runs without error, and changes nothing.
    known_properties = {
        key
        for o in state.objects.values()
        for key in getattr(o, "properties", {})
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
        prop = getattr(e, "property_key", None)
        if prop and prop not in known_properties:
            problems.append(
                f"{e.id}: no object carries a property called {prop!r} "
                f"(they carry: {', '.join(sorted(known_properties)) or 'none'})"
            )
        if prop:
            problems.extend(_arithmetic_problems(e, prop, state))
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
    if not req.policies and not req.custom_policies:
        raise HTTPException(
            422, "Send at least one response to compare, shipped or written by hand."
        )
    # Ids are how a result row is read back, so two responses may not share one.
    seen_ids = list(req.policies) + [p.id for p in req.custom_policies]
    clashing = sorted({i for i in seen_ids if seen_ids.count(i) > 1})
    if clashing:
        raise HTTPException(
            422,
            f"Two responses share the id(s) {', '.join(clashing)}. The ranking is read "
            f"by id, so one would silently stand in for the other.",
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
        # What the institution declared beats what the engine would invent.
        # `care_model_for` picks three severities nobody named, stays of six,
        # three and one step, and a mortality of 0.15 divided by ten and two
        # hundred for the other bands — one hospital's clinical assumptions,
        # handed to whoever opens the product. It survives only as the fallback
        # for a twin that has bound nothing yet.
        model = care_model_from(list(probe.objects.values()), probe.property_schema)
        if not model:
            model = care_model_for(probe, mortality=req.mortality)
        state = load(
            req.system,
            care_model=model,
            population_sizes=req.population_sizes,
            route_capacity=req.route_capacity or None,
            census_acuity=req.census_acuity,
        )
    except ContradictoryCareModel as exc:
        # Listed before the bare ValueError it inherits from, so the message
        # naming the two disagreeing instances is the one that reaches the
        # caller rather than being flattened into a generic load failure.
        raise HTTPException(422, f"The declared care model disagrees with itself: {exc}") from exc
    except UnrunnableExport as exc:
        raise HTTPException(422, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    event = req.event if req.event is not None else EVENTS[req.template or ""](state)
    _reject_effects_that_hit_nothing(event, state)
    policies = [POLICIES[p](state) for p in req.policies] + list(req.custom_policies)

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

    datasets: list[Dataset] = []
    if req.collect:
        # Re-run at the base seed rather than threading trajectories out of the
        # harness. The engine is deterministic, so this is the same trajectory
        # `compare` scored — and when it stops being deterministic this line has
        # to change, which is why the seed is named here rather than defaulted.
        seed = req.seed or 0
        trajectories = {p.id: run(state, event, p, seed) for p in policies}
        datasets = collect(
            trajectories,
            {fid: f.name for fid, f in state.facilities.items()},
            req.collect,
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
        datasets=datasets,
    )
