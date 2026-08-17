"""The bridge from a real twin to a runnable world.

Every test here guards a failure that produces a *believable* answer rather than
an error — a table of zeroes, a policy that ties with doing nothing, a
catastrophe caused by a spelling difference. Those are the ones that get quoted
in a meeting.
"""

from __future__ import annotations

import pytest

from app.events.domain import SPACE, STAFF
from app.events.ontology import UnrunnableExport, load
from app.events.templates import POLICIES, EVENTS, care_model_for


def _objects(spec) -> list[dict]:
    """Instances, the way the exporter now ships them.

    Built here rather than hand-listed because the counts are the point: a test
    that says "48 beds, 28 of them taken" should read that way, and the objects
    it produces are what the engine derives its totals from.
    """
    out: list[dict] = []
    for facility, type_name, role, total, used in spec:
        for i in range(total):
            props: dict = {"label": f"{type_name}-{i}"}
            if i < used:
                props["status"] = "occupied"
            out.append(
                {
                    "id": f"{facility}-{type_name}-{i}",
                    "type": type_name,
                    "role": role,
                    "properties": props,
                    "at": facility,
                }
            )
    return out


def export(**over) -> dict:
    """A two-unit twin shaped exactly like the backend's export.

    `facilities` no longer carries totals: the engine derives them from
    `objects`, so putting numbers there too would leave two truths and no way to
    tell which one an effect had edited.
    """
    base = {
        "environment": "prod",
        "generated_at": "2026-08-12T00:00:00Z",
        "facilities": [
            {"id": "unit-a", "name": "Urgence", "location": [45.5, -73.5]},
            {"id": "unit-b", "name": "Médecine", "location": None},
        ],
        "objects": _objects(
            [
                # 48 beds at Urgence, 28 of them already taken.
                ("unit-a", "Lit", SPACE, 48, 28),
                ("unit-a", "Infirmiere", STAFF, 12, 0),
                ("unit-a", "Patient", "demand", 28, 0),
                ("unit-b", "Lit", SPACE, 30, 0),
            ]
        ),
        "object_rules": {
            "unavailable_keys": ["status", "state", "etat"],
            "unavailable_values": ["occupied", "in_use", "busy", "unavailable"],
        },
        "populations": [
            {"id": "pop:site-1", "name": "Notre-Dame", "size": 0,
             "served_by": ["unit-a", "unit-b"]},
        ],
        "edges": [
            {"source": "unit-a", "target": "unit-b", "kind": "transfer",
             "capacity": 0, "via": "transfer_to"},
        ],
        "gaps": [],
    }
    base.update(over)
    return base


def runnable(**over):
    ex = export(**over)
    probe = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 50_000},
                 route_capacity=10)
    return load(ex, care_model=care_model_for(probe),
                population_sizes={"pop:site-1": 50_000}, route_capacity=10)


def _any_model():
    from app.events.domain import CareRequirement

    return {"_probe": CareRequirement(acuity="_probe", consumes={})}


# --- the twin arrives intact ------------------------------------------------


def test_the_ontology_names_survive_the_crossing() -> None:
    """A French twin needs no translation table.

    The engine matches demand against activities, so `lit` has to stay `lit` all
    the way through. If anything in the loader normalised it to `bed`, every
    patient would go unserved and the model would report a massacre caused by a
    dictionary.
    """
    s = runnable()
    assert s.available_for("unit-a", "lit") == 20
    assert s.capacity_of("unit-a", activity="lit") == 48
    assert s.facility("unit-a").location == (45.5, -73.5)


def test_occupied_beds_arrive_occupied() -> None:
    """48 beds with 28 taken must not start the run as 48 free ones.

    An export that reset occupancy would flatter every policy by the same 28
    beds and rank them wrongly — the crisis would begin in a hospital that does
    not exist.
    """
    s = runnable()
    assert s.occupancy_ratio("unit-a", activity="lit") == pytest.approx(28 / 48)


def test_census_is_left_out_unless_an_acuity_is_named() -> None:
    """Who the current patients are is an assumption, so it is the caller's.

    Left unnamed they simply hold their beds forever; named, they are admitted
    at that acuity and will eventually discharge and free capacity. Both are
    defensible; picking one silently is not.
    """
    assert runnable().census == {}
    ex = export()
    s = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 1},
             route_capacity=1, census_acuity="routine")
    assert s.census["unit-a"]["routine"] == 28


