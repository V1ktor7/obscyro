"""What a fit is allowed to claim.

Most of these are not about whether sklearn works — it does. They are about the
ways a training run can hand back a number that looks like a result and is not:
a target hiding among the features, a random split on time-ordered rows, a
score that never beat the mean.
"""

from __future__ import annotations

import math
import random

import pytest

from app.lab import tabular


def linear_rows(n: int = 200) -> list[dict]:
    """occupees ≈ 0.8 · capacite, plus noise and a label column."""
    rng = random.Random(7)
    out = []
    for i in range(n):
        cap = rng.randint(10, 80)
        out.append(
            {
                "date": f"2026-{1 + i % 12:02d}-{1 + i % 28:02d}",
                "installation": rng.choice(["A", "B", "C"]),
                "capacite": cap,
                "occupees": round(cap * 0.8 + rng.gauss(0, 2), 1),
            }
        )
    return out


def noise_rows(n: int = 200) -> list[dict]:
    rng = random.Random(11)
    return [
        {"x": rng.random(), "y": rng.random(), "cible": rng.gauss(50, 10)}
        for _ in range(n)
    ]


# ------------------------------------------------------------------ le métier


def test_a_linear_relation_is_found() -> None:
    out = tabular.train(linear_rows(), "occupees", ["capacite"], "linear")
    assert out.task == "regression"
    assert out.metrics["r2"] > 0.9


def test_the_baseline_is_reported_beside_the_score() -> None:
    # An R² means nothing until you know what predicting the mean gives.
    out = tabular.train(linear_rows(), "occupees", ["capacite"], "ridge")
    assert "r2" in out.baseline
    assert out.metrics["mae"] < out.baseline["mae"]


def test_a_model_that_learns_nothing_says_so() -> None:
    out = tabular.train(noise_rows(), "cible", ["x", "y"], "linear")
    assert any("moyenne" in w for w in out.warnings)


def test_text_columns_are_encoded_rather_than_refused() -> None:
    out = tabular.train(
        linear_rows(), "occupees", ["capacite", "installation"], "random_forest"
    )
    assert "installation" in out.categorical_features
    assert "capacite" in out.numeric_features
    assert out.metrics["r2"] > 0.8


def test_classification_infers_from_the_estimator() -> None:
    rows = [
        {"cap": i, "plein": "oui" if i > 40 else "non"} for i in range(10, 90)
    ] * 3
    out = tabular.train(rows, "plein", ["cap"], "logistic")
    assert out.task == "classification"
    assert set(out.classes) == {"oui", "non"}
    assert out.metrics["accuracy"] > 0.9


def test_importances_come_back_named() -> None:
    out = tabular.train(
        linear_rows(), "occupees", ["capacite", "installation"], "random_forest"
    )
    assert out.importances
    assert any("capacite" in i["feature"] for i in out.importances)


# ------------------------------------------------------------- les garde-fous


def test_the_target_cannot_also_be_a_feature() -> None:
    # The classic way to get a perfect score and learn nothing.
    with pytest.raises(ValueError, match="cible"):
        tabular.train(linear_rows(), "occupees", ["capacite", "occupees"], "linear")


def test_a_random_split_on_time_ordered_rows_is_flagged() -> None:
    out = tabular.train(
        linear_rows(), "occupees", ["capacite"], "linear",
        split="random", time_column="date",
    )
    assert any("gonfle le score" in w for w in out.warnings)


def test_a_chronological_split_is_available_and_silent() -> None:
    out = tabular.train(
        linear_rows(), "occupees", ["capacite"], "linear",
        split="chronological", time_column="date",
    )
    assert out.split == "chronological"
    assert not any("gonfle" in w for w in out.warnings)


def test_a_chronological_split_needs_a_time_column() -> None:
    with pytest.raises(ValueError, match="colonne de temps"):
        tabular.train(linear_rows(), "occupees", ["capacite"], "linear",
                      split="chronological")


def test_rows_with_no_target_are_counted_not_hidden() -> None:
    rows = linear_rows()
    for r in rows[:40]:
        r["occupees"] = None
    out = tabular.train(rows, "occupees", ["capacite"], "linear")
    assert out.dropped_rows == 40
    assert out.n_train + out.n_test == 160


def test_too_few_rows_is_refused_rather_than_fitted() -> None:
    with pytest.raises(ValueError, match="trop peu"):
        tabular.train(linear_rows(12), "occupees", ["capacite"], "linear")


def test_an_unknown_column_is_named() -> None:
    with pytest.raises(ValueError, match="Colonnes absentes"):
        tabular.train(linear_rows(), "occupees", ["inexistante"], "linear")


def test_no_features_is_refused() -> None:
    with pytest.raises(ValueError, match="au moins une variable"):
        tabular.train(linear_rows(), "occupees", [], "linear")


# --------------------------------------------------------------- la prédiction


def test_a_fitted_model_predicts_new_rows() -> None:
    out = tabular.train(linear_rows(), "occupees", ["capacite"], "linear")
    got = tabular.predict(out.artifact_b64, [{"capacite": 50}, {"capacite": 10}])
    assert len(got) == 2
    assert 35 < got[0] < 45


def test_an_unseen_category_predicts_instead_of_raising() -> None:
    # A facility that opened after training must produce a number, not a 500.
    out = tabular.train(
        linear_rows(), "occupees", ["capacite", "installation"], "random_forest"
    )
    got = tabular.predict(out.artifact_b64, [{"capacite": 40, "installation": "ZZZ"}])
    assert math.isfinite(got[0])


def test_predicting_without_a_needed_column_says_which() -> None:
    out = tabular.train(linear_rows(), "occupees", ["capacite"], "linear")
    with pytest.raises(ValueError, match="capacite"):
        tabular.predict(out.artifact_b64, [{"autre": 1}])


# ----------------------------------------------------------------- l'inférence


def test_a_measurement_reads_as_regression() -> None:
    assert tabular.infer_task([1.2, 8.4, 19.0, 3.3, 44.1, 7.7, 12.9, 30.2,
                               5.5, 9.1, 22.0, 17.4, 6.6]) == "regression"


def test_a_handful_of_codes_reads_as_classification() -> None:
    assert tabular.infer_task([0, 1, 1, 0, 1, 0, 0, 1]) == "classification"


def test_text_reads_as_classification() -> None:
    assert tabular.infer_task(["oui", "non", "oui"]) == "classification"


def test_the_catalogue_offers_both_tasks() -> None:
    tasks = {e["task"] for e in tabular.catalogue()}
    assert tasks == {"regression", "classification"}
