"""The shared semi traffic silhouette; no brands or livery."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _vehicle_lib import build_vehicle

build_vehicle("semi", 16.5, 2.6, 4, 12.5, 1.22, 6.7, "semi")
