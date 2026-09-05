"""Forecasting a series, by reduction to the supervised problem.

There is no separate forecasting library here and there does not need to be: a
forecast is a regression whose features are the past. Lags of the target,
whatever calendar the reader believes matters, optionally lags of another
series — then any estimator from the tabular lab fits it. What changes is not
the model but how it is scored, and that is where forecasting goes wrong.

Three things this does that a single train/test split would not:

* **The baseline is "same as last time", not "the mean".** On a smooth daily
  series the mean is a hopeless predictor, so beating it proves nothing; the
  naive forecast is often very hard to beat, and a model that does not beat it
  is a model nobody should deploy. Every score is reported as MASE — the error
  divided by naive's error — so 1.0 means "exactly as good as doing nothing"
  and anything above it means worse.
* **Evaluation walks forward.** The series is cut into successive origins, each
  trained on everything before it and scored on what came next. One split gives
  one number that depends entirely on where the cut fell.
* **The horizon is part of the question.** Predicting tomorrow and predicting
  three weeks out are different problems with different scores, so the model is
  trained directly for the horizon it will be used at rather than trained once
  and rolled forward silently.
"""

from __future__ import annotations

import base64
import io
import pickle
from dataclasses import dataclass, field
from typing import Any

from app.lab.tabular import ESTIMATORS, MAX_ARTIFACT_BYTES, _build

#: Below this many usable rows a walk-forward evaluation has nothing to walk.
MIN_ROWS = 40
#: Folds in the backtest. More folds means shorter test windows, not more data.
DEFAULT_FOLDS = 4

REGRESSORS = [k for k, v in ESTIMATORS.items() if v.task == "regression"]


@dataclass
class Prepared:
    frame: Any
    feature_names: list[str]
    target_name: str
    index: Any
    dropped: int


def _as_time(series: Any) -> Any:
    """Order a column of times, whatever shape it arrived in."""
    import pandas as pd

    parsed = pd.to_datetime(series, errors="coerce", format="mixed")
    # A column that will not parse is still orderable as text if it is ISO —
    # which is the only string shape that sorts chronologically.
    return parsed if parsed.notna().mean() >= 0.8 else series.astype(str)


def prepare(
    rows: list[dict[str, Any]],
    time_column: str,
    target: str,
    lags: int,
    horizon: int,
    exog: list[str] | None = None,
    calendar: bool = True,
) -> Prepared:
    """Turn a series into the table a regressor can fit."""
    import numpy as np
    import pandas as pd

    if lags < 1:
        raise ValueError("Il faut au moins un décalage.")
    if horizon < 1:
        raise ValueError("L'horizon doit valoir au moins un pas.")

    frame = pd.DataFrame(rows)
    for col in [time_column, target, *(exog or [])]:
        if col not in frame.columns:
            raise ValueError(f"Colonne absente : {col}")

    frame = frame.assign(_t=_as_time(frame[time_column]))
    frame = frame.sort_values("_t").reset_index(drop=True)
    y = pd.to_numeric(frame[target], errors="coerce")

    out = pd.DataFrame({"_t": frame["_t"]})
    names: list[str] = []
    for k in range(1, lags + 1):
        name = f"{target}_lag{k}"
        out[name] = y.shift(k)
        names.append(name)

    for col in exog or []:
        ex = pd.to_numeric(frame[col], errors="coerce")
        for k in range(1, lags + 1):
            name = f"{col}_lag{k}"
            out[name] = ex.shift(k)
            names.append(name)

    if calendar and pd.api.types.is_datetime64_any_dtype(frame["_t"]):
        # Known in advance, unlike every other feature — which is what makes
        # calendar terms usable in a forecast at all.
        out["dow"] = frame["_t"].dt.dayofweek
        out["month"] = frame["_t"].dt.month
        names += ["dow", "month"]

    # The answer, `horizon` steps after the features that predict it.
    out["_y"] = y.shift(-(horizon - 1)) if horizon > 1 else y

    before = len(out)
    out = out.dropna(subset=[*names, "_y"]).reset_index(drop=True)
    if len(out) < MIN_ROWS:
        raise ValueError(
            f"{len(out)} points utilisables après décalage : trop peu pour une "
            "évaluation qui avance dans le temps."
        )
    return Prepared(
        frame=out,
        feature_names=names,
        target_name="_y",
        index=out["_t"],
        dropped=before - len(out),
    )


