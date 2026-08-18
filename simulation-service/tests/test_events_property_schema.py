"""The declaration decides how an effect composes, and the engine obeys it.

Until now the engine carried its own list of perturbable quantities — a length
of stay, a mortality rate, an arrival rate per thousand people. Those are one
hospital's concepts, and a platform that ships them has decided what kind of
institution its customer is.

The composition law moved onto the property, declared by whoever knows what the
number means. Every test here guards a way that could go wrong *quietly*: a
running total silently reset, a multiplier compounding into nothing, a label
turned into arithmetic. All three finish the run and produce a table.
"""

from __future__ import annotations

import pytest

from app.events.domain import SPACE
from app.events.dynamics import Engine
from app.events.effects import Effect, Event, TemporalProfile
from app.events.objects import PropertySchema, apply_property
from app.events.ontology import load
from app.events.policy import null_policy
from app.events.templates import care_model_for
from tests.test_events_ontology import export


def schema(**behaviours) -> PropertySchema:
    """A `Lit` type whose properties carry whatever the test needs to declare."""
    props = []
    for key, spec in behaviours.items():
        if isinstance(spec, str):
            spec = {"behaviour": spec, "type": "number"}
        props.append({"key": key, **spec})
    return PropertySchema(types=[{"name": "Lit", "role": SPACE, "properties": props}])


def obj(**properties):
    from app.events.objects import SimObject

    return SimObject(id="lit-1", type="Lit", role=SPACE, properties=dict(properties), at="unit-a")


def effect(op: str, value, key: str = "charge") -> Effect:
    return Effect(
        id="e",
        target="object.property",
        property_key=key,
        select={"object_type": ["Lit"]},
        op=op,
        value=value,
        profile=TemporalProfile(start=0, end=None, shape="step", peak=1.0),
    )


# --- how each behaviour composes --------------------------------------------


def test_a_level_composes_from_the_baseline_so_it_cannot_compound() -> None:
    """The failure this prevents completes the run and reads as a finding.

    A 0.5 multiplier applied to the running value re-applies every step. Over a
    sixty-step horizon that is 8.7e-19, and the report says the network
    collapsed under a 50% shock.
    """
    o = obj(charge=100.0)
    base = {"charge": 100.0}
    s = schema(charge="level")
    for _ in range(5):
        apply_property(effect("multiply", 0.5), o, base, s)
    assert o.properties["charge"] == 50.0


def test_a_stock_composes_from_the_running_value_so_it_accumulates() -> None:
    """The mirror failure: rebuilding a queue from a baseline every step erases
    everyone still waiting, and the run reports a network that kept up."""
    o = obj(attente=0.0)
    base = {"attente": 0.0}
    s = schema(attente="stock")
    for _ in range(5):
        apply_property(effect("add", 3.0, "attente"), o, base, s)
    assert o.properties["attente"] == 15.0


def test_a_rate_composes_like_a_level() -> None:
    # The difference between the two is what the engine does with the number,
    # not how effects land on it. Stated as a test so a future change to one
    # cannot silently drag the other along.
    o = obj(charge=10.0)
    for _ in range(3):
        apply_property(effect("add", 2.0), o, {"charge": 10.0}, schema(charge="rate"))
    assert o.properties["charge"] == 12.0


def test_arithmetic_on_a_declared_state_is_refused_not_coerced() -> None:
    """A triage level of 3 is not three of anything.

    Coercing it would corrupt an instance in the ontology's own vocabulary while
    the run carried on reporting numbers built from it.
    """
    s = schema(niveau={"behaviour": "state", "type": "number"})
    with pytest.raises(TypeError, match="declared a state"):
        apply_property(effect("multiply", 0.5, "niveau"), obj(niveau=3), {"niveau": 3}, s)


def test_set_still_writes_text_on_a_state() -> None:
    s = schema(statut={"behaviour": "state", "type": "string"})
    o = obj(statut="healthy")
    apply_property(effect("set", "sick", "statut"), o, {"statut": "healthy"}, s)
    assert o.properties["statut"] == "sick"


# --- the bounds the institution declared ------------------------------------


