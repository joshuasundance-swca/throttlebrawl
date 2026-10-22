"""Original stylized stone overlook: exterior only, not a measured reconstruction.

All dimensions are authored choices. The closed ground door and elevated blind arch
do not promise an entrance or a rideable stair. The open parapet has a real solid floor;
later ground-column collision can fill below that floor, but must preserve its open top.
The shallow elevated recess may be conservatively filled by coarse measured columns.
"""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene

COLOURS = {"stone": "#8f8a79", "sandstone": "#a49b83", "trim": "#c2b79b",
           "wood": "#544d3d", "glass": "#30352f"}
BODY_TOP = 8.4
FLOOR_TOP = 8.75
PARAPET_TOP = 9.55
MERLON_TOP = 10.5
HALF = 2.6
DECK_HALF = 3.1


def parapet(mb, detail):
    mb.box(-DECK_HALF, DECK_HALF, -DECK_HALF, DECK_HALF, BODY_TOP, FLOOR_TOP, "trim")
    for side in (-1, 1):
        a, b = (2.6, 3.1) if side > 0 else (-3.1, -2.6)
        mb.box(a, b, -DECK_HALF, DECK_HALF, FLOOR_TOP, PARAPET_TOP, "stone")
        mb.box(-2.6, 2.6, a, b, FLOOR_TOP, PARAPET_TOP, "stone")
        for x in (-2.65, 0, 2.65):
            mb.box(a, b, x - 0.45, x + 0.45, PARAPET_TOP, MERLON_TOP, "stone")
        mb.box(-0.45, 0.45, a, b, PARAPET_TOP, MERLON_TOP, "stone")
    if detail:
        # A light coping makes the separated teeth read from the low chase view.
        for side in (-1, 1):
            a, b = (2.58, 3.1) if side > 0 else (-3.1, -2.58)
            mb.box(a, b, -3.1, 3.1, PARAPET_TOP - 0.12, PARAPET_TOP, "trim")
            mb.box(-2.58, 2.58, a, b, PARAPET_TOP - 0.12, PARAPET_TOP, "trim")


def tower(name, x, detail, mats):
    r = empty(name, loc=(x, 0, 0))
    r["exterior_only"] = True
    r["top_m"] = MERLON_TOP
    mb = MB(COLOURS)
    # A closed stone keep. Only the near front face has a shallow, backed arch recess.
    mb.box(-HALF, 2.15 if detail else HALF, -HALF, HALF, 0, BODY_TOP, "stone")
    if detail:
        for a, b in ((-HALF, -0.65), (0.65, HALF)):
            mb.box(2.15, HALF, a, b, 0, BODY_TOP, "stone")
        mb.box(2.15, HALF, -0.65, 0.65, 0, 3, "stone")
        mb.fprism([(-0.65, BODY_TOP), (0.65, BODY_TOP), (0.65, 4.9),
                   (0.46, 5.36), (0, 5.55), (-0.46, 5.36), (-0.65, 4.9)],
                  2.15, HALF, "stone")
        mb.fprism([(-0.65, 3), (0.65, 3), (0.65, 4.9), (0.46, 5.36),
                   (0, 5.55), (-0.46, 5.36), (-0.65, 4.9)], 2.15, 2.18, "glass")
        # Closed timber door, with a visible centre joint; no dark open entrance.
        for a, b in ((-0.64, -0.02), (0.02, 0.64)):
            mb.box(2.605, 2.66, a, b, 0.1, 2.3, "wood")
        for h in (0.5, 1.8):
            mb.box(2.66, 2.69, -0.6, 0.6, h, h + 0.08, "glass")
        for side in (-1, 1):
            a, b = (0.65, 0.88) if side > 0 else (-0.88, -0.65)
            mb.box(2.58, 2.74, a, b, 2.85, 4.9, "trim")
        for i in range(6):
            a, b = math.pi * i / 6, math.pi * (i + 1) / 6
            mb.fprism([(math.cos(a) * 0.66, 4.9 + math.sin(a) * 0.66),
                       (math.cos(b) * 0.66, 4.9 + math.sin(b) * 0.66),
                       (math.cos(b) * 0.89, 4.9 + math.sin(b) * 0.89),
                       (math.cos(a) * 0.89, 4.9 + math.sin(a) * 0.89)], 2.58, 2.74, "trim")
        mb.box(2.15, 2.82, -0.95, 0.95, 2.85, 3.02, "trim")
    else:
        # The far silhouette keeps the same closed-door/window cues and material roles.
        mb.box(2.605, 2.66, -0.64, 0.64, 0.1, 2.3, "wood")
        mb.box(2.605, 2.63, -0.65, 0.65, 3, 5.5, "glass")

    # Four tapered corner buttresses make a grounded, broad-footed silhouette.
    for sx in (-1, 1):
        for sf in (-1, 1):
            mb.hull([(sx * a, sf * b, h) for a, b, h in
                     ((2.1, 2.1, 0), (3.1, 2.1, 0), (3.1, 3.1, 0), (2.1, 3.1, 0),
                      (2.1, 2.1, 6.1), (2.65, 2.1, 6.1), (2.65, 2.65, 6.1), (2.1, 2.65, 6.1))], "sandstone")
    parapet(mb, detail)
    if detail:
        # Short, offset courses are authored geometry, not a sampled stone texture.
        for course in range(6):
            h = 0.45 + course * 1.25
            for j in range(3):
                a = -2.45 + j * 1.55 + (0.15 if course % 2 else 0)
                b = min(a + 1.3, 2.5)
                if a >= b:
                    continue
                role = "sandstone" if (course + j) % 3 else "stone"
                for side in (-1, 1):
                    # Preserve the closed door and blind arch silhouettes on the front.
                    if side < 0 or not (a < 0.95 and b > -0.95 and h < 5.8):
                        f0, f1 = (2.6, 2.65) if side > 0 else (-2.65, -2.6)
                        mb.box(f0, f1, a, b, h, h + 0.5, role)
                    x0, x1 = (2.6, 2.65) if side > 0 else (-2.65, -2.6)
                    mb.box(a, b, x0, x1, h, h + 0.5, role)
    mb.build(name + "_body", mats, r)


reset_scene()
mats = make_mats(COLOURS)
tower("eagle_stone_tower_lod0", 0, True, mats)
tower("eagle_stone_tower_lod1", 14, False, mats)
export(out_path(), normals=False)
