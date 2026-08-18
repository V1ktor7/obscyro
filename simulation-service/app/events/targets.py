"""What can be perturbed, and how perturbations compose on it.

The engine used to ship three effect classes — demand, capacity, connectivity —
and a fourth was needed the moment anyone tried to model a disease getting worse
rather than more common. Hard-coding a fifth would have been the same mistake
one iteration later.

So the engine publishes a catalogue instead. An effect names a `path` from this
file, a selection, an operation and a schedule; nothing about it is a class.
Adding something perturbable is one entry here, and it appears in the composer
without a line of UI changing.

    THE PART THAT IS NOT NEGOTIABLE

`compose` is a property of the quantity, not a choice the author gets to make,
and this is the whole reason the catalogue exists rather than a free-form "set
any number" effect.

A capacity is re-derived from a baseline every tick. Apply a 0.5 multiplier to
the *running* value instead and it re-applies each tick: 0.5^60 is 8.7e-19. The
run completes, every rule fires plausibly, and the report says the network
collapsed under a 50% shock. That is not a hypothetical — the same shape of bug
(a value compounding when it should have been re-derived) is why this codebase
has a `baseline_capacity` map at all.

A queue is the opposite: it accumulates, and re-deriving it from a baseline
would silently erase everyone still waiting.

Getting this wrong produces runs that are wrong and beautiful. So the author
picks *what* to perturb and *by how much*; the catalogue decides how that
composes, once, here.

Precedence between operations on one quantity is fixed in `Engine._resolve` and
is likewise not the author's to choose: `set` establishes a value, `multiply`
then composes against it, `add` is summed on last. Written the obvious way —
applying effects in list order — the order of a JSONB array silently decided the
simulated network, and a resave that reordered it changed the answer with
nothing raised anywhere.

Of those three, the first two follow from what the operations mean. That
`multiply` runs before `add` is a convention and is marked as such where it is
implemented.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Op = Literal["multiply", "add", "set"]

# How repeated or simultaneous perturbations of one quantity combine.
#
#   baseline    the quantity is rebuilt each tick from an unperturbed baseline,
#               then every active effect is applied to *that*. Effects do not
#               compound over time, and two effects on one quantity multiply
#               once each.
#   accumulate  the effect contributes a per-tick amount into a running total
#               that the engine owns. Nothing is re-derived; nothing decays.
Compose = Literal["baseline", "accumulate"]

# Selector dimensions a target can be narrowed by. An omitted or empty dimension
# means "all of them", which is the common case and should not require typing
# out every facility in a network.
Dimension = Literal[
    "facility", "category", "activity", "acuity", "population", "route", "object_type"
]


class Target(BaseModel):
    """One addressable quantity in the model."""

    path: str
    label: str
    help: str
    selector: list[Dimension] = Field(default_factory=list)
    ops: list[Op]
    compose: Compose
    minimum: float | None = 0.0
    maximum: float | None = None
    # What the number means, for the composer to render a unit beside the field.
    unit: str = ""


CATALOGUE: list[Target] = [
    Target(
        path="object.property",
        label="A property of the objects themselves",
        help=(
            "Changes the instances, not a total. Set a bed's status to "
            "“contaminated”, a patient's to “sick”, a ward's kind to "
            "“overflow”. Capacity follows as a consequence, because totals are "
            "counted from the objects rather than stored beside them — so this is the "
            "only target whose value may be text."
        ),
        selector=["object_type", "facility"],
        # `set` is the operation this exists for. `multiply` and `add` work on a
        # numeric property, and are refused at run time on a string rather than
        # coercing it, because a silent coercion here would corrupt an instance
        # in the ontology's own vocabulary.
        ops=["set", "multiply", "add"],
        compose="baseline",
        # Bounds belong to the property, not to the target: a status has none,
        # and a numeric property's range is the ontology's business.
        minimum=None,
        maximum=None,
    ),
    Target(
        path="resource.capacity",
        label="Capacity of a resource",
        help=(
            "How much of something a facility has at all. Setting it to 0 destroys it; "
            "a multiplier above 1 is a wing opening rather than a wing lost."
        ),
        selector=["facility", "category", "activity"],
        ops=["multiply", "set", "add"],
        compose="baseline",
        unit="units",
    ),
    Target(
        path="edge.weight",
        label="Throughput of a route",
        help=(
            "A fraction of the route's rated capacity. 0 severs it, 0.5 halves it, "
            "above 1 widens it."
        ),
        selector=["route"],
        ops=["multiply", "set"],
        compose="baseline",
        unit="×",
    ),
    # `care.stay_ticks`, `care.mortality_per_unmet` and `care.consumes` used to
    # sit here. They were the last quantities the engine invented on the
    # institution's behalf, and they came with a hospital's values attached —
    # stays of six, three and one step, one bed and a fraction of a nurse per
    # patient, mortality at 0.15 divided by ten and two hundred. A transit
    # authority opening this product was handed them too.
    #
    # A care model is now declared as ontology instances whose properties bind
    # `occupies_for`, `dies_without`, `consumes_activity` and `consumes_amount`
    # (see `mechanics.py`), and an event changes one the same way it changes
    # anything else: `object.property` on the protocol. The model is re-derived
    # from those instances every tick, so the effect reaches what the care loop
    # actually reads.
    #
    # An event saved against the old paths still loads. It names a target this
    # catalogue no longer offers, which the composer reports as inert and
    # refuses to save over — deliberately louder than rewriting it, because an
    # event that quietly models less than it says is the failure this whole file
    # is written against.
    Target(
        path="demand.incidence",
        label="Arrival rate, scaled by the population",
        help=(
            "Per thousand people served, per step, so each population generates demand "
            "in proportion to its own size. This is the form almost every event wants: "
            "something spreading through a population reaches a share of it, not a "
            "share of a facility. Negative removes demand — prevention is a fact about "
            "the world, not a response to one."
        ),
        selector=["population", "acuity"],
        # See `demand.volume` below for why only `add`.
        ops=["add"],
        compose="accumulate",
        minimum=None,
        # The divisor is named in the unit rather than hidden in the arithmetic:
        # it is a rate convention, and an author who can see it can convert. It
        # is deliberately not changed to per-capita, which would rescale every
        # saved event by a thousand without a word.
        unit="per 1000/step",
    ),
    Target(
        path="demand.volume",
        label="Arrivals per step, flat",
        help=(
            "A flat count per step at each selected population, ignoring how many "
            "people it serves. For a coach crash that brings forty people whatever the "
            "catchment; use the rate above for anything that scales with a population."
        ),
        selector=["population", "acuity"],
        # Only `add`: a queue has no baseline to multiply. Offering `multiply`
        # here would read as "halve the wave" and silently do nothing, because
        # there is no prior value at this address to halve.
        ops=["add"],
        compose="accumulate",
        # Individual effects may be negative; the engine clamps the *net*, so
        # prevention can cancel a wave but never invert it.
        minimum=None,
        unit="patients/step",
    ),
]

BY_PATH: dict[str, Target] = {t.path: t for t in CATALOGUE}


def target(path: str) -> Target:
    if path not in BY_PATH:
        raise KeyError(
            f"unknown target {path!r}; available: {', '.join(sorted(BY_PATH))}"
        )
    return BY_PATH[path]


def apply_op(base: float, op: Op, value: float) -> float:
    if op == "multiply":
        return base * value
    if op == "add":
        return base + value
    return value


def clamp(t: Target, v: float) -> float:
    if t.minimum is not None:
        v = max(t.minimum, v)
    if t.maximum is not None:
        v = min(t.maximum, v)
    return v
