"""Original AI-scripted moped; metres, front glTF +Z."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ride_lib

CONFIG = {
    "style": "moped",
    "class": "scooter",
    "wheelbase": 1.14,
    "seat_height": 0.73,
    "radius": 0.28,
    "paint": "#79baad",
}

_ride_lib.build(CONFIG)
