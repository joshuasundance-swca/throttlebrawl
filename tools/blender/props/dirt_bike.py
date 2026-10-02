"""Original AI-scripted dirt_bike: dirt silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {"style": "dirt", "class": "dirt", "wheelbase": 1.48, "seat_height": 0.9, "paint": "#ff7136", "radius": 0.34}

_bike_lib.build(CONFIG)
