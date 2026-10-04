"""The shared pickup traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("pickup", 5.6, 2, 1.9, 3.4, 1.16, 1.5, "pickup")
