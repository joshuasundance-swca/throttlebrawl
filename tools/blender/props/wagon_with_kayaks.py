"""Long-roof station wagon with paired pointed kayaks."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pnw_traffic import build

build("wagon", 4.8, 1.8, 2.1, 3.1, "car", 0.93, 1.0)
