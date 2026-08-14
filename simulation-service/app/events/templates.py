"""Events and responses that fit whatever system they are handed.

`examples/scenarios.py` names `"north"` and `"city"`. A real twin names its
wards with UUIDs, so those cannot be pointed at it — and asking a health
authority to hand-write an effect per ward is not a product.

A template takes a `SystemState` and returns an `Event` or a `Policy` fitted to
the ids actually in it. The engine is untouched: what comes out is ordinary
`Effect` rows, editable in the composer like anything a user wrote by hand.
That is also the test of whether the catalogue is complete — these three
templates used to be three bespoke perturbation classes, and if any of them
still needed one, the generic effect would not have earned its place.

The care model lives here too, and not for filing convenience. What an admission
consumes and how many die when it is refused are properties of the *event*, not
of the building — a flood sends trauma and a pandemic sends respiratory failure
— and no ontology holds them. Keeping them beside the event is what stops them
being silently defaulted somewhere in the loader.
"""

from __future__ import annotations

from typing import Callable

from app.events.domain import CareRequirement, SPACE, STAFF, STUFF, SYSTEMS, SystemState
from app.events.effects import Effect, Event, TemporalProfile
from app.events.policy import (
    Action,
    Comparison,
    Condition,
    Friction,
    Metric,
    Policy,
    Rule,
    null_policy,
)

# --- the care model ---------------------------------------------------------

# Activities named the way the exporter names them: the lowercased object type.
# A twin whose beds are an object type called `Bed` offers `bed`; one that calls
# them `Lit` offers `lit`. `activities_of` reads what is actually on offer
# instead of assuming, so a French ontology needs no translation table.
BASELINE_ACUITIES = ("critical", "urgent", "routine")


def activities_of(state: SystemState, category: str | None = None) -> list[str]:
    """Every activity the twin can actually provide, in a stable order."""
    out: set[str] = set()
    for f in state.facilities.values():
        for r in f.resources.values():
            if category is None or r.category == category:
                out.update(r.enables)
    return sorted(out)


def _available_everywhere(state: SystemState, category: str) -> list[str]:
    """Activities every capacity-carrying facility can provide.

    A care model is global — one `CareRequirement` per acuity, applied at every
    facility — so it can only require what every facility has. Requiring a nurse
    when one ward has no staff type recorded makes that ward unable to treat
    anybody, ever: `servable` is capped by the scarcest input and the scarcest
    input is zero. The ward then looks like a death trap, transfers into it kill
    people, and the cause is a missing declaration rather than a missing nurse.
    """
    carrying = [f for f in state.facilities.values() if f.resources]
    if not carrying:
        return []
    common: set[str] | None = None
    for f in carrying:
        here = {a for r in f.resources.values() if r.category == category for a in r.enables}
        common = here if common is None else (common & here)
    return sorted(common or set())


def care_model_for(state: SystemState, *, mortality: float = 0.15) -> dict[str, CareRequirement]:
    """A three-acuity model expressed against the twin's own activities.

    The mortality figure is the single most contestable number in the whole
    exercise and the one a minister will be asked to defend, so it is a named
    argument with a visible default rather than a constant buried in a formula.

    Everyone consumes the same space here, which is a simplification worth
    stating: a real model distinguishes an ICU bed from a ward bed, and this one
    cannot until the ontology does. The consequence is that it under-reports
    critical-care shortage — the failure mode found on the engine's first run,
    now merely inherited rather than hidden.
    """
    space = _available_everywhere(state, SPACE)
    staff = _available_everywhere(state, STAFF)
    if not space:
        raise ValueError(
            "No single kind of space exists at every facility, so one care model "
            "cannot describe them all. Either declare a crisis role on the type "
            "that represents beds, or give the units that lack one their own model."
        )
    bed, nurse = space[0], (staff[0] if staff else None)

    def consumes(bed_units: float, nurse_units: float) -> dict[str, float]:
        c = {bed: bed_units}
        if nurse:
            c[nurse] = nurse_units
        return c

    return {
        "critical": CareRequirement(
            acuity="critical",
            consumes=consumes(1.0, 0.5),
            mortality_per_unmet=mortality,
            stay_ticks=6,
        ),
        "urgent": CareRequirement(
            acuity="urgent",
            consumes=consumes(1.0, 0.2),
            mortality_per_unmet=mortality / 10,
            stay_ticks=3,
        ),
        "routine": CareRequirement(
            acuity="routine",
            consumes=consumes(1.0, 0.1),
            # Not zero. A routine case turned away for weeks is not a
            # non-event, and a model that scores it at zero will always prefer
            # abandoning routine care.
            mortality_per_unmet=mortality / 200,
            stay_ticks=1,
        ),
    }


