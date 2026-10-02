"""Original AI-scripted parking_trike: trike silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "trike",
    "class": "scooter",
    "wheelbase": 1.36,
    "seat_height": 0.73,
    "paint": "#f7cb28",
    "radius": 0.25,
    "body_roles": ["paint_primary", "tyre", "rim", "glass"],
    "colours": {"glass": "#8dc0da"},
}

_bike_lib.build(CONFIG)
