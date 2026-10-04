"""Class-A motorhome with rear ladder and an actual bicycle on its carrier."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _vehicle_lib import COLOURS, lamps, wheels

LENGTH, WIDTH, HEIGHT, WHEELBASE = 11.0, 2.55, 3.6, 6.5
HOOD_TOP, HOOD_BACK, HOOD_FRONT = 0.70, 5.20, 5.41

reset_scene()
mats = make_mats(dict(COLOURS, paint_secondary="#476779"))
mb = MB(mats)
root = empty("vehicle")
for key, value in {"length_m": LENGTH, "width_m": WIDTH, "height_m": HEIGHT,
                   "wheelbase_m": WHEELBASE, "hood_top_m": HOOD_TOP,
                   "hood_back_m": HOOD_BACK, "hood_front_m": HOOD_FRONT, "class": "bus"}.items():
    root[key] = value
root["hood_note"] = "Front bumper top; this class-A cab has no projecting hood."
mb.box(-5.13, 5.50, -WIDTH / 2, WIDTH / 2, 0.44, 1.07, "paint_primary")
mb.fprism([(-WIDTH/2, 1.07), (WIDTH/2, 1.07), (WIDTH/2, 3.42),
           (WIDTH/2-0.12, HEIGHT), (-WIDTH/2+0.12, HEIGHT), (-WIDTH/2, 3.42)],
          -5.13, 5.50, "paint_primary")
mb.front_quad(5.503, -1.1, 1.1, 1.62, 3.22, "glass")
# Separate living-area windows in painted walls, rather than a full-height bus glass band.
for side in (-1, 1):
    x = side * (WIDTH / 2 + 0.003)
    for f in (-3.4, -0.9, 1.6, 3.8):
        mb.side_quad(x, f - 0.72, f + 0.72, 1.76, 2.74, "glass", side)
    mb.side_quad(side * (WIDTH / 2 + 0.002), -5.04, 5.35, 0.87, 1.02, "paint_secondary", side)
    mb.side_quad(x, -4.83, -4.19, 1.08, 2.7, "paint_secondary", side)
wheels(mb, WIDTH, 0.44, [-WHEELBASE / 2, WHEELBASE / 2])
# Rear ladder offset from the bicycle; five rungs and two vertical rails reach the roof.
for x in (0.78, 1.13):
    mb.box(-5.27, -5.20, x - 0.035, x + 0.035, 0.87, 3.5, "trim")
for z in (1.0, 1.48, 1.96, 2.44, 2.92, 3.4):
    mb.box(-5.27, -5.20, 0.76, 1.15, z - 0.025, z + 0.025, "trim")
mb.box(-5.50, -5.15, -1.13, 0.5, 0.56, 0.64, "trim")
# Bicycle lies transversely on the rear rack: two six-sided wheels and a triangular frame.
for x in (-0.81, 0.21):
    mb.cyl((x, -5.36, 1.07), "f", 0.27, 0.045, 6, "tyre")
for a, b in [((-0.81, -5.36, 1.07), (-0.33, -5.36, 1.14)),
             ((-0.33, -5.36, 1.14), (-0.50, -5.36, 1.67)),
             ((-0.50, -5.36, 1.67), (-0.81, -5.36, 1.07)),
             ((-0.50, -5.36, 1.67), (0.03, -5.36, 1.58)),
             ((0.03, -5.36, 1.58), (-0.33, -5.36, 1.14)),
             ((0.03, -5.36, 1.58), (0.21, -5.36, 1.07))]:
    mb.tube([a, b], [0.027, 0.027], "paint_secondary", sides=3)
mb.box(-5.40, -5.32, -0.66, -0.36, 1.67, 1.73, "trim")
mb.box(-5.40, -5.32, -0.07, 0.25, 1.70, 1.75, "trim")
lamps(mb, root, LENGTH, WIDTH, 0.85)
# The marker and extra describe the real upper face of the projecting front bumper.
mb.box(5.20, 5.5, -0.93, 0.93, 0.65, HOOD_TOP, "paint_primary")
empty("hood", root, P(0, (HOOD_BACK + HOOD_FRONT) / 2, HOOD_TOP))
mb.build("vehicle_body", mats, root)
export(out_path(), texcoords=False, normals=False)
