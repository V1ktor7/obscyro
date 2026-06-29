"""Quantile band extraction, ML-vs-baseline error, and sensitivity-based
feature importances. No heavy deps — pure Python so /simulate always works.
"""

from __future__ import annotations

import copy

from app.contacts import ContactGraph
from app.mechanistic import run_single, mulberry32

_KEYS = ("S", "E", "I", "R", "isolationDemand")


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, int(p * (len(sorted_vals) - 1)))
    return sorted_vals[idx]


def percentile_trajectories(all_daily: list[list[dict]], p: float) -> list[dict]:
    if not all_daily:
        return []
    max_day = max(len(d) for d in all_daily)
    out: list[dict] = []
    for day in range(max_day):
        rows = [d[day] for d in all_daily if day < len(d)]
        if not rows:
            continue
        entry = {"day": day}
        for key in _KEYS:
            vals = sorted(float(r[key]) for r in rows)
            entry[key] = _percentile(vals, p)
        out.append(entry)
    return out


def quantile_bands(all_daily: list[list[dict]]) -> dict:
    return {
        "p10": percentile_trajectories(all_daily, 0.10),
        "p50": percentile_trajectories(all_daily, 0.50),
        "p90": percentile_trajectories(all_daily, 0.90),
    }


def ml_baseline_error(ml_p50: list[dict], baseline_p50: list[dict]) -> dict:
    """RMSE/MAE/peak-abs-error of the ML p50 infected curve vs mechanistic p50."""
    n = min(len(ml_p50), len(baseline_p50))
    if n == 0:
        return {"rmse": 0.0, "mae": 0.0, "peakAbsError": 0.0}
    se = 0.0
    ae = 0.0
    peak = 0.0
    for k in range(n):
        diff = float(ml_p50[k]["I"]) - float(baseline_p50[k]["I"])
        se += diff * diff
        ae += abs(diff)
        peak = max(peak, abs(diff))
    return {"rmse": (se / n) ** 0.5, "mae": ae / n, "peakAbsError": peak}


def sensitivity_feature_importances(
    graph: ContactGraph, params: dict, seed: int
) -> list[dict]:
    """One-at-a-time sensitivity: perturb each scalar driver +/-10% and measure
    the relative change in peak infected. Normalized to sum to 1.
    """
    drivers = {
        "r0": params.get("r0") or 2.5,
        "infectiousDays": params.get("infectiousDays") or 5,
        "incubationDays": params.get("incubationDays") or 3,
        "isolationCapacity": params.get("isolationCapacity"),
    }

    def peak_for(p: dict) -> float:
        res = run_single(graph, p, mulberry32(seed & 0xFFFFFFFF))
        return float(res.summary["peakInfected"])

    base_peak = max(1.0, peak_for(params))
    raw: list[tuple[str, float]] = []
    for feature, value in drivers.items():
        if value is None:
            base = max(1, graph.size // 10)
        else:
            base = value
        hi = dict(params)
        lo = dict(params)
        hi[feature] = base * 1.1 if feature != "isolationCapacity" else int(base * 1.1) + 1
        lo[feature] = base * 0.9 if feature != "isolationCapacity" else max(0, int(base * 0.9))
        hi["beta"] = None if feature in ("r0", "infectiousDays") else params.get("beta")
        lo["beta"] = None if feature in ("r0", "infectiousDays") else params.get("beta")
        sensitivity = abs(peak_for(hi) - peak_for(lo)) / base_peak
        raw.append((feature, sensitivity))

    total = sum(v for _, v in raw) or 1.0
    return [{"feature": f, "importance": v / total} for f, v in sorted(raw, key=lambda x: -x[1])]
