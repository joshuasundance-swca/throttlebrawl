"""Original AI-scripted rustbucket_400: standard silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "standard",
    "class": "rat",
    "wheelbase": 1.44,
    "seat_height": 0.77,
    "paint": "#b74b43",
    "colours": {"paint_secondary": "#789d92"},
}

_bike_lib.build(CONFIG)
