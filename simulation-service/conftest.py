import sys
from pathlib import Path

# Ensure `import app` resolves when running pytest from the service root.
sys.path.insert(0, str(Path(__file__).resolve().parent))
