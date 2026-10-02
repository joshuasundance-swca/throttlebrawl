"""Original AI-scripted mobility_scooter; metres, front glTF +Z."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ride_lib

CONFIG = {
    "style": "mobility",
    "class": "scooter",
    "wheelbase": 0.94,
    "seat_height": 0.68,
    "radius": 0.2,
    "paint": "#686bd0",
}

_ride_lib.build(CONFIG)
