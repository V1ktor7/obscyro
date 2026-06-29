"""Mechanistic SEIR — faithful Python port of backend/src/services/simulation.ts.

Same seeded PRNG (mulberry32) and update order, so a given seed reproduces the
backend's trajectories. Also serves as:
  * the cold-start synthetic-data generator for ML training, and
  * the always-available baseline / fallback for ML nodes.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass

from app.contacts import ContactGraph

DEFAULT_HORIZON = 60
DEFAULT_INCUBATION = 3
DEFAULT_INFECTIOUS = 5
DEFAULT_R0 = 2.5


def _imul(a: int, b: int) -> int:
    return ((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)) & 0xFFFFFFFF


def mulberry32(seed: int):
    """Port of the JS mulberry32 used in simulation.ts (bit-exact)."""
    t = seed & 0xFFFFFFFF

    def rng() -> float:
        nonlocal t
        t = (t + 0x6D2B79F5) & 0xFFFFFFFF
        r = _imul(t ^ (t >> 15), 1 | t)
        r = (r ^ ((r + _imul(r ^ (r >> 7), 61 | r)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((r ^ (r >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


def _is_hcw(type_name: str) -> bool:
    t = type_name.lower()
    return "clinician" in t or "hcw" in t or "staff" in t


def _resolve_beta(params: dict, avg_degree: float) -> float:
    if params.get("beta") is not None:
        return float(params["beta"])
    r0 = params.get("r0") or DEFAULT_R0
    infectious = params.get("infectiousDays") or DEFAULT_INFECTIOUS
    denom = max(1.0, avg_degree) * infectious
    return r0 / denom


@dataclass
class RunResult:
    daily: list[dict]
    summary: dict
    unit_infected: dict[str, dict]  # unitId -> {peakInfected, cumulativeInfected, peakIsolation}


def run_single(graph: ContactGraph, params: dict, rng, track_units: bool = False) -> RunResult:
    node_ids = list(graph.node_ids)
    n = len(node_ids)
    if n == 0:
        return RunResult(
            daily=[{"day": 0, "S": 0, "E": 0, "I": 0, "R": 0, "isolationDemand": 0}],
            summary={
                "peakInfected": 0,
                "peakIsolationDemand": 0,
                "attackRate": 0,
                "daysToContain": 0,
                "hcwInfections": 0,
            },
            unit_infected={},
        )

    horizon = int(params.get("horizonDays") or DEFAULT_HORIZON)
    incubation = int(params.get("incubationDays") or DEFAULT_INCUBATION)
    infectious = int(params.get("infectiousDays") or DEFAULT_INFECTIOUS)
    isolation_capacity = params.get("isolationCapacity")
    if isolation_capacity is None:
        isolation_capacity = -(-n // 10)  # ceil(n * 0.1)
    isolation_capacity = int(isolation_capacity)
    contain_threshold = int(params.get("containThreshold") if params.get("containThreshold") is not None else 1)

    # Per-node mutable state.
    state = {nid: "S" for nid in node_ids}
    days_in_state = {nid: 0 for nid in node_ids}
    isolated = {nid: False for nid in node_ids}

    total_degree = sum(len(graph.adjacency.get(nid, [])) for nid in node_ids)
    avg_degree = total_degree / n
    beta = _resolve_beta(params, avg_degree)

    index_ids = [i for i in (params.get("indexNodeIds") or []) if i in graph.nodes]
    if not index_ids:
        index_ids = [node_ids[0]]
    for nid in index_ids:
        state[nid] = "I"
        days_in_state[nid] = 0

    unit_of = {nid: graph.nodes[nid].unit_id for nid in node_ids}
    unit_peak: dict[str, int] = {}
    unit_cum: dict[str, set] = {}
    unit_peak_iso: dict[str, int] = {}

    daily: list[dict] = []
    peak_infected = 0
    peak_isolation = 0
    days_to_contain: int | None = None
    hcw_infections = 0

    for day in range(horizon + 1):
        s = e = i = r = 0
        isolation_demand = 0
        per_unit_i: dict[str, int] = {}
        per_unit_iso: dict[str, int] = {}
        for nid in node_ids:
            st = state[nid]
            if st == "S":
                s += 1
            elif st == "E":
                e += 1
            elif st == "I":
                i += 1
                u = unit_of[nid]
                if u is not None:
                    per_unit_i[u] = per_unit_i.get(u, 0) + 1
                    if track_units:
                        unit_cum.setdefault(u, set()).add(nid)
                if isolated[nid]:
                    isolation_demand += 1
                    if u is not None:
                        per_unit_iso[u] = per_unit_iso.get(u, 0) + 1
            else:
                r += 1

        peak_infected = max(peak_infected, i)
        peak_isolation = max(peak_isolation, isolation_demand)
        if days_to_contain is None and i <= contain_threshold and day > 0:
            days_to_contain = day

        if track_units:
            for u, cnt in per_unit_i.items():
                unit_peak[u] = max(unit_peak.get(u, 0), cnt)
            for u, cnt in per_unit_iso.items():
                unit_peak_iso[u] = max(unit_peak_iso.get(u, 0), cnt)

        daily.append({"day": day, "S": s, "E": e, "I": i, "R": r, "isolationDemand": isolation_demand})

        if day == horizon:
            break

        newly_exposed: list[str] = []
        for nid in node_ids:
            if state[nid] != "I" or isolated[nid]:
                continue
            for mid in graph.adjacency.get(nid, []):
                if state[mid] != "S":
                    continue
                if rng() < beta:
                    newly_exposed.append(mid)
        for nid in newly_exposed:
            if state[nid] == "S":
                state[nid] = "E"
                days_in_state[nid] = 0

        newly_infectious: list[str] = []
        for nid in node_ids:
            days_in_state[nid] += 1
            if state[nid] == "E" and days_in_state[nid] >= incubation:
                state[nid] = "I"
                days_in_state[nid] = 0
                newly_infectious.append(nid)
                if _is_hcw(graph.nodes[nid].type):
                    hcw_infections += 1
            elif state[nid] == "I" and days_in_state[nid] >= infectious:
                state[nid] = "R"
                days_in_state[nid] = 0

        current_isolated = isolation_demand
        for nid in newly_infectious:
            if current_isolated < isolation_capacity:
                isolated[nid] = True
                current_isolated += 1

    susceptible = sum(1 for nid in node_ids if state[nid] == "S")
    attack_rate = (n - susceptible) / n if n > 0 else 0.0

    unit_infected: dict[str, dict] = {}
    if track_units:
        units = set(list(unit_peak.keys()) + list(unit_cum.keys()))
        for u in units:
            unit_infected[u] = {
                "peakInfected": unit_peak.get(u, 0),
                "cumulativeInfected": len(unit_cum.get(u, set())),
                "peakIsolationDemand": unit_peak_iso.get(u, 0),
            }

    return RunResult(
        daily=daily,
        summary={
            "peakInfected": peak_infected,
            "peakIsolationDemand": peak_isolation,
            "attackRate": attack_rate,
            "daysToContain": days_to_contain,
            "hcwInfections": hcw_infections,
        },
        unit_infected=unit_infected,
    )


def run_ensemble(graph: ContactGraph, params: dict, seed: int, runs: int):
    """Return (all_daily, summaries, representative_unit_infected)."""
    runs = max(1, runs)
    all_daily: list[list[dict]] = []
    summaries: list[dict] = []
    rep_index = runs // 2
    rep_units: dict[str, dict] = {}
    for run in range(runs):
        run_seed = (seed + run * 9973) & 0xFFFFFFFF
        rng = mulberry32(run_seed)
        track = run == rep_index
        res = run_single(graph, params, rng, track_units=track)
        all_daily.append(res.daily)
        summaries.append(res.summary)
        if track:
            rep_units = res.unit_infected
    return all_daily, summaries, rep_units


def aggregate_summaries(summaries: list[dict]) -> dict:
    if not summaries:
        return {
            "peakInfected": 0,
            "peakIsolationDemand": 0,
            "attackRate": 0,
            "daysToContain": None,
            "hcwInfections": 0,
        }
    n = len(summaries)
    contain = [s["daysToContain"] for s in summaries if s["daysToContain"] is not None]
    return {
        "peakInfected": round(sum(s["peakInfected"] for s in summaries) / n),
        "peakIsolationDemand": round(sum(s["peakIsolationDemand"] for s in summaries) / n),
        "attackRate": sum(s["attackRate"] for s in summaries) / n,
        "daysToContain": round(sum(contain) / len(contain)) if contain else None,
        "hcwInfections": round(sum(s["hcwInfections"] for s in summaries) / n),
    }


def generate_synthetic_dataset(graph: ContactGraph, base_params: dict, samples: int, seed: int):
    """Cold-start dataset: sample plausible params, run mechanistic SEIR, return
    (params_vector, peak_infected_trajectory) pairs for ML training.
    """
    rng = mulberry32(seed)
    dataset = []
    for k in range(samples):
        # Sample r0 in [1.2, 4.5], infectious in [3, 9], beta derived.
        r0 = 1.2 + rng() * 3.3
        infectious = 3 + int(rng() * 7)
        incubation = 2 + int(rng() * 4)
        params = dict(base_params)
        params.update({"r0": r0, "infectiousDays": infectious, "incubationDays": incubation, "beta": None})
        res = run_single(graph, params, mulberry32((seed + k * 7919) & 0xFFFFFFFF))
        traj_i = [d["I"] for d in res.daily]
        dataset.append(([r0, float(infectious), float(incubation)], traj_i))
    return dataset
