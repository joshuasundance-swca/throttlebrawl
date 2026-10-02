"""Original AI-scripted streetfighter_750: fighter silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {"style": "fighter", "class": "sport", "wheelbase": 1.46, "seat_height": 0.81, "paint": "#a7ed28"}

_bike_lib.build(CONFIG)
