"""Original AI-scripted sport_stickered: stickered silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "stickered",
    "class": "sport",
    "wheelbase": 1.44,
    "seat_height": 0.82,
    "paint": "#13bed6",
    "body_roles": ["paint_primary", "tyre", "decal_a", "decal_b"],
    "colours": {"decal_a": "#ffdf28", "decal_b": "#ff3ca0"},
}

_bike_lib.build(CONFIG)
