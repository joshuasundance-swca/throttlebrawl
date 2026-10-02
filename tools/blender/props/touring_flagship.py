"""Original AI-scripted touring flagship; long low cruiser with flags."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bike_lib

CONFIG = {
    "style": "flagship",
    "class": "chopper",
    "wheelbase": 1.72,
    "seat_height": 0.72,
    "paint": "#493978",
    "colours": {"paint_secondary": "#edc66a"},
}

_bike_lib.build(CONFIG)
