"""The Golden Gate: repeated steel pieces around the game-owned road and cables."""
import sys
from pathlib import Path

import bmesh

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _sf_atlas import atlas_panel

COLOURS = {"bridge_paint": "#c0452f", "concrete": "#cbc5b7", "brick": "#994f3e"}
ROOTS = ["gg_tower_lod0", "gg_tower_lod1", "gg_bay_lod0", "gg_bay_lod1",
         "gg_suspender", "gg_anchorage", "gg_approach_pier", "gg_fort_arch"]
XS = [-180, -130, -80, -35, 10, 60, 115, 165]


def root(name):
    return empty(name, loc=(XS[ROOTS.index(name)], 0, 0))


def tower(name, mats, detailed):
    r = root(name)
    r["foundation_m"], r["top_m"], r["cable_saddle_x_m"] = 3, 225, 17.5
    mb = MB(mats)
    pier_faces = mb.box(-9, 9, -24.6, 24.6, -3, 4, "concrete")
    if not detailed:
        bmesh.ops.delete(mb.bm, geom=pier_faces[:4], context="FACES_ONLY")
    tiers = [(4, 85, 10, 16), (85, 140, 8, 12), (140, 190, 6.5, 9), (190, 219, 5.8, 7)]
    for x in (-17.5, 17.5):
        for k, (lo, hi, w, depth) in enumerate(tiers):
            # Keep the inner face outside the road; all tier setbacks grow outward.
            centre = (14.6+w/2) * (1 if x > 0 else -1)
            faces = mb.box(-depth/2, depth/2, centre-w/2, centre+w/2, lo, hi, "bridge_paint")
            if not detailed:
                bmesh.ops.delete(mb.bm, geom=[faces[0], faces[2]], context="FACES_ONLY")
            if detailed:
                for side in (-1, 1):
                    ob = atlas_panel(name+f"_panel_{x}_{k}_{side}".replace("-", "n").replace(".", "_"),
                                     mats, "bridge_paint", r, w*0.68, hi-lo-3,
                                     (centre, depth/2+0.01, (lo+hi)/2), "golden-gate-tower-panels")
                    if side < 0:
                        ob.rotation_euler[2] = 3.141592653589793
                        ob.location.x = 2*centre
        if detailed:
            for lo, hi, w, d in ((219, 222, 5.4, 6.5), (222, 224, 4.8, 5.5), (224, 227, 4, 4)):
                mb.box(-d/2, 0.5 if lo == 224 else d/2, x-w/2, x+w/2, lo, hi, "bridge_paint")
        else:
            faces = mb.box(-2, 0.5, x-2, x+2, 219, 227, "bridge_paint")
            bmesh.ops.delete(mb.bm, geom=[faces[0], faces[2]], context="FACES_ONLY")
    # Portals are outside the entire sloped road's clearance band.
    for lo, hi, depth in ((40, 49, 16), (88, 97, 12), (137, 147, 12),
                          (179, 190, 9), (207, 219, 9)):
        faces = mb.box(-depth/2, depth/2, -17.5, 17.5, lo, hi, "bridge_paint")
        if not detailed:
            hidden = faces[:4] if lo < 50 else [faces[1], faces[3]]
            bmesh.ops.delete(mb.bm, geom=hidden, context="FACES_ONLY")
        elif lo > 50:
            # A projecting lower lip and inset face band replace diagonal gussets.
            mb.box(-depth/2-0.3, depth/2+0.3, -16.5, 16.5, lo, lo+1.4, "bridge_paint")
            for side in (-1, 1):
                f0, f1 = sorted((side*(depth/2+0.02), side*(depth/2+0.12)))
                mb.box(f0, f1, -13.6, 13.6, lo+2.2, hi-1.4, "bridge_paint")
    mb.build(name+"_body", mats, r)


