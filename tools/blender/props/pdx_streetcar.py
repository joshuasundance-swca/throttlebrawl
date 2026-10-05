"""Modern articulated low-floor streetcar with a folded pantograph."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pnw_traffic import build

build("streetcar", 20, 2.5, 3.9, 13.4, "bus", 1.25, 9.84)
