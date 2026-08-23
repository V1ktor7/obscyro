"""What a spreading process has to do, and what it must refuse to invent.

The whole point of this module is that it knows no vocabulary. Half these tests
therefore use words from another domain on purpose — a cyberattack across
institutions, a heatwave that spreads along nothing — because a model that only
works when the states are called S, E, I and R is the compartmental model we did
not want, wearing a declaration.
"""

from __future__ import annotations

import pytest

from app.events.objects import PropertySchema, SimObject
from app.events.spread import (
    ContradictorySpreadModel,
    declares_spread,
    incidence_effects,
    run_spread,
    spread_model_from,
)


class Pop:
    def __init__(self, pid: str, size: float, couples: dict | None = None):
        self.id = pid
        self.size = size
        self.couples = couples or {}


SCHEMA = PropertySchema.model_validate(
    {
        "types": [
            {
                "name": "Transition",
                "role": None,
                "properties": [
                    {"key": "de", "type": "string", "behaviour": "state", "mechanic": "leaves_state"},
                    {"key": "vers", "type": "string", "behaviour": "state", "mechanic": "enters_state"},
                    {"key": "taux", "type": "number", "behaviour": "level", "mechanic": "transition_rate"},
                    {"key": "pousse", "type": "string", "behaviour": "state", "mechanic": "driven_by_state"},
                    {"key": "voie", "type": "string", "behaviour": "state", "mechanic": "couples_along"},
                    {"key": "devient", "type": "string", "behaviour": "state", "mechanic": "produces_demand"},
                ],
            }
        ]
    }
)


def tr(tid: str, **props) -> SimObject:
    return SimObject(id=tid, type="Transition", role=None, properties=props, at=None)


# --- reading the declaration ------------------------------------------------


def test_a_transition_is_read_off_the_mechanics_not_the_names() -> None:
    model = spread_model_from(
        [tr("t1", de="sain", vers="compromis", taux=0.4, pousse="compromis", voie="reseau")],
        SCHEMA,
    )
    t = model.transitions[0]
    assert (t.leaves, t.enters, t.rate) == ("sain", "compromis", 0.4)
    assert t.driven_by == "compromis"
    assert t.along == "reseau"
    assert t.coupled is True


def test_a_transition_with_no_driver_happens_on_its_own() -> None:
    model = spread_model_from([tr("t1", de="expose", vers="infectieux", taux=0.33)], SCHEMA)
    assert model.transitions[0].coupled is False


def test_a_half_filled_row_is_skipped_rather_than_guessed_at() -> None:
    # A form in progress is not a contradiction, and refusing the whole model
    # over one blank row would make the composer unusable while it is being
    # filled in.
    model = spread_model_from([tr("t1", de="sain", taux=0.4)], SCHEMA)
    assert model.transitions == []


def test_a_rate_that_is_not_a_number_is_skipped() -> None:
    model = spread_model_from([tr("t1", de="a", vers="b", taux="vite")], SCHEMA)
    assert model.transitions == []


def test_two_rows_that_disagree_about_one_passage_are_refused() -> None:
    # Taking the first, the last or the larger each gives a run that finishes
    # and answers a question nobody asked.
    with pytest.raises(ContradictorySpreadModel) as caught:
        spread_model_from(
            [tr("t1", de="a", vers="b", taux=0.4), tr("t2", de="a", vers="b", taux=0.9)],
            SCHEMA,
        )
    assert "t2" in str(caught.value) and "t1" in str(caught.value)


def test_states_come_back_sorted_so_two_runs_agree() -> None:
    model = spread_model_from(
        [tr("t1", de="zeta", vers="alpha", taux=0.1, pousse="mu")], SCHEMA
    )
    assert model.states == ["alpha", "mu", "zeta"]


def test_a_twin_that_declares_nothing_gets_an_empty_model_not_an_error() -> None:
    bare = PropertySchema.model_validate({"types": [{"name": "Lit", "role": "space", "properties": []}]})
    assert declares_spread(bare) is False
    assert spread_model_from([tr("t1", de="a", vers="b", taux=1)], bare).transitions == []
    assert declares_spread(SCHEMA) is True


