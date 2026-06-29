"""Node-type registry + on-disk artifact discovery.

Heavy DL nodes are imported lazily so the service boots and /health works even
when torch / torch-geometric / pytorch-forecasting are not installed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from app.config import MODEL_DIR
from app.models.base import SimNode

# type -> zero-arg factory (lazy import inside)
_FACTORIES: dict[str, Callable[[], SimNode]] = {}


def register(node_type: str, factory: Callable[[], SimNode]) -> None:
    _FACTORIES[node_type] = factory


def _mechanistic_factory() -> SimNode:
    from app.models.mechanistic_node import MechanisticNode

    return MechanisticNode()


def _ude_factory() -> SimNode:
    from app.models.neural_ode import NeuralOdeNode

    return NeuralOdeNode()


def _gnn_factory() -> SimNode:
    from app.models.gnn import GnnNode

    return GnnNode()


def _forecaster_factory() -> SimNode:
    from app.models.forecaster import ForecasterNode

    return ForecasterNode()


def _surrogate_factory() -> SimNode:
    from app.models.surrogate import SurrogateNode

    return SurrogateNode()


def _causal_factory() -> SimNode:
    from app.models.causal import CausalNode

    return CausalNode()


register("mechanistic_seir", _mechanistic_factory)
register("neural_ode_ude", _ude_factory)
register("gnn_spatiotemporal", _gnn_factory)
register("forecaster_tft", _forecaster_factory)
register("surrogate", _surrogate_factory)
register("causal_counterfactual", _causal_factory)


def create_node(node_type: str) -> SimNode:
    if node_type not in _FACTORIES:
        raise KeyError(f"unknown node type: {node_type}")
    return _FACTORIES[node_type]()


def registered_types() -> list[str]:
    return sorted(_FACTORIES.keys())


def list_artifacts() -> list[dict]:
    """Scan MODEL_DIR/<model_id>/<version>/meta.json for trained artifacts."""
    out: list[dict] = []
    base = Path(MODEL_DIR)
    if not base.exists():
        return out
    for model_dir in sorted(base.iterdir()):
        if not model_dir.is_dir():
            continue
        for version_dir in sorted(model_dir.iterdir()):
            meta_path = version_dir / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text())
                except (OSError, json.JSONDecodeError):
                    meta = {}
                meta["artifact_uri"] = str(version_dir)
                out.append(meta)
    return out