def test_bounds_hold_after_the_operation_not_before() -> None:
    """An author who multiplies staffing by zero means zero; a declared minimum
    of one is the institution saying that is impossible. Letting the impossible
    value through would answer a question about a world that cannot exist."""
    s = schema(charge={"behaviour": "level", "type": "number", "min": 1.0, "max": 80.0})
    o = obj(charge=100.0)
    apply_property(effect("multiply", 0.0), o, {"charge": 100.0}, s)
    assert o.properties["charge"] == 1.0
    apply_property(effect("multiply", 1.0), o, {"charge": 100.0}, s)
    assert o.properties["charge"] == 80.0


def test_set_is_bounded_too() -> None:
    # Otherwise `set` is the hole every bound leaks through, and the field that
    # declared the range would mean "unless you type the number directly".
    s = schema(charge={"behaviour": "level", "type": "number", "min": 0.0, "max": 10.0})
    o = obj(charge=5.0)
    apply_property(effect("set", 999.0), o, {"charge": 5.0}, s)
    assert o.properties["charge"] == 10.0


def test_bounds_leave_text_alone() -> None:
    # A minimum on a status is refused at declaration time, but a schema that
    # arrived from an older writer must not crash a run over it.
    s = schema(statut={"behaviour": "state", "type": "string", "min": 0.0})
    o = obj(statut="healthy")
    apply_property(effect("set", "sick", "statut"), o, {"statut": "healthy"}, s)
    assert o.properties["statut"] == "sick"


def test_an_undeclared_property_still_composes_from_the_baseline() -> None:
    """Not a guess about what the number means.

    `api.py` refuses arithmetic on an undeclared property before the run starts,
    so the only way to reach here without a declaration is `set`. This pins that
    the fallback is the safe one anyway, rather than accumulation.
    """
    o = obj(charge=100.0)
    for _ in range(4):
        apply_property(effect("multiply", 0.5), o, {"charge": 100.0}, None)
    assert o.properties["charge"] == 50.0


# --- through the engine, where the reset lives ------------------------------


def with_schema(types: list[dict]):
    ex = export(object_types=types)
    sizes = {"pop:site-1": 50_000}
    from app.events.domain import CareRequirement

    probe = load(
        ex,
        care_model={"_p": CareRequirement(acuity="_p", consumes={})},
        population_sizes=sizes,
        route_capacity=10,
    )
    return load(ex, care_model=care_model_for(probe), population_sizes=sizes, route_capacity=10)


def test_the_engine_carries_a_stock_across_the_tick_reset() -> None:
    """Every property is rebuilt from its unperturbed value at the top of each
    tick, which is what stops effects compounding. A stock has to survive that,
    or the declaration means nothing once a run is involved."""
    state = with_schema(
        [
            {
                "name": "Lit",
                "role": SPACE,
                "properties": [{"key": "attente", "type": "number", "behaviour": "stock"}],
            }
        ]
    )
    for o in state.objects.values():
        o.properties["attente"] = 0.0
    e = Engine(
        state,
        Event(id="ev", horizon=10, effects=[effect("add", 2.0, "attente")]),
        null_policy(),
        0,
    )
    # The baseline was captured at construction, so re-seeding above is already
    # reflected; three ticks of +2 is 6, not 2.
    for tick in range(3):
        e._apply_objects(tick)
    assert state.objects["unit-a-Lit-0"].properties["attente"] == 6.0


def test_the_engine_still_reverts_a_level_when_the_window_closes() -> None:
    """The counterpart. A level that carried across the reset would leave a
    closed wing shut for ever after the flood receded."""
    state = with_schema(
        [
            {
                "name": "Lit",
                "role": SPACE,
                "properties": [{"key": "charge", "type": "number", "behaviour": "level"}],
            }
        ]
    )
    for o in state.objects.values():
        o.properties["charge"] = 10.0
    shock = Effect(
        id="e",
        target="object.property",
        property_key="charge",
        select={"object_type": ["Lit"]},
        op="add",
        value=5.0,
        profile=TemporalProfile(start=0, end=2, shape="step", peak=1.0),
    )
    e = Engine(state, Event(id="ev", horizon=10, effects=[shock]), null_policy(), 0)
    e._apply_objects(1)
    assert state.objects["unit-a-Lit-0"].properties["charge"] == 15.0
    e._apply_objects(5)
    assert state.objects["unit-a-Lit-0"].properties["charge"] == 10.0


