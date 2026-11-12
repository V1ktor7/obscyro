"""COVID-19 wave profiles, from the INSPQ archive of daily admissions in every region.

For each wave and each of the 13 regions with more than 140,000 residents:
admissions a day per 1,000 residents, smoothed over 7 centred days. The profile is,
day by day across regions, the 10th percentile (low), the median (central) and the
90th percentile (high).

Reliability, by leaving one region out: the profile is rebuilt from the other 12 and
applied to the one left out, then compared with what that region actually had.

Populations: INSPQ's own denominators, recovered from its vaccination file
(first doses / first-dose coverage), so every region is divided by the same source.
"""
import csv
import datetime as dt
import json
import math
import sys

SRC = sys.argv[1]
OUT = sys.argv[2]
WAVES = [
    ("covid-w1", "Wave 1 (spring 2020)", "2020-02-25", "2020-07-11"),
    ("covid-w2", "Wave 2 (fall 2020 – winter 2021)", "2020-08-23", "2021-03-20"),
    ("covid-w3", "Wave 3 (spring 2021)", "2021-03-21", "2021-07-17"),
    ("covid-w4", "Wave 4 (Delta)", "2021-07-18", "2021-12-04"),
    ("covid-w5", "Wave 5 (Omicron)", "2021-12-05", "2022-03-12"),
    ("covid-w6", "Wave 6 (BA.2)", "2022-03-13", "2022-05-28"),
]

pop, name = {}, {}
for r in csv.DictReader(open(f"{SRC}/vaccination_archives_10082022.csv", encoding="utf-8-sig")):
    k = r["Croisement"]
    if r["Regroupement"] != "Région" or not k.startswith("RSS") or k in ("RSS00", "RSS98", "RSS99"):
        continue
    try:
        pop[k] = float(r["vac_cum_1_n"]) / float(r["cvac_cum_tot_1_p"]) * 100
        name[k] = r["Nom"]
    except (ValueError, ZeroDivisionError):
        pass
REGIONS = [k for k in sorted(pop) if pop[k] > 140000]

hosp, icu = {}, {}
for r in csv.DictReader(open(f"{SRC}/covid19-hist-archives-02012023.csv", encoding="utf-8-sig")):
    if r["Regroupement"] != "Région" or r["Date"] == "Date inconnue":
        continue
    for col, store in (("hos_quo_reg_n", hosp), ("hos_quo_si_n", icu)):
        try:
            store.setdefault(r["Croisement"], {})[r["Date"]] = float(r[col])
        except ValueError:
            pass


def days(a, b):
    d, e, out = dt.date.fromisoformat(a), dt.date.fromisoformat(b), []
    while d <= e:
        out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def centred(x, k=7):
    h = k // 2
    return [sum(x[max(0, i - h): i + h + 1]) / len(x[max(0, i - h): i + h + 1]) for i in range(len(x))]


def quantile(v, p):
    v = sorted(v)
    i = (len(v) - 1) * p
    lo, hi = math.floor(i), math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    va, vb = sum((x - ma) ** 2 for x in a), sum((y - mb) ** 2 for y in b)
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb) if va and vb else None


def bands(series_by_region, regions):
    n = len(next(iter(series_by_region.values())))
    out = {"low": [], "central": [], "high": []}
    for i in range(n):
        vals = [series_by_region[k][i] for k in regions]
        out["low"].append(quantile(vals, 0.1))
        out["central"].append(quantile(vals, 0.5))
        out["high"].append(quantile(vals, 0.9))
    return out


profiles = []
for key, label, a, b in WAVES:
    D = days(a, b)
    raw = {k: [hosp.get(k, {}).get(d, 0.0) / pop[k] * 1000 for d in D] for k in REGIONS}
    raw_icu = {k: [icu.get(k, {}).get(d, 0.0) / pop[k] * 1000 for d in D] for k in REGIONS}
    sm = {k: centred(v) for k, v in raw.items()}
    sm_icu = {k: centred(v) for k, v in raw_icu.items()}
    b_all = bands(sm, REGIONS)
    icu_central = bands(sm_icu, REGIONS)["central"]

    tests = []
    for k in REGIONS:
        others = [x for x in REGIONS if x != k]
        bo = bands(sm, others)
        real = sum(raw[k])
        lo, ce, hi = sum(bo["low"]), sum(bo["central"]), sum(bo["high"])
        r = corr(sm[k], bo["central"])
        lag = sm[k].index(max(sm[k])) - bo["central"].index(max(bo["central"]))
        tests.append({"region": name[k], "real": round(real, 3), "low": round(lo, 3), "central": round(ce, 3), "high": round(hi, 3),
                      "inside": lo <= real <= hi, "ratio": round(real / ce, 2) if ce else None, "shape": round(r, 2) if r is not None else None, "peakLag": lag})
    profiles.append({
        "key": key, "label": label, "from": a, "to": b, "days": len(D),
        "hosp": {k: [round(v, 5) for v in vs] for k, vs in b_all.items()},
        "icu": [round(v, 5) for v in icu_central],
        "totals": {k: round(sum(vs), 3) for k, vs in b_all.items()},
        "icuTotal": round(sum(icu_central), 3),
        "regions": len(REGIONS),
        "tests": tests,
    })
    inside = sum(t["inside"] for t in tests)
    ratios = sorted(t["ratio"] for t in tests if t["ratio"] is not None)
    shapes = sorted(t["shape"] for t in tests if t["shape"] is not None)
    print(f"{label:34s} {len(D):3d} d  per 1,000: low {profiles[-1]['totals']['low']:.2f} central {profiles[-1]['totals']['central']:.2f} high {profiles[-1]['totals']['high']:.2f}"
          f"  | left-out region inside range: {inside}/{len(tests)}  ratio {ratios[0]}–{ratios[-1]} (median {ratios[len(ratios)//2]})  shape median {shapes[len(shapes)//2]}")

json.dump({"source": "INSPQ, covid19-hist-archives-02012023.csv (hos_quo_reg_n, hos_quo_si_n)",
           "regions": [name[k] for k in REGIONS], "population": {name[k]: round(pop[k]) for k in REGIONS},
           "profiles": profiles}, open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
print("ok")