# --- integrating ------------------------------------------------------------


def test_a_spontaneous_transition_drains_at_its_rate() -> None:
    model = spread_model_from([tr("t1", de="expose", vers="infectieux", taux=0.5)], SCHEMA)
    steps = run_spread(model, [Pop("p", 1000)], {"p": {"expose": 100}}, horizon=2)
    assert steps[0].states["expose"] == pytest.approx(50)
    assert steps[0].states["infectieux"] == pytest.approx(50)
    assert steps[1].states["expose"] == pytest.approx(25)


def test_a_coupled_transition_reads_the_layer_it_named() -> None:
    # 0.1 per contact × 2 contacts on `ecole` × 10% infectious × 900 susceptible.
    model = spread_model_from(
        [tr("t1", de="sain", vers="malade", taux=0.1, pousse="malade", voie="ecole")], SCHEMA
    )
    steps = run_spread(
        model, [Pop("p", 1000, {"ecole": 2.0})], {"p": {"sain": 900, "malade": 100}}, horizon=1
    )
    assert steps[0].states["malade"] == pytest.approx(100 + 0.1 * 2.0 * 0.1 * 900)


def test_removing_the_layer_stops_that_transition_and_nothing_else() -> None:
    # This is what "close the schools" is: the coupling is gone, so the passage
    # that travelled it carries nobody. No estimation, no identification — the
    # counterfactual is built rather than inferred.
    model = spread_model_from(
        [tr("t1", de="sain", vers="malade", taux=0.1, pousse="malade", voie="ecole")], SCHEMA
    )
    open_school = run_spread(
        model, [Pop("p", 1000, {"ecole": 2.0})], {"p": {"sain": 900, "malade": 100}}, horizon=5
    )
    closed = run_spread(
        model, [Pop("p", 1000, {})], {"p": {"sain": 900, "malade": 100}}, horizon=5
    )
    assert open_school[-1].states["malade"] > closed[-1].states["malade"]
    assert closed[-1].states["malade"] == pytest.approx(100)


def test_a_transition_with_no_layer_reaches_the_whole_catchment() -> None:
    model = spread_model_from(
        [tr("t1", de="sain", vers="malade", taux=0.2, pousse="malade")], SCHEMA
    )
    steps = run_spread(model, [Pop("p", 1000)], {"p": {"sain": 900, "malade": 100}}, horizon=1)
    assert steps[0].states["malade"] == pytest.approx(100 + 0.2 * 0.1 * 900)


def test_a_state_is_never_drained_past_zero() -> None:
    # A rate above one is a typo, and without a cap the deficit turns up
    # downstream as demand that was never there — which reads as a bigger wave
    # rather than as a number somebody mistyped.
    model = spread_model_from([tr("t1", de="a", vers="b", taux=3.0)], SCHEMA)
    steps = run_spread(model, [Pop("p", 100)], {"p": {"a": 100}}, horizon=1)
    assert steps[0].states["a"] == pytest.approx(0)
    assert steps[0].states["b"] == pytest.approx(100)


def test_two_transitions_drawing_on_one_state_are_scaled_together() -> None:
    # Served in order, the answer would depend on which row was typed first.
    model = spread_model_from(
        [tr("t1", de="a", vers="b", taux=0.8), tr("t2", de="a", vers="c", taux=0.8)], SCHEMA
    )
    steps = run_spread(model, [Pop("p", 100)], {"p": {"a": 100}}, horizon=1)
    assert steps[0].states["a"] == pytest.approx(0)
    assert steps[0].states["b"] == pytest.approx(50)
    assert steps[0].states["c"] == pytest.approx(50)


