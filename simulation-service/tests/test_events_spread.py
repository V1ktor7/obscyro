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
