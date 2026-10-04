"""The shared minivan traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("minivan", 5.1, 2, 1.8, 3.1, 1.02, 1.8, "van")
