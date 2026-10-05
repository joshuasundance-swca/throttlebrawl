"""An invented white driverless car with a roof sensor dome and corner pods."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _sf_traffic import build

build("robotaxi", 4.8, 1.9, 1.9, 2.9)
