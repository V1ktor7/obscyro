"""A scenario is a bundle of typed perturbations. It executes nothing.

The versatility claim rests entirely on this file. A pandemic, a flood, a
cyberattack and a strike are not four kinds of thing to the engine — they are
four sets of numbers over the same three verbs:

    demand goes up somewhere
    a resource goes down somewhere
    a connection breaks somewhere

If a new crisis needs a fourth verb, that is a real finding and it belongs in
this module. If it needs a new `if` in the executive, something has gone wrong.
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, NonNegativeFloat

Shape = Literal["step", "pulse", "ramp", "gaussian"]


class TemporalProfile(BaseModel):
    """When a perturbation bites, and how hard, over time.

    Four shapes cover what scenarios actually need: a step (an outage that
    starts and stops), a ramp (staff attrition), a pulse (a mass-casualty
    arrival), and a gaussian (an epidemic wave). Anything else is a new shape
    here, not a special case downstream.
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
        # gaussian
        centre = self.peak_tick if self.peak_tick is not None else (start + end) / 2
        width = max(1.0, (end - start) / 6 or 1.0)
        return self.peak * math.exp(-((tick - centre) ** 2) / (2 * width**2))


class DemandPerturbation(BaseModel):
    """New care demand appearing in a population.

    `acuity_mix` is the whole clinical content of a crisis as far as the engine
    is concerned: a flood sends trauma, a pandemic sends respiratory cases, and
    the difference is which acuities the mix names and in what proportion.
    """

    id: str
    kind: Literal["demand"] = "demand"
    targets: list[str]  # population ids
    acuity_mix: dict[str, float]  # acuity -> share, normalised on use
    profile: TemporalProfile
    # Patients per tick at peak, before the mix is applied.
    volume: NonNegativeFloat = 0.0

    def emit(self, tick: int) -> dict[tuple[str, str], float]:
        """(population, acuity) -> patients arriving this tick."""
        m = self.profile.magnitude_at(tick)
        if m <= 0 or self.volume <= 0:
            return {}
        total_share = sum(self.acuity_mix.values()) or 1.0
        out: dict[tuple[str, str], float] = {}
        for pop in self.targets:
            for acuity, share in self.acuity_mix.items():
                out[(pop, acuity)] = self.volume * m * (share / total_share)
        return out


class CapacityPerturbation(BaseModel):
    """A resource degraded or destroyed.

    `multiplier` for a partial loss (staff sickness at 0.6), `absolute` for a
    hard set (a flooded wing at 0). Absolute wins when both are given, because
    "the building is gone" is not a percentage.
    """

    id: str
    kind: Literal["capacity"] = "capacity"
    facilities: list[str]
    # Empty means every resource in the category; empty category means every
    # resource. Scenarios are usually written at the category level.
    category: str | None = None
    resources: list[str] = Field(default_factory=list)
    multiplier: float | None = None
    absolute: float | None = None
    profile: TemporalProfile

    def factor_at(self, tick: int) -> float | None:
        """Multiplicative factor in force this tick, or None when inactive."""
        m = self.profile.magnitude_at(tick)
        if m <= 0 or self.multiplier is None:
            return None
        # A magnitude of 1 applies the full multiplier; a ramp eases into it.
        return 1.0 - (1.0 - self.multiplier) * min(1.0, m)

    def absolute_at(self, tick: int) -> float | None:
        if self.absolute is None or self.profile.magnitude_at(tick) <= 0:
            return None
        return self.absolute


class ConnectivityPerturbation(BaseModel):
    """A route cut or throttled — a flooded road, a severed information link."""

    id: str
    kind: Literal["connectivity"] = "connectivity"
    edges: list[tuple[str, str]]
    edge_kind: str = "transfer"
    # 0.0 severs it; 0.5 halves throughput.
    multiplier: float = 0.0
    profile: TemporalProfile

    def factor_at(self, tick: int) -> float | None:
        m = self.profile.magnitude_at(tick)
        if m <= 0:
            return None
        return 1.0 - (1.0 - self.multiplier) * min(1.0, m)


Perturbation = DemandPerturbation | CapacityPerturbation | ConnectivityPerturbation


class Scenario(BaseModel):
    """A crisis, as data.

    Adding a crisis type means writing one of these. If it ever means editing
    the dynamics engine, the acceptance criterion in the spec has been broken.
    """

    id: str
    name: str = ""
    description: str = ""
    horizon: int = 60
    perturbations: list[Perturbation] = Field(default_factory=list)

    def demand(self, tick: int) -> dict[tuple[str, str], float]:
        out: dict[tuple[str, str], float] = {}
        for p in self.perturbations:
            if isinstance(p, DemandPerturbation):
                for key, v in p.emit(tick).items():
                    out[key] = out.get(key, 0.0) + v
        return out

    def capacity_effects(self, tick: int) -> list[CapacityPerturbation]:
        return [
            p
            for p in self.perturbations
            if isinstance(p, CapacityPerturbation)
            and (p.factor_at(tick) is not None or p.absolute_at(tick) is not None)
        ]

    def connectivity_effects(self, tick: int) -> list[ConnectivityPerturbation]:
        return [
            p
            for p in self.perturbations
            if isinstance(p, ConnectivityPerturbation) and p.factor_at(tick) is not None
        ]
