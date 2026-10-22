"""Original stylized circular stone overlook; not a measured reconstruction.

The official city photo documentId581 informed only broad circular massing. No image,
texture, traced outline or historical dimensions are incorporated. Dimensions below are
authored choices. Closed door and backed blind arches promise no entrance or stair.
Real floors inside open crenellated parapets suit conservative ground-column solids.
"""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene

COLOURS = {"stone": "#928c7a", "sandstone": "#a69b82", "trim": "#c1b596",
           "wood": "#554d3b", "glass": "#30362e"}
OUTER_R = 5.2
OUTER_FLOOR = 3.35
UPPER_R = 2.55
UPPER_FLOOR = 9.4
TOP = 10.7


def wedge(mb, radius0, radius1, angle0, angle1, low, high, role):
    plan = [(radius0, angle0), (radius1, angle0), (radius1, angle1), (radius0, angle1)]
    mb.loft([[P(r * math.sin(a), r * math.cos(a), h) for r, a in plan]
             for h in (low, high)], role)


def ring(mb, inner, outer, low, high, n, role):
    """One manifold annular solid, with a genuinely open centre, not a capped cylinder."""
    loops = [[mb.v(P(r * math.sin(i * math.tau / n), r * math.cos(i * math.tau / n), h))
              for i in range(n)] for r, h in ((outer, low), (outer, high), (inner, low), (inner, high))]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        for a, b in ((0, 1), (1, 3), (3, 2), (2, 0)):
            faces.append(mb.bm.faces.new((loops[a][i], loops[a][j], loops[b][j], loops[b][i])))
    mb.tag(faces, role)


def crown(mb, radius, floor, wall_top, tooth_top, n, detail):
    ring(mb, radius - 0.48, radius, floor, wall_top, n, "stone")
    count = 8 if detail else 4
    for i in range(count):
        angle = i * math.tau / count
        wedge(mb, radius - 0.48, radius, angle - 0.13, angle + 0.13, wall_top, tooth_top, "stone")


def blind_arch(mb, radius, angle, low, detail):
    """Backed blind opening above solid stone, with a shallow proud stone surround."""
    if not detail:
        wedge(mb, radius, radius + 0.025, angle - 0.18, angle + 0.18, low, low + 1.5, "glass")
        return
    arch = MB(COLOURS)
    spring = low + 1.2
    arch.fprism([(-0.5, low), (0.5, low), (0.5, spring), (0.35, spring + 0.35),
                 (0, spring + 0.5), (-0.35, spring + 0.35), (-0.5, spring)],
                radius - 0.04, radius + 0.025, "glass")
    for side in (-1, 1):
        a, b = (0.5, 0.7) if side > 0 else (-0.7, -0.5)
        arch.box(radius - 0.04, radius + 0.3, a, b, low, spring, "trim")
    for i in range(4):
        a, b = math.pi * i / 4, math.pi * (i + 1) / 4
        arch.fprism([(math.cos(a) * 0.5, spring + math.sin(a) * 0.5),
                     (math.cos(b) * 0.5, spring + math.sin(b) * 0.5),
                     (math.cos(b) * 0.7, spring + math.sin(b) * 0.7),
                     (math.cos(a) * 0.7, spring + math.sin(a) * 0.7)],
                    radius - 0.04, radius + 0.3, "trim")
    # Transfer the original front geometry radially, preserving roles and winding.
    ca, sa = math.cos(angle), math.sin(angle)
    for vertex in arch.bm.verts:
        x, y = vertex.co.x, vertex.co.y
        vertex.co.x = ca * x - sa * y
        vertex.co.y = sa * x + ca * y
    vertices = {v: mb.v(v.co) for v in arch.bm.verts}
    for face in arch.bm.faces:
        made = mb.bm.faces.new([vertices[v] for v in face.verts])
        mb.tag([made], arch.mats[face.material_index], closed=False)
    arch.bm.free()


def tower(name, x, detail, mats):
    r = empty(name, loc=(x, 0, 0))
    r["exterior_only"] = True
    r["top_m"] = TOP
    mb = MB(COLOURS)
    n = 16 if detail else 8
    mb.cyl((0, 0, OUTER_FLOOR / 2), "z", OUTER_R, OUTER_FLOOR / 2, n, "sandstone")
    mb.cyl((0, 0, UPPER_FLOOR / 2), "z", UPPER_R, UPPER_FLOOR / 2, n, "stone")
    mb.cyl((0, 0, 9.3), "z", 2.7, 0.1, n, "trim")
    crown(mb, OUTER_R, OUTER_FLOOR, 4.05, 4.7, n, detail)
    crown(mb, 2.7, UPPER_FLOOR, 10, TOP, n, detail)
    mb.box(OUTER_R - 0.02, OUTER_R + 0.06, -0.6, 0.6, 0.1, 2.35, "wood")
    blind_arch(mb, UPPER_R, 0, 5.9, detail)
    if detail:
        for angle in (math.pi / 2, math.pi, 3 * math.pi / 2):
            blind_arch(mb, OUTER_R, angle, 1.15, True)
        # Sparse offset stone facets, never a copied image or texture.
        for radius, levels, count in ((OUTER_R, (0.45,), 8), (UPPER_R, (4.4, 8.2), 6)):
            for row, h in enumerate(levels):
                for i in range(count):
                    a = (i + row * 0.35) * math.tau / count
                    if radius == UPPER_R and h < 7.8 and (i == 0 or i == count - 1):
                        continue
                    wedge(mb, radius - 0.03, radius + 0.045, a + 0.06, a + 0.43,
                          h, h + 0.38, "sandstone" if i % 3 else "stone")
    else:
        for angle in (math.pi / 2, math.pi, 3 * math.pi / 2):
            wedge(mb, OUTER_R - 0.04, OUTER_R + 0.3, angle - 0.13, angle + 0.13,
                  1.15, 2.85, "trim")
    mb.build(name + "_body", mats, r)


reset_scene()
mats = make_mats(COLOURS)
tower("eagle_stone_tower_lod0", 0, True, mats)
tower("eagle_stone_tower_lod1", 14, False, mats)
export(out_path(), normals=False)
