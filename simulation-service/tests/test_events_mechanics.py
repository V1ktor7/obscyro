"""The care model, read rather than invented.

`care_model_for` picks three severities nobody named, stays of six, three and
one step, one bed and a fraction of a nurse per patient, and a mortality of 0.15
divided by ten and two hundred for the other bands. Those are one hospital's
clinical assumptions. Every test here is about an institution supplying its own
and the engine using them without knowing what any of the words mean.
"""

from __future__ import annotations

import pytest

from app.events.mechanics import (
    ContradictoryCareModel,
    binds_care_model,
    care_model_from,
)
from app.events.objects import PropertySchema, SimObject


def protocol_type(name: str = "Protocole") -> dict:
    """A type whose properties are bound to mechanics.

    Deliberately named in French with keys that look nothing like the engine's
    vocabulary: if any of this leaks a property name into the model, these tests
    are the ones that catch it.
    """
    return {
        "name": name,
        "role": None,
        "properties": [
            {"key": "gravite", "type": "string", "behaviour": "state", "mechanic": "serves_severity"},
            {"key": "duree_sejour", "type": "number", "behaviour": "level", "mechanic": "occupies_for"},
            {"key": "deces_sans_soin", "type": "number", "behaviour": "level", "mechanic": "dies_without"},
            {"key": "ressource", "type": "string", "behaviour": "state", "mechanic": "consumes_activity"},
            {"key": "quantite", "type": "number", "behaviour": "level", "mechanic": "consumes_amount"},
        ],
    }


def schema(*types: dict) -> PropertySchema:
    return PropertySchema(types=list(types) or [protocol_type()])


def row(rid: str, gravite: str, **over) -> SimObject:
    props = {
        "gravite": gravite,
        "duree_sejour": 6,
        "deces_sans_soin": 0.15,
        "ressource": "lit",
        "quantite": 1.0,
    }
    props.update(over)
    return SimObject(id=rid, type="Protocole", role=None, properties=props, at=None)


# --- reading it ------------------------------------------------------------


def test_one_instance_becomes_one_care_requirement() -> None:
    model = care_model_from([row("p1", "critique")], schema())
    assert set(model) == {"critique"}
    req = model["critique"]
    assert req.acuity == "critique"
    assert req.stay_ticks == 6
    assert req.mortality_per_unmet == 0.15
    assert req.consumes == {"lit": 1.0}


def test_two_instances_on_one_severity_merge_what_it_consumes() -> None:
    """"A critical case needs a bed and half a nurse" — written as two rows,
    without the engine knowing either word."""
    model = care_model_from(
        [
            row("p1", "critique", ressource="lit", quantite=1.0),
            row("p2", "critique", ressource="infirmiere", quantite=0.5),
        ],
        schema(),
    )
    assert model["critique"].consumes == {"lit": 1.0, "infirmiere": 0.5}


def test_the_institution_names_its_own_severities() -> None:
    # Not critical/urgent/routine. Whatever they call them, however many.
    model = care_model_from(
        [row("p1", "P1"), row("p2", "P2"), row("p3", "P3"), row("p4", "P4"), row("p5", "P5")],
        schema(),
    )
    assert sorted(model) == ["P1", "P2", "P3", "P4", "P5"]


def test_nothing_bound_yields_no_model_rather_than_a_default_one() -> None:
    # The caller reads an empty dict as "this institution has not described its
    # care", which is true, instead of being handed somebody else's numbers.
    bare = PropertySchema(types=[{"name": "Lit", "role": "space", "properties": []}])
    assert care_model_from([row("p1", "critique")], bare) == {}
    assert care_model_from([], schema()) == {}
    assert care_model_from([row("p1", "x")], None) == {}


def test_binds_care_model_answers_before_anything_is_loaded() -> None:
    assert binds_care_model(schema()) is True
    assert binds_care_model(PropertySchema(types=[{"name": "Lit", "properties": []}])) is False
    assert binds_care_model(None) is False


# --- what an unbound mechanic means ----------------------------------------


def test_an_unbound_mortality_is_zero_not_a_shipped_figure() -> None:
    """Nobody said anyone dies of this, so the model does not claim they do.

    A default here would be the 0.15 all over again, and it is the single number
    a minister would be asked to defend.
    """
    partial = {
        "name": "Protocole",
        "role": None,
        "properties": [
            {"key": "gravite", "type": "string", "behaviour": "state", "mechanic": "serves_severity"},
            {"key": "ressource", "type": "string", "behaviour": "state", "mechanic": "consumes_activity"},
            {"key": "quantite", "type": "number", "behaviour": "level", "mechanic": "consumes_amount"},
        ],
    }
    model = care_model_from([row("p1", "critique")], schema(partial))
    assert model["critique"].mortality_per_unmet == 0.0