# --- the refusals -----------------------------------------------------------


def test_a_twin_with_no_capacity_is_refused() -> None:
    """The quiet failure this whole module exists to prevent.

    No object type carries a crisis role, so nothing has capacity, so nobody can
    be turned away, so nobody dies and every policy scores zero. The table looks
    perfect and means nothing.
    """
    hollow = export(
        facilities=[{"id": "unit-a", "name": "Urgence", "location": None}],
        objects=[],
    )
    with pytest.raises(UnrunnableExport, match="crisis role"):
        load(hollow, care_model=_any_model(), population_sizes={"pop:site-1": 10})


def test_a_twin_with_no_catchment_is_refused() -> None:
    with pytest.raises(UnrunnableExport, match="size 0"):
        load(export(), care_model=_any_model())


def test_a_care_model_nothing_provides_is_refused() -> None:
    """A naming mismatch must not be reported as a shortage.

    If the scenario asks for `icu_bed` and the twin offers `lit`, every patient
    goes unserved. That is indistinguishable from a real collapse unless
    somebody checks, and nobody checks a number that confirms their fears.
    """
    from app.events.domain import CareRequirement

    mismatched = {"critical": CareRequirement(acuity="critical", consumes={"icu_bed": 1.0})}
    with pytest.raises(UnrunnableExport, match="naming mismatch"):
        load(export(), care_model=mismatched, population_sizes={"pop:site-1": 50_000})


def test_edges_to_nowhere_are_dropped() -> None:
    """A route into a non-facility would be a hole patients fall into."""
    ex = export(edges=[
        {"source": "unit-a", "target": "ghost", "kind": "transfer", "capacity": 5, "via": "x"},
    ])
    s = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 10}, route_capacity=5)
    assert s.network.all_edges() == []


# --- the templates fit whatever they are given ------------------------------


@pytest.mark.parametrize("name", sorted(EVENTS))
def test_every_event_template_targets_real_ids(name: str) -> None:
    """Templates exist because a real twin names its wards with UUIDs.

    An effect aimed at something that is not there is silently inert: the run
    completes, nothing happens, and the event appears to have been survived.
    """
    s = runnable()
    event = EVENTS[name](s)
    assert event.effects, f"{name} produced no effect"
    routes = {f"{e.source}>{e.target}" for e in s.network.all_edges()}
    for e in event.effects:
        for fid in e.select.get("facility", []):
            assert fid in s.facilities
        for pid in e.select.get("population", []):
            assert pid in s.populations
        for acuity in e.select.get("acuity", []):
            assert acuity in s.care_model
        for route in e.select.get("route", []):
            assert route in routes


def test_a_template_uses_only_catalogued_targets() -> None:
    """The templates are the proof the catalogue is complete.

    These three used to be three bespoke perturbation classes. If any of them
    still needed one, the generic effect would not have earned its place.
    """
    from app.events.targets import BY_PATH

    s = runnable()
    used = {e.target for name in EVENTS for e in EVENTS[name](s).effects}
    assert used <= set(BY_PATH)
    assert used >= {"resource.capacity", "demand.incidence"}


def test_a_policy_template_reads_the_real_network() -> None:
    s = runnable()
    lb = POLICIES["load-balance"](s)
    assert [r.action.source for r in lb.rules] == ["unit-a"]
    assert [r.action.target for r in lb.rules] == ["unit-b"]


def test_a_network_with_no_routes_yields_a_policy_with_no_rules() -> None:
    """Truthful, not an error: nothing can be transferred, so nothing is."""
    ex = export(edges=[])
    probe = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 50_000})
    s = load(ex, care_model=care_model_for(probe), population_sizes={"pop:site-1": 50_000})
    assert POLICIES["load-balance"](s).rules == []


def test_the_care_model_only_requires_what_every_unit_has() -> None:
    """One unit has nurses and the other does not, so nursing is left out.

    A global care model is applied at every facility, so requiring a nurse makes
    the unit that has none unable to treat anybody — `servable` is capped by the
    scarcest input and the scarcest input is zero. That unit then reads as a
    death trap and transfers into it kill people, because of a missing
    declaration rather than a missing nurse.
    """
    s = runnable()
    model = care_model_for(s)
    assert set(model) == {"critical", "urgent", "routine"}
    assert model["critical"].consumes == {"lit": 1.0}


