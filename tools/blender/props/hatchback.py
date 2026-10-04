"""The shared hatchback traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("hatchback", 4.1, 1.8, 1.5, 2.5, 0.94, 1.1, "hatch")
