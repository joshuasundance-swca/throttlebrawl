"""The shared sedan traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("sedan", 4.8, 1.85, 1.45, 2.8, 0.95, 1.05, "sedan")
