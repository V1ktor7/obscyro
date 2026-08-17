"""The instances the ontology holds, and the aggregates derived from them.

The export used to count objects and ship the counts: forty-eight beds became
"48 units of space", and every property went with them. That made a whole class
of event inexpressible — a bed cannot become contaminated if the engine has
never heard of a bed, only of a number.

The direction is inverted here. Objects are the truth; `Resource` totals are a
view recomputed from them. So an effect that writes

    status: "available" → "contaminated"

reduces the ward's capacity as a *consequence*, and nothing in the care loop
needs to know the two are related. Text and numbers go through the same door.

One seam is worth stating rather than hiding: the simulation's own occupancy —
a patient admitted this tick — is still tracked as a scalar on `Resource`, not
by marking a particular bed. So "which twenty beds are contaminated" and "which
twenty beds hold patients" are not the same twenty. At the level the model
reasons about, totals, they agree; below it, they are not reconciled.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.events.domain import Facility, Resource

Role = str  # space | staff | stuff | systems | demand — validated upstream


class ObjectRules(BaseModel):
    """How to read availability off an object's own properties.

    Shipped with the data rather than written on both sides: availability has to
    be re-derived every time an effect edits a property, and a rule duplicated
    in two languages is a rule that will eventually disagree with itself.
    """

    unavailable_keys: list[str] = Field(default_factory=list)
    unavailable_values: list[str] = Field(default_factory=list)

    def unavailable(self, properties: dict) -> bool:
        wanted = {v.strip().lower() for v in self.unavailable_values}
        for key in self.unavailable_keys:
            value = properties.get(key)
            if isinstance(value, str) and value.strip().lower() in wanted:
                return True
        return False


class SimObject(BaseModel):
    """One instance, carried whole."""

    id: str
    type: str
    role: Role
    properties: dict = Field(default_factory=dict)
    # The unit it is attached to, or None if it hangs off nothing.
    at: str | None = None


def activity_of(type_name: str) -> str:
    """The activity an object of this type enables.

    Mirrors the exporter: the lowercased type name. A label, not a meaning — the
    engine treats it as an opaque token, so two twins that both call their beds
    `Bed` are comparable and one that calls them `Lit` is internally consistent.
    """
    return type_name.strip().lower().replace(" ", "_")


def derive_resources(
    objects: list[SimObject], rules: ObjectRules, facility_id: str
) -> dict[str, Resource]:
    """Rebuild one facility's resources from the objects sitting in it.

    Called at load and again whenever an effect edits a property, which is what
    makes the inversion real rather than decorative.
    """
    totals: dict[str, list[int]] = {}
    for o in objects:
        if o.at != facility_id or o.role == "demand":
            continue
        activity = activity_of(o.type)
        acc = totals.setdefault(activity, [0, 0])
        acc[0] += 1
        if rules.unavailable(o.properties):
            acc[1] += 1

    out: dict[str, Resource] = {}
    for activity, (total, used) in totals.items():
        role = next(
            (o.role for o in objects if o.at == facility_id and activity_of(o.type) == activity),
            "stuff",
        )
        out[activity] = Resource(
            id=activity,
            category=role,
            capacity=total,
            # Free units, not total. A bed already spoken for is not capacity
            # the event can use, and starting every run with an empty hospital
            # would flatter every response at once.
            quantity=max(0, total - used),
            enables=frozenset({activity}),
        )
    return out


def derive_census(objects: list[SimObject], facility_id: str) -> dict[str, float]:
    """People held here, by the type that represents them.

    Kept apart from resources because a person is not capacity: counting
    patients as a resource would make a ward look better staffed the fuller it
    got.
    """
    out: dict[str, float] = {}
    for o in objects:
        if o.at != facility_id or o.role != "demand":
            continue
        activity = activity_of(o.type)
        out[activity] = out.get(activity, 0.0) + 1
    return out


def rebuild(
    facility: Facility, objects: list[SimObject], rules: ObjectRules
) -> None:
    """Re-derive a facility's resources in place, preserving what is in use.

    Capacity comes from the objects; the *drawn-down* part comes from the run so
    far. Overwriting quantity outright would hand back every bed a patient is
    lying in the moment any effect touched the ward — the run would silently
    heal itself.
    """
    fresh = derive_resources(objects, rules, facility.id)
    for activity, resource in fresh.items():
        existing = facility.resources.get(activity)
        if existing is None:
            facility.resources[activity] = resource
            continue
        drawn = max(0.0, existing.capacity - existing.quantity)
        existing.capacity = resource.capacity
        existing.quantity = max(0.0, min(resource.quantity, resource.capacity - drawn))
    # An activity whose objects have all gone is not merely empty, it is absent;
    # leaving a stale zero-capacity resource behind would keep it in every
    # category total and in the composer's vocabulary.
    for activity in list(facility.resources):
        if activity not in fresh:
            del facility.resources[activity]
