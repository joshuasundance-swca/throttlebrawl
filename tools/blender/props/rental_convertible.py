"""Top-down island rental: two exposed seats, a raked screen and no brand cues."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _vehicle_lib import COLOURS, arch_body, lamps, polygon, wheels

LENGTH, WIDTH, HEIGHT, WHEELBASE = 4.7, 1.85, 1.35, 2.8
HOOD_TOP, HOOD_BACK, HOOD_FRONT = 0.83, 0.80, 2.26

reset_scene()
colours = dict(COLOURS, paint_secondary="#334752")
mats = make_mats(colours)
mb = MB(mats)
root = empty("vehicle")
for key, value in {"length_m": LENGTH, "width_m": WIDTH, "height_m": HEIGHT,
                   "wheelbase_m": WHEELBASE, "hood_top_m": HOOD_TOP,
                   "hood_back_m": HOOD_BACK, "hood_front_m": HOOD_FRONT, "class": "car"}.items():
    root[key] = value
# Four separate lower panels leave an actual open cockpit, not a dark roof painted onto a car.
# The arch body stops at the sill; only hood and rear deck rise to HOOD_TOP.
arch_body(mb, LENGTH, WIDTH, 0.62, 0.30, [-WHEELBASE / 2, WHEELBASE / 2])
mb.box(HOOD_BACK, LENGTH / 2, -WIDTH / 2, WIDTH / 2, 0.62, HOOD_TOP, "paint_primary")
mb.box(-LENGTH / 2, -0.98, -WIDTH / 2, WIDTH / 2, 0.62, 0.84, "paint_primary")
for side in (-1, 1):
    x = side * (WIDTH / 2 - 0.06)
    mb.box(-0.98, HOOD_BACK, x - 0.06, x + 0.06, 0.62, 0.87, "paint_primary")
    sx = side * 0.43
    polygon(mb, [(sx - 0.31, -0.58, 0.77), (sx + 0.31, -0.58, 0.77),
                 (sx + 0.31, 0.13, 0.77), (sx - 0.31, 0.13, 0.77)], "paint_secondary", (0, 0, 1))
    mb.box(-0.68, -0.53, sx - 0.31, sx + 0.31, 0.74, 1.12, "paint_secondary")
# Closed thin screen prism, including both glass faces: it remains readable from the rear.
mb.xprism([(0.75, 0.87), (0.80, 0.87), (0.49, HEIGHT), (0.44, HEIGHT)],
          -0.79, 0.79, "glass")
for side in (-1, 1):
    mb.tube([(side * 0.79, 0.77, 0.88), (side * 0.79, 0.47, HEIGHT)],
            [0.035, 0.035], "trim", sides=4)
polygon(mb, [(-0.82, 0.41, HEIGHT), (0.82, 0.41, HEIGHT),
             (0.82, 0.49, HEIGHT - 0.035), (-0.82, 0.49, HEIGHT - 0.035)], "trim", (0, 0, 1))
polygon(mb, [(-0.79, 0.47, 0.88), (0.79, 0.47, 0.88),
             (0.79, 0.73, 0.88), (-0.79, 0.73, 0.88)], "trim", (0, 0, 1))
# Small steering-wheel silhouette; the seat is visibly on the driver's (+X) side.
mb.cyl((0.43, 0.33, 0.96), "f", 0.13, 0.025, 4, "trim")
wheels(mb, WIDTH, 0.30, [-WHEELBASE / 2, WHEELBASE / 2])
lamps(mb, root, LENGTH, WIDTH, HOOD_TOP)
polygon(mb, [(-0.45, LENGTH / 2 + 0.002, 0.44), (0.45, LENGTH / 2 + 0.002, 0.44),
             (0.45, LENGTH / 2 + 0.002, 0.59), (-0.45, LENGTH / 2 + 0.002, 0.59)], "trim", (0, 1, 0))
empty("hood", root, P(0, (HOOD_FRONT + HOOD_BACK) / 2, HOOD_TOP))
mb.build("vehicle_body", mats, root)
export(out_path(), texcoords=False, normals=False)
