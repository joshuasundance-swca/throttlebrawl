"""The shared suv traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("suv", 4.9, 1.95, 1.8, 2.9, 1.13, 1.42, "suv")
