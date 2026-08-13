"""Running one triple, and comparing many.

No optimiser here — deliberately. What is here is the loop an optimiser will
call, `evaluate(system, event, policy, seed) -> Score`, and the replicate
machinery that makes the comparison mean something. A search over policies built
on single stochastic runs would optimise the seed.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from app.events.domain import SystemState
from app.events.dynamics import Trajectory, run
from app.events.effects import Event
from app.events.policy import Policy
from app.events.scoring import Objective, Score


def evaluate(
    system: SystemState, event: Event, policy: Policy, objective: Objective, seed: int = 0
) -> tuple[Trajectory, Score]:
    """The signature to keep stable. An optimiser calls this in a loop."""
    t = run(system, event, policy, seed)
    return t, objective.score(t)


@dataclass
class Replicated:
    """A policy's result as a distribution, not a number."""

    policy_id: str
    scores: list[float]
    parts: dict[str, list[float]]

    @property
    def mean(self) -> float:
        return statistics.fmean(self.scores)

    @property
    def stdev(self) -> float:
        return statistics.stdev(self.scores) if len(self.scores) > 1 else 0.0

    def interval(self) -> tuple[float, float]:
        """A rough 95% band. Rough on purpose: a tight-looking interval from
        five replicates would be a more confident lie than a wide one."""
        if len(self.scores) < 2:
            return (self.mean, self.mean)
        half = 1.96 * self.stdev / (len(self.scores) ** 0.5)
        return (self.mean - half, self.mean + half)


def replicate(
    system: SystemState,
    event: Event,
    policy: Policy,
    objective: Objective,
    n: int = 10,
    base_seed: int = 0,
) -> Replicated:
    scores: list[float] = []
    parts: dict[str, list[float]] = {}
    for i in range(n):
        _t, s = evaluate(system, event, policy, objective, seed=base_seed + i)
        scores.append(s.scalar)
        for k, v in s.parts.items():
            parts.setdefault(k, []).append(v)
    return Replicated(policy_id=policy.id, scores=scores, parts=parts)


def compare(
    system: SystemState,
    event: Event,
    policies: list[Policy],
    objective: Objective,
    replicates: int = 1,
    base_seed: int = 0,
) -> list[dict]:
    """One row per policy, ranked. The null policy should be in `policies` —
    a ranking with no baseline says which option is least bad, not whether any
    of them helped."""
    rows: list[dict] = []
    for p in policies:
        r = replicate(system, event, p, objective, n=replicates, base_seed=base_seed)
        lo, hi = r.interval()
        row = {
            "policy": p.id,
            "name": p.name,
            "score": r.mean,
            "ci_low": lo,
            "ci_high": hi,
        }
        for k, vals in r.parts.items():
            row[k] = statistics.fmean(vals)
        rows.append(row)
    rows.sort(key=lambda r: r["score"])
    return rows


def format_table(rows: list[dict], columns: list[str] | None = None) -> str:
    """A comparison a person can read without a notebook."""
    cols = columns or ["policy", "score", "excess_deaths", "unmet_care", "response_cost"]
    widths = {c: max(len(c), *(len(_fmt(r.get(c))) for r in rows)) for c in cols} if rows else {}
    head = "  ".join(c.ljust(widths[c]) for c in cols)
    lines = [head, "-" * len(head)]
    for r in rows:
        lines.append("  ".join(_fmt(r.get(c)).ljust(widths[c]) for c in cols))
    return "\n".join(lines)


def _fmt(v: object) -> str:
    if isinstance(v, float):
        return f"{v:,.1f}"
    return str(v if v is not None else "")
