"""A response, as inspectable data.

This is the object the user iterates on and that an optimiser will later mutate
and search over, so every part of it is a pydantic model: serialisable,
diffable, and generable. Nothing here executes — `dynamics` does that.

Conditions are a small typed expression tree rather than a string passed to
`eval`. Two reasons, and the second is the one that matters: a tree can be shown
back to a minister as "fired because occupancy at Notre-Dame was 0.94, above
0.90", and a string cannot be searched over safely by a program that writes new
policies.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.crisis.domain import SystemState

# --- reading the world ------------------------------------------------------

MetricFn = Literal[
    "occupancy_ratio",  # used / capacity — per activity when named, else per category
    "available",        # units of an activity still free at a facility
    "capacity",         # total capacity, so "destroyed" is distinguishable from "empty"
    "total",            # sum of a category across a scope
    "backlog",          # unserved patients waiting at a facility
    "census",           # patients currently held
]


class Metric(BaseModel):
    """One number read from the state, named declaratively."""

    fn: MetricFn
    facility: str | None = None
    category: str | None = None
    activity: str | None = None
    acuity: str | None = None
    scope: list[str] | None = None

    def read(self, state: SystemState) -> float:
        if self.fn == "occupancy_ratio":
            return state.occupancy_ratio(
                self.facility or "", self.category or "space", self.activity
            )
        if self.fn == "available":
            return state.available_for(self.facility or "", self.activity or "")
        if self.fn == "capacity":
            return state.capacity_of(self.facility or "", self.category, self.activity)
        if self.fn == "total":
            return state.total(self.category or "", self.scope)
        if self.fn == "backlog":
            per = state.backlog.get(self.facility or "", {})
            return per.get(self.acuity, 0.0) if self.acuity else sum(per.values())
        if self.fn == "census":
            per = state.census.get(self.facility or "", {})
            return per.get(self.acuity, 0.0) if self.acuity else sum(per.values())
        raise ValueError(f"unknown metric {self.fn}")

    def describe(self, state: SystemState) -> str:
        where = self.facility or (",".join(self.scope) if self.scope else "system")
        what = self.activity or self.acuity or self.category or ""
        return f"{self.fn}({where}{':' + what if what else ''})={self.read(state):.4g}"


Op = Literal[">", ">=", "<", "<=", "==", "!="]


class Comparison(BaseModel):
    left: Metric
    op: Op
    right: float

    def evaluate(self, state: SystemState) -> bool:
        v = self.left.read(state)
        return {
            ">": v > self.right,
            ">=": v >= self.right,
            "<": v < self.right,
            "<=": v <= self.right,
            "==": v == self.right,
            "!=": v != self.right,
        }[self.op]

    def describe(self, state: SystemState) -> str:
        return f"{self.left.describe(state)} {self.op} {self.right:g}"


class Condition(BaseModel):
    """A boolean over state. Exactly one field is set."""

    compare: Comparison | None = None
    all_of: list["Condition"] | None = None
    any_of: list["Condition"] | None = None
    negate: "Condition | None" = None
    always: bool | None = None

    def evaluate(self, state: SystemState) -> bool:
        if self.always is not None:
            return self.always
        if self.compare is not None:
            return self.compare.evaluate(state)
        if self.all_of is not None:
            return all(c.evaluate(state) for c in self.all_of)
        if self.any_of is not None:
            return any(c.evaluate(state) for c in self.any_of)
        if self.negate is not None:
            return not self.negate.evaluate(state)
        return False

    def describe(self, state: SystemState) -> str:
        if self.always is not None:
            return "always" if self.always else "never"
        if self.compare is not None:
            return self.compare.describe(state)
        if self.all_of is not None:
            return " and ".join(c.describe(state) for c in self.all_of)
        if self.any_of is not None:
            return " or ".join(c.describe(state) for c in self.any_of)
        if self.negate is not None:
            return f"not ({self.negate.describe(state)})"
        return "?"


Condition.model_rebuild()


# --- acting on the world ----------------------------------------------------


class Friction(BaseModel):
    """Nothing a government does is instant, free, or fully obeyed.

    A model without these three makes every policy look better than it is, which
    is the failure mode that discredits the whole exercise.
    """

    delay: int = 0
    cost: float = 0.0
    effectiveness: float = 1.0


class Action(BaseModel):
    """A typed operation on the primitives. `kind` selects the handler."""

    kind: Literal["transfer", "surge_resource", "reallocate", "modify_demand"]
    # transfer / reallocate
    source: str | None = None
    target: str | None = None
    # what moves
    activity: str | None = None
    acuity: str | None = None
    resource: str | None = None
    category: str | None = None
    amount: float = 0.0
    # modify_demand: scale the arriving demand for a population
    population: str | None = None
    factor: float = 1.0
    friction: Friction = Field(default_factory=Friction)


class Trigger(BaseModel):
    """When a rule is even considered. Cheap gate before the condition."""

    when: Literal["every_tick", "from_tick", "between"] = "every_tick"
    start: int = 0
    end: int | None = None

    def eligible(self, tick: int) -> bool:
        if self.when == "every_tick":
            return True
        if self.when == "from_tick":
            return tick >= self.start
        return self.start <= tick <= (self.end if self.end is not None else tick)


class Rule(BaseModel):
    id: str
    trigger: Trigger = Field(default_factory=Trigger)
    condition: Condition = Field(default_factory=lambda: Condition(always=True))
    action: Action
    # Higher wins when two rules contend for the same target.
    priority: int = 0
    scope: list[str] = Field(default_factory=list)
    # "A unless B": this rule stands down when the named rule fired this tick.
    unless: str | None = None


class Policy(BaseModel):
    id: str
    name: str = ""
    rules: list[Rule] = Field(default_factory=list)
    objective: str | None = None

    def ordered(self) -> list[Rule]:
        """Deterministic order: priority first, then id.

        Sorting by id as a tiebreak is not cosmetic — two rules of equal
        priority must not swap places because a dict was built differently, or
        the same policy would score differently on two runs.
        """
        return sorted(self.rules, key=lambda r: (-r.priority, r.id))


def null_policy() -> Policy:
    """Do nothing. The reference every other policy is scored against.

    Worth being an explicit object rather than `None`: the comparison harness
    then has no special case, and the baseline appears in the results table like
    any other candidate.
    """
    return Policy(id="null", name="No response", rules=[])
