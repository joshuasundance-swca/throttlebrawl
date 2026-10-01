"""throttlebrawl prop: one timber trestle bent, the repeating frame under a timber trestle bridge.

Run: blender --background --factory-startup --python-exit-code 1 --python trestle_bent.py -- --out <path>.glb

The root empty `trestle_bent` sits on the ground (or the river bed) under the middle of the
deck. One mesh child, `trestle_bent_body`: two plumb posts and two battered outer posts on a
sill, a cap beam that carries the deck, a girt halfway up and X bracing across the face. It is
10 m tall as authored; the game stretches it in height to reach each deck and repeats it every
few metres along the bridge, across the road (the bent's face is the prop's x, z plane).
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
HEIGHT = 10.0          # the cap beam's top (m); the game scales this to the deck
CAP_HALF = 6.4         # the cap beam's half length (x, m): under the deck and its verges
POST = 0.32            # post size (square, m)
INNER_X = 2.4          # the plumb posts
OUTER_TOP_X = 5.6      # the battered posts at the cap
OUTER_FOOT_X = 7.4     # ... and at the sill
BRACE = 0.18

COLOURS = {
    "wood": "#4f3f31",   # dark creosoted timber
    "frame": "#2f2924",  # the cap and the sill
}


def build(mb):
    cap0 = HEIGHT - 0.5
    mb.box(-0.3, 0.3, -CAP_HALF, CAP_HALF, cap0, HEIGHT, "frame")
    mb.box(-0.35, 0.35, -OUTER_FOOT_X - 0.4, OUTER_FOOT_X + 0.4, 0.0, 0.4, "frame")
    for sx in (-1, 1):
        x = sx * INNER_X
        mb.box(-POST / 2, POST / 2, x - POST / 2, x + POST / 2, 0.4, cap0, "wood")
        mb.tube([(sx * OUTER_FOOT_X, 0.0, 0.4), (sx * OUTER_TOP_X, 0.0, cap0)], [POST / 2, POST / 2], "wood",
                sides=4)
    girt = HEIGHT * 0.5
    mb.box(-0.12, 0.12, -6.6, 6.6, girt - 0.15, girt + 0.15, "wood")
    # X bracing on the face, one pair below the girt and one above, slightly proud of the posts
    for z0, z1 in ((0.6, girt - 0.2), (girt + 0.2, cap0 - 0.1)):
        xa = OUTER_FOOT_X - (OUTER_FOOT_X - OUTER_TOP_X) * (z0 / cap0)
        xb = OUTER_FOOT_X - (OUTER_FOOT_X - OUTER_TOP_X) * (z1 / cap0)
        for s in (-1, 1):
            mb.tube([(s * xa, 0.22, z0), (-s * xb, 0.22, z1)], [BRACE / 2, BRACE / 2], "wood", sides=4)


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    root = _lib.empty("trestle_bent")
    mb = _lib.MB(list(COLOURS))
    build(mb)
    mb.build("trestle_bent_body", mats, root)
    _lib.export(out)


main()
