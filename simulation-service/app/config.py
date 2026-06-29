import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# On-disk model artifacts live under MODEL_DIR/<model_id>/<version>/.
MODEL_DIR = Path(os.getenv("MODEL_DIR", str(ROOT / "artifacts")))

# Torch device. CPU keeps the image portable; cold-start training runs on CPU.
TORCH_DEVICE = os.getenv("TORCH_DEVICE", "cpu")

# Default Monte-Carlo ensemble size for mechanistic / cold-start runs.
DEFAULT_RUNS = int(os.getenv("SIM_DEFAULT_RUNS", "200"))
MAX_RUNS = int(os.getenv("SIM_MAX_RUNS", "2000"))

# Default forecast horizon (days) when the request does not specify one.
DEFAULT_HORIZON_DAYS = int(os.getenv("SIM_DEFAULT_HORIZON_DAYS", "60"))
MAX_HORIZON_DAYS = int(os.getenv("SIM_MAX_HORIZON_DAYS", "365"))

# Quantiles emitted as uncertainty bands.
QUANTILES = (0.10, 0.50, 0.90)

# Link types that represent location/containment rather than person-to-person
# contact. Mirrors backend buildContactGraphFromCopy.
LOCATION_LINK_NAMES = {
    name.strip().lower()
    for name in os.getenv("LOCATION_LINK_NAMES", "located_in,located_in_bed,assigned_to").split(",")
    if name.strip()
}

# Object types treated as organizational units for predicted-property roll-ups.
UNIT_TYPE_NAMES = {
    name.strip().lower()
    for name in os.getenv("UNIT_TYPE_NAMES", "orgunit,unit,ward,department,facility").split(",")
    if name.strip()
}


def model_artifact_dir(model_id: str, version: str) -> Path:
    return MODEL_DIR / model_id / version
