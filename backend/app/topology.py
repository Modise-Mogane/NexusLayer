"""Load topology scenarios from local JSON files."""

import json
from pathlib import Path

from .models import Topology

SCENARIOS_DIR = Path(__file__).resolve().parent.parent / "scenarios"
DEFAULT_SCENARIO = "maritime_failover.json"


def load_topology(scenario: str = DEFAULT_SCENARIO) -> Topology:
    """Load and validate a topology scenario file."""
    path = SCENARIOS_DIR / scenario
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return Topology.model_validate(data)
