"""Builds one rider GLB: blender --background --python build_rider.py -- --rider <id> --out <path>.

Run it through tools/blender/riders/build.mjs, which builds each rider twice and checks the two
GLBs are byte-identical.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cast  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
rider = argv[argv.index("--rider") + 1]
out = argv[argv.index("--out") + 1]
cast.build(rider, out)