def test_catchments_do_not_infect_each_other() -> None:
    # Stated rather than hidden: every declared coupling is inside a catchment,
    # so a wave seeded in one territory stays there. A reader who expects it to
    # travel has to be told, and the caller has to seed each one.
    model = spread_model_from(
        [tr("t1", de="sain", vers="malade", taux=0.5, pousse="malade")], SCHEMA
    )
    steps = run_spread(
        model,
        [Pop("a", 1000), Pop("b", 1000)],
        {"a": {"sain": 900, "malade": 100}, "b": {"sain": 1000}},
        horizon=3,
    )
    quiet = [s for s in steps if s.population == "b"]
    assert all(s.states["malade"] == 0 for s in quiet)


def test_a_catchment_with_nobody_in_it_is_skipped_rather_than_dividing_by_zero() -> None:
    model = spread_model_from(
        [tr("t1", de="sain", vers="malade", taux=0.5, pousse="malade")], SCHEMA
    )
    steps = run_spread(model, [Pop("p", 0)], {"p": {"sain": 10, "malade": 1}}, horizon=1)
    assert steps[0].states["malade"] == pytest.approx(1)


# --- the seam to the care model ---------------------------------------------


def test_what_crosses_a_producing_transition_becomes_demand() -> None:
    model = spread_model_from(
        [tr("t1", de="malade", vers="hospitalise", taux=0.5, devient="hospitalisation")], SCHEMA
    )
    steps = run_spread(model, [Pop("p", 1000)], {"p": {"malade": 200}}, horizon=1)
    assert steps[0].incidence == {"hospitalisation": pytest.approx(100)}


def test_a_transition_that_produces_nothing_reports_no_demand() -> None:
    model = spread_model_from([tr("t1", de="a", vers="b", taux=0.5)], SCHEMA)
    steps = run_spread(model, [Pop("p", 100)], {"p": {"a": 100}}, horizon=1)
    assert steps[0].incidence == {}


def test_the_run_is_written_as_effects_an_event_can_carry() -> None:
    # The seam. A spreading model with its own result format would need its own
    # player, chart and download; written as `demand.incidence` it lands in the
    # engine that already queues, serves and counts.
    model = spread_model_from(
        [tr("t1", de="malade", vers="hospitalise", taux=0.5, devient="hospitalisation")], SCHEMA
    )
    pops = [Pop("p", 1000)]
    steps = run_spread(model, pops, {"p": {"malade": 200}}, horizon=1)
    effects = incidence_effects(steps, pops)
    assert len(effects) == 1
    e = effects[0]
    assert e["target"] == "demand.incidence"
    assert e["select"] == {"acuity": ["hospitalisation"], "population": ["p"]}
    # Per thousand: 100 of 1000 people.
    assert e["value"] == pytest.approx(100)
    assert e["profile"]["start"] == 0 and e["profile"]["end"] == 0


def test_a_step_with_nobody_crossing_writes_no_effect() -> None:
    # An effect worth zero is a row in a table and a line in a trace that says
    # something happened.
    model = spread_model_from([tr("t1", de="a", vers="b", taux=0.5)], SCHEMA)
    pops = [Pop("p", 100)]
    assert incidence_effects(run_spread(model, pops, {"p": {"a": 100}}, 3), pops) == []


# --- the structural intervention --------------------------------------------


def _sir():
    return spread_model_from(
        [
            tr("c", de="sain", vers="malade", taux=0.08, pousse="malade", voie="ecole"),
            tr("r", de="malade", vers="retabli", taux=0.2, devient="hospitalisation"),
        ],
        SCHEMA,
    )


def test_closing_a_layer_leaves_the_days_before_it_untouched() -> None:
    """The same invariant branching rests on, one model down.

    A measure that starts on day 30 cannot change day 29, and if it does then
    the difference on screen is not the one anybody asked about.
    """
    from app.events.spread import LayerChange

    model = _sir()
    pop = [Pop("p", 10_000, {"ecole": 3.0})]
    seeds = {"p": {"sain": 9900, "malade": 100}}
    plain = run_spread(model, pop, seeds, horizon=60)
    closed = run_spread(
        model, pop, seeds, horizon=60, changes=[LayerChange(layer="ecole", factor=0.0, from_step=30)]
    )
    for a, b in zip(plain[:30], closed[:30]):
        assert a.states == b.states
    assert closed[-1].states["retabli"] < plain[-1].states["retabli"]


