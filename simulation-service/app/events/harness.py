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


#: A gap smaller than this is not a gap: half a death, half a patient left
#: unserved, half a dollar. Below it two responses are level on that count and
#: the next one decides.
TIE = 0.5


def rank(rows: list[dict], by: list[str], tie: float = TIE) -> list[dict]:
    """Order rows by the first count, and by the next only where that one ties.

    Priorities in order rather than one weighted sum, because a sum needs an
    exchange rate between its terms and there is no honest one here. Weighed
    by deaths and dollars alone, a twin whose care model declares no deaths
    ranked every response by its cost — so doing nothing, which costs
    nothing, came first every time, whatever it left undelivered.

    Rows level on every count keep the order they were given in, which puts
    the baseline first when nothing beat it.
    """
    if not by or len(rows) < 2:
        return list(rows)
    key, rest = by[0], by[1:]
    ordered = sorted(rows, key=lambda r: float(r.get(key) or 0.0))
    out: list[dict] = []
    level = [ordered[0]]
    for row in ordered[1:]:
        # Level with its neighbour, not with the first of the group: three
        # rows a third of a death apart are one group, not two.
        if float(row.get(key) or 0.0) - float(level[-1].get(key) or 0.0) <= tie:
            level.append(row)
        else:
            out.extend(rank(_as_given(level, rows), rest, tie))
            level = [row]
    out.extend(rank(_as_given(level, rows), rest, tie))
    return out


def _as_given(group: list[dict], rows: list[dict]) -> list[dict]:
    """A group of level rows, back in the order the caller listed them."""
    position = {id(r): i for i, r in enumerate(rows)}
    return sorted(group, key=lambda r: position[id(r)])


def decided_by(ranked: list[dict], by: list[str], tie: float = TIE) -> str | None:
    """The count that put the first row ahead of the second, or None if level.

    Said on screen, so first place reads as a reason rather than a verdict.
    """
    if len(ranked) < 2:
        return None
    for key in by:
        if float(ranked[1].get(key) or 0.0) - float(ranked[0].get(key) or 0.0) > tie:
            return key
    return None


def compare(
    system: SystemState,
    event: Event,
    policies: list[Policy],
    objective: Objective,
    replicates: int = 1,
    base_seed: int = 0,
    rank_by: list[str] | None = None,
) -> list[dict]:
    """One row per policy, ranked. The null policy should be in `policies` —
    a ranking with no baseline says which option is least bad, not whether any
    of them helped.

    Ranked by the objective's weighted score unless `rank_by` names counts to
    rank on in order (see `rank`).
    """
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
    if rank_by:
        return rank(rows, rank_by)
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
