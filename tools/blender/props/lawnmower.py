"""Original AI-scripted lawnmower; metres, front glTF +Z."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ride_lib

CONFIG = {"style": "mower", "class": "rat", "wheelbase": 1.04, "seat_height": 0.66, "radius": 0.23, "paint": "#dc5239"}

_ride_lib.build(CONFIG)