# --- crises -----------------------------------------------------------------


def _all_populations(state: SystemState) -> list[str]:
    return sorted(state.populations)


def _all_facilities(state: SystemState) -> list[str]:
    return sorted(state.facilities)


# Admissions per thousand people served, per step, with a step read as a day.
# Anchored on published orders of magnitude rather than invented: an ordinary
# day runs around 0.3 hospital admissions per thousand residents, and a severe
# respiratory wave roughly doubles that at its peak.
#
# They are starting points a health authority is expected to argue with, which
# is why they are named constants in one place rather than multipliers buried
# inside three templates.
ORDINARY_DAY = 0.30
PANDEMIC_PEAK = 0.45
FLOOD_TRAUMA_PULSE = 0.60


def _rate(
    eid: str,
    state: SystemState,
    mix: dict[str, float],
    total: float,
    profile: TemporalProfile,
) -> list[Effect]:
    """A severity mix, as one incidence effect per severity.

    Rates, not counts. Demand used to be anchored on the network's own bed
    capacity, which meant doubling a hospital's beds doubled its patients and
    left occupancy untouched — so building a wing could never help, and the
    catchment size the loader insisted on was never read.

    The old form carried an `acuity_mix` field; the generic effect needs none.
    A mix is just several rates, and expressing it that way lets someone raise
    the critical share of an event without re-deriving every other proportion.
    """
    out: list[Effect] = []
    share = sum(mix.values()) or 1.0
    for acuity, w in mix.items():
        out.append(
            Effect(
                id=f"{eid}-{acuity}",
                target="demand.incidence",
                select={"population": _all_populations(state), "acuity": [acuity]},
                op="add",
                value=total * (w / share),
                profile=profile,
            )
        )
    return out