def test_a_window_that_closes_puts_the_coupling_back() -> None:
    # "Schools shut for two weeks" is not "schools shut forever", and a model
    # that cannot say the difference cannot answer the question that started
    # all of this.
    from app.events.spread import LayerChange

    model = _sir()
    pop = [Pop("p", 10_000, {"ecole": 3.0})]
    seeds = {"p": {"sain": 9900, "malade": 100}}
    forever = run_spread(
        model, pop, seeds, horizon=80, changes=[LayerChange("ecole", 0.0, from_step=20)]
    )
    fortnight = run_spread(
        model, pop, seeds, horizon=80, changes=[LayerChange("ecole", 0.0, 20, 34)]
    )
    assert fortnight[-1].states["retabli"] > forever[-1].states["retabli"]


def test_four_more_days_of_closure_is_a_question_the_model_can_answer() -> None:
    # The sentence this whole design exists for. Two windows, four days apart.
    from app.events.spread import LayerChange

    model = _sir()
    pop = [Pop("p", 10_000, {"ecole": 3.0})]
    seeds = {"p": {"sain": 9900, "malade": 100}}
    short = run_spread(model, pop, seeds, horizon=90, changes=[LayerChange("ecole", 0.0, 20, 34)])
    longer = run_spread(model, pop, seeds, horizon=90, changes=[LayerChange("ecole", 0.0, 20, 38)])
    assert longer[-1].states["retabli"] < short[-1].states["retabli"]


def test_two_measures_on_one_layer_compound() -> None:
    # What happens on the ground, and what a reader who wrote both would expect.
    # The last one winning would silently discard a measure they declared.
    #
    # Measured on infection alone: with recovery in the model the count of the
    # sick is a net of two flows, and a weaker coupling makes it fall rather
    # than rise — which is true, and not what this test is about.
    from app.events.spread import LayerChange

    model = spread_model_from(
        [tr("c", de="sain", vers="malade", taux=0.08, pousse="malade", voie="ecole")], SCHEMA
    )
    pop = [Pop("p", 10_000, {"ecole": 4.0})]
    seeds = {"p": {"sain": 9900, "malade": 100}}
    one = run_spread(model, pop, seeds, horizon=1, changes=[LayerChange("ecole", 0.5)])
    both = run_spread(
        model, pop, seeds, horizon=1, changes=[LayerChange("ecole", 0.5), LayerChange("ecole", 0.5)]
    )
    assert both[0].states["malade"] - 100 == pytest.approx((one[0].states["malade"] - 100) / 2)


def test_a_change_to_a_layer_nobody_declared_does_nothing_rather_than_raising() -> None:
    # A stale measure naming a layer that has gone is a rule that reaches
    # nothing, which the run should survive and the gap list should mention —
    # not a crash halfway through an integration.
    from app.events.spread import LayerChange

    model = _sir()
    pop = [Pop("p", 10_000, {"ecole": 3.0})]
    seeds = {"p": {"sain": 9900, "malade": 100}}
    plain = run_spread(model, pop, seeds, horizon=10)
    stale = run_spread(model, pop, seeds, horizon=10, changes=[LayerChange("metro", 0.0)])
    assert [s.states for s in plain] == [s.states for s in stale]


# --- the endpoint -----------------------------------------------------------


