"""An invented open island tram: jeep-like lead unit and three canopy bench cars."""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _vehicle_lib import COLOURS, polygon

LENGTH, WIDTH, HEIGHT, WHEELBASE = 18.0, 2.4, 3.0, 15.6
HOOD_TOP, HOOD_BACK, HOOD_FRONT = 1.30, 7.55, 8.91

reset_scene()
mats = make_mats(dict(COLOURS, paint_secondary="#516879"))
mb = MB(mats)
root = empty("vehicle")
for key, value in {"length_m": LENGTH, "width_m": WIDTH, "height_m": HEIGHT,
                   "wheelbase_m": WHEELBASE, "hood_top_m": HOOD_TOP,
                   "hood_back_m": HOOD_BACK, "hood_front_m": HOOD_FRONT, "class": "bus"}.items():
    root[key] = value


def canopy(front, back, roof):
    mb.box(back, front, -WIDTH / 2, WIDTH / 2, roof - 0.12, roof, "paint_secondary")
    # Narrow central posts support the open cars without walling their sides in.
    for side in (-1, 1):
        x = side * 0.97
        mb.box((front + back) / 2 - 0.04, (front + back) / 2 + 0.04,
               x - 0.045, x + 0.045, 0.65, roof - 0.12, "trim")
        # Scalloped geometric fringe, no lettering, no company livery.
        points = [(side * 1.201, back, roof - 0.12), (side * 1.201, front, roof - 0.12)]
        points += [(side * 1.201, front - (front - back) * i / 4,
                    roof - (0.23 if i % 2 == 0 else 0.16)) for i in range(5)]
        polygon(mb, points, "paint_secondary", (side, 0, 0))


for centre in (-6.7, -2.1, 2.5):
    front, back = centre + 2.1, centre - 2.1
    mb.box(back, front, -1.10, 1.10, 0.50, 0.65, "paint_primary")
    canopy(front, back, HEIGHT)
    for seat_f in (centre - 1.1, centre + 0.70):
        mb.box(seat_f - 0.35, seat_f + 0.35, -0.93, 0.93, 0.86, 1.0, "paint_secondary")
        mb.box(seat_f - 0.40, seat_f - 0.28, -0.93, 0.93, 0.98, 1.51, "paint_secondary")
    for side in (-1, 1):
        mb.side_quad(side * 1.10, back, front, 0.66, 0.82, "paint_primary", side)
    # Each coupler crosses the gap to the next body, all baked into vehicle_body.
    mb.box(front, front + 0.40, -0.09, 0.09, 0.45, 0.54, "trim")
mb.box(-8.8, -8.68, -1.1, 1.1, 0.65, 1.10, "paint_primary")
# A short broad hood, vertical grille and upright windscreen distinguish the locomotive.
mb.box(5.0, 9.0, -1.1, 1.1, 0.50, 0.75, "paint_primary")
mb.box(HOOD_BACK, 9.0, -0.97, 0.97, 0.75, HOOD_TOP, "paint_primary")
canopy(7.58, 5.00, 2.67)
mb.box(5.90, 6.65, -0.88, 0.88, 0.86, 1.01, "paint_secondary")
mb.box(5.78, 5.91, -0.88, 0.88, 1.0, 1.58, "paint_secondary")
mb.box(7.40, 7.47, -0.93, 0.93, 1.31, 2.4, "glass")
mb.front_quad(9.003, -0.52, 0.52, 0.80, 1.20, "trim")
for axle in (-7.8, -5.6, -3.2, -1.0, 1.4, 3.6, 5.6, 7.8):
    for side in (-1, 1):
        mb.cyl((side * 1.03, axle, 0.36), "x", 0.36, 0.09, 6, "tyre", phase=math.pi / 6)
        # A diamond hub uses only two triangles, leaving room for the fringe and bench backs.
        x = side * 1.122
        polygon(mb, [(x, axle, 0.54), (x, axle + 0.18, 0.36),
                     (x, axle, 0.18), (x, axle - 0.18, 0.36)], "trim", (side, 0, 0))
for end, f, role in ((1, 9.005, "light_head"), (-1, -8.803, "light_tail")):
    for side, suffix in ((1, "l"), (-1, "r")):
        x = side * 0.78
        polygon(mb, [(x - 0.13, f, 0.85), (x + 0.13, f, 0.85),
                     (x + 0.13, f, 1.04), (x - 0.13, f, 1.04)], role, (0, end, 0))
        empty(f"{role}_{suffix}", root, P(x, f, 0.945))
empty("hood", root, P(0, (HOOD_BACK + HOOD_FRONT) / 2, HOOD_TOP))
mb.build("vehicle_body", mats, root)
export(out_path(), texcoords=False, normals=False)
