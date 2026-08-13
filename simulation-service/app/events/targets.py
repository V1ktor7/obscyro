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
Dimension = Literal["facility", "category", "activity", "acuity", "population", "route"]


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
    Target(
        path="care.stay_ticks",
        label="Length of stay",
        help=(
            "How long one patient of this severity occupies what they consume. This is "
            "where a disease that lingers is expressed — the clinical signature of an "
            "illness, as opposed to how many people catch it. Because discharge is "
            "recomputed every tick, lengthening it also holds the patients already "
            "admitted, which is what 'it turned out to be worse than we thought' "
            "actually looks like."
        ),
        selector=["acuity"],
        ops=["multiply", "add", "set"],
        compose="baseline",
        minimum=1.0,
        unit="steps",
    ),
    Target(
        path="care.mortality_per_unmet",
        label="Deaths per unserved patient, per step",
        help=(
            "The most contestable number in the model and the one a minister will be "
            "asked to defend. It belongs in an event, where it can be argued with."
        ),
        selector=["acuity"],
        ops=["multiply", "set"],
        compose="baseline",
        minimum=0.0,
        maximum=1.0,
    ),
    Target(
        path="care.consumes",
        label="What one patient consumes",
        help=(
            "Units of an activity per patient per step. Raising it models a case that "
            "is heavier to treat without any more cases arriving."
        ),
        selector=["acuity", "activity"],
        ops=["multiply", "add", "set"],
        compose="baseline",
        minimum=0.0,
    ),
    Target(
        path="demand.volume",
        label="Patients arriving",
        help=(
            "Per step, before the severity mix is applied. Negative removes demand — a "
            "vaccination programme is a fact about the world, not a response to one."
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