def _naive_mae(y: Any, horizon: int) -> float:
    """Error of predicting the value `horizon` steps earlier.

    The denominator of MASE, and the thing a forecast has to beat before it is
    worth anything at all.
    """
    import numpy as np

    arr = np.asarray(y, dtype=float)
    if len(arr) <= horizon:
        return float("nan")
    return float(np.mean(np.abs(arr[horizon:] - arr[:-horizon])))


@dataclass
class FoldScore:
    origin: str
    n_train: int
    n_test: int
    mae: float
    rmse: float
    naive_mae: float
    mase: float


@dataclass
class ForecastOutcome:
    estimator: str
    params: dict[str, Any]
    horizon: int
    lags: int
    exog: list[str]
    folds: list[FoldScore]
    #: Averaged across folds. MASE is the one to read.
    metrics: dict[str, float]
    importances: list[dict[str, Any]]
    n_points: int
    dropped_rows: int
    warnings: list[str] = field(default_factory=list)
    artifact_b64: str = ""


def backtest_and_fit(
    rows: list[dict[str, Any]],
    time_column: str,
    target: str,
    estimator: str,
    lags: int = 7,
    horizon: int = 1,
    exog: list[str] | None = None,
    params: dict[str, Any] | None = None,
    folds: int = DEFAULT_FOLDS,
) -> ForecastOutcome:
    """Walk forward through the series, then refit on all of it."""
    import numpy as np
    from sklearn.metrics import mean_absolute_error, mean_squared_error

    if estimator not in ESTIMATORS or ESTIMATORS[estimator].task != "regression":
        raise ValueError(
            "Une prévision se fait avec un estimateur de régression : "
            + ", ".join(REGRESSORS)
        )

    prep = prepare(rows, time_column, target, lags, horizon, exog, calendar=True)
    X = prep.frame[prep.feature_names]
    y = prep.frame[prep.target_name]
    n = len(prep.frame)

    folds = max(2, min(int(folds), 8))
    # Expanding window: every origin trains on all of its past. The first half
    # is held back as the smallest training set so no fold fits on nothing.
    first = max(MIN_ROWS // 2, n // 2)
    step = max(1, (n - first) // folds)

    scored: list[FoldScore] = []
    unscorable = 0
    for i in range(folds):
        cut = first + i * step
        end = min(n, cut + step)
        if cut >= n or end <= cut:
            break
        naive = _naive_mae(y.iloc[:end], horizon)
        if not naive or not np.isfinite(naive):
            # The series does not move over this window, so the naive forecast
            # is already exact and MASE has no denominator. Scoring against it
            # would mean dividing by zero; carrying a NaN forward would mean
            # printing a number that isn't one. The fold is dropped and said so.
            unscorable += 1
            continue
        pipe, merged = _build(estimator, params or {}, prep.feature_names, [])
        pipe.fit(X.iloc[:cut], y.iloc[:cut])
        pred = pipe.predict(X.iloc[cut:end])
        truth = y.iloc[cut:end]
        mae = float(mean_absolute_error(truth, pred))
        scored.append(
            FoldScore(
                origin=str(prep.index.iloc[cut]),
                n_train=int(cut),
                n_test=int(end - cut),
                mae=round(mae, 4),
                rmse=round(float(np.sqrt(mean_squared_error(truth, pred))), 4),
                naive_mae=round(naive, 4),
                mase=round(mae / naive, 4),
            )
        )

    if not scored:
        if unscorable:
            raise ValueError(
                "La série ne bouge pas sur les fenêtres évaluées : répéter la "
                "dernière valeur est déjà exact, il n'y a rien à prévoir."
            )
        raise ValueError("La série est trop courte pour être évaluée par fenêtres.")

    metrics = {
        "mase": round(float(np.mean([f.mase for f in scored])), 4),
        "mae": round(float(np.mean([f.mae for f in scored])), 4),
        "rmse": round(float(np.mean([f.rmse for f in scored])), 4),
        "naive_mae": round(float(np.mean([f.naive_mae for f in scored])), 4),
    }

    warnings: list[str] = []
    if unscorable:
        warnings.append(
            f"{unscorable} fenêtre(s) sur {unscorable + len(scored)} n'ont pas pu être "
            "notées : la série y est constante. Le score porte sur les autres."
        )
    if metrics["mase"] >= 1:
        warnings.append(
            "Le modèle ne bat pas la prévision naïve — répéter la dernière valeur "
            "connue ferait aussi bien ou mieux. Sur une série lisse c'est courant, "
            "et cela veut dire qu'il n'y a rien à déployer."
        )
    if exog:
        warnings.append(
            "Des variables exogènes sont utilisées : la prévision ne peut pas aller "
            "au-delà du dernier point où elles sont connues."
        )
    if horizon > 1:
        warnings.append(
            f"Le modèle est entraîné directement pour un horizon de {horizon} pas. "
            "Le score ci-dessus est celui de cet horizon, pas celui du pas suivant."
        )

    # Refit on everything for the model that will actually be used.
    pipe, merged = _build(estimator, params or {}, prep.feature_names, [])
    pipe.fit(X, y)

    from app.lab.tabular import _importances

    buf = io.BytesIO()
    pickle.dump(
        {
            "pipeline": pipe,
            "features": prep.feature_names,
            "task": "regression",
            "kind": "timeseries",
            "target": target,
            "time_column": time_column,
            "lags": lags,
            "horizon": horizon,
            "exog": list(exog or []),
        },
        buf,
    )
    blob = buf.getvalue()
    if len(blob) > MAX_ARTIFACT_BYTES:
        raise ValueError("Le modèle entraîné dépasse la limite de stockage.")

    return ForecastOutcome(
        estimator=estimator,
        params=merged,
        horizon=horizon,
        lags=lags,
        exog=list(exog or []),
        folds=scored,
        metrics=metrics,
        importances=_importances(pipe, prep.feature_names, []),
        n_points=n,
        dropped_rows=prep.dropped,
        warnings=warnings,
        artifact_b64=base64.b64encode(blob).decode("ascii"),
    )


def forecast(
    artifact_b64: str,
    rows: list[dict[str, Any]],
    steps: int = 14,
) -> dict[str, Any]:
    """Continue the series past its last observation.

    Recursive: each predicted point becomes a lag for the next, which is the
    only way to go further than one horizon when the features are the target's
    own past. It also means the error compounds, and the returned payload says
    so rather than letting a smooth line imply otherwise.
    """
    import numpy as np
    import pandas as pd

    bundle = pickle.loads(base64.b64decode(artifact_b64))
    if bundle.get("kind") != "timeseries":
        raise ValueError("Ce modèle n'est pas un modèle de série temporelle.")

    target = bundle["target"]
    time_column = bundle["time_column"]
    lags = int(bundle["lags"])
    exog = list(bundle.get("exog") or [])
    if exog:
        raise ValueError(
            "Ce modèle utilise des variables exogènes : leurs valeurs futures ne "
            "sont pas connues, donc il ne peut pas prolonger la série."
        )

    frame = pd.DataFrame(rows)
    frame = frame.assign(_t=_as_time(frame[time_column])).sort_values("_t")
    history = pd.to_numeric(frame[target], errors="coerce").dropna().tolist()
    if len(history) < lags:
        raise ValueError(f"Il faut au moins {lags} points d'historique.")

    times = list(frame["_t"])
    is_dates = pd.api.types.is_datetime64_any_dtype(frame["_t"])
    stride = (times[-1] - times[-2]) if is_dates and len(times) > 1 else None

    pipe = bundle["pipeline"]
    names = bundle["features"]
    out: list[dict[str, Any]] = []
    series = list(history)
    when = times[-1]

    for i in range(max(1, min(int(steps), 365))):
        row: dict[str, Any] = {}
        for k in range(1, lags + 1):
            row[f"{target}_lag{k}"] = series[-k]
        if "dow" in names or "month" in names:
            nxt = (when + stride) if stride is not None else when
            row["dow"] = nxt.dayofweek if is_dates else 0
            row["month"] = nxt.month if is_dates else 1
            when = nxt
        value = float(pipe.predict(pd.DataFrame([row])[names])[0])
        series.append(value)
        out.append(
            {
                "step": i + 1,
                "t": str(when) if stride is not None else f"+{i + 1}",
                "value": round(value, 4),
            }
        )

    return {
        "points": out,
        "note": (
            "Prévision récursive : chaque point prédit sert de passé au suivant, "
            "donc l'erreur s'accumule à mesure qu'on s'éloigne. Le score de "
            "l'évaluation vaut pour l'horizon entraîné, pas pour le dernier point "
            "de cette courbe."
        ),
    }
