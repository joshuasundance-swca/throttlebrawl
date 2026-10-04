"""Pickup, trailer and centre-console boat, baked into one traffic body."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _vehicle_lib import COLOURS, cabin, polygon, wheels

LENGTH, WIDTH, HEIGHT, WHEELBASE = 11.0, 2.4, 2.6, 7.9
HOOD_TOP, HOOD_BACK, HOOD_FRONT = 1.20, 4.04, 5.41

reset_scene()
mats = make_mats(dict(COLOURS, paint_secondary="#536a76"))
mb = MB(mats)
root = empty("vehicle")
for key, value in {"length_m": LENGTH, "width_m": WIDTH, "height_m": HEIGHT,
                   "wheelbase_m": WHEELBASE, "hood_top_m": HOOD_TOP,
                   "hood_back_m": HOOD_BACK, "hood_front_m": HOOD_FRONT, "class": "truck"}.items():
    root[key] = value
# The combined wheelbase runs between the pickup's front axle (+3.95) and trailer axle (-3.95).
# The root remains its road-level midpoint; the pickup itself is forward of that origin.
mb.box(0.10, 5.50, -1.1, 1.1, 0.42, 0.84, "paint_primary")
mb.box(HOOD_BACK, 5.50, -1.1, 1.1, 0.84, HOOD_TOP, "paint_primary")
cabin(mb, 2.2, HOOD_TOP, 1.98, 1.53, 1.65, 3.60, HOOD_BACK)
# Open bed behind the crew cab; a low dark floor and three painted walls.
mb.box(0.20, 1.48, -0.91, 0.91, 0.84, 0.88, "trim")
for side in (-1, 1):
    x = side * 1.04
    mb.box(0.1, 1.5, x - 0.06, x + 0.06, 0.84, 1.24, "paint_primary")
mb.box(0.10, 0.23, -1.1, 1.1, 0.84, 1.24, "paint_primary")
wheels(mb, 2.2, 0.36, [0.95, 3.95])
# Trailer tongue and paired longitudinal rails, with a visible single axle under the hull.
mb.box(-1.15, 0.10, -0.10, 0.10, 0.38, 0.47, "trim")
for side in (-1, 1):
    x = side * 0.68
    mb.box(-5.5, -1.05, x - 0.06, x + 0.06, 0.48, 0.61, "trim")
mb.box(-4.05, -3.85, -1.17, 1.17, 0.31, 0.41, "trim")
wheels(mb, WIDTH, 0.31, [-3.95])
# Faceted V-bottom hull: a narrow keel, chine and gunwale; bow forward toward the pickup.
mb.loft([[P(-0.88, -5.12, 0.96), P(0, -5.12, 0.66), P(0.88, -5.12, 0.96),
          P(1.05, -5.12, 1.48), P(-1.05, -5.12, 1.48)],
         [P(-0.92, -3.00, 0.96), P(0, -3.00, 0.68), P(0.92, -3.00, 0.96),
          P(1.08, -3.00, 1.48), P(-1.08, -3.00, 1.48)],
         [P(-0.04, -1.00, 1.20), P(0, -1.00, 1.05), P(0.04, -1.00, 1.20),
          P(0.08, -1.00, 1.48), P(-0.08, -1.00, 1.48)]], "paint_secondary")
# A shallow open cockpit over the solid structural hull; coaming, transom and centre console.
mb.box(-4.92, -2.1, -0.89, 0.89, 1.48, 1.495, "trim")
for side in (-1, 1):
    x = side * 0.98
    mb.box(-5.1, -2.3, x - 0.09, x + 0.09, 1.48, 1.69, "paint_primary")
mb.box(-5.12, -4.98, -1.05, 1.05, 1.48, 1.69, "paint_primary")
mb.box(-3.52, -2.78, -0.36, 0.36, 1.50, 2.12, "paint_primary")
mb.box(-3.23, -2.82, -0.36, 0.36, 2.12, 2.32, "glass")
mb.box(-4.15, -3.65, -0.5, 0.5, 1.5, 1.85, "paint_primary")
# A small console T-top keeps the silhouette at the stated 2.6 m height.
for side in (-1, 1):
    mb.tube([(side * 0.31, -3.4, 1.72), (side * 0.31, -3.4, 2.53)],
            [0.035, 0.035], "trim", sides=4)
mb.box(-3.9, -2.45, -0.67, 0.67, 2.53, HEIGHT, "paint_secondary")
mb.box(-5.47, -5.16, -0.30, 0.30, 0.87, 1.78, "trim")
for end, f, role, z in ((1, 5.503, "light_head", 0.98), (-1, -5.503, "light_tail", 0.53)):
    for side, suffix in ((1, "l"), (-1, "r")):
        x = side * 0.85
        polygon(mb, [(x - 0.14, f, z - 0.065), (x + 0.14, f, z - 0.065),
                     (x + 0.14, f, z + 0.065), (x - 0.14, f, z + 0.065)], role, (0, end, 0))
        empty(f"{role}_{suffix}", root, P(x, f, z))
empty("hood", root, P(0, (HOOD_BACK + HOOD_FRONT) / 2, HOOD_TOP))
mb.build("vehicle_body", mats, root)
export(out_path(), texcoords=False, normals=False)
