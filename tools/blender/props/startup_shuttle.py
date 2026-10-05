"""A plain white commuter coach, tinted windows and no markings."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _sf_traffic import build

build("shuttle", 11.0, 2.6, 3.4, 7.4)
