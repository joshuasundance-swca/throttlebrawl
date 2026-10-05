"""Bunk truck and pole trailer carrying faceted logs."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pnw_traffic import build

build("logger", 16, 2.6, 3.9, 13.3, "truck", 2.0, 5.6)
