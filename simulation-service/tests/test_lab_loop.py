"""The daily loop: what a morning's forecast is allowed to know.

The whole value of a frozen forecast is that it was made with what was known
that morning. These pin the three ways that promise breaks quietly: a value
from the future leaking into a feature, a refit trained on outcomes that had
not happened yet, and two blocks of mornings disagreeing about the same day.
"""

from __future__ import annotations

import datetime as dt
import math
import random

import pytest

from app.lab import loop


def series(days: int = 260, start: str = "2021-01-01") -> list[dict]:
    rng = random.Random(7)
    d0 = dt.date.fromisoformat(start)
    out = []
    for i in range(days):
        v = 40 + 15 * math.sin(i / 20) + 6 * math.sin(2 * math.pi * i / 7) + rng.gauss(0, 1.5)
        out.append({"date": (d0 + dt.timedelta(days=i)).isoformat(), "y": f"{v:.2f}", "x": "." if i % 11 == 0 else f"{v / 10:.2f}"})
    return out


SPECS = [loop.Spec("A", "ridge", [], {}), loop.Spec("B", "ridge", ["x"], {})]


def block(rows, first, last, start="2021-05-03", horizons=(1, 7)):
    return loop.run_block(rows, "date", "y", list(horizons), 14, SPECS, start, first, last)


def test_every_morning_gets_a_forecast_per_horizon_and_model():
    out = block(series(), "2021-05-03", "2021-05-16")
    made = {(f["made"], f["h"], f["spec"]) for f in out["forecasts"]}
    assert len(made) == 14 * 2 * 2
    assert all(f["value"] >= 0 for f in out["forecasts"])


def test_a_forecast_does_not_move_when_the_future_changes():
    rows = series()
    before = {(f["made"], f["h"], f["spec"]): f["value"] for f in block(rows, "2021-05-10", "2021-05-12")["forecasts"]}
    # Rewrite everything from the morning of 10 May on: nothing that morning knew.
    altered = [dict(r, y="999", x="999") if r["date"] >= "2021-05-10" else r for r in rows]
    after = block(altered, "2021-05-10", "2021-05-10")["forecasts"]
    for f in after:
        assert f["value"] == pytest.approx(before[(f["made"], f["h"], f["spec"])])


def test_two_blocks_agree_on_the_mornings_they_share():
    rows = series()
    whole = {(f["made"], f["h"], f["spec"]): f["value"] for f in block(rows, "2021-05-03", "2021-05-23")["forecasts"]}
    part = block(rows, "2021-05-12", "2021-05-23")["forecasts"]
    for f in part:
        assert f["value"] == pytest.approx(whole[(f["made"], f["h"], f["spec"])])


def test_refits_are_mondays_after_the_first_morning():
    out = block(series(), "2021-05-03", "2021-05-23")
    days = sorted({r["on"] for r in out["retrains"]})
    assert days == ["2021-05-03", "2021-05-10", "2021-05-17"]
    assert all(dt.date.fromisoformat(d).weekday() == 0 for d in days)
    assert all(r["mae"] is None or r["mae"] > 0 for r in out["retrains"])


def test_the_morning_after_the_data_is_still_forecast():
    rows = series(200)
    last_day = rows[-1]["date"]
    nxt = (dt.date.fromisoformat(last_day) + dt.timedelta(days=1)).isoformat()
    out = block(rows, nxt, nxt)
    assert {f["made"] for f in out["forecasts"]} == {nxt}


def test_two_rows_on_one_day_are_refused():
    rows = series(120)
    rows.append(dict(rows[50]))
    with pytest.raises(ValueError, match="one value a day"):
        block(rows, "2021-04-05", "2021-04-06", start="2021-04-05")
