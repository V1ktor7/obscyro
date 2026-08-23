"""A spreading process over states the institution declared.

The alternative was a compartmental model with S, E, I and R written into it.
That answers one question and hides the same assumption as `care.stay_ticks`: a
cyberattack travels a network of institutions, a heatwave travels nothing at all
and pushes every catchment at once, a strike takes capacity away rather than
adding demand. A model with `infectious` in its source has already decided which
of those a customer is allowed to ask.

So this file knows three shapes of transition and no vocabulary:

    spontaneous   a rate out of a state, depending on nothing else
    coupled       a rate proportional to how much of another state there is,
                  travelling along a named coupling
    forced        a rate an event perturbs over time — which needs nothing here,
                  because `object.property` effects already do that to a
                  declared number, and `_rederive` reads it back each tick

Nothing below knows what "susceptible" or "school" means. It reads which state a
transition leaves, which it enters, how fast, and what makes it go.

What it does *not* model, and what the caller has to be told: mixing between
catchments. Every coupling declared on a catchment is inside it, so an epidemic
seeded in one territory never reaches the next on its own. That is a real gap
rather than an approximation — seed each catchment, or declare the mixing when
there is somewhere to declare it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.events.objects import PropertySchema, SimObject

LEAVES_STATE = "leaves_state"
ENTERS_STATE = "enters_state"
TRANSITION_RATE = "transition_rate"
DRIVEN_BY_STATE = "driven_by_state"
COUPLES_ALONG = "couples_along"
PRODUCES_DEMAND = "produces_demand"


class ContradictorySpreadModel(ValueError):
    """Two transitions describe the same passage and disagree about its rate.

    Raised rather than resolved, for the same reason `ContradictoryCareModel`
    is: taking the first, the last or the larger each gives a run that finishes
    and answers a question nobody asked, and the author never learns which of
    their two numbers was used.
    """


@dataclass(frozen=True)
class Transition:
    """One declared passage between two states."""

    id: str
    leaves: str
    enters: str
    rate: float
    #: The state whose share drives it. None means it happens on its own.
    driven_by: str | None = None
    #: The coupling it travels. None means it reaches the whole catchment.
    along: str | None = None
    #: The severity a unit becomes on crossing, for the care model downstream.
    produces: str | None = None

    @property
    def coupled(self) -> bool:
        return self.driven_by is not None


@dataclass
class SpreadModel:
    transitions: list[Transition] = field(default_factory=list)

    @property
    def states(self) -> list[str]:
        """Every state named anywhere, in a stable order.

        Sorted rather than in declaration order: the set is what matters and two
        runs of the same model must not differ because a query came back in a
        different order.
        """
        out: set[str] = set()
        for t in self.transitions:
            out.add(t.leaves)
            out.add(t.enters)
            if t.driven_by:
                out.add(t.driven_by)
        return sorted(out)

    @property
    def couplings(self) -> list[str]:
        return sorted({t.along for t in self.transitions if t.along})


def _bound(schema: PropertySchema, type_name: str) -> dict[str, str]:
    """mechanic -> property key, for one type."""
    out: dict[str, str] = {}
    for t in schema.types:
        if t.name != type_name:
            continue
        for p in t.properties:
            if p.mechanic and p.mechanic not in out:
                out[p.mechanic] = p.key
    return out


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _text(value) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def declares_spread(schema: PropertySchema | None) -> bool:
    """Whether anything at all binds a spreading mechanic. Cheap to ask first."""
    if schema is None:
        return False
    return any(
        p.mechanic in (LEAVES_STATE, ENTERS_STATE) for t in schema.types for p in t.properties
    )


def spread_model_from(
    objects: list[SimObject], schema: PropertySchema | None
) -> SpreadModel:
    """Build the model out of declared instances.

    Returns an empty model when nothing is bound, which the caller reads as
    "this institution has described no spreading process" rather than as an
    error — a twin is perfectly runnable for events that perturb demand
    directly, which is how every run before this one worked.
    """
    model = SpreadModel()
    if schema is None:
        return model

    seen: dict[tuple[str, str], tuple[float, str]] = {}
    for obj in objects:
        bound = _bound(schema, obj.type)
        if LEAVES_STATE not in bound or ENTERS_STATE not in bound:
            continue
        leaves = _text(obj.properties.get(bound[LEAVES_STATE]))
        enters = _text(obj.properties.get(bound[ENTERS_STATE]))
        # A half-filled row is a form in progress, not a contradiction.
        if not leaves or not enters:
            continue

        rate_key = bound.get(TRANSITION_RATE)
        raw_rate = obj.properties.get(rate_key) if rate_key else None
        if not _is_number(raw_rate):
            continue
        rate = float(raw_rate)

        driven_key = bound.get(DRIVEN_BY_STATE)
        along_key = bound.get(COUPLES_ALONG)
        produces_key = bound.get(PRODUCES_DEMAND)
        driven = _text(obj.properties.get(driven_key)) if driven_key else None
        along = _text(obj.properties.get(along_key)) if along_key else None
        produces = _text(obj.properties.get(produces_key)) if produces_key else None

        # Keyed by the whole passage and not by its endpoints alone. Five
        # contact layers all carrying `sain` to `malade` are five passages, not
        # one described five times, and keying on the endpoints rejected the
        # only declaration anybody would actually write: a home contact and a
        # school contact that do not transmit alike. What stays a contradiction
        # is two rows that agree on every word and disagree on the number.
        key = (leaves, enters, driven or "", along or "")
        prior = seen.get(key)
        if prior is not None and prior[0] != rate:
            raise ContradictorySpreadModel(
                f"{obj.id!r} and {prior[1]!r} both describe {leaves!r} to {enters!r} and give "
                f"different rates ({rate} and {prior[0]}). Two rows that agree on every "
                f"word and disagree on the number leave the engine reading one of them; "
                f"say which. (A different coupling or a different driver makes it a "
                f"different passage, and those are allowed to differ.)"
            )
        seen[key] = (rate, obj.id)
        model.transitions.append(
            Transition(
                id=obj.id,
                leaves=leaves,
                enters=enters,
                rate=rate,
                driven_by=driven,
                along=along,
                produces=produces,
            )
        )
    return model


@dataclass(frozen=True)
class LayerChange:
    """A named coupling, scaled over a window.

    This is what a structural intervention *is* here, and why it needs no
    estimation: closing a school is `factor=0` on the layer the school is, and
    the counterfactual is built rather than inferred. Fitted against an observed
    curve the same question was not answerable at all — the closure landed on
    the same day as the holidays, and no method separates two things that only
    ever happened together.
    """

    layer: str
    factor: float
    from_step: int = 0
    #: None runs to the end. A window that closes puts the coupling back.
    to_step: int | None = None

    def active(self, tick: int) -> bool:
        if tick < self.from_step:
            return False
        return self.to_step is None or tick <= self.to_step


@dataclass
class SpreadStep:
    """One step of one catchment, as the caller needs to read it."""

    tick: int
    population: str
    #: How much sits in each state at the end of the step.
    states: dict[str, float]
    #: What crossed a transition that produces demand, by severity.
    incidence: dict[str, float]


def run_spread(
    model: SpreadModel,
    populations: list,
    seeds: dict[str, dict[str, float]],
    horizon: int,
    changes: list[LayerChange] | None = None,
) -> list[SpreadStep]:
    """Integrate the declared model forward, one catchment at a time.

    Explicit Euler at one step per tick. Not because it is the best integrator
    but because it is the one whose arithmetic a reader can check by hand
    against the numbers they declared — and a model nobody can check is one
    nobody should act on. The engine's step is already the unit the whole
    product speaks in.

    Flows are capped at what is actually in the leaving state. Without that a
    rate above one drains a state past zero and the deficit turns up as demand
    that was never there, which reads as a bigger wave rather than as a rate
    somebody typed wrong.

    `changes` scale named couplings over windows. They multiply where several
    overlap, so two measures on one layer compound rather than the last one
    winning — which is what happens on the ground and what a reader would expect
    from having written both.
    """
    out: list[SpreadStep] = []
    if not model.transitions or horizon <= 0:
        return out

    states = model.states
    # Everything starts where the caller put it. A state nobody seeded is empty,
    # which is the honest reading of silence.
    stock: dict[str, dict[str, float]] = {
        p.id: {s: float(seeds.get(p.id, {}).get(s, 0.0)) for s in states} for p in populations
    }
    size = {p.id: float(getattr(p, "size", 0.0) or 0.0) for p in populations}
    couples = {p.id: dict(getattr(p, "couples", {}) or {}) for p in populations}
    changes = changes or []

    for tick in range(horizon):
        # Recomputed per tick rather than per transition: the same layer is read
        # by every transition that travels it, and scaling it twelve times would
        # be twelve chances to drift.
        scaled: dict[str, float] = {}
        for ch in changes:
            if ch.active(tick):
                scaled[ch.layer] = scaled.get(ch.layer, 1.0) * ch.factor
        for p in populations:
            pid = p.id
            here = stock[pid]
            flows: list[tuple[Transition, float]] = []
            for t in model.transitions:
                available = here.get(t.leaves, 0.0)
                if available <= 0:
                    continue
                if t.coupled:
                    n = size[pid]
                    if n <= 0:
                        continue
                    share = here.get(t.driven_by or "", 0.0) / n
                    # No layer named means the transition reaches the whole
                    # catchment: the rate is then the whole contact-and-
                    # transmission product, and there is nothing to look up.
                    strength = couples[pid].get(t.along, 0.0) if t.along else 1.0
                    if t.along and t.along in scaled:
                        strength *= scaled[t.along]
                    flow = t.rate * strength * share * available
                else:
                    flow = t.rate * available
                if flow > 0:
                    flows.append((t, flow))

            # Two transitions may draw on one state. Scaled together rather than
            # served in order, so the answer does not depend on which row was
            # typed first.
            drawn: dict[str, float] = {}
            for t, f in flows:
                drawn[t.leaves] = drawn.get(t.leaves, 0.0) + f
            scale: dict[str, float] = {}
            for s, total in drawn.items():
                have = here.get(s, 0.0)
                scale[s] = min(1.0, have / total) if total > have and total > 0 else 1.0

            incidence: dict[str, float] = {}
            for t, f in flows:
                moved = f * scale.get(t.leaves, 1.0)
                here[t.leaves] = here.get(t.leaves, 0.0) - moved
                here[t.enters] = here.get(t.enters, 0.0) + moved
                if t.produces:
                    incidence[t.produces] = incidence.get(t.produces, 0.0) + moved

            out.append(
                SpreadStep(
                    tick=tick,
                    population=pid,
                    states={s: round(v, 6) for s, v in here.items()},
                    incidence={k: round(v, 6) for k, v in incidence.items()},
                )
            )
    return out


def incidence_effects(steps: list[SpreadStep], populations: list) -> list[dict]:
    """The run, written as effects an event can carry.

    This is the seam. A spreading model that produced its own result format
    would need its own player, its own chart and its own download; written as
    `demand.incidence` it arrives in the engine that already queues, serves and
    counts, and every screen downstream works unchanged.

    Per thousand people, because that is what `demand.incidence` means — the
    engine multiplies it back by each catchment's own head count.
    """
    size = {p.id: float(getattr(p, "size", 0.0) or 0.0) for p in populations}
    effects: list[dict] = []
    for s in steps:
        n = size.get(s.population, 0.0)
        if n <= 0:
            continue
        for severity, count in s.incidence.items():
            if count <= 0:
                continue
            effects.append(
                {
                    "id": f"{s.population}-{severity}-{s.tick}",
                    "target": "demand.incidence",
                    "select": {"acuity": [severity], "population": [s.population]},
                    "op": "add",
                    "value": count / n * 1000.0,
                    "profile": {
                        "start": s.tick,
                        "end": s.tick,
                        "shape": "step",
                        "peak": 1.0,
                    },
                }
            )
    return effects
