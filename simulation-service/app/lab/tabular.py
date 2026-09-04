"""Supervised learning on a table: pick a target, pick features, fit, score.

This is the scikit-learn workflow, exposed rather than reinvented. Every choice
a user makes here maps to something they would write in a notebook — a
``ColumnTransformer``, an estimator, a ``train_test_split`` — so the mental
model transfers in both directions: what they learn here works in code, and
what they know from code works here.

Three things it does that a naive wrapper would not, and each one is the
difference between a score and a defensible score:

* **Every fit is scored against a baseline.** An R² of 0.8 means nothing until
  you know that predicting the mean scores 0.79. A model that cannot beat
  ``DummyRegressor`` is a model that has learned the average and dressed it up,
  and that is the most common way a first attempt fools its author.
* **Splitting can be chronological.** A random split on a time-ordered table
  trains on next week and tests on last week, which inflates every metric and
  is invisible in the numbers. Where a time column exists, the honest split is
  available and the choice is recorded on the result.
* **Rows dropped are counted and reported.** Silently discarding a third of a
  table because its target is blank produces a model fitted on a population
  nobody chose.
"""

from __future__ import annotations

import base64
import io
import pickle
from dataclasses import dataclass, field
from typing import Any, Literal

Task = Literal["regression", "classification"]
SplitMode = Literal["random", "chronological"]

#: Above this many distinct numeric values, a target is treated as continuous.
#: Below it, a numeric column is usually a code or a small ordinal.
CLASS_MAX_LEVELS = 12
#: A fitted pipeline larger than this is refused rather than stored: a forest
#: with unlimited depth on a wide table runs to hundreds of megabytes.
MAX_ARTIFACT_BYTES = 24 * 1024 * 1024


@dataclass
class EstimatorInfo:
    key: str
    label: str
    task: Task
    #: Parameters a user may set, with their defaults. Anything not listed is
    #: left at the library's own default rather than guessed at here.
    params: dict[str, Any] = field(default_factory=dict)
    note: str = ""


ESTIMATORS: dict[str, EstimatorInfo] = {
    "linear": EstimatorInfo(
        "linear", "Régression linéaire", "regression",
        {},
        "Le point de départ. Si un modèle plus lourd ne la bat pas, la relation est linéaire.",
    ),
    "ridge": EstimatorInfo(
        "ridge", "Ridge", "regression",
        {"alpha": 1.0},
        "Linéaire, mais qui résiste aux variables corrélées entre elles.",
    ),
    "lasso": EstimatorInfo(
        "lasso", "Lasso", "regression",
        {"alpha": 0.1},
        "Linéaire, et met à zéro les variables inutiles — utile pour savoir lesquelles comptent.",
    ),
    "random_forest": EstimatorInfo(
        "random_forest", "Forêt aléatoire", "regression",
        {"n_estimators": 200, "max_depth": None, "min_samples_leaf": 1},
        "Capte les effets non linéaires et les interactions sans qu'on les déclare.",
    ),
    "gradient_boosting": EstimatorInfo(
        "gradient_boosting", "Gradient boosting", "regression",
        {"n_estimators": 200, "learning_rate": 0.1, "max_depth": 3},
        "Souvent le plus précis sur des tableaux, au prix d'un temps d'entraînement plus long.",
    ),
    "logistic": EstimatorInfo(
        "logistic", "Régression logistique", "classification",
        {"C": 1.0, "max_iter": 1000},
        "Le point de départ en classification, et le plus facile à expliquer.",
    ),
    "random_forest_clf": EstimatorInfo(
        "random_forest_clf", "Forêt aléatoire", "classification",
        {"n_estimators": 200, "max_depth": None, "min_samples_leaf": 1},
    ),
    "gradient_boosting_clf": EstimatorInfo(
        "gradient_boosting_clf", "Gradient boosting", "classification",
        {"n_estimators": 200, "learning_rate": 0.1, "max_depth": 3},
    ),
}


