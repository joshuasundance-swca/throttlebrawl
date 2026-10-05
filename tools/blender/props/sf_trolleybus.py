"""An unbranded electric city bus with paired trolley poles."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _sf_traffic import build

build("trolleybus", 12.2, 2.55, 3.3, 7.8)
