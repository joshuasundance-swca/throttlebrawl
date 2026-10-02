"""Original AI-scripted golf_cart; metres, front glTF +Z."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ride_lib

CONFIG = {"style": "golf", "class": "rat", "wheelbase": 1.46, "seat_height": 0.72, "radius": 0.25, "paint": "#e3e5cf"}

_ride_lib.build(CONFIG)
