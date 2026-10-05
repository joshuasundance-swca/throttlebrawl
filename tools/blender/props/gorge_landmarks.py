"""CX5: Crown Point, the falls and lodge, and deck-free historic concrete arches."""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene

COLOURS = {"stone": "#9d9b90", "trim": "#bdb7a6", "tile_green": "#587d70",
           "glass": "#303f42", "roof": "#393c39", "wood": "#685745",
           "steel_dark": "#3a3f3c", "moss": "#596d45", "falls_water": "#f2f6f7",
           "concrete": "#bdb8ad", "foliage_dark": "#294339"}
ROOTS = ["vista_house_lod0", "vista_house_lod1", "multnomah_falls_lod0",
         "multnomah_falls_lod1", "multnomah_lodge", "gorge_arch_bay", "gorge_arch_span_46"]
XS = [-220, -185, -120, -45, 20, 65, 100]


def root(name, **extras):
    r = empty(name, loc=(XS[ROOTS.index(name)], 0, 0))
    for k, v in extras.items():
        r[k] = v
    return r


def vista(name, mats, detail):
    r = root(name, top_m=17)
    mb = MB(COLOURS)
    n = 16 if detail else 8
    for radius, low, high, role in ((11, 0, 0.6, "stone"), (10.6, 0.6, 1.5, "trim"),
                                   (6.5, 1.5, 11.5, "stone")):
        mb.cyl((0, 0, (low+high)/2), "z", radius, (high-low)/2, n, role)
    # Low pitched copper roof and a small lantern with a faceted dome.
    mb.cyl((0, 0, 12.75), "z", 7.0, 1.25, n, "tile_green", r_top=2)
    mb.cyl((0, 0, 14.75), "z", 1.6, 0.75, n, "trim")
    if detail:
        rings = [[P(rad*math.cos(2*math.pi*i/n), rad*math.sin(2*math.pi*i/n), h)
                  for i in range(n)] for h, rad in ((15.5, 1.6), (16.5, 1.1), (17, 0.15))]
        mb.loft(rings, "tile_green")
        # Narrow arched dark window recesses on all sixteen sandstone faces.
        for i in range(n):
            a = (i+0.5)*2*math.pi/n
            ca, sa = math.cos(a), math.sin(a)
            pts = [(-0.55, 4), (0.55, 4), (0.55, 9), (0.3, 9.6),
                   (0, 9.8), (-0.3, 9.6), (-0.55, 9)]
            vs = [mb.v(P(6.39*ca-t*sa, 6.39*sa+t*ca, h)) for t, h in pts]
            fc = mb.bm.faces.new(vs)
            mb.tag([fc], "glass", closed=False)
            fc.normal_update()
            if fc.normal.dot(P(ca, sa, 0)) < 0:
                fc.normal_flip()
        # Parapet as narrow terrace-edge segments rather than a solid drum.
        for i in range(n):
            a, b = 2*math.pi*i/n, 2*math.pi*(i+1)/n
            mb.tube([(10.2*math.cos(a), 10.2*math.sin(a), 1.8),
                     (10.2*math.cos(b), 10.2*math.sin(b), 1.8)], [0.18]*2, "stone", sides=3)
    else:
        mb.cone((0, 0, 15.5), 1.6, 17, n, "tile_green")
    mb.build(name+"_body", mats, r)


