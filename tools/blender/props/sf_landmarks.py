"""Coit Tower's fluted concrete and the Golden Gate's blank toll gantry."""
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {"concrete": "#e0d9c4", "stone": "#b5b1a4", "glass": "#263d43",
           "steel_dark": "#34444a", "sign_face": "#e6e6de"}


def coit(name, x, mats, detailed):
    r = empty(name, loc=(x, 0, 0))
    r["foundation_m"] = 4
    mb = MB(mats)
    mb.box(-10, 10, -10, 10, -4, 0, "stone")
    mb.box(-8, 8, -9, 9, 0, 6, "concrete")
    mb.box(8, 11, -8, 8, 0, 0.4, "stone")
    n = 16 if detailed else 12
    mb.cyl((0, 0, 30), "z", 5.1, 24, n, "concrete")
    mb.cyl((0, 0, 58), "z", 5.1, 4, n, "glass")
    mb.cyl((0, 0, 63), "z", 5.6, 1, n, "concrete")
    if detailed:
        for k in range(12):
            a = k*math.tau/12
            xx, ff = 4.95*math.cos(a), 4.95*math.sin(a)
            mb.cyl((xx, ff, 30), "z", 0.55, 24, 5, "concrete")
            # A ring of piers and arch crowns leaves tall dark openings between them.
            mb.cyl((xx, ff, 58), "z", 0.55, 4, 5, "concrete")
            mb.blob((xx, ff, 61.2), (0.9, 0.9, 0.8), "concrete")
    mb.build(name+"_body", mats, r)


def main():
    reset_scene()
    mats = make_mats(COLOURS)
    coit("coit_tower", -45, mats, True)
    coit("coit_tower_lod1", -15, mats, False)
    r = empty("toll_gantry", loc=(25, 0, 0))
    r["span_m"] = 31
    mb = MB(mats)
    for x in (-15.5, 15.5):
        mb.box(-1, 1, x-0.8, x+0.8, 0, 0.45, "concrete")
        mb.box(-0.35, 0.35, x-0.3, x+0.3, 0.45, 8.5, "steel_dark")
    for f in (-0.4, 0.4):
        for h in (6.2, 8.3):
            mb.box(f-0.1, f+0.1, -15.5, 15.5, h-0.1, h+0.1, "steel_dark")
        for x in (-12, -8, -4, 0, 4, 8, 12):
            mb.tube([(x-2, f, 6.2), (x+2, f, 8.3)], [0.065]*2,
                    "steel_dark", sides=3)
    for x in (-10.3, -6.3, -2.3, 2.3, 6.3, 10.3):
        mb.box(-0.5, 0.5, x-0.35, x+0.35, 5.8, 6.4, "steel_dark")
    mb.box(0.45, 0.65, -5, 5, 6.5, 8.1, "steel_dark")
    mb.build("toll_gantry_body", mats, r)
    text_panel("toll_gantry_sign", mats, "sign_face", r, 10, 1.6, (0, 0.655, 7.3))
    export(out_path(), texcoords=True)


main()
