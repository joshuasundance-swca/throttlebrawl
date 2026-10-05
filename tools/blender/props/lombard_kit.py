"""Small mirrored hydrangea beds confined to a three-metre hairpin's inside."""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene

COLOURS = {"brick": "#ad5440", "foliage": "#284a37", "paint_pink": "#d393b4",
           "paint_blue": "#739fd0", "paint_cream": "#e4d8b8"}
BED_RADIUS = 3.0
XS = [-8, 0, 8]

reset_scene()
mats = make_mats(COLOURS)
for side, x, suffix in ((1, XS[0], "l"), (-1, XS[1], "r")):
    root = empty(f"lombard_bed_curve_{suffix}", loc=(x, 0, 0))
    root["bed_r_m"] = BED_RADIUS
    mb = MB(mats)
    rings = []
    # 160 degrees at the outer rim is 8.38 m. The asymmetric arc is mirrored exactly in X.
    for i in range(8):
        a = math.radians(-70 + 160 * i / 7)
        rings.append([P(side * r * math.sin(a), r * math.cos(a), y)
                      for r, y in ((2.15, 0), (3, 0), (3, 0.3), (2.15, 0.3))])
    mb.loft(rings, "brick")
    # Closed faceted leaf mass and three flower heads: no double-sided solid foliage.
    mb.blob((0.35 * side, 1.85, 0.55), (1.35, 0.6, 0.5), "foliage")
    for a, colour in ((-42, "paint_pink"), (8, "paint_blue"), (57, "paint_cream")):
        angle = math.radians(a)
        mb.blob((side * 2.3 * math.sin(angle), 2.3 * math.cos(angle), 0.78),
                (0.48, 0.48, 0.493739), colour)
    mb.build(f"lombard_bed_curve_{suffix}_body", mats, root)
root = empty("lombard_hedge", loc=(XS[2], 0, 0))
root["length_m"] = 6
mb = MB(mats)
mb.box(-0.4, 0.4, -3, 3, 0, 1, "foliage")
mb.build("lombard_hedge_body", mats, root)
export(out_path(), normals=False)