def test_an_unbound_stay_is_one_step_because_zero_would_make_capacity_free() -> None:
    """A unit of demand has to hold what it consumes for at least the step it is
    served in. At zero, being served costs nothing and no capacity ever binds —
    every policy would tie at zero deaths."""
    partial = {
        "name": "Protocole",
        "role": None,
        "properties": [
            {"key": "gravite", "type": "string", "behaviour": "state", "mechanic": "serves_severity"},
            {"key": "ressource", "type": "string", "behaviour": "state", "mechanic": "consumes_activity"},
            {"key": "quantite", "type": "number", "behaviour": "level", "mechanic": "consumes_amount"},
        ],
    }
    assert care_model_from([row("p1", "critique")], schema(partial))["critique"].stay_ticks == 1
    # Same floor when the value is bound and set below it.
    assert care_model_from([row("p1", "critique", duree_sejour=0)], schema())["critique"].stay_ticks == 1


def test_a_row_naming_no_severity_describes_nothing_and_is_skipped() -> None:
    # A half-filled row is a form in progress, not a reason to refuse the run.
    model = care_model_from([row("p1", ""), row("p2", "critique")], schema())
    assert sorted(model) == ["critique"]


# --- the contradictions, named rather than resolved -------------------------


def test_two_rows_disagreeing_about_a_stay_are_refused() -> None:
    """Picking the first, the last or the larger each gives a run that completes
    and answers a question nobody asked."""
    with pytest.raises(ContradictoryCareModel, match="occupies_for"):
        care_model_from(
            [row("p1", "critique", duree_sejour=6), row("p2", "critique", duree_sejour=9)],
            schema(),
        )


def test_the_message_names_both_sides() -> None:
    with pytest.raises(ContradictoryCareModel) as exc:
        care_model_from(
            [row("proto-a", "critique", deces_sans_soin=0.1), row("proto-b", "critique", deces_sans_soin=0.2)],
            schema(),
        )
    assert "proto-a" in str(exc.value) and "proto-b" in str(exc.value)


def test_two_rows_disagreeing_about_one_consumption_are_refused() -> None:
    with pytest.raises(ContradictoryCareModel, match="lit"):
        care_model_from(
            [
                row("p1", "critique", ressource="lit", quantite=1.0),
                row("p2", "critique", ressource="lit", quantite=2.0),
            ],
            schema(),
        )


def test_agreeing_rows_are_not_a_contradiction() -> None:
    # Restating the same stay on two rows of one severity is redundant, not
    # wrong, and refusing it would make the two-activity case impossible to
    # write.
    model = care_model_from(
        [
            row("p1", "critique", ressource="lit", quantite=1.0, duree_sejour=6),
            row("p2", "critique", ressource="infirmiere", quantite=0.5, duree_sejour=6),
        ],
        schema(),
    )
    assert model["critique"].stay_ticks == 6
    assert model["critique"].consumes == {"lit": 1.0, "infirmiere": 0.5}


def test_severities_do_not_contaminate_each_other() -> None:
    model = care_model_from(
        [row("p1", "critique", duree_sejour=6), row("p2", "routine", duree_sejour=1)],
        schema(),
    )
    assert model["critique"].stay_ticks == 6
    assert model["routine"].stay_ticks == 1


# --- the property names never escape ---------------------------------------


def test_two_institutions_with_different_words_produce_the_same_model() -> None:
    """The point of binding by mechanic rather than by name.

    A site that calls its stay `los` and one that calls it `duree_sejour` give
    the engine identical input, and neither had to adopt the other's vocabulary.
    """
    english = {
        "name": "Protocole",
        "role": None,
        "properties": [
            {"key": "band", "type": "string", "behaviour": "state", "mechanic": "serves_severity"},
            {"key": "los", "type": "number", "behaviour": "level", "mechanic": "occupies_for"},
            {"key": "uses", "type": "string", "behaviour": "state", "mechanic": "consumes_activity"},
            {"key": "qty", "type": "number", "behaviour": "level", "mechanic": "consumes_amount"},
        ],
    }
    other = SimObject(
        id="p1",
        type="Protocole",
        properties={"band": "critique", "los": 6, "uses": "lit", "qty": 1.0},
    )
    theirs = care_model_from([other], schema(english))
    mine = care_model_from([row("p1", "critique")], schema())
    assert theirs["critique"].stay_ticks == mine["critique"].stay_ticks
    assert theirs["critique"].consumes == mine["critique"].consumes


# --- the loop is closed -----------------------------------------------------
#
# A declared care model is only a replacement for `care.stay_ticks` if an
# effect on the protocol reaches the numbers the engine actually reads. If it
# does not, the effect applies, the run completes, and nothing changes — which
# is the exact failure this codebase keeps finding.