def bay(name, mats, detailed):
    r = root(name)
    r["bay_m"], r["deck_w_m"], r["pier_m"] = 15.24, 27.6, 7.6
    mb = MB(mats)
    for s in (-1, 1):
        a, b = sorted((s*13.8, s*18.5))
        if detailed:
            mb.box(0, 15.24, a, b, -0.3, 0, "bridge_paint")
            faces = mb.box(0, 15.24, s*17.5-0.18, s*17.5+0.18, -7.6, -0.3, "bridge_paint")
            # One open bay end is hidden by its repeated neighbour.
            bmesh.ops.delete(mb.bm, geom=[faces[-1]], context="FACES_ONLY")
        else:
            mb.box(0, 15.24, a, b, -7.6, 0, "bridge_paint")
        if detailed:
            ob = atlas_panel(name+f"_truss_{s}".replace("-", "n"), mats, "bridge_paint", r,
                             15.24, 7.3, (0, 0, -3.95), "golden-gate-truss")
            # Rotate the front plane onto the two outward X faces.
            ob.rotation_euler[2] = s*3.141592653589793/2
            ob.location.x = s*17.69
            ob.location.y = -7.62
    mb.build(name+"_body", mats, r)


def main():
    reset_scene()
    mats = make_mats(COLOURS)
    tower("gg_tower_lod0", mats, True)
    tower("gg_tower_lod1", mats, False)
    bay("gg_bay_lod0", mats, True)
    bay("gg_bay_lod1", mats, False)
    r = root("gg_suspender")
    r["unit_m"], r["cable_saddle_x_m"] = 1, 17.5
    mb = MB(mats)
    for x in (-17.5, 17.5):
        for f in (-0.25, 0.25):
            # Open ends: the deck/cable close these four-sided unit ropes.
            mb.loft([[P(x+dx, f+df, h) for dx, df in
                      ((-0.06, -0.06), (0.06, -0.06), (0.06, 0.06), (-0.06, 0.06))]
                     for h in (0, 1)], "bridge_paint", caps=False)
    mb.build("gg_suspender_body", mats, r)
    r = root("gg_anchorage")
    r["foundation_m"], r["cable_entry_m"] = 72, 6
    mb = MB(mats)
    mb.box(-46, 0, -21, 21, -72, -0.3, "concrete")
    for x in (-17.75, 17.75):
        mb.box(-38, 0, x-3.25, x+3.25, -0.3, 3, "concrete")
        mb.box(-23, 0, x-2.8, x+2.8, 3, 6.5, "concrete")
        mb.box(-13, -2, x-2.3, x+2.3, 6.5, 8, "concrete")
    mb.build("gg_anchorage_body", mats, r)
    r = root("gg_approach_pier")
    r["height_m"], r["deck_w_m"] = 10, 27.6
    mb = MB(mats)
    for x in (-15.5, 15.5):
        mb.box(-1, 1, x-0.7, x+0.7, 0, 9, "bridge_paint")
    mb.box(-1.2, 1.2, -17.5, 17.5, 9, 10, "bridge_paint")
    for a, b in ((-15.5, 15.5), (15.5, -15.5)):
        mb.tube([(a, 0, 0.5), (b, 0, 8.5)], [0.18]*2, "bridge_paint", sides=4)
    mb.build("gg_approach_pier_body", mats, r)
    r = root("gg_fort_arch")
    r["bay_m"], r["deck_w_m"], r["pier_m"] = 98, 27.6, 50
    mb = MB(mats)
    mb.box(0, 98, -13, 13, -50, -35, "brick")
    for x in (-17.5, 17.5):
        points = [(0, -35), (16, -17), (33, -7), (49, -3),
                  (65, -7), (82, -17), (98, -35)]
        for (f0, h0), (f1, h1) in zip(points, points[1:]):
            mb.xprism([(f0, h0), (f1, h1), (f1, h1+1.6), (f0, h0+1.6)],
                      x-0.8, x+0.8, "bridge_paint")
        # Thin outward web plates support the cap from the arch; no roadway is authored.
        for f, h in points[1:-1]:
            mb.side_quad(x + (0.8 if x > 0 else -0.8), f-0.35, f+0.35,
                         h+1.6, -0.8, "bridge_paint", 1 if x > 0 else -1)
        mb.box(0, 98, x-0.4, x+0.4, -0.8, -0.3, "bridge_paint")
    mb.build("gg_fort_arch_body", mats, r)
    export(out_path(), texcoords=True)


main()