def catalogue() -> list[dict[str, Any]]:
    """What the picker offers, with the defaults it should pre-fill."""
    return [
        {
            "key": e.key,
            "label": e.label,
            "task": e.task,
            "params": e.params,
            "note": e.note,
        }
        for e in ESTIMATORS.values()
    ]


def infer_task(values: list[Any]) -> Task:
    """Whether a column is something to measure or something to name."""
    import pandas as pd

    s = pd.Series(values).dropna()
    if s.empty:
        return "regression"
    numeric = pd.to_numeric(s, errors="coerce")
    if numeric.notna().mean() < 0.9:
        return "classification"
    # A numeric column with a handful of distinct values is a code, not a
    # measurement: 0/1, or five severity levels.
    return "classification" if numeric.nunique() <= CLASS_MAX_LEVELS else "regression"


def _split_columns(frame: Any, features: list[str]) -> tuple[list[str], list[str]]:
    """Which features are numbers and which are labels."""
    import pandas as pd

    numeric: list[str] = []
    categorical: list[str] = []
    for col in features:
        s = frame[col]
        as_num = pd.to_numeric(s, errors="coerce")
        (numeric if as_num.notna().mean() >= 0.9 else categorical).append(col)
    return numeric, categorical


def _build(estimator: str, params: dict[str, Any], numeric: list[str], categorical: list[str]):
    """A ColumnTransformer feeding an estimator — the shape you would write."""
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import (
        GradientBoostingClassifier,
        GradientBoostingRegressor,
        RandomForestClassifier,
        RandomForestRegressor,
    )
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import Lasso, LinearRegression, LogisticRegression, Ridge
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    info = ESTIMATORS[estimator]
    merged = {**info.params, **{k: v for k, v in (params or {}).items() if v is not None}}

    num_pipe = Pipeline(
        [("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]
    )
    cat_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent")),
            # Unknown categories at prediction time become all-zeros instead of
            # raising: a facility that opened after training should produce a
            # number, not a 500.
            ("encode", OneHotEncoder(handle_unknown="ignore", max_categories=40)),
        ]
    )
    pre = ColumnTransformer(
        [("num", num_pipe, numeric), ("cat", cat_pipe, categorical)],
        remainder="drop",
    )

    seed = 20260904
    if estimator == "linear":
        model = LinearRegression()
    elif estimator == "ridge":
        model = Ridge(alpha=float(merged.get("alpha", 1.0)))
    elif estimator == "lasso":
        model = Lasso(alpha=float(merged.get("alpha", 0.1)), max_iter=5000)
    elif estimator == "random_forest":
        model = RandomForestRegressor(
            n_estimators=int(merged.get("n_estimators", 200)),
            max_depth=merged.get("max_depth") or None,
            min_samples_leaf=int(merged.get("min_samples_leaf", 1)),
            random_state=seed,
            n_jobs=1,
        )
    elif estimator == "gradient_boosting":
        model = GradientBoostingRegressor(
            n_estimators=int(merged.get("n_estimators", 200)),
            learning_rate=float(merged.get("learning_rate", 0.1)),
            max_depth=int(merged.get("max_depth", 3)),
            random_state=seed,
        )
    elif estimator == "logistic":
        model = LogisticRegression(
            C=float(merged.get("C", 1.0)),
            max_iter=int(merged.get("max_iter", 1000)),
            random_state=seed,
        )
    elif estimator == "random_forest_clf":
        model = RandomForestClassifier(
            n_estimators=int(merged.get("n_estimators", 200)),
            max_depth=merged.get("max_depth") or None,
            min_samples_leaf=int(merged.get("min_samples_leaf", 1)),
            random_state=seed,
            n_jobs=1,
        )
    elif estimator == "gradient_boosting_clf":
        model = GradientBoostingClassifier(
            n_estimators=int(merged.get("n_estimators", 200)),
            learning_rate=float(merged.get("learning_rate", 0.1)),
            max_depth=int(merged.get("max_depth", 3)),
            random_state=seed,
        )
    else:
        raise ValueError(f"Estimateur inconnu : {estimator}")

    return Pipeline([("prepare", pre), ("model", model)]), merged


