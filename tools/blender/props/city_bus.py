"""The shared city bus traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("city_bus", 12.2, 2.55, 3.2, 6.4, 1.18, 5.95, "bus")