def _request(**over):
    """The smallest twin that can spread: one catchment, one coupling, a SIR."""
    body = {
        "system": {
            "facilities": [],
            "objects": [
                {"id": "c", "type": "Transition", "role": None, "at": None,
                 "properties": {"de": "sain", "vers": "malade", "taux": 0.08,
                                "pousse": "malade", "voie": "ecole"}},
                {"id": "r", "type": "Transition", "role": None, "at": None,
                 "properties": {"de": "malade", "vers": "retabli", "taux": 0.2,
                                "devient": "hospitalisation"}},
            ],
            "object_types": SCHEMA.model_dump()["types"],
            "populations": [
                {"id": "pop:a", "name": "A", "size": 10_000, "served_by": [], "couples": {"ecole": 3.0}},
                {"id": "pop:b", "name": "B", "size": 8_000, "served_by": [], "couples": {"ecole": 2.0}},
            ],
        },
        "seeds": {"pop:a": {"sain": 9_900, "malade": 100}},
        "horizon": 20,
    }
    body.update(over)
    return body


def test_the_endpoint_writes_the_run_as_an_event() -> None:
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(SpreadRequest.model_validate(_request()))
    assert out.event["horizon"] == 20
    assert out.event["effects"], "the run produced no demand at all"
    assert all(e["target"] == "demand.incidence" for e in out.event["effects"])
    assert out.vocabulary["states"] == ["malade", "retabli", "sain"]
    assert out.vocabulary["couplings"] == ["ecole"]


def test_an_unseeded_catchment_is_named_rather_than_left_to_be_noticed() -> None:
    # Every declared coupling is internal, so B stays empty for the whole run.
    # A reader who expects a wave to travel has to be told here, not by squinting
    # at a map.
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(SpreadRequest.model_validate(_request()))
    codes = [g["code"] for g in out.gaps]
    assert "CATCHMENT_NOT_SEEDED" in codes
    assert "pop:b" in next(g for g in out.gaps if g["code"] == "CATCHMENT_NOT_SEEDED")["subjects"]


def test_a_measure_on_a_coupling_nobody_travels_is_reported() -> None:
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(
        SpreadRequest.model_validate(_request(changes=[{"layer": "metro", "factor": 0.0}]))
    )
    assert "CHANGE_ON_UNKNOWN_COUPLING" in [g["code"] for g in out.gaps]


def test_closing_a_coupling_through_the_endpoint_reaches_the_event() -> None:
    from app.events.api import SpreadRequest, spread_route

    plain = spread_route(SpreadRequest.model_validate(_request()))
    closed = spread_route(
        SpreadRequest.model_validate(
            _request(changes=[{"layer": "ecole", "factor": 0.0, "from_step": 5}])
        )
    )
    total = lambda r: sum(e["value"] for e in r.event["effects"])
    assert total(closed) < total(plain)


def test_a_twin_that_declares_no_spreading_model_is_refused_with_a_reason() -> None:
    from fastapi import HTTPException

    from app.events.api import SpreadRequest, spread_route

    body = _request()
    body["system"]["object_types"] = [{"name": "Lit", "role": "space", "properties": []}]
    with pytest.raises(HTTPException) as caught:
        spread_route(SpreadRequest.model_validate(body))
    assert caught.value.status_code == 422
    assert "leaves_state" in str(caught.value.detail)


def test_a_run_with_nothing_seeded_is_refused_and_names_the_states() -> None:
    # Every state empty means nothing can move, and the run would come back
    # looking like a wave that fizzled rather than one that never started.
    from fastapi import HTTPException

    from app.events.api import SpreadRequest, spread_route

    with pytest.raises(HTTPException) as caught:
        spread_route(SpreadRequest.model_validate(_request(seeds={})))
    assert caught.value.status_code == 422
    assert "sain" in str(caught.value.detail)


def test_a_declaration_with_no_instances_is_refused() -> None:
    from fastapi import HTTPException

    from app.events.api import SpreadRequest, spread_route

    body = _request()
    body["system"]["objects"] = []
    with pytest.raises(HTTPException) as caught:
        spread_route(SpreadRequest.model_validate(body))
    assert "no instance fills them in" in str(caught.value.detail)


