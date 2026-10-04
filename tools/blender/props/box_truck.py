"""The shared box truck traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("box_truck", 7.5, 2.4, 3.4, 4.8, 1.18, 3.5, "box")
