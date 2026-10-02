"""Original AI-scripted superbike_1000: sport silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {"style": "sport", "class": "super", "wheelbase": 1.43, "seat_height": 0.84, "paint": "#ed304c"}

_bike_lib.build(CONFIG)
