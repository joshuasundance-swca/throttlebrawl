"""Original three-wheel bicycle taxi, baked rider and unmarked canvas canopy."""

from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene  # noqa: E402

COLOURS = {"paint_primary": "#ffffff", "trim": "#445158", "tyre": "#252a2d",
           "canvas": "#e2d4b3", "seat": "#456975", "bark": "#b38a6b", "paint_blue": "#8bb1c5"}
LENGTH, WIDTH, HEIGHT, WHEELBASE = 2.6, 1.2, 1.9, 1.96

reset_scene()
mats = make_mats(COLOURS)
root = empty("vehicle")
for key, value in {"length_m": LENGTH, "width_m": WIDTH, "height_m": HEIGHT,
                   "wheelbase_m": WHEELBASE, "hood_top_m": 0.68,
                   "hood_front_m": 1.24, "hood_back_m": 0.73, "class": "car"}.items():
    root[key] = value
mb = MB(mats)
# One narrow front wheel and two rear wheels, all baked into vehicle_body.
for x, f, r, half in ((0, 0.98, 0.32, 0.035), (-0.55, -0.98, 0.28, 0.05),
                      (0.55, -0.98, 0.28, 0.05)):
    mb.cyl((x, f, r), "x", r, half, 8, "tyre")
    for side in ((-1, 1) if x == 0 else (1 if x > 0 else -1,)):
        mb.cyl((x + side * (half + 0.002), f, r), "x", r * 0.65, 0.003, 4, "trim")
# A clearly triangular bicycle frame; not a car body in disguise.
for a, b in (((0, 0.98, 0.32), (0, 0.64, 0.95)),
             ((0, 0.64, 0.95), (0, -0.08, 0.8)),
             ((0, -0.08, 0.8), (0, 0.31, 0.34)),
             ((0, 0.31, 0.34), (0, 0.64, 0.95)),
             ((0, 0.31, 0.34), (0, -0.98, 0.28))):
    mb.tube([a, b], [0.025, 0.025], "paint_primary", sides=3)
mb.box(0.48, 0.53, -0.3, 0.3, 0.96, 1.0, "trim")
mb.box(-0.23, 0.03, -0.14, 0.14, 0.84, 0.89, "seat")
# Bench for two, footboard, backrest and a single canopy support on each side.
mb.box(-1.3, -0.35, -0.48, 0.48, 0.3, 0.4, "paint_primary")
mb.box(-1.12, -0.55, -0.47, 0.47, 0.62, 0.73, "seat")
mb.box(-1.17, -1.09, -0.47, 0.47, 0.7, 1.15, "seat")
for x in (-0.48, 0.48):
    mb.tube([(x, -1.0, 0.38), (x, -1.0, 1.83)], [0.025, 0.025], "trim", sides=3)
mb.xprism([(-1.25, 1.77), (-0.25, 1.77), (-0.27, 1.9), (-1.23, 1.9)], -0.6, 0.6, "canvas")
# Baked pedalling rider; shirt and cap have no operator colours or livery.
mb.tube([(0, -0.03, 0.91), (0, 0.05, 1.31)], [0.13, 0.17], "paint_blue", sides=4)
mb.blob((0, 0.065, 1.47), (0.105, 0.11, 0.13), "bark")
mb.box(-0.02, 0.2, -0.12, 0.12, 1.54, 1.6, "paint_blue")
for x, knee_f, knee_z, foot_f in ((-0.095, 0.29, 0.66, 0.21), (0.095, 0.13, 0.73, 0.4)):
    mb.tube([(x, -0.03, 0.91), (x, knee_f, knee_z), (x, foot_f, 0.40)],
            [0.065, 0.045, 0.025], "trim", sides=3)
    mb.tube([(x * 1.4, 0.05, 1.27), (x * 1.9, 0.3, 1.08), (x * 2.4, 0.5, 0.99)],
            [0.055, 0.035, 0.02], "bark", sides=3)
# Short launch surface above the front wheel; lamp markers are contract empties.
mb.box(0.73, 1.24, -0.045, 0.045, 0.65, 0.68, "paint_primary")
empty("hood", root, P(0, 0.985, 0.68))
for role, f in (("light_head", 1.24), ("light_tail", -1.3)):
    for side, suffix in ((1, "l"), (-1, "r")):
        empty(f"{role}_{suffix}", root, P(side * 0.32, f, 0.52))
mb.build("vehicle_body", mats, root)
export(out_path(), normals=False)