def test_staff_is_required_once_every_unit_has_some() -> None:
    ex = export()
    ex["objects"].extend(_objects([("unit-b", "Infirmiere", STAFF, 6, 0)]))
    probe = load(ex, care_model=_any_model(), population_sizes={"pop:site-1": 50_000})
    assert "infirmiere" in care_model_for(probe)["critical"].consumes


def test_routine_deaths_are_not_zero() -> None:
    """Otherwise every optimiser learns to abandon routine care for free."""
    assert care_model_for(runnable())["routine"].mortality_per_unmet > 0


# --- the defects the first real twin surfaced -------------------------------


def test_the_dead_leave_the_queue() -> None:
    """Otherwise one unserved patient dies again every tick, forever.

    The toll is then bounded by the horizon rather than by how many people
    arrived, the backlog becomes a debt no response can pay down, and every
    policy scores within a rounding error of doing nothing — which is exactly
    what the first run against a real twin produced.
    """
    from app.events.dynamics import run

    s = runnable()
    scenario = EVENTS["pandemic"](s)
    t = run(s, scenario, POLICIES["null"](s), seed=0)
    arrived = sum(sum(x.arrivals.values()) for x in t.ticks)
    assert 0 < t.deaths <= arrived


def test_a_transfer_moves_the_sickest_not_the_longest_queue() -> None:
    """Sending routine cases down the only road out kills the critical ones.

    They take the beds at the far end, and the critical patients they displace
    there die — so the policy scores *worse* than doing nothing while its trace
    shows a rule firing and patients moving, which reads as working.
    """
    from app.events.dynamics import _transfer
    from app.events.policy import Action, Friction

    s = runnable()
    s.backlog["unit-a"] = {"routine": 100.0, "critical": 4.0}
    moved = _transfer(
        s,
        Action(kind="transfer", source="unit-a", target="unit-b", amount=10,
               friction=Friction(effectiveness=1.0)),
        engine=None,  # type: ignore[arg-type]
    )
    assert moved == 4.0
    assert s.backlog["unit-b"] == {"critical": 4.0}


def test_surging_follows_the_constraint_as_it_moves() -> None:
    """A ward short of nurses that becomes short of beds must stop hiring nurses.

    Choosing the binding constraint once, when the policy is built, kept
    buying nurses for a facility that had been bed-bound for most of the run —
    a seven-figure spend for no additional patient served, with a healthy-looking
    trace throughout. The measured figures are not repeated: they predate the
    correction to the demand model.
    """
    s = runnable()
    surging = [r for r in POLICIES["surge-and-balance"](s).rules
               if r.action.kind == "surge_resource" and r.action.target == "unit-a"]
    assert {r.action.resource for r in surging} == {"lit", "infirmiere"}


# --- events composed by hand ------------------------------------------------


def _arrivals(state, effects, tick=2):
    """Net arrivals at one tick, through the engine that computes them."""
    from app.events.dynamics import Engine
    from app.events.effects import Event
    from app.events.policy import null_policy

    e = Engine(state, Event(id="e", horizon=10, effects=effects), null_policy(), 0)
    return e._arrivals(tick)


def _demand(eid: str, volume: float, acuity: str = "critical"):
    from app.events.effects import Effect, TemporalProfile

    return Effect(
        id=eid, target="demand.volume",
        select={"population": ["pop:site-1"], "acuity": [acuity]},
        op="add", value=volume,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )


def test_an_event_can_remove_demand_as_well_as_add_it() -> None:
    """A vaccination programme is a fact about the world, not a response.

    With demand pinned non-negative the only expressible events are ones that
    make things worse, and anything protective has to masquerade as a policy —
    which then shows up in the response cost and gets ranked against the very
    thing it is not.
    """
    s = runnable()
    assert _arrivals(s, [_demand("wave", 100)])[("pop:site-1", "critical")] == 100
    net = _arrivals(s, [_demand("wave", 100), _demand("vaccination", -40)])
    assert net[("pop:site-1", "critical")] == 60


