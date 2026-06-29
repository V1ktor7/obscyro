"""Cold-start training: fit the UDE residual on synthetic mechanistic SEIR data.

This is the cold-start path from the spec: the mechanistic model generates the
training data, the physics-informed UDE learns on it, metrics are logged, and the
artifact is versioned on disk. Heavy DL is optional — without torch we return a
scaffold result and the inference path stays on the mechanistic baseline.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.config import model_artifact_dir
from app.contacts import build_contact_graph
from app.mechanistic import generate_synthetic_dataset
from app.schemas import GraphLink, GraphNode, GraphPayload, OutbreakParams, TrainRequest, TrainResponse


def synthetic_graph(n: int = 40) -> GraphPayload:
    """A small ring + hub contact graph for cold-start data generation."""
    nodes = [GraphNode(id=f"p{i}", type="Person", properties={}) for i in range(n)]
    nodes.append(GraphNode(id="unit0", type="OrgUnit", properties={"kind": "ward"}))
    links: list[GraphLink] = []
    for i in range(n):
        links.append(GraphLink(linkTypeName="contact", fromId=f"p{i}", toId=f"p{(i + 1) % n}"))
        links.append(GraphLink(linkTypeName="located_in", fromId=f"p{i}", toId="unit0"))
    return GraphPayload(nodes=nodes, links=links)


def _write_meta(artifact_dir: Path, meta: dict) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "meta.json").write_text(json.dumps(meta, indent=2))


def run_training(req: TrainRequest) -> TrainResponse:
    payload = req.graph or synthetic_graph()
    graph = build_contact_graph(payload)
    base_params = req.params.model_dump()
    dataset = generate_synthetic_dataset(graph, base_params, req.samples, req.seed)

    artifact_dir = model_artifact_dir(req.name, req.version)

    from app.models import ude_core

    if not ude_core.torch_available():
        meta = {
            "model_type": req.model_type,
            "name": req.name,
            "version": req.version,
            "dataset_kind": req.dataset_kind,
            "seed": req.seed,
            "metrics": {"status": "scaffold", "reason": "torch/torchdiffeq not installed"},
        }
        _write_meta(artifact_dir, meta)
        return TrainResponse(
            model_type=req.model_type,
            name=req.name,
            version=req.version,
            status="failed",
            seed=req.seed,
            dataset_kind=req.dataset_kind,
            artifact_uri=str(artifact_dir),
            metrics=meta["metrics"],
        )

    metrics = _train_ude(dataset, graph.size, req.epochs, artifact_dir)
    meta = {
        "model_type": req.model_type,
        "name": req.name,
        "version": req.version,
        "dataset_kind": req.dataset_kind,
        "seed": req.seed,
        "metrics": metrics,
    }
    _write_meta(artifact_dir, meta)
    return TrainResponse(
        model_type=req.model_type,
        name=req.name,
        version=req.version,
        status="ready",
        seed=req.seed,
        dataset_kind=req.dataset_kind,
        artifact_uri=str(artifact_dir),
        metrics=metrics,
    )


def _train_ude(dataset, n_nodes: int, epochs: int, artifact_dir: Path) -> dict:
    import torch

    from app.models import ude_core

    model = ude_core.build_model()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    horizon = max((len(traj) for _, traj in dataset), default=61) - 1

    # Precompute mechanistic targets (normalized infected fraction) per sample.
    targets = []
    ctxs = []
    for feats, traj in dataset:
        t = torch.tensor([v / max(1, n_nodes) for v in traj], dtype=torch.float32)
        targets.append(t)
        ctxs.append(feats)

    losses = []
    for _ in range(max(1, epochs)):
        opt.zero_grad()
        total = torch.tensor(0.0)
        for feats, target in zip(ctxs, targets):
            r0, infectious, _incub = feats
            gamma = 1.0 / max(1.0, infectious)
            sigma = 1.0 / max(1.0, _incub)
            beta = r0 * gamma
            i0 = 1.0 / max(1, n_nodes)
            x0 = torch.tensor([1.0 - i0, 0.0, i0], dtype=torch.float32)
            tt = torch.arange(0, len(target), dtype=torch.float32)
            ctx_t = torch.tensor([r0, infectious], dtype=torch.float32)
            from torchdiffeq import odeint

            def f(s, x):
                return model.dynamics(s, x, torch.tensor(beta), torch.tensor(sigma), torch.tensor(gamma), ctx_t)

            traj = odeint(f, x0, tt, method="rk4")
            pred_i = traj[:, 2].clamp(min=0.0)
            total = total + torch.mean((pred_i - target) ** 2)
        loss = total / max(1, len(targets))
        loss.backward()
        opt.step()
        losses.append(float(loss.detach()))

    ude_core.save_model(model, artifact_dir)
    return {
        "status": "trained",
        "samples": len(dataset),
        "epochs": epochs,
        "final_loss": losses[-1] if losses else None,
        "initial_loss": losses[0] if losses else None,
    }
