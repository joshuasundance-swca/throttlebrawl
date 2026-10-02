"""Original AI-scripted step_through: scooter silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "scooter",
    "class": "scooter",
    "wheelbase": 1.28,
    "seat_height": 0.74,
    "paint": "#35ceac",
    "radius": 0.25,
    "body_roles": ["paint_primary", "tyre", "rim", "glass"],
    "colours": {"glass": "#82b5d8"},
}

_bike_lib.build(CONFIG)
