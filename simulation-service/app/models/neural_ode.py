"""Neural-ODE / UDE DAG node.

Physics-informed: builds on the upstream mechanistic ensemble. When untrained
(cold-start) or when torch is unavailable, it returns the mechanistic quantiles
unchanged — the zero-residual UDE reduces exactly to mechanistic SEIR, which the
tests assert. When a trained artifact is present, it applies the learned residual
correction to the mechanistic infected curve while preserving the uncertainty
band shape.
"""

from __future__ import annotations

import copy
from pathlib import Path

from app.config import model_artifact_dir
from app.models.base import BaseNode, NodeOutput, SimContext, first_mechanistic_input
from app.schemas import GraphNodeSpec


class NeuralOdeNode(BaseNode):
    type = "neural_ode_ude"

    def run(self, ctx: SimContext, spec: GraphNodeSpec) -> NodeOutput:
        mech = first_mechanistic_input(ctx, spec)
        if mech is None:
            raise ValueError("neural_ode_ude requires an upstream mechanistic node")

        model_ref = ctx.model_ref or {}
        artifact_dir = None
        if model_ref.get("id") and model_ref.get("version"):
            artifact_dir = model_artifact_dir(model_ref["id"], model_ref["version"])

        trained = self._try_predict(ctx, mech, artifact_dir)
        if trained is None:
            # Cold-start: zero-residual UDE == mechanistic SEIR.
            return NodeOutput(
                node_id=spec.id,
                node_type=self.type,
                kind="ml",
                quantiles=mech.quantiles,
                summary=mech.summary,
                ensemble=mech.ensemble,
                unit_infected=mech.unit_infected,
                fallback=True,
                fallback_reason="cold-start: zero-residual UDE reduces to mechanistic SEIR",
            )

        corrected = self._apply_correction(mech.quantiles, trained)
        return NodeOutput(
            node_id=spec.id,
            node_type=self.type,
            kind="ml",
            quantiles=corrected,
            summary=mech.summary,
            ensemble=mech.ensemble,
            unit_infected=mech.unit_infected,
            fallback=False,
            fallback_reason=None,
        )

    def _try_predict(self, ctx: SimContext, mech: NodeOutput, artifact_dir: Path | None):
        if artifact_dir is None or not Path(artifact_dir).exists():
            return None
        from app.models import ude_core

        if not ude_core.torch_available():
            return None
        model = ude_core.load_model(artifact_dir)
        if model is None:
            return None
        try:
            return ude_core.predict_infected_curve(
                model, ctx.params, ctx.horizon, ctx.graph.size
            )
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _apply_correction(quantiles: dict, infected_curve: list[float]) -> dict:
        """Rescale the mechanistic I band by the UDE infected curve, day by day,
        preserving the spread between p10/p50/p90.
        """
        corrected = copy.deepcopy(quantiles)
        p50 = corrected.get("p50", [])
        for day, row in enumerate(p50):
            if day >= len(infected_curve):
                break
            base = float(row["I"]) or 1.0
            target = max(0.0, infected_curve[day])
            ratio = target / base if base > 0 else 1.0
            for band in ("p10", "p50", "p90"):
                if day < len(corrected[band]):
                    corrected[band][day]["I"] = max(0.0, float(corrected[band][day]["I"]) * ratio)
        return corrected
