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

from typing import Literal

from pydantic import BaseModel, Field

from app.events.domain import Facility, Resource

Role = str  # space | staff | stuff | systems | demand — validated upstream

# How a declared value composes when an effect lands on it. Mirrors
# `backend/src/services/property-schema.ts`; the two sides are versioned
# separately, so a behaviour added on one and not the other has to fail loudly
# here rather than be silently ignored.
Behaviour = Literal["level", "rate", "stock", "state"]


class PropertyDef(BaseModel):
    """One property, as the institution declared it.

    The engine's job is to do arithmetic on numbers. Which arithmetic is legal,
    and against what, is a fact about the number that only the institution
    knows — so it crosses in the payload rather than being decided here. Nothing
    in this class knows what a bed is.
    """

    key: str
    type: str = "string"
    label: str | None = None
    unit: str | None = None
    min: float | None = None
    max: float | None = None
    behaviour: Behaviour | None = None

    def clamp(self, value):
        """Hold a value inside the range the institution declared.

        Applied after the operation, not before: an author who multiplies a
        staffing level by zero means zero, and a declared minimum of one is the
        institution saying that is impossible. Silently allowing the impossible
        value would let the run answer a question about a world that cannot
        exist.
        """
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return value
        if self.min is not None:
            value = max(self.min, value)
        if self.max is not None:
            value = min(self.max, value)
        return value


class ObjectTypeDef(BaseModel):
    name: str
    role: str | None = None
    properties: list[PropertyDef] = Field(default_factory=list)


class PropertySchema(BaseModel):
    """The declared schema, indexed for the two questions the engine asks.

    Built once at load. An absent type or an absent key returns None, which the
    caller reports rather than fills in — the whole point of the exercise is that
    an undeclared quantity stays undeclared instead of acquiring a default nobody
    chose.
    """

    types: list[ObjectTypeDef] = Field(default_factory=list)

    def find(self, type_name: str, key: str) -> PropertyDef | None:
        for t in self.types:
            if t.name != type_name:
                continue
            for p in t.properties:
                if p.key == key:
                    return p
        return None

    def behaviour(self, type_name: str, key: str) -> Behaviour | None:
        declared = self.find(type_name, key)
        return declared.behaviour if declared else None


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


def matching(objects: list[SimObject], effect) -> list[SimObject]:
    """The objects an `object.property` effect addresses, in a stable order.

    Sorted by id, and `reach` takes from the front rather than at random. That
    is deliberately not realistic — a contamination does not pick the
    lowest-numbered beds — but a run that changes its answer between two
    identical invocations cannot be compared with anything, and realism here
    would buy nothing a fixed seed does not already give.
    """
    hits = [
        o
        for o in objects
        if effect.wants("object_type", o.type) and effect.wants("facility", o.at or "")
    ]
    hits.sort(key=lambda o: o.id)
    if effect.reach is None:
        return hits
    # Below 1 reads as a share of what matched; anything else is a count. A
    # share of nothing is nothing, and a count larger than the population is the
    # population — neither needs an error.
    take = round(len(hits) * effect.reach) if effect.reach < 1 else int(effect.reach)
    return hits[: max(0, min(take, len(hits)))]


def apply_property(
    effect, obj: SimObject, baseline: dict, schema: PropertySchema | None = None
) -> None:
    """Write one effect onto one object, composing the way the property says.

    Which value the operation reads is the whole question, and it is answered by
    the declaration rather than here:

        level, rate     compose from `baseline`. A multiplier applied to the
                        running value instead re-applies every tick and decays
                        the property to nothing, with every reading along the way
                        looking entirely reasonable. Same trap `Engine._resolve`
                        exists to avoid, no less dangerous on a property.
        stock           composes from the *running* value, because that is what
                        accumulating means. Rebuilding it from a baseline would
                        silently erase everything that had piled up.
        state           refuses arithmetic outright.

    An undeclared property falls back to baseline composition. That is not a
    guess about what the number means — `api.py` refuses arithmetic on an
    undeclared property before the run starts, so the only way to reach here
    without a declaration is `set`, which reads nothing.
    """
    key = effect.property_key
    if not key:
        return
    declared = schema.find(obj.type, key) if schema else None
    behaviour = declared.behaviour if declared else None

    if effect.op == "set":
        obj.properties[key] = declared.clamp(effect.value) if declared else effect.value
        return

    if behaviour == "state":
        # Declared a label, not a quantity. A triage level of 3 is not three of
        # anything, and halving it is a corrupted record rather than a milder
        # case.
        raise TypeError(
            f"effect {effect.id!r}: {key!r} on {obj.type} is declared a state, "
            f"which can only be set, not {effect.op}"
        )

    current = obj.properties.get(key) if behaviour == "stock" else baseline.get(key)
    if not isinstance(current, (int, float)) or isinstance(current, bool):
        # Refused rather than coerced. Multiplying a status by 0.6 has no
        # meaning, and inventing one would corrupt an instance in the
        # ontology's own vocabulary while the run carried on reporting numbers.
        raise TypeError(
            f"effect {effect.id!r}: {effect.op} needs a number, but {key!r} on "
            f"{obj.type} {obj.id!r} is {current!r}"
        )
    out = (
        current * float(effect.value) if effect.op == "multiply" else current + float(effect.value)
    )
    obj.properties[key] = declared.clamp(out) if declared else out


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
        # Free = what the objects say is free, minus what the run has admitted.
        # Inferring the second from `capacity - quantity` instead conflated it
        # with beds the ontology itself marked occupied, so an event that freed
        # them changed nothing and reopening a wing was impossible.
        existing.capacity = resource.capacity
        existing.quantity = max(0.0, resource.quantity - existing.reserved)
    # An activity whose objects have all gone is not merely empty, it is absent;
    # leaving a stale zero-capacity resource behind would keep it in every
    # category total and in the composer's vocabulary.
    for activity in list(facility.resources):
        if activity not in fresh:
            del facility.resources[activity]
