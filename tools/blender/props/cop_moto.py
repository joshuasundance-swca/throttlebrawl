"""Original AI-scripted cop_moto: cop silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "cop",
    "class": "rat",
    "wheelbase": 1.59,
    "seat_height": 0.78,
    "paint": "#faf1dd",
    "body_roles": ["paint_primary", "paint_secondary", "light_red", "light_blue"],
    "colours": {"paint_secondary": "#20232c", "light_red": "#fa2949", "light_blue": "#2374ff"},
}

_bike_lib.build(CONFIG)