def test_the_schema_travels_from_the_export_without_being_asked_for() -> None:
    state = with_schema(
        [
            {
                "name": "Lit",
                "role": SPACE,
                "properties": [
                    {"key": "statut", "type": "string", "behaviour": "state"},
                    {"key": "charge", "type": "number", "unit": "%", "behaviour": "level"},
                ],
            }
        ]
    )
    assert state.property_schema.behaviour("Lit", "charge") == "level"
    assert state.property_schema.find("Lit", "charge").unit == "%"
    # A type nobody declared, and a key nobody declared on a type that exists,
    # both answer "nothing said" rather than raising — the caller reports it.
    assert state.property_schema.behaviour("Lit", "inexistant") is None
    assert state.property_schema.behaviour("Infirmiere", "charge") is None


def test_an_export_with_no_schema_still_loads() -> None:
    # Every twin in existence is in this state until somebody opens the type
    # editor. A hard requirement here would have made the change a migration.
    state = with_schema([])
    assert state.property_schema.types == []


# --- the refusal at the boundary --------------------------------------------
#
# `apply_property` would raise on a declared state eventually, but by then a
# partially-applied trajectory exists and the caller gets a 500 for what is
# really a question about the ontology. These check the answer arrives before
# the run starts.


def problems_for(op: str, key: str, types: list[dict], select=None) -> list[str]:
    from app.events.api import _arithmetic_problems

    state = with_schema(types)
    e = Effect(
        id="ev-1",
        target="object.property",
        property_key=key,
        select=select if select is not None else {"object_type": ["Lit"]},
        op=op,
        value=0.5,
    )
    return _arithmetic_problems(e, key, state)


def declared(key: str, **spec) -> list[dict]:
    return [{"name": "Lit", "role": SPACE, "properties": [{"key": key, **spec}]}]


def test_an_undeclared_number_refuses_arithmetic_and_says_where_to_fix_it() -> None:
    """This is the whole change in one assertion.

    The engine used to answer "does this rebuild or accumulate?" itself, by
    shipping quantities it had invented. It no longer does, so the honest reply
    to "multiply this by 0.5" is to say nobody has said, and name the place.
    """
    out = problems_for("multiply", "charge", declared("charge", type="number"))
    assert len(out) == 1
    assert "no declared behaviour" in out[0]
    assert "object type" in out[0]


def test_arithmetic_on_a_declared_state_is_refused_before_the_run() -> None:
    out = problems_for("add", "niveau", declared("niveau", type="number", behaviour="state"))
    assert len(out) == 1
    assert "declared a state" in out[0]


def test_a_declared_quantity_passes() -> None:
    assert problems_for("multiply", "charge", declared("charge", type="number", behaviour="level")) == []
    assert problems_for("add", "attente", declared("attente", type="number", behaviour="stock")) == []


def test_a_property_nothing_declares_is_left_to_the_other_check() -> None:
    # "No object carries a property called X" is already reported, and the fix
    # is to add the property rather than to classify it. Two messages about one
    # missing field would read as two problems.
    assert problems_for("multiply", "inexistant", declared("charge", type="number")) == []


def test_it_names_only_the_types_the_effect_can_land_on() -> None:
    """An effect narrowed to beds should not be told about nurses.

    The message exists to be acted on, and one that lists every type in the
    ontology is one nobody reads.
    """
    types = [
        {"name": "Lit", "role": SPACE, "properties": [{"key": "charge", "type": "number", "behaviour": "level"}]},
        {"name": "Infirmiere", "role": "staff", "properties": [{"key": "charge", "type": "number"}]},
    ]
    assert problems_for("multiply", "charge", types, select={"object_type": ["Lit"]}) == []
    # Unnarrowed, the undeclared one surfaces — because that is the type the
    # effect would actually hit and fail on.
    unnarrowed = problems_for("multiply", "charge", types, select={})
    assert len(unnarrowed) == 1
    assert "Infirmiere" in unnarrowed[0]


def test_set_is_never_the_subject_of_this_check() -> None:
    # `set` reads no prior value, so composition does not arise. Refusing it
    # would make a declared status unwritable, which is the one thing object
    # effects exist for.
    out = problems_for("set", "statut", declared("statut", type="string", behaviour="state"))
    assert out == []
