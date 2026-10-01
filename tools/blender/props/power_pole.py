"""throttlebrawl prop: a wooden roadside power pole with a crossarm and three insulators.

Run: blender --background --factory-startup --python-exit-code 1 --python power_pole.py -- --out <path>.glb

The root empty `power_pole` stands on the ground at the pole's foot. One mesh child,
`power_pole_body` (wood, trim): two draws. The crossarm runs across the pole (glTF X), so the
wires run along glTF Z, the way the road runs past it. Three empties, `wire_attach_1` to
`wire_attach_3`, mark where each wire touches an insulator (left to right in X); the game draws
the sagging wires between neighbouring poles' matching attach points. The root carries the
extra `wire_attach_count` = 3.
"""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
HEIGHT = 10.5           # pole top (m)
R_BASE, R_TOP = 0.17, 0.12
SIDES = 6
ARM_Z = 9.7             # crossarm centre height
ARM_HALF = 1.25         # crossarm half length (x)
ARM_T = (0.1, 0.12)     # crossarm thickness (f, z)
LEAN = 0.12             # the pole leans this far at the top (m, toward -x): old poles lean
INSULATOR_X = (-1.05, 1.05)   # on the crossarm; the third sits on the pole top
INS_R, INS_H = 0.07, 0.22

COLOURS = {
    "wood": "#6b5a47",   # creosote-weathered pole and arm
    "trim": "#9fb8ac",   # pale green-grey glass insulators
}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    root = _lib.empty("power_pole")
    root["wire_attach_count"] = 3
    mb = _lib.MB(["wood", "trim"])

    def lean_x(z):
        return -LEAN * (z / HEIGHT)

    # pole: one tapered six-sided segment with its top a little off plumb
    mb.tube([(0.0, 0.0, 0.0), (lean_x(HEIGHT), 0.0, HEIGHT)], [R_BASE, R_TOP], "wood", sides=SIDES, phase=0.0)
    # crossarm and its two diagonal braces
    ax = lean_x(ARM_Z)
    mb.box(-ARM_T[0] / 2 - R_TOP, ARM_T[0] / 2 - R_TOP, ax - ARM_HALF, ax + ARM_HALF, ARM_Z - ARM_T[1] / 2,
           ARM_Z + ARM_T[1] / 2, "wood")
    for sx in (-1, 1):
        mb.tube([(lean_x(ARM_Z - 0.75), -R_TOP, ARM_Z - 0.75), (ax + sx * 0.7, -R_TOP, ARM_Z - 0.05)],
                [0.03, 0.03], "wood", sides=4)
    # insulators: two on the arm, one on the pole top; each attach point is an insulator's tip
    tips = []
    for x in INSULATOR_X:
        base_z = ARM_Z + ARM_T[1] / 2
        mb.cyl((ax + x, -R_TOP, base_z + INS_H / 2), "z", INS_R, INS_H / 2, 6, "trim", phase=math.pi / 6,
               r_top=INS_R * 0.6)
        tips.append((ax + x, -R_TOP, base_z + INS_H))
    top_x = lean_x(HEIGHT)
    mb.cyl((top_x, 0.0, HEIGHT + INS_H / 2), "z", INS_R, INS_H / 2, 6, "trim", phase=math.pi / 6,
           r_top=INS_R * 0.6)
    tips.insert(1, (top_x, 0.0, HEIGHT + INS_H))
    mb.build("power_pole_body", mats, root)
    for k, (x, f, z) in enumerate(sorted(tips), start=1):
        _lib.empty(f"wire_attach_{k}", parent=root, loc=_lib.P(x, f, z))
    _lib.export(out)


main()
