"""Cold-start training CLI: generate synthetic SEIR data and fit the UDE.

Usage:
    python scripts/train_cold_start.py --name ude-coldstart --version 0.1.0 \
        --samples 64 --epochs 50 --seed 1

Requires torch + torchdiffeq. Without them, writes a scaffold artifact and the
inference path stays on the mechanistic baseline.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas import OutbreakParams, TrainRequest  # noqa: E402
from app.training import run_training  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Cold-start UDE training")
    parser.add_argument("--name", default="ude-coldstart")
    parser.add_argument("--version", default="0.1.0")
    parser.add_argument("--model-type", default="neural_ode_ude")
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    req = TrainRequest(
        model_type=args.model_type,
        name=args.name,
        version=args.version,
        seed=args.seed,
        dataset_kind="synthetic",
        params=OutbreakParams(),
        samples=args.samples,
        epochs=args.epochs,
    )
    result = run_training(req)
    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    main()