def falls(name, mats, detail):
    r = root(name, top_m=190, foundation_m=0.5)
    mb = MB(COLOURS)
    # A thin concave wall: wings come forward, the falls sit in the central recess.
    plan = [(-80, 0), (-50, -8), (-20, -20), (20, -20), (50, -8), (80, 0)]
    tops = [171, 184, 185, 181, 173]
    for i, ((xa, fa), (xb, fb)) in enumerate(zip(plan, plan[1:])):
        levels = [0, 58+i*3, 116-i*2, tops[i]] if detail else [0, tops[i]]
        for low, high in zip(levels, levels[1:]):
            mb.hull([(x, f, h) for x, f in ((xa, fa), (xb, fb),
                     (xa, fa-5), (xb, fb-5)) for h in (low, high)], "steel_dark")
        # Low conifers across the whole rim, not a single mast-like summit.
        count = 3 if detail else 1
        for j in range(count):
            t = (j+0.5)/count
            x, f = xa+(xb-xa)*t, fa+(fb-fa)*t
            height = min(7, 190-tops[i])
            mb.cone((x, f-2.5, tops[i]-0.5), 3.5,
                    tops[i]+height, 6 if detail else 4, "foliage_dark")
    # Horizontal wet ledges break up the wall's broad basalt faces.
    if detail:
        for xa, xb, f, h in ((-72, -53, -5, 47), (-46, -24, -13, 98),
                              (25, 47, -13, 63), (53, 72, -5, 122),
                              (-18, 18, -19, 115), (-19, 19, -19, 57)):
            mb.box(f-1.5, f+1, xa, xb, h, h+1.2, "moss")
    # A 0.6 m air gap separates the ribbon from the central basalt face.
    mb.fprism([(-7, 25), (7, 25), (4, 190), (-4, 190)], -19.4, -19.2, "falls_water")
    mb.box(-20, -10, -10, 10, 22, 24, "moss")
    mb.fprism([(-10, 23), (10, 23), (7, 25), (-7, 25)], -10.2, -9.8, "falls_water")
    mb.box(-10.4, -10.2, -6, 6, 2, 23, "falls_water")
    mb.box(-10, 0, -13, 13, -0.5, -0.1, "glass")
    # Pale foam skirts the foot of the lower ribbon; the pool remains grey-blue.
    mb.fprism([(-12, 0), (12, 0), (7, 2), (-7, 2)], -9, -8.4, "falls_water")
    if detail:
        mb.box(-5, -4.5, -11, 11, 0, 0.3, "falls_water")
        # Benson's shallow pale arch is in front of the lower fall.
        mb.fprism([(-7, 29), (-3.5, 31), (0, 31.7), (3.5, 31), (7, 29),
                   (7, 30), (3.5, 32), (0, 32.7), (-3.5, 32), (-7, 30)], -7, -5, "concrete")
        for x in (-7, 7):
            mb.box(-7, -5, x-0.6, x+0.6, 23, 30, "concrete")
        for f in (-7, -5):
            mb.box(f-0.1, f+0.1, -7, 7, 33, 33.3, "concrete")
        for x in (-6, -3, 0, 3, 6):
            mb.box(-5.15, -4.95, x-0.1, x+0.1, 31.9, 33, "concrete")
    else:
        mb.box(-7.1, -4.9, -7.6, 7.6, 29, 33.3, "concrete")
    mb.build(name+"_body", mats, r)


