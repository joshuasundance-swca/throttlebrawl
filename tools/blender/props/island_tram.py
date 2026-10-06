"""CX7: an original short open sightseeing train, with no operator or lettering."""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene  # noqa: E402
from _vehicle_lib import COLOURS, polygon  # noqa: E402

LENGTH, WIDTH, HEIGHT, WHEELBASE = 7.5, 2.2, 2.6, 5.0
HOOD_TOP, HOOD_BACK, HOOD_FRONT = 1.10, 2.75, 3.65
RADIUS = 0.32

reset_scene()
mats = make_mats(dict(COLOURS, paint_secondary="#eee4ca"))
mb = MB(mats)
root = empty("vehicle")
for key, value in {"length_m": LENGTH, "width_m": WIDTH, "height_m": HEIGHT,
                   "wheelbase_m": WHEELBASE, "hood_top_m": HOOD_TOP,
                   "hood_front_m": HOOD_FRONT, "hood_back_m": HOOD_BACK,
                   "class": "truck"}.items():
    root[key] = value


def bench(f, half_width):
    # A single closed L-profile is both the seat and its rear backrest, facing +Z.
    mb.xprism([(f - 0.28, 0.80), (f + 0.28, 0.80), (f + 0.28, 0.94),
               (f - 0.16, 0.94), (f - 0.16, 1.42), (f - 0.28, 1.42)],
              -half_width, half_width, "trim")


def canopy(back, front, top, fringe=False):
    mb.box(back, front, -1.1, 1.1, top - 0.10, top, "paint_secondary")
    for x in (-0.94, 0.94):
        for f in (back + 0.08, front - 0.08):
            mb.tube([(x, f, 0.61), (x, f, top - 0.10)],
                    [0.035, 0.035], "trim", sides=3)
        if fringe:
            # Closed thin scalloped strips read from either side of an open passenger car.
            profile = [(back, top - 0.10), (front, top - 0.10)]
            profile += [(front - (front - back) * i / 4,
                         top - (0.23 if i % 2 == 0 else 0.14)) for i in range(5)]
            mb.xprism(profile, math.copysign(1.075, x) - 0.012,
                      math.copysign(1.075, x) + 0.012, "paint_secondary")


# Two 2.3 m passenger decks, separated by 0.2 m; sides remain open above low skirts.
for back, front in ((-3.65, -1.35), (-1.15, 1.15)):
    mb.box(back, front, -1.0, 1.0, 0.46, 0.61, "paint_primary")
    for side in (-1, 1):
        mb.side_quad(side * 1.001, back, front, 0.62, 0.83, "paint_primary", side)
        mb.side_quad(side * 0.999, back, front, 0.62, 0.83, "paint_primary", -side)
    for f in (back + 0.48, back + 1.55):
        bench(f, 0.83)
    canopy(back, front, HEIGHT, fringe=True)
# Couplers overlap decks slightly, but have their own closed shells.
for back, front in ((-1.39, -1.11), (1.11, 1.39)):
    mb.box(back, front, -0.08, 0.08, 0.43, 0.52, "trim")

# The 2.4 m jeep-like tractor: a broad flat launch hood, upright screen and one driver seat.
mb.box(1.35, 3.65, -0.96, 0.96, 0.46, 0.61, "paint_primary")
mb.box(HOOD_BACK, HOOD_FRONT, -0.86, 0.86, 0.61, HOOD_TOP, "paint_primary")
bench(1.98, 0.35)
canopy(1.35, 2.73, 2.50)
mb.box(2.62, 2.66, -0.94, 0.94, 1.15, 2.35, "glass")
# The front canopy posts flank the pane; these horizontal bars complete its upright frame.
for bottom, top in ((1.11, 1.17), (2.34, 2.40)):
    mb.box(2.61, 2.67, -0.97, 0.97, bottom, top, "trim")
mb.box(3.64, 3.75, -1.0, 1.0, 0.35, 0.45, "trim")
mb.box(-3.747, -3.64, -0.93, 0.93, 0.62, 0.92, "paint_primary")
polygon(mb, [(-0.48, 3.653, 0.65), (0.48, 3.653, 0.65),
             (0.48, 3.653, 1.02), (-0.48, 3.653, 1.02)], "trim", (0, 1, 0))

# Three small axles; the first and last are +/-2.5 m, so the root is their midpoint.
# Six facets with this phase include exact ground vertices at z=0.
for axle in (-2.5, 0.0, 2.5):
    for side in (-1, 1):
        mb.cyl((side * 1.01, axle, RADIUS), "x", RADIUS, 0.08, 6,
               "tyre", phase=math.pi / 6)
for f, role, direction in ((3.654, "light_head", 1), (-3.75, "light_tail", -1)):
    for side, suffix in ((1, "l"), (-1, "r")):
        x = side * 0.72
        polygon(mb, [(x - 0.11, f, 0.70), (x + 0.11, f, 0.70),
                     (x + 0.11, f, 0.88), (x - 0.11, f, 0.88)], role, (0, direction, 0))
        empty(f"{role}_{suffix}", root, P(x, f, 0.79))
empty("hood", root, P(0, (HOOD_BACK + HOOD_FRONT) / 2, HOOD_TOP))
mb.build("vehicle_body", mats, root)
export(out_path(), texcoords=False, normals=False)
