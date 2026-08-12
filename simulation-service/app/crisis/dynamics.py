"""The executive. It owns the clock, and it is the only procedural thing here.

Order within a tick is a modelling decision, not an implementation detail, so it
is written once and stated plainly:

    1. time advances
    2. the crisis happens          (perturbations, against the *baseline*)
    3. the response is decided     (rules evaluated on the state as it now is)
    4. care is delivered or not    (demand vs supply, and the cost of "not")
    5. failures spread             (cascades, to a fixpoint)
    6. everything is written down  (the audit trail)

Deciding the response *before* delivering care means a policy reacts to the
crisis in the tick it lands, not the tick after. Deciding it after would make
every policy look one step slower than it is.
"""

from __future__ import annotations

import copy
from typing import Callable

import numpy as np
from pydantic import BaseModel, Field

from app.crisis.domain import STAFF, STUFF, SPACE, SYSTEMS, SystemState
from app.crisis.events import Scenario
from app.crisis.policy import Action, Policy, Rule

# --- what gets written down -------------------------------------------------


class FiredRule(BaseModel):
    """One rule that fired, and why — in words, at the moment it fired.

    The condition is rendered against the state that triggered it, because
    "occupancy > 0.9" is not an answer to "why did the model do that" and
    "occupancy(HND)=0.94 > 0.9" is.
    """

    rule_id: str
    because: str
    action: Action
    applied_at: int


class TickRecord(BaseModel):
    tick: int
    arrivals: dict[str, float] = Field(default_factory=dict)
    served: dict[str, float] = Field(default_factory=dict)
    unmet: dict[str, float] = Field(default_factory=dict)
    deaths: float = 0.0
    cost: float = 0.0
    occupancy: dict[str, float] = Field(default_factory=dict)
    shortfall: dict[str, float] = Field(default_factory=dict)
    fired: list[FiredRule] = Field(default_factory=list)
    suppressed: list[str] = Field(default_factory=list)
    cascades: list[str] = Field(default_factory=list)


