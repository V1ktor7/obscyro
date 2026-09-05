"""What a forecast is allowed to claim.

Forecasting fails differently from ordinary regression. The metric that looks
best is usually the one on the easiest split; the baseline that matters is not
the mean; and a smooth recursive curve can imply a confidence that nothing in
the fit supports. Each case here pins one of those down.
"""

from __future__ import annotations

import math
import random

import pytest

from app.lab import timeseries as ts


def daily(n: int = 220, noise: float = 1.0, trend: float = 0.0) -> list[dict]:
    """A weekly-seasonal series with light noise — a plausible admissions curve."""
    rng = random.Random(3)
    out = []
    for i in range(n):
        day = 1 + i
        value = (
            40
            + trend * i
            + 8 * math.sin(2 * math.pi * i / 7)
            + rng.gauss(0, noise)
        )
        out.append(
            {
                "date": f"2026-01-01T00:00:00" if i == 0 else None,
                "jour": i,
                "admissions": round(value, 2),
            }
        )
    # Real ISO dates, so the calendar features have something to read.
    import datetime as dt

    start = dt.date(2026, 1, 1)
    for i, row in enumerate(out):
        row["date"] = (start + dt.timedelta(days=i)).isoformat()
    return out


def random_walk(n: int = 220) -> list[dict]:
    """The series a forecaster cannot beat: tomorrow is today plus noise."""
    import datetime as dt

    rng = random.Random(5)
    start = dt.date(2026, 1, 1)
    value = 100.0
    out = []
    for i in range(n):
        value += rng.gauss(0, 3)
        out.append({"date": (start + dt.timedelta(days=i)).isoformat(),
                    "admissions": round(value, 2)})
    return out


# ------------------------------------------------------------------ préparer


def test_lags_and_calendar_become_columns() -> None:
    prep = ts.prepare(daily(), "date", "admissions", lags=3, horizon=1)
    assert "admissions_lag1" in prep.feature_names
    assert "admissions_lag3" in prep.feature_names
    assert "dow" in prep.feature_names


def test_rows_lost_to_shifting_are_counted() -> None:
    prep = ts.prepare(daily(100), "date", "admissions", lags=5, horizon=1)
    assert prep.dropped == 5
    assert len(prep.frame) == 95


def test_a_missing_column_is_named() -> None:
    with pytest.raises(ValueError, match="Colonne absente"):
        ts.prepare(daily(), "date", "inexistante", lags=3, horizon=1)


def test_a_series_too_short_to_walk_is_refused() -> None:
    with pytest.raises(ValueError, match="trop peu"):
        ts.prepare(daily(30), "date", "admissions", lags=7, horizon=1)


# ------------------------------------------------------- la ligne de base


def test_the_baseline_is_the_naive_forecast_not_the_mean() -> None:
    # On a seasonal series the mean is hopeless, so beating it proves nothing.
    # MASE divides by naive's error: 1.0 means "as good as doing nothing".
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    assert "mase" in out.metrics
    assert out.metrics["naive_mae"] > 0


def test_a_seasonal_series_is_forecast_better_than_naive() -> None:
    out = ts.backtest_and_fit(daily(noise=0.6), "date", "admissions", "ridge", lags=7)
    assert out.metrics["mase"] < 1


def test_a_random_walk_is_not_and_the_lab_says_so() -> None:
    # The honest outcome: nothing predicts a random walk, and a model that
    # claims to is the most expensive kind of wrong.
    out = ts.backtest_and_fit(random_walk(), "date", "admissions", "ridge", lags=7)
    assert out.metrics["mase"] >= 1
    assert any("naïve" in w for w in out.warnings)


# -------------------------------------------------------------- l évaluation


def test_evaluation_walks_forward_over_several_origins() -> None:
    # One split gives one number that depends on where the cut fell.
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7, folds=4)
    assert len(out.folds) >= 3
    # Expanding window: each origin trains on strictly more than the last.
    sizes = [f.n_train for f in out.folds]
    assert sizes == sorted(sizes)
    assert sizes[0] < sizes[-1]


def test_each_fold_carries_its_own_origin() -> None:
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    assert all(f.origin for f in out.folds)


def test_several_estimators_can_forecast() -> None:
    for name in ("linear", "ridge", "random_forest"):
        out = ts.backtest_and_fit(daily(), "date", "admissions", name, lags=7, folds=2)
        assert out.estimator == name


def test_a_classifier_is_refused_for_a_forecast() -> None:
    with pytest.raises(ValueError, match="régression"):
        ts.backtest_and_fit(daily(), "date", "admissions", "logistic", lags=7)


