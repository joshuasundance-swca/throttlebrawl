"""High-roof camper van with a pop-top and roof canoe."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pnw_traffic import build

build("camper", 6.6, 2.2, 3.0, 4.1, "truck", 1.05, 2.45)