def test_a_probe_reads_the_declaration_back_without_running_it() -> None:
    # The form that seeds a run has to name a state, and a state misspelled by
    # one letter seeds nothing: the run comes back empty and nothing on screen
    # says why. So the vocabulary has to be readable before the first run.
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(SpreadRequest.model_validate(_request(seeds={}, probe=True)))
    assert out.vocabulary["states"] == ["malade", "retabli", "sain"]
    assert out.vocabulary["couplings"] == ["ecole"]
    assert out.states == []
    assert out.event["effects"] == []


def test_a_probe_names_the_catchments_a_form_has_to_offer() -> None:
    # A run reports ids and a picker shows names. Without these the reader
    # chooses between eleven UUIDs.
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(SpreadRequest.model_validate(_request(seeds={}, probe=True)))
    assert {p["id"] for p in out.populations} == {"pop:a", "pop:b"}
    assert all(p["name"] for p in out.populations)


def test_a_probe_is_not_refused_for_being_unseeded() -> None:
    # Refusing it would make the vocabulary readable only by parsing an error
    # message, which turns a refusal into an API.
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(SpreadRequest.model_validate(_request(seeds={}, probe=True)))
    assert [g["code"] for g in out.gaps] == []


def test_a_probe_still_refuses_a_twin_that_declared_nothing() -> None:
    # There is no vocabulary to read back, and answering with an empty one
    # would look like a model whose states are all named "".
    from fastapi import HTTPException

    from app.events.api import SpreadRequest, spread_route

    body = _request(seeds={}, probe=True)
    body["system"]["object_types"] = [{"name": "Lit", "role": "space", "properties": []}]
    with pytest.raises(HTTPException) as caught:
        spread_route(SpreadRequest.model_validate(body))
    assert caught.value.status_code == 422


def test_a_real_run_still_names_the_catchments() -> None:
    from app.events.api import SpreadRequest, spread_route

    out = spread_route(SpreadRequest.model_validate(_request()))
    assert {p["id"] for p in out.populations} == {"pop:a", "pop:b"}


def test_two_layers_of_the_same_passage_may_transmit_differently() -> None:
    # A home contact and a school contact both carry `sain` to `malade`, and
    # they are two passages rather than one described twice. Keyed on the
    # endpoints alone this raised, which rejected the only declaration anybody
    # would actually write.
    model = spread_model_from(
        [
            tr("t1", de="sain", vers="malade", taux=0.05, pousse="malade", voie="ecole"),
            tr("t2", de="sain", vers="malade", taux=0.02, pousse="malade", voie="domicile"),
        ],
        SCHEMA,
    )
    assert len(model.transitions) == 2
    assert model.couplings == ["domicile", "ecole"]


def test_the_same_passage_twice_with_two_numbers_is_still_refused() -> None:
    # Same states, same driver, same layer, two rates: the engine reads one of
    # them and the author never learns which.
    with pytest.raises(ContradictorySpreadModel):
        spread_model_from(
            [
                tr("t1", de="sain", vers="malade", taux=0.05, pousse="malade", voie="ecole"),
                tr("t2", de="sain", vers="malade", taux=0.09, pousse="malade", voie="ecole"),
            ],
            SCHEMA,
        )


def test_two_layers_that_differ_actually_move_different_amounts() -> None:
    # Accepting the declaration is not the same as integrating it. Doubling the
    # rate on one layer has to change the run, or the second row was parsed and
    # then dropped.
    def total(school_rate: float) -> float:
        model = spread_model_from(
            [
                tr("t1", de="sain", vers="malade", taux=school_rate, pousse="malade",
                   voie="ecole", devient="urgence"),
                tr("t2", de="sain", vers="malade", taux=0.02, pousse="malade",
                   voie="domicile", devient="urgence"),
            ],
            SCHEMA,
        )
        pops = [Pop("pop:a", 1000.0, {"ecole": 1.6, "domicile": 1.2})]
        steps = run_spread(model, pops, {"pop:a": {"sain": 990, "malade": 10}}, 20)
        return sum(sum(s.incidence.values()) for s in steps)

    assert total(0.10) > total(0.05)