def _importances(pipe: Any, numeric: list[str], categorical: list[str]) -> list[dict[str, Any]]:
    """What the model leaned on, named after one-hot expansion."""
    import numpy as np

    try:
        names = list(pipe.named_steps["prepare"].get_feature_names_out())
    except Exception:
        return []
    model = pipe.named_steps["model"]
    if hasattr(model, "feature_importances_"):
        weights = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "coef_"):
        coef = np.asarray(model.coef_, dtype=float)
        weights = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)
    else:
        return []
    if len(weights) != len(names):
        return []
    pairs = sorted(zip(names, weights), key=lambda p: -abs(p[1]))
    return [{"feature": n, "weight": round(float(w), 6)} for n, w in pairs[:25]]


@dataclass
class TrainOutcome:
    task: Task
    estimator: str
    params: dict[str, Any]
    metrics: dict[str, float]
    #: The same metrics for a model that ignores the features entirely.
    baseline: dict[str, float]
    importances: list[dict[str, Any]]
    n_train: int
    n_test: int
    dropped_rows: int
    numeric_features: list[str]
    categorical_features: list[str]
    split: SplitMode
    classes: list[str]
    warnings: list[str]
    artifact_b64: str


def train(
    rows: list[dict[str, Any]],
    target: str,
    features: list[str],
    estimator: str,
    params: dict[str, Any] | None = None,
    split: SplitMode = "random",
    test_size: float = 0.25,
    time_column: str | None = None,
) -> TrainOutcome:
    import numpy as np
    import pandas as pd
    from sklearn.dummy import DummyClassifier, DummyRegressor
    from sklearn.metrics import (
        accuracy_score,
        f1_score,
        mean_absolute_error,
        mean_squared_error,
        r2_score,
    )
    from sklearn.model_selection import train_test_split

    if estimator not in ESTIMATORS:
        raise ValueError(f"Estimateur inconnu : {estimator}")
    if not features:
        raise ValueError("Il faut au moins une variable explicative.")
    if target in features:
        raise ValueError(
            f"« {target} » est à la fois la cible et une variable explicative. "
            "Un modèle qui voit sa réponse obtient un score parfait et ne prédit rien."
        )

    frame = pd.DataFrame(rows)
    missing = [c for c in [target, *features] if c not in frame.columns]
    if missing:
        raise ValueError("Colonnes absentes : " + ", ".join(missing))

    before = len(frame)
    frame = frame[frame[target].notna() & (frame[target].astype(str) != "")]
    dropped = before - len(frame)
    if len(frame) < 20:
        raise ValueError(
            f"{len(frame)} lignes utilisables : trop peu pour séparer entraînement et test."
        )

    task = ESTIMATORS[estimator].task
    y_raw = frame[target]
    if task == "regression":
        y = pd.to_numeric(y_raw, errors="coerce")
        keep = y.notna()
        dropped += int((~keep).sum())
        frame, y = frame[keep], y[keep]
    else:
        y = y_raw.astype(str)

    warnings: list[str] = []
    numeric, categorical = _split_columns(frame, features)

    if split == "chronological":
        if not time_column or time_column not in frame.columns:
            raise ValueError(
                "Une séparation chronologique demande une colonne de temps."
            )
        order = frame[time_column].astype(str).argsort()
        frame, y = frame.iloc[order], y.iloc[order]
        cut = int(len(frame) * (1 - test_size))
        X_train, X_test = frame.iloc[:cut], frame.iloc[cut:]
        y_train, y_test = y.iloc[:cut], y.iloc[cut:]
    else:
        if time_column and time_column in frame.columns:
            warnings.append(
                "Séparation aléatoire alors qu'une colonne de temps existe : le modèle "
                "s'entraîne sur l'avenir et se teste sur le passé, ce qui gonfle le score."
            )
        stratify = y if task == "classification" and y.value_counts().min() >= 2 else None
        X_train, X_test, y_train, y_test = train_test_split(
            frame, y, test_size=test_size, random_state=20260904, stratify=stratify
        )

    pipe, merged = _build(estimator, params or {}, numeric, categorical)
    pipe.fit(X_train[features], y_train)
    pred = pipe.predict(X_test[features])

    dummy = (DummyRegressor(strategy="mean") if task == "regression"
             else DummyClassifier(strategy="most_frequent"))
    dummy.fit(X_train[features], y_train)
    dummy_pred = dummy.predict(X_test[features])

    if task == "regression":
        metrics = {
            "r2": round(float(r2_score(y_test, pred)), 4),
            "mae": round(float(mean_absolute_error(y_test, pred)), 4),
            "rmse": round(float(np.sqrt(mean_squared_error(y_test, pred))), 4),
        }
        baseline = {
            "r2": round(float(r2_score(y_test, dummy_pred)), 4),
            "mae": round(float(mean_absolute_error(y_test, dummy_pred)), 4),
            "rmse": round(float(np.sqrt(mean_squared_error(y_test, dummy_pred))), 4),
        }
        if metrics["mae"] >= baseline["mae"]:
            warnings.append(
                "Le modèle ne fait pas mieux que prédire la moyenne. Les variables "
                "choisies ne portent pas d'information sur la cible."
            )
        classes: list[str] = []
    else:
        metrics = {
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "f1_macro": round(float(f1_score(y_test, pred, average="macro", zero_division=0)), 4),
        }
        baseline = {
            "accuracy": round(float(accuracy_score(y_test, dummy_pred)), 4),
            "f1_macro": round(
                float(f1_score(y_test, dummy_pred, average="macro", zero_division=0)), 4
            ),
        }
        if metrics["accuracy"] <= baseline["accuracy"]:
            warnings.append(
                "Le modèle ne fait pas mieux que toujours répondre la classe majoritaire."
            )
        classes = [str(c) for c in getattr(pipe.named_steps["model"], "classes_", [])]

    buf = io.BytesIO()
    pickle.dump({"pipeline": pipe, "features": features, "task": task}, buf)
    blob = buf.getvalue()
    if len(blob) > MAX_ARTIFACT_BYTES:
        raise ValueError(
            f"Le modèle entraîné pèse {len(blob) // (1024 * 1024)} Mo, au-delà de la "
            "limite de stockage. Réduisez le nombre d'arbres ou la profondeur."
        )

    return TrainOutcome(
        task=task,
        estimator=estimator,
        params=merged,
        metrics=metrics,
        baseline=baseline,
        importances=_importances(pipe, numeric, categorical),
        n_train=int(len(X_train)),
        n_test=int(len(X_test)),
        dropped_rows=int(dropped),
        numeric_features=numeric,
        categorical_features=categorical,
        split=split,
        classes=classes,
        warnings=warnings,
        artifact_b64=base64.b64encode(blob).decode("ascii"),
    )


def predict(artifact_b64: str, rows: list[dict[str, Any]]) -> list[Any]:
    """Apply a fitted pipeline to new rows.

    The artifact is a pickle, and it is only ever one this service produced and
    the backend stored. That is a trust assumption worth naming: anybody able to
    write to the model table could run code here. They would already own the
    database, so it adds no exposure — but it is the reason nothing else may
    ever be unpickled through this path.
    """
    import pandas as pd

    bundle = pickle.loads(base64.b64decode(artifact_b64))
    frame = pd.DataFrame(rows)
    features = bundle["features"]
    missing = [c for c in features if c not in frame.columns]
    if missing:
        raise ValueError("Colonnes absentes pour la prédiction : " + ", ".join(missing))
    out = bundle["pipeline"].predict(frame[features])
    return [o.item() if hasattr(o, "item") else o for o in out]
