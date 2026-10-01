"""throttlebrawl prop: a San Francisco cable car (a generic double-ended grip car).

Run: blender --background --factory-startup --python-exit-code 1 --python cable_car.py -- --out <path>.glb

The root empty `cable_car` sits on the road at the middle of the car; its front faces the
prop's front (glTF +Z). One mesh child, `cable_car_body`: an enclosed cabin in the middle with
open bench sections at both ends, a clerestory roof, running boards and small wheels. The game
draws it as the region's cable-car traffic, scaled to the traffic type's length and width.
Maroon and cream, with gold trim; flat colours only.
"""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
HALF_L = 4.25          # half the car's length (f, m)
HALF_W = 1.25          # half the body's width (x, m)
CABIN_F = 2.0          # the enclosed cabin runs from -CABIN_F to +CABIN_F
FLOOR_Z = (0.62, 0.78)
WAIST_Z = 1.55         # maroon below, cream above
EAVE_Z = 2.62
ROOF_T = 0.14
CLERESTORY = (0.32, 0.72)   # height and half-width of the raised roof's middle
WHEEL_R = 0.33
WHEEL_F = 2.7

COLOURS = {
    "body": "#8c2f2f",       # maroon lower panels
    "body_alt": "#e9dcb0",   # cream upper panels and posts
    "trim": "#d9b45a",       # gold trim bands
    "roof": "#3f3b37",
    "glass": "#2e3a44",
    "wood": "#7a5a3a",       # benches, floor, running boards
    "tyre": "#1d1d1d",       # wheels and trucks
    "light_head": "#fff4cf",
}


def build(mb):
    w = HALF_W
    # running gear: two trucks and four small wheels, then the floor
    for sf in (-1, 1):
        mb.box(sf * WHEEL_F - 0.8, sf * WHEEL_F + 0.8, -0.95, 0.95, 0.25, FLOOR_Z[0], "tyre")
        for sx in (-1, 1):
            mb.cyl((sx * 0.85, sf * WHEEL_F, WHEEL_R), "x", WHEEL_R, 0.09, 6, "tyre")
    mb.box(-HALF_L, HALF_L, -w, w, *FLOOR_Z, "wood")
    for sx in (-1, 1):
        a, b = sorted((sx * w, sx * (w + 0.22)))
        mb.box(-HALF_L + 0.2, HALF_L - 0.2, a, b, 0.42, 0.52, "wood")
    # the enclosed cabin: maroon to the waist, cream above, a gold band between, windows each side
    mb.box(-CABIN_F, CABIN_F, -w, w, FLOOR_Z[1], WAIST_Z, "body")
    mb.box(-CABIN_F, CABIN_F, -w, w, WAIST_Z, EAVE_Z, "body_alt")
    mb.box(-CABIN_F - 0.02, CABIN_F + 0.02, -w - 0.02, w + 0.02, WAIST_Z - 0.06, WAIST_Z + 0.06, "trim")
    n = 4
    for k in range(n):
        f0 = -CABIN_F + 0.2 + k * (2 * CABIN_F - 0.4) / n
        f1 = f0 + (2 * CABIN_F - 0.4) / n - 0.18
        for sx in (-1, 1):
            mb.side_quad(sx * (w + 0.01), f0, f1, WAIST_Z + 0.18, EAVE_Z - 0.2, "glass", sx)
    # bulkhead windows at both ends of the cabin (x reversed turns a panel to face the back)
    mb.front_quad(CABIN_F + 0.01, -0.6, 0.6, WAIST_Z + 0.18, EAVE_Z - 0.2, "glass")
    mb.front_quad(-CABIN_F - 0.01, 0.6, -0.6, WAIST_Z + 0.18, EAVE_Z - 0.2, "glass")
    # the open ends: outward-facing benches, a low dash at each end, corner and middle posts
    for sf in (-1, 1):
        f_in, f_out = sorted((sf * CABIN_F, sf * (HALF_L - 0.25)))
        mb.box(f_in, f_out, -0.35, 0.35, FLOOR_Z[1], FLOOR_Z[1] + 0.95, "wood")
        mb.box(f_in, f_out, -0.5, 0.5, FLOOR_Z[1] + 0.4, FLOOR_Z[1] + 0.5, "wood")
        end_a, end_b = sorted((sf * (HALF_L - 0.25), sf * HALF_L))
        mb.box(end_a, end_b, -w, w, FLOOR_Z[1], WAIST_Z, "body")
        mb.box(end_a, end_b, -w, w, WAIST_Z - 0.06, WAIST_Z + 0.06, "trim")
        for x in (-w + 0.07, w - 0.07):
            for f in (sf * (HALF_L - 0.12), sf * (CABIN_F + (HALF_L - CABIN_F) / 2)):
                mb.box(f - 0.06, f + 0.06, x - 0.06, x + 0.06, FLOOR_Z[1], EAVE_Z, "body_alt")
        # a destination board under the eave, and a headlight on the dash
        mb.box(end_a, end_b, -0.7, 0.7, EAVE_Z - 0.38, EAVE_Z - 0.05, "trim")
        lf = sf * (HALF_L + 0.02)
        mb.cyl((0.0, lf, WAIST_Z - 0.35), "f", 0.16, 0.04, 6, "light_head", phase=math.pi / 6)
    # the roof: a wide deck with a raised clerestory down the middle
    mb.box(-HALF_L - 0.1, HALF_L + 0.1, -w - 0.12, w + 0.12, EAVE_Z, EAVE_Z + ROOF_T, "roof")
    h, hw = CLERESTORY
    mb.box(-HALF_L + 0.6, HALF_L - 0.6, -hw, hw, EAVE_Z + ROOF_T, EAVE_Z + ROOF_T + h, "roof")
    for sx in (-1, 1):
        mb.side_quad(sx * (hw + 0.01), -HALF_L + 0.9, HALF_L - 0.9, EAVE_Z + ROOF_T + 0.08,
                     EAVE_Z + ROOF_T + h - 0.08, "body_alt", sx)
    # the grip lever by the front bench
    mb.box(CABIN_F + 0.35, CABIN_F + 0.45, -0.05, 0.05, FLOOR_Z[1], FLOOR_Z[1] + 1.5, "trim")


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, rough={"trim": 0.5})
    root = _lib.empty("cable_car")
    mb = _lib.MB(list(COLOURS))
    build(mb)
    mb.build("cable_car_body", mats, root)
    _lib.export(out)


main()
