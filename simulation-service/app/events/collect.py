"""The run, as data you can take away.

A trajectory is computed step by step and then thrown away: only the summary
row survives the call. That makes the most detailed thing this service produces
— what happened, where, when, and why — visible for a few milliseconds and then
gone.

These turn it into tables. Three of them, because they answer different
questions and forcing them into one would mean a row per (tick × facility ×
rule) that is mostly nulls:

    steps       one row per policy and step: arrivals, care, deaths, cost
    facilities  one row per policy, step and facility: occupancy and queue
    decisions   one row per rule that fired, with the reading that tripped it

The third is the one nobody expects to want and everybody asks for eventually,
because "why did the model do that" is the first question after "what did it
say". It is already recorded — `FiredRule.because` renders the condition against
the state at the moment it fired — and was simply never surfaced.

Nothing here samples or summarises. A row is a step, and a reader who wants an
average can take one; a service that averaged first would have decided which
question the data is allowed to answer.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.events.dynamics import Trajectory


class Dataset(BaseModel):
    """One table, ready to become a CSV without further shaping."""

    name: str
    label: str
    description: str
    columns: list[str]
    rows: list[list[Any]] = Field(default_factory=list)


def _acuities(trajectories: dict[str, Trajectory]) -> list[str]:
    """Every severity that appears anywhere, so all rows have the same width.

    Derived from the data rather than from the care model: a column that exists
    in the header and never in a row reads as a measurement of zero instead of
    an absence, and a ragged CSV is worse than either.
    """
    seen: set[str] = set()
    for t in trajectories.values():
        for tick in t.ticks:
            seen.update(tick.arrivals)
            seen.update(tick.served)
            seen.update(tick.unmet)
    return sorted(seen)


def steps_table(trajectories: dict[str, Trajectory]) -> Dataset:
    acuities = _acuities(trajectories)
    columns = ["policy", "step", "deaths", "cost"]
    for a in acuities:
        columns += [f"arrived_{a}", f"served_{a}", f"unmet_{a}"]
    rows: list[list[Any]] = []
    for policy, t in trajectories.items():
        for tick in t.ticks:
            row: list[Any] = [policy, tick.tick, round(tick.deaths, 4), round(tick.cost, 2)]
            for a in acuities:
                row += [
                    round(tick.arrivals.get(a, 0.0), 4),
                    round(tick.served.get(a, 0.0), 4),
                    round(tick.unmet.get(a, 0.0), 4),
                ]
            rows.append(row)
    return Dataset(
        name="steps",
        label="One row per step",
        description=(
            "Arrivals, care delivered, care refused, deaths and spend, for each "
            "response at each step of the run."
        ),
        columns=columns,
        rows=rows,
    )


def facilities_table(
    trajectories: dict[str, Trajectory], names: dict[str, str]
) -> Dataset:
    rows: list[list[Any]] = []
    for policy, t in trajectories.items():
        for tick in t.ticks:
            for fid, by_activity in sorted(tick.occupancy.items()):
                waiting = tick.waiting.get(fid, {})
                for activity, occ in sorted(by_activity.items()):
                    rows.append([
                        policy,
                        tick.tick,
                        fid,
                        names.get(fid, fid),
                        activity,
                        round(occ, 4),
                        round(waiting.get(activity, 0.0), 3),
                    ])
    return Dataset(
        name="facilities",
        label="One row per step, facility and activity",
        description=(
            "How full each thing a unit provides was at each step, and how many "
            "units of demand were waiting for it. Split by activity because a "
            "unit-wide figure averages full acute beds with empty long-stay "
            "places and reports neither. The id travels beside the name so a row "
            "can be joined back to the ontology rather than matched on a label "
            "that may not be unique."
        ),
        columns=[
            "policy", "step", "facility_id", "facility", "activity", "occupancy", "waiting",
        ],
        rows=rows,
    )


def decisions_table(trajectories: dict[str, Trajectory]) -> Dataset:
    rows: list[list[Any]] = []
    for policy, t in trajectories.items():
        for tick in t.ticks:
            for f in tick.fired:
                rows.append(
                    [
                        policy,
                        tick.tick,
                        f.rule_id,
                        f.action.kind,
                        f.action.target or f.action.source or "",
                        f.applied_at,
                        f.because,
                    ]
                )
            for s in tick.suppressed:
                rows.append([policy, tick.tick, s, "suppressed", "", tick.tick, ""])
    return Dataset(
        name="decisions",
        label="One row per decision",
        description=(
            "Every rule that fired, what it did, when it landed, and the reading "
            "that tripped it — plus the rules that were considered and stood "
            "down, which is how a response that did nothing can be told from one "
            "that was never eligible."
        ),
        columns=["policy", "step", "rule", "action", "on", "applied_at", "because"],
        rows=rows,
    )


BUILDERS = {
    "steps": lambda tr, names: steps_table(tr),
    "facilities": facilities_table,
    "decisions": lambda tr, names: decisions_table(tr),
}


def collect(
    trajectories: dict[str, Trajectory],
    names: dict[str, str],
    wanted: list[str],
) -> list[Dataset]:
    """Build the requested tables, in the order asked for.

    An unknown name is ignored rather than raising: collection is a side errand
    of a run that has already happened, and losing a completed simulation
    because of a typo in a download option would be a poor trade.
    """
    return [BUILDERS[name](trajectories, names) for name in wanted if name in BUILDERS]
