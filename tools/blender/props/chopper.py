"""Original AI-scripted chopper: chopper silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "chopper",
    "class": "chopper",
    "wheelbase": 1.9,
    "seat_height": 0.67,
    "paint": "#ac39ce",
    "body_roles": ["paint_primary", "tyre"],
    "colours": {},
}

_bike_lib.build(CONFIG)
