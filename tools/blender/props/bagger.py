"""Original AI-scripted bagger: bagger silhouette, metres, front glTF +Z.

Build through tools/blender/build.mjs. Tuning and palette below; construction in _bike_lib.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {"style": "bagger", "class": "chopper", "wheelbase": 1.65, "seat_height": 0.7, "paint": "#ff6a19"}

_bike_lib.build(CONFIG)