def engine_over(rows: list[SimObject], effects=()):
    from app.events.domain import Edge, Facility, NetworkxBackend, Population, Resource, SystemState
    from app.events.dynamics import Engine
    from app.events.effects import Event
    from app.events.policy import null_policy

    schema_obj = schema()
    state = SystemState(
        facilities={
            "unit-a": Facility(
                id="unit-a",
                name="Urgence",
                resources={
                    "lit": Resource(id="lit", category="space", capacity=10, quantity=10,
                                    enables=frozenset({"lit"}))
                },
            )
        },
        populations={"pop": Population(id="pop", size=1000, served_by=["unit-a"])},
        care_model=care_model_from(rows, schema_obj),
        network=NetworkxBackend(),
        objects={o.id: o for o in rows},
        object_rules=__import__("app.events.objects", fromlist=["ObjectRules"]).ObjectRules(),
        property_schema=schema_obj,
    )
    return state, Engine(state, Event(id="ev", horizon=20, effects=list(effects)), null_policy(), 0)


def test_perturbing_a_protocol_changes_what_the_engine_reads() -> None:
    """The replacement for `care.stay_ticks`, in one assertion.

    Writing to the instance is not enough — the model the care loop consults has
    to be re-derived from it, the way a ward's capacity is re-counted from its
    beds.
    """
    from app.events.effects import Effect, TemporalProfile

    rows = [row("p1", "critique", duree_sejour=6)]
    longer = Effect(
        id="ca-traine",
        target="object.property",
        property_key="duree_sejour",
        select={"object_type": ["Protocole"]},
        op="multiply",
        value=2.0,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    state, engine = engine_over(rows, [longer])
    assert state.care_model["critique"].stay_ticks == 6
    engine._apply_perturbations(1)
    assert state.care_model["critique"].stay_ticks == 12


def test_the_care_model_reverts_when_the_window_closes() -> None:
    """A disease that turned out worse than expected has to stop being worse.

    The property reverts to its baseline each tick; if the model did not follow
    it back, the run would carry the perturbation to the end of the horizon.
    """
    from app.events.effects import Effect, TemporalProfile

    rows = [row("p1", "critique", duree_sejour=6)]
    burst = Effect(
        id="pointe",
        target="object.property",
        property_key="duree_sejour",
        select={"object_type": ["Protocole"]},
        op="multiply",
        value=2.0,
        profile=TemporalProfile(start=0, end=3, shape="step", peak=1.0),
    )
    state, engine = engine_over(rows, [burst])
    engine._apply_perturbations(1)
    assert state.care_model["critique"].stay_ticks == 12
    engine._apply_perturbations(9)
    assert state.care_model["critique"].stay_ticks == 6


def test_an_acuity_that_vanishes_keeps_its_baseline_rather_than_stranding_a_queue() -> None:
    """Effects perturb values. One that renamed a severity would otherwise leave
    every patient already queued under the old name unserved for ever, and a
    backlog that quietly stops being served reads as care delivered."""
    from app.events.effects import Effect, TemporalProfile

    rows = [row("p1", "critique", duree_sejour=6)]
    renamed = Effect(
        id="renomme",
        target="object.property",
        property_key="gravite",
        select={"object_type": ["Protocole"]},
        op="set",
        value="autre",
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    state, engine = engine_over(rows, [renamed])
    engine._apply_perturbations(1)
    assert "critique" in state.care_model
    assert state.care_model["critique"].stay_ticks == 6


def test_an_event_touching_only_protocols_is_not_skipped() -> None:
    """A protocol hangs off no unit, so it contributes nothing to the set of
    facilities to re-derive. The property pass used to return early when that
    set was empty, which would have made every care-model effect silently do
    nothing."""
    from app.events.effects import Effect, TemporalProfile

    rows = [row("p1", "critique", deces_sans_soin=0.15)]
    milder = Effect(
        id="plus-doux",
        target="object.property",
        property_key="deces_sans_soin",
        select={"object_type": ["Protocole"]},
        op="multiply",
        value=0.5,
        profile=TemporalProfile(start=0, end=10, shape="step", peak=1.0),
    )
    state, engine = engine_over(rows, [milder])
    assert engine.object_scope == set()
    engine._apply_perturbations(1)
    assert state.care_model["critique"].mortality_per_unmet == 0.075


def test_a_mechanic_this_service_does_not_know_is_ignored_not_fatal() -> None:
    """The backend may declare a mechanic before this service is redeployed.

    Failing the whole export over an unrecognised string would take the twin
    offline for a deploy-ordering accident.
    """
    future = {
        "name": "Protocole",
        "role": None,
        "properties": [
            {"key": "gravite", "type": "string", "behaviour": "state", "mechanic": "serves_severity"},
            {"key": "ressource", "type": "string", "behaviour": "state", "mechanic": "consumes_activity"},
            {"key": "quantite", "type": "number", "behaviour": "level", "mechanic": "consumes_amount"},
            {"key": "avenir", "type": "number", "behaviour": "level", "mechanic": "teleports_at"},
        ],
    }
    model = care_model_from([row("p1", "critique", avenir=3)], schema(future))
    assert model["critique"].consumes == {"lit": 1.0}
