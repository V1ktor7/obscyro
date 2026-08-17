"""Reading the real twin instead of a hand-written example.

`examples/system.py` invents three facilities so the engine can be tested. This
module takes the export the platform produces from the actual ontology — nine
sites, twenty-one units, the beds that are really in them — and turns it into
the same `SystemState`.

The contract is a payload, not a database connection. The ontology's rules stay
in the backend that already enforces them, and this side never learns what a
`sited_at` is. That keeps the engine a pure function of its input, which is what
makes a run reproducible and a bug attributable to one side or the other.

The one thing the payload cannot carry is the **care model**: what an admission
consumes and how many people die when it is refused. No ontology holds those.
They are clinical and political numbers, so `load()` refuses to invent them and
requires the caller to pass them in with the crisis.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, NonNegativeFloat

from app.events.domain import (
    CareRequirement,
    Edge,
    Facility,
    NetworkxBackend,
    Population,
    Resource,
    SystemState,
)
from app.events.objects import ObjectRules, SimObject, derive_census, derive_resources

# Mirrors the `crisis_role` check constraint in migration 045. Kept as a literal
# rather than imported from anywhere: the two sides are versioned separately, so
# a role added on one and not the other has to fail loudly here.
CrisisRole = Literal["space", "staff", "stuff", "systems", "demand"]


class ExportedResource(BaseModel):
    id: str
    category: str
    quantity: NonNegativeFloat
    capacity: NonNegativeFloat
    enables: list[str] = Field(default_factory=list)


class ExportedFacility(BaseModel):
    id: str
    name: str = ""
    location: tuple[float, float] | None = None
    resources: dict[str, ExportedResource] = Field(default_factory=dict)
    census: dict[str, float] = Field(default_factory=dict)


class ExportedEdge(BaseModel):
    source: str
    target: str
    kind: Literal["transfer", "supply", "information"] = "transfer"
    capacity: NonNegativeFloat = 0.0
    via: str = ""


class ExportedPopulation(BaseModel):
    id: str
    name: str = ""
    size: NonNegativeFloat = 0.0
    served_by: list[str] = Field(default_factory=list)


class Gap(BaseModel):
    code: str
    message: str
    subjects: list[str] = Field(default_factory=list)


class OntologyExport(BaseModel):
    """Exactly what `GET /v1/ontology/:env/twin/crisis-export` returns."""

    environment: str = ""
    generated_at: str = ""
    facilities: list[ExportedFacility] = Field(default_factory=list)
    # Every instance that plays a role, with its properties intact. The
    # `resources` and `census` on each facility above are a *view* of these,
    # computed by the exporter from the same array — kept because the composer
    # wants them, never read here.
    objects: list[SimObject] = Field(default_factory=list)
    object_rules: ObjectRules = Field(default_factory=ObjectRules)
    populations: list[ExportedPopulation] = Field(default_factory=list)
    edges: list[ExportedEdge] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)


class UnrunnableExport(ValueError):
    """The twin does not describe enough of a system to simulate.

    Raised rather than returning a degraded state, because every failure this
    guards produces a *plausible* run: a network with no capacity anywhere
    reports zero deaths and every policy ties for first place. A result that
    looks fine and means nothing is worse than an error.
    """


def load(
    export: OntologyExport | dict[str, Any],
    care_model: dict[str, CareRequirement],
    *,
    population_sizes: dict[str, float] | None = None,
    route_capacity: float | None = None,
    census_acuity: str | None = None,
) -> SystemState:
    """Turn a platform export into a runnable world.

    `population_sizes` and `route_capacity` fill the two holes the ontology
    cannot: how many people a site serves, and how many patients a route can
    move in a tick. Both are keyed by the ids in the export, and both are
    required in practice — see the checks at the end, which refuse a system that
    would run and mean nothing.

    `census_acuity` decides what happens to the patients already in the
    building. Left as None, occupied beds simply start unavailable and stay
    that way, which makes every run pessimistic in the same direction. Naming an
    acuity instead admits them as patients, so they occupy a bed, then leave and
    free it. The second is more realistic and needs an assumption about who they
    are, so it is the caller's to make, not this module's.
    """
    ex = export if isinstance(export, OntologyExport) else OntologyExport.model_validate(export)
    sizes = population_sizes or {}

    facilities: dict[str, Facility] = {}
    census: dict[str, dict[str, float]] = {}
    for f in ex.facilities:
        # Derived from the objects, never read from the payload's aggregates.
        # Those exist for the composer; taking them here would leave two truths
        # and no way to tell which one an effect had edited.
        facilities[f.id] = Facility(
            id=f.id,
            name=f.name,
            location=f.location,
            resources=derive_resources(ex.objects, ex.object_rules, f.id),
        )
        if census_acuity:
            held = sum(derive_census(ex.objects, f.id).values())
            if held:
                census[f.id] = {census_acuity: held}

    network = NetworkxBackend()
    for fid in facilities:
        network.add_node(fid)
    for e in ex.edges:
        # Endpoints that are not facilities would create phantom nodes the
        # policies can route into and never come back from.
        if e.source not in facilities or e.target not in facilities:
            continue
        network.add_edge(
            Edge(
                source=e.source,
                target=e.target,
                kind=e.kind,
                capacity=e.capacity if route_capacity is None else route_capacity,
            )
        )

    populations: dict[str, Population] = {}
    for p in ex.populations:
        served = [u for u in p.served_by if u in facilities]
        populations[p.id] = Population(
            id=p.id,
            size=sizes.get(p.id, p.size),
            served_by=served,
        )

    state = SystemState(
        facilities=facilities,
        populations=populations,
        care_model=dict(care_model),
        network=network,
        census=census,
        objects={o.id: o for o in ex.objects},
        object_rules=ex.object_rules,
    )
    _refuse_if_hollow(state, care_model)
    return state


def _refuse_if_hollow(state: SystemState, care_model: dict[str, CareRequirement]) -> None:
    """Reject the shapes that run cleanly and answer nothing."""
    if not state.facilities:
        raise UnrunnableExport(
            "The export contains no facilities. Nothing in the ontology is placed "
            "where care could happen."
        )
    if not care_model:
        raise UnrunnableExport(
            "No care model. The ontology says what exists, not what an admission "
            "consumes or what happens when it is refused — supply it with the crisis."
        )

    total_capacity = sum(
        r.capacity for f in state.facilities.values() for r in f.resources.values()
    )
    if total_capacity <= 0:
        raise UnrunnableExport(
            "No facility carries any capacity. Every policy would tie at zero deaths "
            "and the comparison would be meaningless. Declare a crisis role on the "
            "object types that represent beds, staff and equipment."
        )

    if not state.populations or all(p.size <= 0 for p in state.populations.values()):
        raise UnrunnableExport(
            "Every population has size 0, so no demand can arrive and no policy can "
            "be told apart from doing nothing. The ontology holds no catchment — set "
            "the sizes on the run."
        )

    # A care model whose activities nothing enables is the quiet failure: every
    # patient goes unserved, deaths look catastrophic, and the cause is a
    # spelling difference between the ontology and the scenario.
    offered = {a for f in state.facilities.values() for r in f.resources.values() for a in r.enables}
    wanted = {a for c in care_model.values() for a in c.consumes}
    orphans = sorted(wanted - offered)
    if orphans and not (wanted & offered):
        raise UnrunnableExport(
            "The care model consumes "
            + ", ".join(orphans)
            + " and nothing in the twin provides any of them. Every patient would go "
            "unserved for a naming mismatch rather than a real shortage. Available: "
            + (", ".join(sorted(offered)) or "nothing")
            + "."
        )


def blocking_gaps(export: OntologyExport | dict[str, Any]) -> list[Gap]:
    """The gaps that stop a run, as opposed to the ones that merely narrow it.

    Used by the UI to decide whether the run button is worth offering, without
    having to reimplement `_refuse_if_hollow`'s reasoning in TypeScript.
    """
    ex = export if isinstance(export, OntologyExport) else OntologyExport.model_validate(export)
    blocking = {"POPULATION_WITHOUT_SIZE", "ROUTE_WITHOUT_CAPACITY", "NO_CARE_MODEL"}
    return [g for g in ex.gaps if g.code in blocking]
