"""Universal Differential Equation core (torch + torchdiffeq).

Physics-informed: a continuous mean-field SEIR backbone plus a learned residual
on the latent dynamics. The residual MLP is zero-initialized, so an untrained
(or cold-start trained) model reduces exactly to the mechanistic SEIR ODE.

Imported lazily; only loaded when torch is available and a trained artifact is
requested. The DAG node falls back to the discrete mechanistic ensemble when
torch is absent or no artifact exists.
"""

from __future__ import annotations

from pathlib import Path


def torch_available() -> bool:
    try:
        import torch  # noqa: F401
        import torchdiffeq  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


def build_model():
    import torch
    from torch import nn

    class Residual(nn.Module):
        def __init__(self, hidden: int = 16):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(5, hidden),
                nn.Tanh(),
                nn.Linear(hidden, 3),
            )
            # Zero-init the final layer => residual == 0 at init (pure physics).
            nn.init.zeros_(self.net[-1].weight)
            nn.init.zeros_(self.net[-1].bias)

        def forward(self, t, state, ctx):
            inp = torch.cat([state, ctx], dim=-1)
            return self.net(inp)

    class UDE(nn.Module):
        """dX/dt = SEIR(X; beta,sigma,gamma) + residual(X, ctx)."""

        def __init__(self):
            super().__init__()
            self.residual = Residual()

        def dynamics(self, t, x, beta, sigma, gamma, ctx):
            s, e, i = x[..., 0], x[..., 1], x[..., 2]
            n = torch.clamp(s + e + i + (1.0 - s - e - i), min=1e-6)
            new_exp = beta * s * i / n
            ds = -new_exp
            de = new_exp - sigma * e
            di = sigma * e - gamma * i
            phys = torch.stack([ds, de, di], dim=-1)
            return phys + self.residual(t, x, ctx)

        def forward(self, x0, t, beta, sigma, gamma, ctx):
            from torchdiffeq import odeint

            def f(tt, xx):
                return self.dynamics(tt, xx, beta, sigma, gamma, ctx)

            return odeint(f, x0, t, method="rk4")

    return UDE()


def load_model(artifact_dir: Path):
    import torch

    weights = Path(artifact_dir) / "ude.pt"
    if not weights.exists():
        return None
    model = build_model()
    model.load_state_dict(torch.load(weights, map_location="cpu"))
    model.eval()
    return model


def save_model(model, artifact_dir: Path) -> None:
    import torch

    Path(artifact_dir).mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), Path(artifact_dir) / "ude.pt")


def predict_infected_curve(model, params: dict, horizon: int, n_nodes: int) -> list[float]:
    """Integrate the UDE and return absolute infected counts per day."""
    import torch

    r0 = float(params.get("r0") or 2.5)
    infectious = float(params.get("infectiousDays") or 5)
    incubation = float(params.get("incubationDays") or 3)
    gamma = 1.0 / max(1.0, infectious)
    sigma = 1.0 / max(1.0, incubation)
    beta = r0 * gamma
    i0 = 1.0 / max(1, n_nodes)
    x0 = torch.tensor([1.0 - i0, 0.0, i0], dtype=torch.float32)
    t = torch.arange(0, horizon + 1, dtype=torch.float32)
    ctx = torch.tensor([r0, infectious], dtype=torch.float32)
    with torch.no_grad():
        traj = model(x0, t, torch.tensor(beta), torch.tensor(sigma), torch.tensor(gamma), ctx)
    frac_i = traj[:, 2].clamp(min=0.0).tolist()
    return [f * n_nodes for f in frac_i]
