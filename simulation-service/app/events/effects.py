"""An event is a bundle of effects. It executes nothing.

The versatility claim rests entirely on this file, and it used to rest on three
hard-coded classes: demand, capacity, connectivity. That held until someone
wanted to model a disease that lingers rather than one that spreads — a change
to length of stay, which is neither demand nor capacity nor a route. The fourth
class would have been followed by a fifth.

So there is one effect type. It names a quantity from `targets.CATALOGUE`, a
selection, an operation and a schedule. A pandemic, a flood, a cyberattack, a
strike, a hospital opening and a vaccination programme are all the same object
with different rows in it, and adding a new kind of event requires no code.

What is deliberately *not* here: how a perturbation composes with the value it
lands on. That belongs to the quantity, not to the author — see `targets.py`.
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.events.targets import BY_PATH, Op, Target, target

Shape = Literal["step", "pulse", "ramp", "gaussian"]


class TemporalProfile(BaseModel):
    """When an effect bites, and how hard, over time.

    Four shapes cover what events actually need: a step (an outage that starts
    and stops), a ramp (staff attrition), a pulse (a mass-casualty arrival), and
    a gaussian (an epidemic wave). Anything else is a new shape here, not a
    special case downstream.
    """

    start: int = 0
    end: int | None = None
    shape: Shape = "step"
    peak: float = 1.0
    # Where the maximum sits, for shapes that have one. Defaults to the middle.
    peak_tick: int | None = None

    def _span(self) -> tuple[int, int]:
        end = self.end if self.end is not None else self.start
        return self.start, max(end, self.start)

    def magnitude_at(self, tick: int) -> float:
        start, end = self._span()
        if tick < start or (self.end is not None and tick > end):
            return 0.0
        if self.shape == "step":
            return self.peak
        if self.shape == "ramp":
            span = max(1, end - start)
            return self.peak * min(1.0, (tick - start) / span)
        if self.shape == "pulse":
            return self.peak if tick == start else 0.0
        centre = self.peak_tick if self.peak_tick is not None else (start + end) / 2
        width = max(1.0, (end - start) / 6 or 1.0)
        return self.peak * math.exp(-((tick - centre) ** 2) / (2 * width**2))


class Effect(BaseModel):
    """One perturbation of one quantity.

    `select` narrows by the dimensions the target declares. A missing or empty
    dimension means every value of it, which is both the common case and the
    one that stays correct when the network grows — an event written against
    "every facility" does not quietly skip the ward opened last month.
    """

    id: str
    target: str
    select: dict[str, list[str]] = Field(default_factory=dict)
    op: Op = "multiply"
    value: float = 1.0
    profile: TemporalProfile = Field(default_factory=TemporalProfile)

    @model_validator(mode="after")
    def _known_target_and_op(self) -> "Effect":
        if self.target not in BY_PATH:
            raise ValueError(
                f"effect {self.id!r}: unknown target {self.target!r}; "
                f"available: {', '.join(sorted(BY_PATH))}"
            )
        t = BY_PATH[self.target]
        if self.op not in t.ops:
            raise ValueError(
                f"effect {self.id!r}: {t.label} cannot be changed by {self.op!r}; "
                f"it accepts {', '.join(t.ops)}"
            )
        unknown = [d for d in self.select if d not in t.selector]
        if unknown:
            raise ValueError(
                f"effect {self.id!r}: {t.label} cannot be narrowed by "
                f"{', '.join(unknown)}; it accepts "
                f"{', '.join(t.selector) if t.selector else 'no filters'}"
            )
        return self

    @property
    def spec(self) -> Target:
        return target(self.target)

    def wants(self, dimension: str, value: str) -> bool:
        """Whether this effect applies to one value of one dimension."""
        chosen = self.select.get(dimension) or []
        return not chosen or value in chosen

    def magnitude_at(self, tick: int) -> float:
        return self.profile.magnitude_at(tick)

    def value_at(self, tick: int) -> float | None:
        """The operand in force this tick, eased in by the profile, or None.

        A ramp reaching half strength should apply half the *change*, not half
        the operand: a 0.5 multiplier at magnitude 0.5 is 0.75, not 0.25. Doing
        it the naive way makes every ramp start out harsher than its own peak,
        which is exactly backwards and very hard to see in a chart.
        """
        m = self.magnitude_at(tick)
        if m <= 0:
            return None
        m = min(1.0, m)
        if self.op == "multiply":
            return 1.0 - (1.0 - self.value) * m
        return self.value * m


class Event(BaseModel):
    """A named bundle of effects.

    Adding a kind of event means writing one of these — in the composer, not in
    Python. If it ever means editing the engine, the acceptance criterion in the
    spec has been broken.
    """

    id: str
    name: str = ""
    description: str = ""
    horizon: int = 60
    effects: list[Effect] = Field(default_factory=list)

    def active(self, tick: int, path: str) -> list[Effect]:
        return [
            e for e in self.effects if e.target == path and e.magnitude_at(tick) > 0
        ]

    def touches(self, path: str) -> bool:
        return any(e.target == path for e in self.effects)