def pandemic(state: SystemState, horizon: int = 60) -> Event:
    """A wave of respiratory cases, with staff falling sick as it peaks.

    Demand up, staff down, supplies down. The staff curve trails the demand
    curve because that is what makes the second half worse than the first, and
    a model where they peak together understates the event.
    """
    effects = _rate(
        "wave", state, {"critical": 0.15, "urgent": 0.35, "routine": 0.5}, PANDEMIC_PEAK,
        TemporalProfile(start=0, end=horizon, shape="gaussian", peak=1.0,
                        peak_tick=horizon // 3),
    )
    effects.append(
        Effect(
            id="staff-sickness",
            target="resource.capacity",
            select={"category": [STAFF]},
            op="multiply",
            value=0.7,
            profile=TemporalProfile(start=horizon // 6, end=horizon, shape="ramp", peak=1.0),
        )
    )
    if activities_of(state, STUFF):
        effects.append(
            Effect(
                id="supply-strain",
                target="resource.capacity",
                select={"category": [STUFF]},
                op="multiply",
                value=0.6,
                profile=TemporalProfile(start=horizon // 4, end=horizon, shape="step", peak=1.0),
            )
        )
    return Event(
        id="pandemic",
        name="Pandemic wave",
        description="Respiratory surge over a whole network, with staff attrition behind it.",
        horizon=horizon,
        effects=effects,
    )


def flood(state: SystemState, horizon: int = 30) -> Event:
    """One site under water, its routes cut, trauma arriving everywhere.

    The site chosen is the one with the least capacity — the honest worst case
    for a template with no map to consult. Which building floods is a real
    input, and the composer lets it be chosen; picking the largest by default
    would manufacture a catastrophe and make every policy look heroic.
    """
    facilities = _all_facilities(state)
    if not facilities:
        raise ValueError("no facilities to flood")
    hit = min(facilities, key=lambda fid: (state.capacity_of(fid), fid))
    routes = [
        f"{e.source}>{e.target}"
        for e in state.network.all_edges()
        if hit in (e.source, e.target)
    ]
    effects = [
        Effect(
            id="inundation",
            target="resource.capacity",
            select={"facility": [hit]},
            op="set",
            value=0.0,
            profile=TemporalProfile(start=2, end=horizon, shape="step", peak=1.0),
        )
    ]
    effects += _rate(
        "trauma", state, {"critical": 0.35, "urgent": 0.45, "routine": 0.2},
        FLOOD_TRAUMA_PULSE,
        TemporalProfile(start=2, end=10, shape="pulse", peak=1.0),
    )
    if routes:
        effects.append(
            Effect(
                id="roads-cut",
                target="edge.weight",
                select={"route": routes},
                op="set",
                value=0.0,
                profile=TemporalProfile(start=2, end=horizon // 2, shape="step", peak=1.0),
            )
        )
    return Event(
        id="flood",
        name="Flood",
        description=f"{state.facility(hit).name or hit} inundated and cut off; trauma surge.",
        horizon=horizon,
        effects=effects,
    )


def cyberattack(state: SystemState, horizon: int = 40) -> Event:
    """Systems down and nothing else touched.

    The purest test of whether the primitives were chosen well: no demand
    effect beyond an ordinary day, no bed destroyed. If a cyberattack still
    kills people, it is because the cascade carried it there — and if it does
    not, the model is saying this twin's care does not depend on its systems,
    which is a finding about the ontology rather than about the attack.
    """
    systems = activities_of(state, SYSTEMS)
    effects = _rate(
        "steady-state", state, {"critical": 0.1, "urgent": 0.3, "routine": 0.6},
        ORDINARY_DAY,
        TemporalProfile(start=0, end=horizon, shape="step", peak=1.0),
    )
    if systems:
        effects.append(
            Effect(
                id="ransomware",
                target="resource.capacity",
                select={"category": [SYSTEMS]},
                op="multiply",
                value=0.1,
                profile=TemporalProfile(start=3, end=horizon - 5, shape="step", peak=1.0),
            )
        )
    return Event(
        id="cyberattack",
        name="Cyberattack",
        description=(
            "Systems degraded network-wide. Nothing else is perturbed."
            if systems
            else "No object type in this twin declares the `systems` role, so this "
            "attack has nothing to degrade and the run will show a normal day."
        ),
        horizon=horizon,
        effects=effects,
    )


# --- responses --------------------------------------------------------------


def _busiest_activity(state: SystemState) -> str:
    space = activities_of(state, SPACE)
    return space[0] if space else "bed"


def load_balance(state: SystemState) -> Policy:
    """Move waiting patients along whatever routes exist.

    One rule per route, generated from the network rather than written by hand.
    A network with no routes yields a policy with no rules — identical to doing
    nothing, which is the truthful result and not an error.
    """
    activity = _busiest_activity(state)
    rules: list[Rule] = []
    for e in sorted(state.network.all_edges(), key=lambda x: (x.source, x.target)):
        if e.kind != "transfer":
            continue
        rules.append(
            Rule(
                id=f"overflow-{e.source[:8]}-{e.target[:8]}",
                condition=Condition(
                    all_of=[
                        Condition(
                            any_of=[
                                Condition(
                                    compare=Comparison(
                                        left=Metric(
                                            fn="occupancy_ratio",
                                            facility=e.source,
                                            activity=activity,
                                        ),
                                        op=">",
                                        right=0.9,
                                    )
                                ),
                                # Occupancy alone cannot see a destroyed site: no
                                # capacity means no fraction, so a flooded ward
                                # holding a hundred stranded patients reads 0%.
                                # The queue is what makes it visible.
                                Condition(
                                    compare=Comparison(
                                        left=Metric(fn="backlog", facility=e.source),
                                        op=">",
                                        right=5,
                                    )
                                ),
                            ]
                        ),
                        # Only send people somewhere that can take them.
                        #
                        # Without this the rule reads only the source, and a
                        # saturated network transfers its sickest into a ward
                        # with no free bed — where they queue behind that ward's
                        # own critical patients instead of being served first at
                        # home, and die. Measured on the toy network once demand
                        # became realistic, that made load-balancing *worse*
                        # than doing nothing (30.0 deaths against 26.2) while
                        # its trace showed rules firing and patients moving.
                        # No transfer protocol sends to a full hospital.
                        Condition(
                            compare=Comparison(
                                left=Metric(
                                    fn="available", facility=e.target, activity=activity
                                ),
                                op=">",
                                right=0,
                            )
                        ),
                    ]
                ),
                action=Action(
                    kind="transfer",
                    source=e.source,
                    target=e.target,
                    amount=6,
                    friction=Friction(delay=0, cost=500, effectiveness=0.9),
                ),
                priority=10,
            )
        )
    return Policy(id="load-balance", name="Transfer when full", rules=rules)


def surge_and_balance(state: SystemState) -> Policy:
    """Buy capacity as well as moving load.

    One rule per resource, each watching *its own* scarcity rather than the
    facility's general busyness. The obvious version of this template picks the
    binding constraint once, when the policy is built, and surges that thing for
    the rest of the run — so a ward that started short of nurses keeps hiring
    nurses long after beds became the limit. In the first run against a real
    twin that spent 1.2 M and served no additional patient, while the trace
    showed a rule firing fifty-five times and looked entirely healthy.

    Surging arrives three ticks late and costs real money, so it should beat
    load-balancing on deaths and lose on cost. If it wins on both, the friction
    is not being applied and the model is flattering the expensive option.
    """
    base = load_balance(state)
    rules = list(base.rules)
    for fid in _all_facilities(state):
        for r in sorted(state.facility(fid).resources.values(), key=lambda x: x.id):
            if r.capacity <= 0:
                continue
            activity = sorted(r.enables)[0] if r.enables else r.id
            rules.append(
                Rule(
                    id=f"surge-{fid[:8]}-{r.id}",
                    condition=Condition(
                        compare=Comparison(
                            left=Metric(fn="occupancy_ratio", facility=fid, activity=activity),
                            op=">",
                            right=0.85,
                        )
                    ),
                    action=Action(
                        kind="surge_resource",
                        target=fid,
                        resource=r.id,
                        # A tenth of what is already there, so the template
                        # scales with the facility instead of being generous to
                        # a clinic and irrelevant to a teaching hospital.
                        amount=max(1.0, r.capacity * 0.1),
                        friction=Friction(delay=3, cost=25_000, effectiveness=0.8),
                    ),
                    priority=20,
                )
            )
    return Policy(id="surge-and-balance", name="Surge what is short, then transfer", rules=rules)


EVENTS: dict[str, Callable[[SystemState], Event]] = {
    "pandemic": pandemic,
    "flood": flood,
    "cyberattack": cyberattack,
}

POLICIES: dict[str, Callable[[SystemState], Policy]] = {
    "null": lambda _state: null_policy(),
    "load-balance": load_balance,
    "surge-and-balance": surge_and_balance,
}