def lodge(mats):
    name = "multnomah_lodge"
    r = root(name, top_m=15)
    mb = MB(COLOURS)
    mb.box(-13, 0, -15, 15, 0, 4.5, "stone")
    # A slightly ragged fieldstone course instead of a straight apartment cornice.
    for i in range(10):
        x = -15+i*3
        mb.box(-13, 0, x, x+3, 4.5, 4.65+(i % 3)*0.1, "stone")
    # The upper floor lives under the steep roof; no full-height second-storey box.
    mb.xprism([(-13, 4.5), (0, 4.5), (-6.5, 12.5)], -15, 15, "wood")
    mb.xprism([(-13.5, 4.45), (0.5, 4.45), (-6.5, 12.85)], -15.5, 15.5, "roof")
    # Three broad gabled dormers bring grouped, small-paned windows to the front.
    for x in (-10, 0, 10):
        mb.box(-5, -0.4, x-1.8, x+1.8, 5.2, 8.8, "wood")
        mb.fprism([(x-2.1, 8.8), (x+2.1, 8.8), (x, 11)], -5.2, -0.1, "roof")
        mb.front_quad(-0.39, x-1.3, x+1.3, 6.2, 8.5, "glass")
        mb.box(-0.38, -0.30, x-0.06, x+0.06, 6.2, 8.5, "trim")
        mb.box(-0.38, -0.30, x-1.3, x+1.3, 7.3, 7.42, "trim")
    # Two massive stone chimneys stand clear above the roof ridge.
    for x in (-7, 7):
        mb.box(-8, -5.5, x-1.25, x+1.25, 4, 14.6, "stone")
        mb.box(-8.2, -5.3, x-1.45, x+1.45, 14.6, 15, "stone")
    # Fewer wide window groups in the rough lower storey.
    for x in (-11, -5, 5, 11):
        mb.front_quad(0.03, x-1.65, x+1.65, 1.1, 3.65, "glass")
        for dx in (-0.55, 0.55):
            mb.box(0.04, 0.11, x+dx-0.045, x+dx+0.045, 1.1, 3.65, "trim")
        mb.box(0.04, 0.11, x-1.65, x+1.65, 2.32, 2.43, "trim")
    # Projecting, stone-posted gabled entrance porch at the front-wall origin.
    mb.box(0, 3.4, -3, 3, 0, 0.3, "stone")
    for x in (-2.5, 2.5):
        mb.box(2.3, 3, x-0.3, x+0.3, 0.3, 4, "stone")
    mb.fprism([(-3.2, 4), (3.2, 4), (0, 7)], -0.1, 3.7, "roof")
    mb.front_quad(0.04, -1, 1, 0.3, 3.7, "wood")
    mb.build(name+"_body", mats, r)


def arch(name, mats, length, depth):
    """Solid historic arches; approved caps are 560 / 880 triangles.

    The ribs are single closed prisms, not disconnected strip blocks. Every
    column, transverse beam, fascia and footing step is a closed solid too.
    """
    r = root(name, bay_m=length, pier_m=depth, deck_w_m=11)
    mb = MB(COLOURS)
    n = 12

    def top(f):
        u = f / length
        return -depth + 2.6 + (depth - 3.5) * 4 * u * (1 - u)

    def thick(f):
        return 1.1 + 0.5 * abs(2 * f / length - 1)

    fs = [length * i / n for i in range(n + 1)]
    # A single simple profile encloses the full curved ribbon. The crown's
    # upper edge is precisely -0.9; the bottom edge follows the same parabola.
    profile = [(f, top(f)) for f in fs]
    profile += [(f, top(f) - thick(f)) for f in reversed(fs)]
    for x in (-3.6, 3.6):
        mb.xprism(profile, x - 0.45, x + 0.45, "concrete")
        for f in (0, length):
            # Springings sit in stepped stone, staying inside the exact bay.
            a, b = (0, 2.4) if f == 0 else (length - 2.4, length)
            mb.box(a, b, x - 1.5, x + 1.5, -depth, -depth + 1.2, "stone")
            a, b = (0, 1.8) if f == 0 else (length - 1.8, length)
            mb.box(a, b, x - 1.0, x + 1.0, -depth + 1.2, -depth + 2.8, "stone")

    lines = [float(f) for f in range(3, int(length), 3) if top(f) < -0.901]
    for f in lines:
        # Columns start inside the rib, so there is no light gap at their base.
        for x in (-3.6, 3.6):
            mb.box(f - 0.25, f + 0.25, x - 0.25, x + 0.25,
                   top(f) - 0.05, -0.9, "concrete")
        mb.box(f - 0.25, f + 0.25, -3.85, 3.85, -0.9, -0.4, "concrete")

    for x in (-5.4, 5.4):
        # Slight outboard overhang, with no deck or railing surface added.
        mb.box(0, length, x - 0.3, x + 0.3, -0.9, -0.1, "concrete")
    mb.build(name + "_body", mats, r)


reset_scene()
mats = make_mats(COLOURS)
vista(ROOTS[0], mats, True)
vista(ROOTS[1], mats, False)
falls(ROOTS[2], mats, True)
falls(ROOTS[3], mats, False)
lodge(mats)
arch(ROOTS[5], mats, 24, 16)
arch(ROOTS[6], mats, 46, 28)
export(out_path(), normals=False)
