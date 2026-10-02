"""Original AI-scripted ebike_carbon; metres, front glTF +Z."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ride_lib

CONFIG = {
    "style": "ebike",
    "class": "sport",
    "wheelbase": 1.18,
    "seat_height": 0.92,
    "radius": 0.33,
    "paint": "#424953",
}

_ride_lib.build(CONFIG)