class Trajectory(BaseModel):
    scenario_id: str
    policy_id: str
    seed: int
    ticks: list[TickRecord] = Field(default_factory=list)

    @property
    def deaths(self) -> float:
        return sum(t.deaths for t in self.ticks)

    @property
    def cost(self) -> float:
        return sum(t.cost for t in self.ticks)

    def unmet_by_acuity(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for t in self.ticks:
            for a, v in t.unmet.items():
                out[a] = out.get(a, 0.0) + v
        return out


# --- actions, as a registry so the executive never grows an `if` ------------

ActionHandler = Callable[[SystemState, Action, "Engine"], float]
_HANDLERS: dict[str, ActionHandler] = {}


def register_action(kind: str) -> Callable[[ActionHandler], ActionHandler]:
    def deco(fn: ActionHandler) -> ActionHandler:
        _HANDLERS[kind] = fn
        return fn

    return deco


def _most_urgent(state: SystemState, waiting: dict[str, float]) -> str | None:
    """The queued acuity with the highest mortality when left unserved.

    Ties break on the name so a run does not change its answer when a scenario
    file is reordered.
    """
    queued = [a for a, n in waiting.items() if n > 0]
    if not queued:
        return None
    return min(
        queued,
        key=lambda a: (
            -(state.care_model[a].mortality_per_unmet if a in state.care_model else 0.0),
            a,
        ),
    )


@register_action("transfer")
def _transfer(state: SystemState, a: Action, engine: "Engine") -> float:
    """Move waiting patients along a transfer edge, capped by its throughput.

    A transfer that ignored the edge would let a model evacuate a city in one
    tick, which is the single easiest way to make a policy look miraculous.
    """
    edge = state.network.edge(a.source or "", a.target or "", "transfer")
    if edge is None:
        return 0.0
    waiting = state.backlog.get(a.source or "", {})
    # Sickest first, matching how `_deliver_care` triages. Defaulting to the
    # longest queue instead — which this did — sends routine cases down the only
    # road out, they take the beds at the far end, and the critical patients
    # they displace there die. The policy then scores *worse* than doing
    # nothing while appearing to work: the rule fires, patients move, and the
    # trace looks correct.
    acuity = a.acuity or _most_urgent(state, waiting)
    if acuity is None:
        return 0.0
    movable = min(waiting.get(acuity, 0.0), edge.throughput, a.amount or float("inf"))
    movable *= a.friction.effectiveness
    if movable <= 0:
        return 0.0
    waiting[acuity] = waiting.get(acuity, 0.0) - movable
    dest = state.backlog.setdefault(a.target or "", {})
    dest[acuity] = dest.get(acuity, 0.0) + movable
    return movable


@register_action("surge_resource")
def _surge(state: SystemState, a: Action, engine: "Engine") -> float:
    """Raise a resource's capacity — agency staff, a field hospital.

    Capacity, not quantity: surging creates the ability to hold patients, and
    the baseline is raised too so a later perturbation multiplies the surged
    figure rather than the original one.
    """
    try:
        r = state.resource(a.target or "", a.resource or "")
    except KeyError:
        return 0.0
    gain = a.amount * a.friction.effectiveness
    r.capacity += gain
    r.quantity += gain
    engine.baseline_capacity[(a.target or "", a.resource or "")] += gain
    return gain


@register_action("reallocate")
def _reallocate(state: SystemState, a: Action, engine: "Engine") -> float:
    """Move a resource between facilities along a supply edge."""
    edge = state.network.edge(a.source or "", a.target or "", "supply")
    if edge is None:
        return 0.0
    try:
        src = state.resource(a.source or "", a.resource or "")
        dst = state.resource(a.target or "", a.resource or "")
    except KeyError:
        return 0.0
    moved = min(src.quantity, a.amount, edge.throughput) * a.friction.effectiveness
    if moved <= 0:
        return 0.0
    src.quantity -= moved
    dst.capacity += moved
    dst.quantity += moved
    engine.baseline_capacity[(a.source or "", a.resource or "")] -= moved
    engine.baseline_capacity[(a.target or "", a.resource or "")] += moved
    return moved


@register_action("modify_demand")
def _modify_demand(state: SystemState, a: Action, engine: "Engine") -> float:
    """Scale what a population generates — how "close the schools" is expressed.

    Held on the engine rather than the state because it modifies the *inflow*,
    which is computed before the state exists for that tick.
    """
    pop = a.population or ""
    engine.demand_scale[pop] = engine.demand_scale.get(pop, 1.0) * a.factor
    return a.factor


# --- the engine -------------------------------------------------------------


class Engine:
    def __init__(self, state: SystemState, scenario: Scenario, policy: Policy, seed: int = 0):
        self.state = state
        self.scenario = scenario
        self.policy = policy
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        # Perturbations modify the *baseline*, never the current value. Applying
        # a 0.6 staff multiplier to the running total every tick would decay it
        # to nothing over a fortnight and look like a plausible epidemic curve.
        self.baseline_capacity: dict[tuple[str, str], float] = {
            (fid, rid): r.capacity
            for fid, f in state.facilities.items()
            for rid, r in f.resources.items()
        }
        self.baseline_weight: dict[tuple[str, str, str], float] = {
            (e.source, e.target, e.kind): e.weight for e in state.network.all_edges()
        }
        self.demand_scale: dict[str, float] = {}
        self.trajectory = Trajectory(
            scenario_id=scenario.id, policy_id=policy.id, seed=seed
        )

    # -- step 2 ---------------------------------------------------------------

    def _apply_perturbations(self, tick: int) -> None:
        factors: dict[tuple[str, str], float] = {}
        absolutes: dict[tuple[str, str], float] = {}
        for p in self.scenario.capacity_effects(tick):
            f = p.factor_at(tick)
            a = p.absolute_at(tick)
            for fid in p.facilities:
                if fid not in self.state.facilities:
                    continue
                for rid, r in self.state.facility(fid).resources.items():
                    if p.resources and rid not in p.resources:
                        continue
                    if p.category and r.category != p.category:
                        continue
                    if a is not None:
                        absolutes[(fid, rid)] = a
                    elif f is not None:
                        factors[(fid, rid)] = factors.get((fid, rid), 1.0) * f

        for (fid, rid), base in self.baseline_capacity.items():
            r = self.state.facility(fid).resources[rid]
            if (fid, rid) in absolutes:
                cap = absolutes[(fid, rid)]
            else:
                cap = base * factors.get((fid, rid), 1.0)
            r.capacity = cap
            # Damage takes what is free first and the rest from what is in use —
            # a flooded wing does not politely wait for its beds to empty.
            r.quantity = min(r.quantity, cap)

        conn: dict[tuple[str, str, str], float] = {}
        for p in self.scenario.connectivity_effects(tick):
            f = p.factor_at(tick)
            if f is None:
                continue
            for s, t in p.edges:
                conn[(s, t, p.edge_kind)] = min(conn.get((s, t, p.edge_kind), 1.0), f)
        for key, base in self.baseline_weight.items():
            e = self.state.network.edge(key[0], key[1], key[2])  # type: ignore[arg-type]
            if e is not None:
                e.weight = base * conn.get(key, 1.0)

    # -- step 3 ---------------------------------------------------------------

    def _decide(self, tick: int) -> tuple[list[FiredRule], list[str]]:
        fired: list[FiredRule] = []
        suppressed: list[str] = []
        fired_ids: set[str] = set()
        claimed: set[tuple[str, str]] = set()

        for rule in self.policy.ordered():
            if not rule.trigger.eligible(tick):
                continue
            if rule.unless and rule.unless in fired_ids:
                suppressed.append(f"{rule.id} (stood down for {rule.unless})")
                continue
            if not rule.condition.evaluate(self.state):
                continue
            # Two rules must not both spend the same thing. First by priority
            # wins the claim; the loser is recorded rather than dropped, so the
            # trace shows what was considered and rejected.
            claim = (rule.action.kind, rule.action.target or rule.action.source or "")
            if claim in claimed:
                suppressed.append(f"{rule.id} (conflict on {claim[0]}@{claim[1]})")
                continue
            claimed.add(claim)
            fired_ids.add(rule.id)
            because = rule.condition.describe(self.state)
            at = tick + rule.action.friction.delay
            fired.append(
                FiredRule(rule_id=rule.id, because=because, action=rule.action, applied_at=at)
            )
            if rule.action.friction.delay > 0:
                self.state.pending.setdefault(at, []).append(
                    {"rule_id": rule.id, "action": rule.action}
                )
        return fired, suppressed

    def _apply_actions(self, tick: int, fired: list[FiredRule]) -> float:
        cost = 0.0
        due: list[tuple[str, Action]] = [
            (f.rule_id, f.action) for f in fired if f.action.friction.delay == 0
        ]
        for payload in self.state.pending.pop(tick, []):
            due.append((payload["rule_id"], payload["action"]))
        for _rid, action in due:
            handler = _HANDLERS.get(action.kind)
            if handler is None:
                continue
            handler(self.state, action, self)
            cost += action.friction.cost
        return cost

    # -- step 4 ---------------------------------------------------------------

    def _deliver_care(self, tick: int) -> TickRecord:
        rec = TickRecord(tick=tick)

        # Arrivals land on the facilities that serve the population. Split
        # evenly: an unmodelled preference is better than an invented one.
        for (pop_id, acuity), count in self.scenario.demand(tick).items():
            pop = self.state.populations.get(pop_id)
            if pop is None or not pop.served_by:
                continue
            scaled = count * self.demand_scale.get(pop_id, 1.0)
            rec.arrivals[acuity] = rec.arrivals.get(acuity, 0.0) + scaled
            share = scaled / len(pop.served_by)
            for fid in pop.served_by:
                q = self.state.backlog.setdefault(fid, {})
                q[acuity] = q.get(acuity, 0.0) + share

        # Discharge before admitting: a bed freed this morning takes a patient
        # this afternoon, and the alternative silently halves throughput.
        for fid, held in self.state.census.items():
            for acuity, n in list(held.items()):
                req = self.state.care_model.get(acuity)
                if req is None or req.stay_ticks <= 0:
                    continue
                leaving = n / req.stay_ticks
                held[acuity] = n - leaving
                for activity, per in req.consumes.items():
                    self.state.release(fid, activity, leaving * per)

        for fid in self.state.facilities:
            waiting = self.state.backlog.setdefault(fid, {})
            # Sickest first. A different triage rule is a different model, and
            # it belongs in the care model rather than here — noted, not built.
            for acuity in sorted(
                waiting,
                key=lambda a: -self.state.care_model.get(a).mortality_per_unmet
                if self.state.care_model.get(a)
                else 0.0,
            ):
                n = waiting.get(acuity, 0.0)
                if n <= 0:
                    continue
                req = self.state.care_model.get(acuity)
                if req is None:
                    continue
                # How many can be served is set by the scarcest thing they need.
                servable = n
                for activity, per in req.consumes.items():
                    if per <= 0:
                        continue
                    servable = min(servable, self.state.available_for(fid, activity) / per)
                servable = max(0.0, servable)
                for activity, per in req.consumes.items():
                    self.state.consume(fid, activity, servable * per)
                waiting[acuity] = n - servable
                held = self.state.census.setdefault(fid, {})
                held[acuity] = held.get(acuity, 0.0) + servable
                rec.served[acuity] = rec.served.get(acuity, 0.0) + servable

                left = waiting[acuity]
                if left > 0:
                    rec.unmet[acuity] = rec.unmet.get(acuity, 0.0) + left
                    # The dead leave the queue. Without this line they are
                    # counted again every tick for the rest of the run: one
                    # unserved critical patient produces 0.15 deaths a tick
                    # forever, the toll is bounded by nothing, and the backlog
                    # becomes a permanent debt no policy can pay down. Every
                    # response then scores within a rounding error of doing
                    # nothing — which is exactly what the first run against a
                    # real twin showed.
                    died = left * req.mortality_per_unmet
                    rec.deaths += died
                    waiting[acuity] = left - died

        for fid in self.state.facilities:
            rec.occupancy[fid] = self.state.occupancy_ratio(fid, SPACE)
        for cat in (SPACE, STAFF, STUFF, SYSTEMS):
            cap = sum(
                r.capacity for f in self.state.facilities.values() for r in f.by_category(cat)
            )
            have = sum(
                r.quantity for f in self.state.facilities.values() for r in f.by_category(cat)
            )
            rec.shortfall[cat] = max(0.0, cap - have)
        return rec

    # -- step 5 ---------------------------------------------------------------

    def _cascade(self, rec: TickRecord) -> None:
        """Failures spread. Run to a fixpoint, because a degradation can trip
        another one — Systems down at a hub degrades a facility that then cannot
        supply its neighbour.

        Bounded to the node count: a graph with a cycle would otherwise iterate
        for ever, and a simulation that hangs is worse than one that is wrong.
        """
        for _ in range(len(self.state.facilities) + 1):
            changed = False
            for fid, f in self.state.facilities.items():
                sysres = f.by_category(SYSTEMS)
                if not sysres:
                    continue
                cap = sum(r.capacity for r in sysres)
                have = sum(r.quantity for r in sysres)
                if cap <= 0:
                    continue
                health = have / cap
                if health >= 0.999:
                    continue
                # Systems is connective tissue: when it degrades, everything it
                # connects degrades with it, at the same fraction.
                for r in f.resources.values():
                    if r.category == SYSTEMS:
                        continue
                    ceiling = self.baseline_capacity[(fid, r.id)] * health
                    if r.capacity > ceiling + 1e-9:
                        r.capacity = ceiling
                        r.quantity = min(r.quantity, ceiling)
                        changed = True
                if changed:
                    rec.cascades.append(f"{fid}: systems at {health:.0%}, dependents capped")
            if not changed:
                break

    # -- replenishment --------------------------------------------------------

    def _replenish(self, tick: int) -> None:
        for fid, f in self.state.facilities.items():
            for r in f.resources.values():
                rep = r.replenishment
                if rep.per_tick <= 0 or tick < rep.lead_time:
                    continue
                r.quantity = min(r.capacity, r.quantity + rep.per_tick)

    # -- the loop -------------------------------------------------------------

    def run(self) -> Trajectory:
        for tick in range(self.scenario.horizon):
            self.state.tick = tick
            self._apply_perturbations(tick)
            fired, suppressed = self._decide(tick)
            cost = self._apply_actions(tick, fired)
            rec = self._deliver_care(tick)
            self._cascade(rec)
            self._replenish(tick)
            rec.fired = fired
            rec.suppressed = suppressed
            rec.cost = cost
            self.trajectory.ticks.append(rec)
        return self.trajectory


def run(state: SystemState, scenario: Scenario, policy: Policy, seed: int = 0) -> Trajectory:
    """The signature an optimiser will call in a loop. Deep-copies the state so
    a caller can run twenty policies against one system without them bleeding
    into each other — the commonest way a comparison harness lies."""
    return Engine(copy.deepcopy(state), scenario, policy, seed).run()