def test_prevention_cannot_go_below_zero_arrivals() -> None:
    """Otherwise a facility carries a negative queue that later swallows real
    patients, and the run reports fewer arrivals than actually happened."""
    s = runnable()
    assert _arrivals(s, [_demand("small", 10), _demand("over", -500)]) == {}


def test_a_severity_mix_splits_rather_than_multiplies() -> None:
    """Forty patients per step has to mean forty, not forty of each kind.

    Populations and severities are deliberately asymmetric: a wave reaching
    three catchments sends the stated number from all three, but one spread
    across three severities is still one wave.
    """
    from app.events.effects import Effect, TemporalProfile

    s = runnable()
    spread = Effect(
        id="wave", target="demand.volume", select={"population": ["pop:site-1"]},
        op="add", value=30,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    got = _arrivals(s, [spread])
    assert sum(got.values()) == 30
    assert len(got) == len(s.care_model)


def test_an_unknown_target_is_refused_at_parse_time() -> None:
    """A free-form path would throw away the whole point of the catalogue.

    An effect naming a quantity that does not exist cannot be applied, so it
    would run and change nothing — the failure mode this design exists to
    prevent, arriving through the door built to close it.
    """
    import pydantic

    from app.events.effects import Effect

    with pytest.raises(pydantic.ValidationError, match="unknown target"):
        Effect(id="x", target="staff.morale", op="multiply", value=0.5)


def test_an_operation_the_quantity_rejects_is_refused() -> None:
    """A queue has no prior value to multiply.

    Offering it would read as halving the wave and silently do nothing,
    because there is nothing at that address to halve.
    """
    import pydantic

    from app.events.effects import Effect

    with pytest.raises(pydantic.ValidationError, match="cannot be changed by"):
        Effect(id="x", target="demand.volume", op="multiply", value=0.5)


def test_a_filter_the_quantity_does_not_have_is_refused() -> None:
    """Narrowing length of stay by facility looks reasonable and does nothing:
    the care model is global, so such a filter matches no dimension and the
    effect would apply everywhere or nowhere depending on how it was read.
    """
    import pydantic

    from app.events.effects import Effect

    with pytest.raises(pydantic.ValidationError, match="cannot be narrowed by"):
        Effect(
            id="x", target="care.stay_ticks", select={"facility": ["unit-a"]},
            op="add", value=2,
        )


def test_length_of_stay_can_be_perturbed() -> None:
    """The verb that was missing, and the reason the catalogue exists.

    A disease that lingers is neither more demand nor less capacity. Before
    the catalogue it could only be faked by sending more patients, which is a
    different illness entirely.
    """
    from app.events.dynamics import run
    from app.events.effects import Effect, Event, TemporalProfile
    from app.events.policy import null_policy

    s = runnable()
    base_stay = s.care_model["critical"].stay_ticks
    longer = Event(
        id="lingering", horizon=20,
        effects=[
            _demand("wave", 30),
            Effect(
                id="slower-recovery", target="care.stay_ticks",
                select={"acuity": ["critical"]}, op="add", value=2,
                profile=TemporalProfile(start=0, end=20, shape="step", peak=1.0),
            ),
        ],
    )
    normal = Event(id="normal", horizon=20, effects=[_demand("wave", 30)])
    slow = run(s, longer, null_policy(), seed=0)
    fast = run(s, normal, null_policy(), seed=0)
    # Beds are held two steps longer each, so fewer people get one.
    assert slow.deaths > fast.deaths
    # And the state it was measured from is untouched.
    assert s.care_model["critical"].stay_ticks == base_stay


def _scaled(export_dict, *, beds=1.0, population=50_000):
    """Load the twin with capacity and catchment scaled independently."""
    import copy

    from app.events.domain import CareRequirement
    from app.events.templates import care_model_for

    e = copy.deepcopy(export_dict)
    if beds != 1.0:
        # Capacity is a count of objects now, so scaling it means duplicating
        # them — which is what a bigger network actually is.
        extra: list[dict] = []
        for o in e["objects"]:
            if o["role"] != SPACE:
                continue
            for k in range(1, int(beds)):
                clone = copy.deepcopy(o)
                clone["id"] = f"{o['id']}-x{k}"
                extra.append(clone)
        e["objects"].extend(extra)
    sizes = {p["id"]: population for p in e["populations"]}
    probe = load(
        e,
        care_model={"_p": CareRequirement(acuity="_p", consumes={})},
        population_sizes=sizes,
        route_capacity=10,
    )
    return load(
        e, care_model=care_model_for(probe), population_sizes=sizes, route_capacity=10
    )


def test_demand_follows_the_population_not_the_beds() -> None:
    """The defect that made every capacity plan pointless.

    Demand used to be anchored on the network's own bed capacity. Measured on
    the real twin, doubling the beds doubled the deaths — exactly linear, 4116
    to 8232 to 16465 — so occupancy was invariant to capacity and building a
    wing could never help. Meanwhile the catchment size the loader insisted on
    was read in exactly one place: the check that refused zero.

    Both directions are asserted, because fixing one and not the other would
    leave the model wrong in a way that reads as right.
    """
    from app.events.dynamics import run
    from app.events.policy import null_policy

    ex = export()

    small = _scaled(ex, population=25_000)
    large = _scaled(ex, population=100_000)
    deaths_small = run(small, EVENTS["pandemic"](small), null_policy(), seed=0).deaths
    deaths_large = run(large, EVENTS["pandemic"](large), null_policy(), seed=0).deaths
    assert deaths_large > deaths_small, "a bigger catchment has to produce more demand"

    lean = _scaled(ex, beds=1.0)
    roomy = _scaled(ex, beds=3.0)
    deaths_lean = run(lean, EVENTS["pandemic"](lean), null_policy(), seed=0).deaths
    deaths_roomy = run(roomy, EVENTS["pandemic"](roomy), null_policy(), seed=0).deaths
    assert deaths_roomy < deaths_lean, "more beds must not summon more patients"


def test_a_flat_arrival_ignores_the_catchment() -> None:
    """A bus crash brings forty people whatever the catchment.

    Both forms exist because both are real, and collapsing them would force
    every mass-casualty event to be expressed as a rate over a population it has
    nothing to do with.
    """
    from app.events.effects import Effect, Event, TemporalProfile
    from app.events.dynamics import Engine
    from app.events.policy import null_policy

    def arrivals(population: int) -> float:
        state = _scaled(export(), population=population)
        flat = Effect(
            id="crash",
            target="demand.volume",
            select={"population": ["pop:site-1"], "acuity": ["critical"]},
            op="add",
            value=40,
            profile=TemporalProfile(start=0, end=5, shape="step", peak=1.0),
        )
        engine = Engine(state, Event(id="e", horizon=5, effects=[flat]), null_policy(), 0)
        return sum(engine._arrivals(1).values())

    assert arrivals(25_000) == arrivals(400_000) == 40


def test_a_rate_is_read_per_thousand_people() -> None:
    """The unit is in the label, so it has to be the unit in the arithmetic."""
    from app.events.effects import Effect, Event, TemporalProfile
    from app.events.dynamics import Engine
    from app.events.policy import null_policy

    state = _scaled(export(), population=50_000)
    rate = Effect(
        id="wave",
        target="demand.incidence",
        select={"population": ["pop:site-1"], "acuity": ["critical"]},
        op="add",
        value=0.4,
        profile=TemporalProfile(start=0, end=5, shape="step", peak=1.0),
    )
    engine = Engine(state, Event(id="e", horizon=5, effects=[rate]), null_policy(), 0)
    # 0.4 per thousand across 50 000 people is twenty patients a step.
    assert sum(engine._arrivals(1).values()) == pytest.approx(20.0)


def test_a_transfer_needs_room_at_the_far_end() -> None:
    """No protocol sends patients to a full hospital.

    The rule used to read only the source. Under saturation it moved the
    sickest into a ward with no free bed, where they queued behind that ward's
    own critical patients instead of being served first at home — and died. On
    the toy network with realistic demand that made load-balancing *worse* than
    doing nothing, while its trace showed rules firing and patients moving.
    """
    s = runnable()
    rules = [r for r in POLICIES["load-balance"](s).rules if r.action.kind == "transfer"]
    assert rules, "expected a transfer rule on a network with a route"
    for rule in rules:
        flat = [
            c.compare
            for c in (rule.condition.all_of or [])
            if c.compare is not None
        ]
        assert any(
            c.left.fn == "available" and c.left.facility == rule.action.target
            for c in flat
        ), "the destination's free capacity is never consulted"


def _capacity_after(effects, facility="unit-a", tick=3):
    """The capacity the engine resolves for one facility at one tick."""
    from app.events.dynamics import Engine
    from app.events.effects import Event
    from app.events.policy import null_policy

    state = _scaled(export(), population=50_000)
    engine = Engine(state, Event(id="e", horizon=10, effects=effects), null_policy(), 0)
    engine._apply_perturbations(tick)
    return state.facility(facility).resources["lit"].capacity


def _cap_effect(eid, op, value):
    from app.events.effects import Effect, TemporalProfile

    return Effect(
        id=eid,
        target="resource.capacity",
        select={"facility": ["unit-a"]},
        op=op,
        value=value,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )


def test_the_order_of_the_effects_list_does_not_change_the_result() -> None:
    """A JSON array's order is not a modelling decision.

    Applied in list order, `[set 10, multiply 0.5]` resolved to 5 and
    `[multiply 0.5, set 10]` to 10 — the same event, reordered by a save,
    producing a different network. Nothing in the composer suggests the list is
    ordered, so nobody would think to look.
    """
    forward = [_cap_effect("a-set", "set", 10), _cap_effect("b-mult", "multiply", 0.5)]
    reverse = list(reversed(forward))
    assert _capacity_after(forward) == _capacity_after(reverse)


def test_set_establishes_the_value_that_transformations_then_act_on() -> None:
    """`set` asserts a state; `multiply` and `add` transform one.

    Read as sentences, "the wing is rebuilt to 40 beds" followed by "staff
    sickness costs 30% of capacity" means 28. Applying `set` last instead would
    compute that multiplier against the old baseline and discard it, so the
    staff shortage would silently not exist at that facility — which is what
    the first version of this did while a comment claimed the opposite.
    """
    assert _capacity_after(
        [_cap_effect("a-set", "set", 40), _cap_effect("b-mult", "multiply", 0.7)]
    ) == pytest.approx(28)
    # And the same the other way round in the file, because precedence is by
    # operation, not by position.
    assert _capacity_after(
        [_cap_effect("a-mult", "multiply", 0.7), _cap_effect("b-set", "set", 40)]
    ) == pytest.approx(28)


def test_something_can_be_stood_up_at_a_site_an_event_flattened() -> None:
    """Destroyed, then twenty field beds in the car park.

    Under set-last this gave zero, and nothing could ever be added at a site an
    event had wiped out — a whole class of response left inexpressible by a
    tie-break nobody had argued for.
    """
    assert _capacity_after(
        [_cap_effect("a-flood", "set", 0), _cap_effect("b-field", "add", 20)]
    ) == 20


def test_multiply_bites_before_add() -> None:
    """The percentage hits the ward; the field beds are extra.

    Mixed addition and multiplication are not commutative, so a precedence had
    to be chosen or the result would depend on effect ids — deterministic, but
    changed by a rename.
    """
    # 48 beds, minus 30%, plus 20 = 53.6 — not (48 + 20) * 0.7 = 47.6.
    assert _capacity_after(
        [_cap_effect("a-add", "add", 20), _cap_effect("b-mult", "multiply", 0.7)]
    ) == pytest.approx(53.6)


def test_two_overlapping_sets_resolve_by_id_not_by_position() -> None:
    """Still arbitrary, but no longer sensitive to how the file was written.

    The engine cannot guess which of two contradictory `set` effects was meant.
    What it can do is stop the answer depending on array order, and leave the
    composer to warn that the event says two things at once.
    """
    first = [_cap_effect("aaa", "set", 5), _cap_effect("zzz", "set", 40)]
    assert _capacity_after(first) == 40
    assert _capacity_after(list(reversed(first))) == 40


# --- the objects are the truth ----------------------------------------------


def test_capacity_is_counted_from_objects_not_read_from_the_payload() -> None:
    """The inversion, stated as a test.

    The export ships aggregates *and* objects, because the composer wants the
    former. If the loader read them, an effect could edit a bed's property and
    the ward's capacity would not move — two truths, and no way to tell which
    one had been changed. So the payload's totals are deliberately absent from
    the fixture and the numbers below can only have come from counting.
    """
    s = runnable()
    lit = s.facility("unit-a").resources["lit"]
    assert lit.capacity == 48
    # 28 of the 48 carry status "occupied", so 20 are free.
    assert lit.quantity == 20
    assert s.facility("unit-b").resources["lit"].capacity == 30


def test_marking_an_object_unavailable_takes_capacity_away() -> None:
    """The thing the aggregate model could not express.

    "This bed became contaminated" is a text change on one instance. Capacity
    falling by one is a consequence nobody had to wire up — which is the whole
    point of deriving totals rather than shipping them.
    """
    from app.events.objects import ObjectRules, SimObject, rebuild

    s = runnable()
    rules = s.object_rules
    assert isinstance(rules, ObjectRules)
    objects = list(s.objects.values())
    before = s.facility("unit-a").resources["lit"].capacity

    free = next(
        o
        for o in objects
        if isinstance(o, SimObject)
        and o.at == "unit-a"
        and o.type == "Lit"
        and not rules.unavailable(o.properties)
    )
    free.properties["status"] = "contaminated"
    rebuild(s.facility("unit-a"), objects, ObjectRules(
        unavailable_keys=rules.unavailable_keys,
        unavailable_values=[*rules.unavailable_values, "contaminated"],
    ))

    assert s.facility("unit-a").resources["lit"].capacity == before
    # Capacity is unchanged — the bed still exists — but it is no longer free.
    assert s.facility("unit-a").resources["lit"].quantity == 19


def test_rebuilding_does_not_hand_back_beds_a_patient_is_lying_in() -> None:
    """Re-deriving must not heal the run.

    Capacity comes from the objects; the drawn-down part comes from the
    simulation so far. Overwriting quantity outright would return every occupied
    bed the moment any effect touched the ward, and the network would quietly
    recover from its own admissions.
    """
    from app.events.objects import ObjectRules, rebuild

    s = runnable()
    s.consume("unit-a", "lit", 15)
    assert s.facility("unit-a").resources["lit"].quantity == 5

    rebuild(s.facility("unit-a"), list(s.objects.values()), s.object_rules)
    assert s.facility("unit-a").resources["lit"].quantity == 5


def test_an_object_type_that_vanishes_leaves_no_ghost_resource() -> None:
    """A stale zero-capacity entry would keep counting in category totals and
    would keep appearing in the composer's vocabulary as something to perturb."""
    from app.events.objects import rebuild

    s = runnable()
    assert "infirmiere" in s.facility("unit-a").resources
    remaining = [o for o in s.objects.values() if o.type != "Infirmiere"]
    rebuild(s.facility("unit-a"), remaining, s.object_rules)
    assert "infirmiere" not in s.facility("unit-a").resources


def test_people_are_census_and_never_capacity() -> None:
    """Counting patients as a resource would make a ward look better staffed
    the fuller it got."""
    s = runnable()
    assert "patient" not in s.facility("unit-a").resources


# --- effects on the objects themselves --------------------------------------


def _prop(eid, value, **over):
    from app.events.effects import Effect, TemporalProfile

    kwargs = dict(
        id=eid,
        target="object.property",
        property_key="status",
        select={"object_type": ["Lit"], "facility": ["unit-a"]},
        op="set",
        value=value,
        profile=TemporalProfile(start=3, end=8, shape="step", peak=1.0),
    )
    kwargs.update(over)
    return Effect(**kwargs)


def _free_at(effects, ticks):
    from app.events.dynamics import Engine
    from app.events.effects import Event
    from app.events.policy import null_policy

    s = runnable()
    engine = Engine(s, Event(id="ev", horizon=12, effects=effects), null_policy(), 0)
    out = []
    for t in ticks:
        engine._apply_perturbations(t)
        out.append(s.facility("unit-a").resources["lit"].quantity)
    return out


def test_setting_a_text_property_moves_capacity() -> None:
    """The thing the aggregate model could not say at all.

    Forty-eight beds, twenty-eight already marked occupied by the ontology.
    Marking the rest takes free capacity to zero — and nothing in the care loop
    was told that a status and a bed count are related. That connection is the
    inversion working.
    """
    assert _free_at([_prop("shut", "occupied")], [0, 4]) == [20, 0]


def test_a_property_change_can_give_capacity_back() -> None:
    """Reopening a wing has to work, or half the point is missing.

    This failed at first: `rebuild` inferred what the run had drawn from
    `capacity - quantity`, which also counted the beds the *ontology* called
    occupied. Those were then held for the whole run, and an event that freed
    them changed nothing while looking entirely reasonable.
    """
    assert _free_at([_prop("reopen", "available")], [0, 4]) == [20, 48]


def test_an_effect_lets_go_when_its_window_closes() -> None:
    """A closed window must undo itself.

    Rebuilding only the facilities touched *this* tick left a finished effect
    applied for ever: the properties reverted, nothing recomputed the totals
    from them, and the ward stayed shut long after the flood receded.
    """
    assert _free_at([_prop("shut", "occupied")], [4, 9]) == [0, 20]


def test_reach_takes_a_share_rather_than_everything() -> None:
    """"Every bed in the network" is almost never what someone means, and an
    effect that silently means it produces a catastrophe nobody wrote."""
    # Half of 48 is 24, and 4 of those were free before.
    assert _free_at([_prop("half", "occupied", reach=0.5)], [4]) == [18]
    # Freeing ten gives ten back. Written as a *release* rather than another
    # occupation on purpose: `reach` takes from the front of the id order, and
    # the first ten ids here are all already occupied — marking them occupied
    # again would change nothing and the test would prove nothing while passing
    # for the wrong reason. Front-taking is deterministic, which a comparison
    # needs, but it does mean a reach can land entirely on objects an earlier
    # state had already claimed.
    assert _free_at([_prop("ten", "available", reach=10)], [4]) == [30]


def test_an_effect_stays_inside_the_facility_it_names() -> None:
    s = runnable()
    from app.events.dynamics import Engine
    from app.events.effects import Event
    from app.events.policy import null_policy

    engine = Engine(
        s,
        Event(id="ev", horizon=12, effects=[
            _prop("elsewhere", "occupied", select={"object_type": ["Lit"], "facility": ["unit-b"]}),
        ]),
        null_policy(),
        0,
    )
    engine._apply_perturbations(4)
    assert s.facility("unit-a").resources["lit"].quantity == 20
    assert s.facility("unit-b").resources["lit"].quantity == 0


def test_arithmetic_on_a_text_property_is_refused_not_coerced() -> None:
    """Multiplying a status by 0.6 has no meaning.

    Inventing one would corrupt an instance in the ontology's own vocabulary
    while the run carried on reporting numbers built from it.
    """
    import pytest as _pytest

    with _pytest.raises(TypeError, match="needs a number"):
        _free_at([_prop("nonsense", 0.6, op="multiply")], [4])


def test_a_property_effect_does_not_compound_over_time() -> None:
    """Applied to the running value, a multiplier re-applies every tick and the
    property decays to nothing while every reading of it looks plausible. The
    same trap `_resolve` exists to avoid, no less dangerous on a property."""
    from app.events.dynamics import Engine
    from app.events.effects import Effect, Event, TemporalProfile
    from app.events.policy import null_policy

    s = runnable()
    for o in s.objects.values():
        if o.type == "Lit":
            o.properties["beds_in_bay"] = 4.0
    engine = Engine(
        s,
        Event(id="ev", horizon=12, effects=[
            Effect(
                id="halve", target="object.property", property_key="beds_in_bay",
                select={"object_type": ["Lit"]}, op="multiply", value=0.5,
                profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
            )
        ]),
        null_policy(),
        0,
    )
    for t in range(6):
        engine._apply_perturbations(t)
    sample = next(o for o in s.objects.values() if o.type == "Lit")
    assert sample.properties["beds_in_bay"] == 2.0


# --- end to end -------------------------------------------------------------


def test_a_real_twin_runs_and_a_policy_beats_doing_nothing() -> None:
    from app.events.harness import compare
    from app.events.scoring import Objective

    s = runnable()
    rows = compare(
        s,
        EVENTS["pandemic"](s),
        [POLICIES["null"](s), POLICIES["load-balance"](s), POLICIES["surge-and-balance"](s)],
        Objective(weights={"excess_deaths": 1.0}),
    )
    assert rows[-1]["policy"] == "null", "doing nothing should never win"
    assert rows[0]["excess_deaths"] < rows[-1]["excess_deaths"]
