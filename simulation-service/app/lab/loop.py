"""The daily forecasting loop, one block of mornings at a time.

A forecast shown to someone on a morning can only have used what was known that
morning. A backtest that fits once and scores a held-out tail does not answer
"how good would this have been, run every day"; this does, by doing exactly
that:

* **Every morning**, each horizon forecasts from what was known that morning:
  the target up to the day before, a driver one day further behind (published
  later), and the calendar.
* **Every Monday** (and on the loop's first morning) each model is refitted on
  everything whose outcome was known by then, one model per horizon, and its
  error on the last eight known weeks — fitted without them — is kept as the
  error to expect until the next refit.

Stateless like the rest of the lab: the caller sends the series and the window
of mornings, and stores what comes back. A block that starts mid-week refits at
the Monday before it, which is the same fit the previous block made, so blocks
can be computed in any order and still agree.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from app.lab.tabular import ESTIMATORS, _build

#: Fewer training rows than this and a refit is skipped: the horizon waits.
MIN_TRAIN = 60
#: The days held back to measure the error to expect at a refit.
HOLDOUT_DAYS = 56


@dataclass
class Spec:
    key: str
    estimator: str
    exog: list[str]
    params: dict[str, Any]


def _parse_day(v: Any) -> dt.date | None:
    if v is None:
        return None
    s = str(v).strip()[:10]
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def _num(v: Any) -> float | None:
    """A published "." or an empty cell is a missing value, not a zero."""
    if v is None:
        return None
    s = str(v).strip().replace(",", ".")
    if s in ("", "."):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if f == f else None


def frame_of(rows: list[dict[str, Any]], time_column: str, target: str, exog: list[str]):
    """One row per calendar day, gaps kept as gaps rather than closed up."""
    import pandas as pd

    by_day: dict[dt.date, dict[str, float | None]] = {}
    for r in rows:
        d = _parse_day(r.get(time_column))
        if d is None:
            continue
        if d in by_day:
            raise ValueError(
                f'Two rows carry {d.isoformat()} in "{time_column}". The loop forecasts one '
                "value a day: filter the table to one region, or aggregate it first."
            )
        by_day[d] = {target: _num(r.get(target)), **{c: _num(r.get(c)) for c in exog}}
    if not by_day:
        raise ValueError(f'No row has a date in "{time_column}".')
    idx = pd.date_range(min(by_day), max(by_day), freq="D")
    frame = pd.DataFrame(
        [by_day.get(d.date(), {}) for d in idx], index=idx, columns=[target, *exog], dtype="float64"
    )
    return frame


def features(frame, target: str, lags: int, exog: list[str], exog_delay: int):
    """Row D holds what is known on the morning of D."""
    import pandas as pd

    y = frame[target]
    cols: dict[str, Any] = {}
    for k in range(1, lags + 1):
        cols[f"{target}_lag{k}"] = y.shift(k)
    for c in exog:
        for k in range(1, lags + 1):
            cols[f"{c}_lag{k}"] = frame[c].shift(k + exog_delay)
    X = pd.DataFrame(cols, index=frame.index)
    X["dow"] = frame.index.dayofweek
    X["month"] = frame.index.month
    own = [f"{target}_lag{k}" for k in range(1, lags + 1)]
    return X, own


def _refit_days(start: dt.date, first: dt.date, last: dt.date, weekday: int) -> list[dt.date]:
    """The refits in force over [first, last]: the one before `first`, then every Monday."""
    def latest_on_or_before(d: dt.date) -> dt.date:
        back = (d.weekday() - weekday) % 7
        r = d - dt.timedelta(days=back)
        return max(r, start)

    out = [latest_on_or_before(first)]
    d = first + dt.timedelta(days=1)
    while d <= last:
        if d.weekday() == weekday and d > start:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def run_block(
    rows: list[dict[str, Any]],
    time_column: str,
    target: str,
    horizons: list[int],
    lags: int,
    specs: list[Spec],
    start: str,
    first: str,
    last: str,
    exog_delay: int = 1,
    weekday: int = 0,
) -> dict[str, Any]:
    """Forecasts for every morning in [first, last], and the refits behind them."""
    import numpy as np
    import pandas as pd

    d_start, d_first, d_last = (dt.date.fromisoformat(x) for x in (start, first, last))
    if d_first < d_start or d_last < d_first:
        raise ValueError("The block must lie on or after the loop's first morning, in order.")
    if (d_last - d_first).days > 120:
        raise ValueError("A block covers at most 120 mornings.")
    for s in specs:
        if s.estimator not in ESTIMATORS or ESTIMATORS[s.estimator].task != "regression":
            raise ValueError(f"{s.estimator} is not a regression estimator.")

    exog_all = sorted({c for s in specs for c in s.exog})
    frame = frame_of(rows, time_column, target, exog_all)
    # The mornings may run one day past the data: that morning knows everything.
    end = max(frame.index[-1], pd.Timestamp(d_last))
    frame = frame.reindex(pd.date_range(frame.index[0], end, freq="D"))

    refits = _refit_days(d_start, d_first, d_last, weekday)
    forecasts: list[dict[str, Any]] = []
    retrains: list[dict[str, Any]] = []

    for spec in specs:
        X, own = features(frame, target, lags, spec.exog, exog_delay)
        names = list(X.columns)
        has_own = X[own].notna().all(axis=1)
        for h in horizons:
            y_h = frame[target].shift(-(h - 1))
            # Each refit is in force from its day until the day before the next.
            for k, r in enumerate(refits):
                r_ts = pd.Timestamp(r)
                # Known by the morning of r: the outcome's day is before r.
                outcome_day = X.index + pd.Timedelta(days=h - 1)
                train = has_own & y_h.notna() & (outcome_day < r_ts)
                n = int(train.sum())
                if n < MIN_TRAIN:
                    continue
                cut = r_ts - pd.Timedelta(days=HOLDOUT_DAYS)
                fit_part = train & (outcome_day < cut)
                held = train & (outcome_day >= cut)
                mae = None
                if int(fit_part.sum()) >= MIN_TRAIN and int(held.sum()) >= 7:
                    pipe, _ = _build(spec.estimator, spec.params, names, [])
                    pipe.fit(X[fit_part], y_h[fit_part])
                    mae = float(np.mean(np.abs(pipe.predict(X[held]) - y_h[held])))
                pipe, _ = _build(spec.estimator, spec.params, names, [])
                pipe.fit(X[train], y_h[train])
                if d_first <= r <= d_last or k == 0:
                    retrains.append({"on": r.isoformat(), "h": h, "spec": spec.key, "mae": None if mae is None else round(mae, 4), "points": n})
                until = refits[k + 1] - dt.timedelta(days=1) if k + 1 < len(refits) else d_last
                days = pd.date_range(max(r, d_first), until, freq="D")
                rows_in = [d for d in days if d in X.index and bool(has_own.get(d, False))]
                if not rows_in:
                    continue
                pred = pipe.predict(X.loc[rows_in])
                for d, v in zip(rows_in, pred):
                    forecasts.append({"made": d.date().isoformat(), "h": h, "spec": spec.key, "value": round(max(0.0, float(v)), 3)})

    return {"forecasts": forecasts, "retrains": retrains}
