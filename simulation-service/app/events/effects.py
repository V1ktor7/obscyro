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

from app.events.geo import Spatial, distance_km
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
    # Text is allowed because `object.property` writes the ontology's own
    # vocabulary — "contaminated", "sick", "overflow" — and forcing those
    # through a float was exactly the limit that made a whole class of event
    # unwritable.
    value: float | str = 1.0
    # Which property to change. Only meaningful for `object.property`; named
    # explicitly rather than smuggled into `select`, because "what I am
    # filtering by" and "what I am changing" must not look like the same thing.
    #
    # Not called `property`: that shadows the decorator used further down this
    # very class, and the failure is a TypeError at import time with no mention
    # of the field that caused it.
    property_key: str | None = None
    # How many of the matching objects this reaches. None is all of them; a
    # value below 1 is a fraction of them; anything else is a count.
    #
    # Worth a field of its own because "every bed in the network becomes
    # contaminated" is almost never what someone means, and an effect that
    # silently means it produces a catastrophe nobody wrote.
    reach: float | None = None
    # Where the effect starts on the map, how far it carries and how fast. An
    # event does not reach every site at once, and this is what says so without
    # simulating anything travelling.
    spatial: Spatial | None = None
    profile: TemporalProfile = Field(default_factory=TemporalProfile)

    @model_validator(mode="after")
    def _text_only_where_it_means_something(self) -> "Effect":
        """A string value is only meaningful on an object property.

        Everywhere else the quantity is a number, and accepting text would
        either raise deep in a tick or be coerced into a nonsense figure that
        the run would then present as a finding.
        """
        if isinstance(self.value, str) and self.target != "object.property":
            raise ValueError(
                f"effect {self.id!r}: {self.target} is a number, so it cannot be set to "
                f"the text {self.value!r}"
            )
        if self.target == "object.property":
            if not self.property_key:
                raise ValueError(
                    f"effect {self.id!r}: say which property to change — an object "
                    f"effect without one applies to nothing"
                )
            if self.op != "set" and isinstance(self.value, str):
                raise ValueError(
                    f"effect {self.id!r}: {self.op!r} needs a number, not text"
                )
        elif self.property_key:
            raise ValueError(
                f"effect {self.id!r}: {self.target} has no properties to name"
            )
        if self.spatial is not None:
            t = BY_PATH.get(self.target)
            if t and not ({"facility", "route"} & set(t.selector)):
                # Geography needs somewhere to measure from. On a target with no
                # place — arrivals into a population, a care-model parameter —
                # an epicentre would be accepted, ignored, and read as though it
                # had constrained the event.
                raise ValueError(
                    f"effect {self.id!r}: {t.label} has no location, so an epicentre "
                    f"cannot narrow it. Spatial reach works on targets that name a "
                    f"facility or a route."
                )
        if self.reach is not None and self.reach <= 0:
            raise ValueError(
                f"effect {self.id!r}: a reach of {self.reach} touches nothing; leave it "
                f"unset to mean every matching object"
            )
        return self

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

    def magnitude_for(
        self, tick: int, location: tuple[float, float] | None
    ) -> float:
        """Strength here, this step — the whole spatial model in one function.

        Distance decides three things at once: whether the effect arrives at
        all, when its window opens, and how much of it survives the journey.
        Computing them together is what keeps a front from needing anything to
        move.

        A place with no coordinates is *excluded* rather than assumed to be at
        the centre. Four of the twenty-one units in the real twin have none, and
        quietly treating them as ground zero would put the worst of every event
        exactly where the data is thinnest.
        """
        if self.spatial is None:
            return self.magnitude_at(tick)
        if location is None:
            return 0.0
        d = distance_km(self.spatial.epicentre, location)
        if not self.spatial.reaches(d):
            return 0.0
        shifted = tick - self.spatial.delay_steps(d)
        if shifted < 0:
            return 0.0
        return self.profile.magnitude_at(shifted) * self.spatial.attenuation(d)

    def text_at(self, tick: int) -> str | None:
        """The string in force this tick, or None.

        Text does not ease in: a bed is contaminated or it is not, and there is
        no half of "sick". The profile therefore only decides *whether* it
        applies, never how much.
        """
        if not isinstance(self.value, str):
            return None
        return self.value if self.magnitude_at(tick) > 0 else None

    def value_for(
        self, tick: int, location: tuple[float, float] | None
    ) -> float | None:
        """`value_at`, but eased by the strength that survives to `location`."""
        if isinstance(self.value, str):
            return None
        m = self.magnitude_for(tick, location)
        if m <= 0:
            return None
        m = min(1.0, m)
        if self.op == "multiply":
            return 1.0 - (1.0 - self.value) * m
        return self.value * m

    def text_for(self, tick: int, location: tuple[float, float] | None) -> str | None:
        """Text does not ease in, so distance only decides whether it lands."""
        if not isinstance(self.value, str):
            return None
        return self.value if self.magnitude_for(tick, location) > 0 else None

    def value_at(self, tick: int) -> float | None:
        """The operand in force this tick, eased in by the profile, or None.

        A ramp reaching half strength should apply half the *change*, not half
        the operand: a 0.5 multiplier at magnitude 0.5 is 0.75, not 0.25. Doing
        it the naive way makes every ramp start out harsher than its own peak,
        which is exactly backwards and very hard to see in a chart.
        """
        if isinstance(self.value, str):
            return None
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