def test_a_longer_horizon_says_which_horizon_the_score_belongs_to() -> None:
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7, horizon=7)
    assert out.horizon == 7
    assert any("horizon de 7" in w for w in out.warnings)


# -------------------------------------------------------------- la prévision


def test_a_forecast_continues_the_series() -> None:
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    got = ts.forecast(out.artifact_b64, daily(), steps=10)
    assert len(got["points"]) == 10
    assert all(math.isfinite(p["value"]) for p in got["points"])


def test_a_forecast_says_that_its_error_compounds() -> None:
    # A smooth line implies a confidence the fit does not support.
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    got = ts.forecast(out.artifact_b64, daily(), steps=5)
    assert "s'accumule" in got["note"]


def test_a_forecast_dates_its_points() -> None:
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    got = ts.forecast(out.artifact_b64, daily(), steps=3)
    assert got["points"][0]["t"] > "2026"


def test_exogenous_inputs_block_extrapolation_rather_than_being_faked() -> None:
    """Holding an exogenous series constant into the future is a silent lie."""
    rows = daily()
    for r in rows:
        r["eaux_usees"] = r["admissions"] * 12 + 3
    out = ts.backtest_and_fit(
        rows, "date", "admissions", "ridge", lags=5, exog=["eaux_usees"]
    )
    assert any("exogènes" in w for w in out.warnings)
    with pytest.raises(ValueError, match="exogènes"):
        ts.forecast(out.artifact_b64, rows, steps=5)


def test_a_tabular_model_cannot_be_used_as_a_forecaster() -> None:
    from app.lab import tabular

    rows = [{"x": i, "y": i * 2 + 1} for i in range(60)]
    fitted = tabular.train(rows, "y", ["x"], "linear")
    with pytest.raises(ValueError, match="série temporelle"):
        ts.forecast(fitted.artifact_b64, rows, steps=3)


def test_forecasting_without_enough_history_is_refused() -> None:
    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    with pytest.raises(ValueError, match="historique"):
        ts.forecast(out.artifact_b64, daily(4), steps=3)


# ------------------------------------------------------ la série qui ne bouge pas


def flat(n: int = 220, value: float = 12.0) -> list[dict]:
    """A column that never moves — a bed count nobody ever updated."""
    import datetime as dt

    start = dt.date(2026, 1, 1)
    return [
        {"date": (start + dt.timedelta(days=i)).isoformat(), "admissions": value}
        for i in range(n)
    ]


def test_a_flat_series_is_refused_instead_of_scored_against_zero() -> None:
    # MASE divides by the naive forecast's error, which on a constant series is
    # zero. The old code produced NaN, and NaN is not JSON: the response layer
    # raised on it and the caller got a 500 with nothing to read.
    with pytest.raises(ValueError, match="ne bouge pas"):
        ts.backtest_and_fit(flat(), "date", "admissions", "ridge", lags=7)


def test_every_number_a_forecast_reports_survives_json() -> None:
    # The response is serialised with allow_nan=False, so a NaN anywhere in it
    # is a 500 rather than a metric.
    import json

    out = ts.backtest_and_fit(daily(), "date", "admissions", "ridge", lags=7)
    payload = {**out.__dict__, "folds": [f.__dict__ for f in out.folds]}
    json.dumps(payload, allow_nan=False)


def test_a_series_flat_at_the_start_is_scored_on_what_is_left() -> None:
    # Half constant, half real: the constant windows cannot be scored, but the
    # rest can, and the response says how many were dropped.
    rows = flat(110) + daily(110)
    import datetime as dt

    start = dt.date(2026, 1, 1)
    for i, row in enumerate(rows):
        row["date"] = (start + dt.timedelta(days=i)).isoformat()

    out = ts.backtest_and_fit(rows, "date", "admissions", "ridge", lags=7)
    assert math.isfinite(out.metrics["mase"])
    assert all(math.isfinite(f.mase) for f in out.folds)


def test_windows_that_could_not_be_scored_are_counted_out_loud() -> None:
    # Dropping a fold silently would make the score look like it covered the
    # whole series. It says how many windows it actually judged.
    import datetime as dt

    rows = flat(160) + daily(60)
    start = dt.date(2026, 1, 1)
    for i, row in enumerate(rows):
        row["date"] = (start + dt.timedelta(days=i)).isoformat()

    out = ts.backtest_and_fit(rows, "date", "admissions", "ridge", lags=7)
    assert len(out.folds) < 4
    assert any("constante" in w for w in out.warnings)
