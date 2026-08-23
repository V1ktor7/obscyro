"""Turning a trajectory into a number a government can argue with.

Two rules here, and both exist because the number will be used to justify a
decision:

  * every objective reports its per-tick series alongside its total, so a score
    can be read as a story rather than accepted as a verdict;
  * the weights are data. Whether a death is worth a thousand dollars or ten
    million is not a modelling question, and this file must not answer it.
"""

from __future__ import annotations

from typing import Callable

from pydantic import BaseModel, Field

from app.events.dynamics import Trajectory

ObjectiveFn = Callable[[Trajectory], tuple[float, list[float]]]
_OBJECTIVES: dict[str, ObjectiveFn] = {}


def register_objective(name: str) -> Callable[[ObjectiveFn], ObjectiveFn]:
    """New objectives plug in here rather than by editing the scorer."""

    def deco(fn: ObjectiveFn) -> ObjectiveFn:
        _OBJECTIVES[name] = fn
        return fn

    return deco


@register_objective("excess_deaths")
def _deaths(t: Trajectory) -> tuple[float, list[float]]:
    series = [x.deaths for x in t.ticks]
    return sum(series), series


@register_objective("unmet_care")
def _unmet(t: Trajectory) -> tuple[float, list[float]]:
    series = [sum(x.unmet.values()) for x in t.ticks]
    return sum(series), series


@register_objective("peak_shortfall")
def _peak_shortfall(t: Trajectory) -> tuple[float, list[float]]:
    """The worst moment, not the average one. A system that coped for
    twenty-nine days and collapsed on the thirtieth did not cope."""
    series = [max(x.shortfall.values(), default=0.0) for x in t.ticks]
    return max(series, default=0.0), series


@register_objective("response_cost")
def _cost(t: Trajectory) -> tuple[float, list[float]]:
    series = [x.cost for x in t.ticks]
    return sum(series), series


@register_objective("peak_occupancy")
def _peak_occupancy(t: Trajectory) -> tuple[float, list[float]]:
    # The worst activity anywhere, not the worst facility average. A network
    # whose only full thing is one hospital's acute beds should read 100%, and
    # under the category-wide reading it read 6%.
    series = [
        max((v for by_activity in x.occupancy.values() for v in by_activity.values()), default=0.0)
        for x in t.ticks
    ]
    return max(series, default=0.0), series


class Objective(BaseModel):
    """A weighted combination, with the weights set by whoever owns the trade-off."""

    name: str = "default"
    weights: dict[str, float] = Field(
        default_factory=lambda: {"excess_deaths": 1.0, "unmet_care": 0.0, "response_cost": 0.0}
    )

    def score(self, t: Trajectory) -> "Score":
        parts: dict[str, float] = {}
        series: dict[str, list[float]] = {}
        for key, fn in _OBJECTIVES.items():
            total, per_tick = fn(t)
            parts[key] = total
            series[key] = per_tick
        scalar = sum(parts.get(k, 0.0) * w for k, w in self.weights.items())
        return Score(objective=self.name, scalar=scalar, parts=parts, series=series)


class Score(BaseModel):
    objective: str
    scalar: float
    # Every registered metric, whether or not it is weighted — a decision-maker
    # should see the cost of the option they were not shown.
    parts: dict[str, float] = Field(default_factory=dict)
    series: dict[str, list[float]] = Field(default_factory=dict)

    def summary(self) -> str:
        bits = ", ".join(f"{k}={v:,.1f}" for k, v in sorted(self.parts.items()))
        return f"{self.scalar:,.1f}  [{bits}]"
