"""Streamlined 1940s-style streetcar: invented two-tone paint and one roof trolley pole."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _sf_traffic import build

build("streetcar", 14.0, 2.6, 3.2, 9.8)
