"""throttlebrawl prop: a Pacific Northwest sawmill set piece.

Run: blender --background --factory-startup --python-exit-code 1 --python sawmill.py -- --out <path>.glb

The root empty `sawmill` sits on the ground at the middle of the yard's front edge; the yard
faces the prop's front (glTF +Z), which the game turns toward the road. One mesh child,
`sawmill_body`: a long gabled mill shed, a teepee (wigwam) burner with its mesh dome, a
conveyor from the shed up to the burner, a smokestack, two pyramids of logs and stacks of
sawn lumber in the yard. It stands well back from the road on the sawmill side. Flat colours
only: weathered boards and galvanised roofs, no rust (the maintainer's call on grime).
"""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
SHED = dict(x0=-14.0, x1=6.0, f0=-16.0, f1=-5.0, wall=7.0, ridge=10.5)
BURNER = dict(x=13.0, f=-10.0, r0=4.6, r1=1.7, h=13.0, dome=2.6)
STACK = dict(x=-11.0, f=-14.0, r=0.55, h=17.0)
LOG_R = 0.42
LOG_LEN = 8.0

COLOURS = {
    "body": "#8d8473",       # weathered board walls
    "roof": "#66706f",       # galvanised roofs
    "frame": "#3d3b39",      # the burner's steel, the stack, the conveyor
    "trim": "#e9e2cf",       # doors and the shed's trim
    "bark": "#5f4a3a",       # logs
    "wood": "#c9a77a",       # sawn lumber
}


def shed(mb):
    s = SHED
    mb.box(s["f0"], s["f1"], s["x0"], s["x1"], 0.0, s["wall"], "body")
    mid = (s["f0"] + s["f1"]) / 2
    half = (s["f1"] - s["f0"]) / 2
    # gable ends (the ridge runs along x), then the two roof slabs with an overhang
    for x in (s["x0"], s["x1"]):
        a, b = sorted((x, x + (0.02 if x == s["x0"] else -0.02)))
        mb.xprism([(s["f0"], s["wall"]), (s["f1"], s["wall"]), (mid, s["ridge"])], a, b, "body")
    over = 0.5
    drop = (s["ridge"] - s["wall"]) * (half + over) / half
    for sf in (-1, 1):
        edge = mid + sf * (half + over)
        prof = [(mid, s["ridge"] + 0.15), (edge, s["ridge"] + 0.15 - drop), (edge, s["ridge"] - drop),
                (mid, s["ridge"])]
        mb.xprism(prof, s["x0"] - over, s["x1"] + over, "roof")
    # big doors on the yard side, a lean-to over the log infeed at the west end
    for xc in (-9.0, -1.5):
        mb.front_quad(s["f1"] + 0.02, xc - 2.0, xc + 2.0, 0.0, 4.6, "trim")
    mb.xprism([(s["f1"], 5.2), (s["f1"] + 4.0, 4.0), (s["f1"] + 4.0, 3.8), (s["f1"], 5.0)], s["x0"], s["x0"] + 7.0,
              "roof")
    for x in (s["x0"] + 0.3, s["x0"] + 6.7):
        mb.box(s["f1"] + 3.7, s["f1"] + 3.9, x - 0.1, x + 0.1, 0.0, 4.0, "frame")


def burner(mb):
    b = BURNER
    mb.cyl((b["x"], b["f"], b["h"] / 2), "z", b["r0"], b["h"] / 2, 10, "frame", r_top=b["r1"])
    mb.blob((b["x"], b["f"], b["h"] + 0.6), (b["r1"] * 1.15, b["r1"] * 1.15, b["dome"] * 0.55), "frame")
    # the conveyor from the shed's east end up to the burner's top
    top = (b["x"] - b["r1"] - 0.3, b["f"], b["h"] - 0.3)
    foot = (SHED["x1"] - 1.0, b["f"], SHED["wall"] + 1.0)
    mb.tube([foot, top], [0.45, 0.45], "frame", sides=4, phase=math.pi / 4)
    mb.box(b["f"] - 0.15, b["f"] + 0.15, (foot[0] + top[0]) / 2 - 0.15, (foot[0] + top[0]) / 2 + 0.15, 0.0,
           (foot[2] + top[2]) / 2, "frame")


def stack(mb):
    s = STACK
    mb.cyl((s["x"], s["f"], s["h"] / 2), "z", s["r"], s["h"] / 2, 8, "frame", r_top=s["r"] * 0.8)


def log_pile(mb, xc, fc, rows):
    """A pyramid of logs along x: `rows` logs at the bottom, one fewer each row up."""
    for row in range(rows):
        n = rows - row
        z = LOG_R + row * LOG_R * 1.7
        for k in range(n):
            f = fc + (k - (n - 1) / 2) * LOG_R * 2.05
            mb.cyl((xc, f, z), "x", LOG_R, LOG_LEN / 2, 6, "bark", phase=(k + row) * 0.4)


def lumber(mb, xc, fc, h):
    for i in range(3):
        f = fc + i * 1.6
        mb.box(f, f + 1.3, xc - 2.2, xc + 2.2, 0.15, h - 0.2 * i, "wood")
        mb.box(f + 0.1, f + 1.2, xc - 1.9, xc - 1.7, 0.0, 0.15, "frame")
        mb.box(f + 0.1, f + 1.2, xc + 1.7, xc + 1.9, 0.0, 0.15, "frame")


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, rough={"roof": 0.6})
    root = _lib.empty("sawmill")
    mb = _lib.MB(list(COLOURS))
    shed(mb)
    burner(mb)
    stack(mb)
    log_pile(mb, -9.0, -1.5, 3)
    log_pile(mb, -0.5, -1.0, 2)
    lumber(mb, 7.5, -3.5, 1.6)
    mb.build("sawmill_body", mats, root)
    # Faceted: the game rebuilds each face's normal from its corners (models.ts), so none ship.
    _lib.export(out, normals=False)


main()
