"""Coit Tower's fluted concrete and the Golden Gate's blank toll gantry."""
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {"concrete": "#e0d9c4", "stone": "#b5b1a4", "glass": "#263d43",
           "steel_dark": "#34444a", "sign_face": "#e6e6de",
           "car_red": "#a74235", "tile_green": "#4f806c"}


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


def gate_roof(mb, xc, half_width, base, top):
    # Convex hip and four convex eave courses avoid ambiguous outward normals
    # on one concave, upturned loft (the independent export guard re-derives them).
    outer = [(xc+dx, f, base+0.4) for dx, f in
             ((-half_width,-1.8),(half_width,-1.8),(half_width,1.8),(-half_width,1.8))]
    inner = [(xc+dx, f, base+0.18) for dx, f in
             ((-half_width*0.78,-1.35),(half_width*0.78,-1.35),
              (half_width*0.78,1.35),(-half_width*0.78,1.35))]
    mb.hull(inner + [(xc+dx, f, top) for dx, f in
                    ((-half_width*0.48,-0.12),(half_width*0.48,-0.12),
                     (half_width*0.48,0.12),(-half_width*0.48,0.12))], "tile_green")
    for i in range(4):
        j = (i+1) % 4
        lip = [outer[i],outer[j],inner[j],inner[i]]
        mb.hull(lip + [(x,f,h-0.12) for x,f,h in lip], "tile_green")


def dragon_gate(mats):
    name = "sf_dragon_gate"
    root = empty(name, loc=(65, 0, 0))
    root["top_m"] = 11
    mb = MB(["stone", "concrete", "car_red", "tile_green"])
    for x in (-10, -6.7, 6.7, 10):
        mb.box(-0.7, 0.7, x-0.48, x+0.48, 0, 0.55, "stone")
        mb.box(-0.34, 0.34, x-0.34, x+0.34, 0.55, 7.6, "car_red")
    mb.box(-0.5, 0.5, -7.05, 7.05, 7.4, 8.3, "concrete")
    mb.box(-0.55, 0.55, -7.1, 7.1, 8.3, 8.5, "tile_green")
    gate_roof(mb, 0, 7.5, 8.5, 11)
    for side in (-1, 1):
        x = side*8.6
        mb.box(-0.5, 0.5, x-2.1, x+2.1, 6.5, 7.2, "concrete")
        gate_roof(mb, x, 2.4, 7.2, 8.5)
        # Invented block guardians outside the road opening.
        xx = side*10
        mb.box(0.8, 2, xx-0.5, xx+0.5, 0, 0.55, "stone")
        mb.box(1, 1.8, xx-0.32, xx+0.32, 0.55, 1.35, "stone")
        mb.blob((xx, 1.65, 1.6), (0.42, 0.4, 0.4), "stone")
    mb.build(name+"_body", mats, root)
    text_panel("sf_dragon_gate_plaque", mats, "sign_face", root,
               4, 0.65, (0, 0.565, 7.85))


def arch_face(mb, x, bottom, spring, radius, role, f=0.025):
    profile = [(x-radius,bottom),(x+radius,bottom),(x+radius,spring)]
    profile += [(x+radius*math.cos(i*math.pi/4), spring+radius*math.sin(i*math.pi/4))
                for i in range(1,5)]
    mb.fprism(profile, f-0.02, f, role)


def church(name, x, mats, detailed):
    root = empty(name, loc=(x, 0, 0))
    root["top_m"] = 58
    mb = MB(["concrete", "stone", "glass"])
    if detailed:
        # A real recess in the front wall, backed 0.4 m behind the facade.
        mb.box(-18, -0.45, -15, 15, 0, 20, "concrete")
        mb.box(-0.45, 0, -15, -4, 0, 20, "concrete")
        mb.box(-0.45, 0, 4, 15, 0, 20, "concrete")
        mb.box(-0.45, 0, -4, 4, 0, 12, "concrete")
        for i in range(8):
            angles = (i*math.tau/8, (i+1)*math.tau/8)
            inner, outer = [], []
            for a in angles:
                c, s = math.cos(a), math.sin(a)
                inner.append((2.7*c, 16+2.7*s))
                q = 4 / max(abs(c), abs(s))
                outer.append((q*c, 16+q*s))
            mb.fprism([outer[0],outer[1],inner[1],inner[0]], -0.45, 0, "stone")
    else:
        mb.box(-18, 0, -15, 15, 0, 20, "concrete")
    mb.fprism([(-8,20),(8,20),(0,29)], -18, 0, "concrete")
    for side in (-1,1):
        xx = side*11.5
        mb.box(-7, 0, xx-3.5, xx+3.5, 20, 42, "concrete")
        mb.cone((xx,-3.5,42), 3.5*math.sqrt(2), 58, 4, "concrete", phase=math.pi/4)
        if detailed:
            for h in (20,29,40):
                mb.box(-7.1, 0.1, xx-3.5, xx+3.5, h, h+0.55, "stone")
            for h in (23,33):
                arch_face(mb,xx,h,h+3.5,1.2,"glass",f=0.03)
            for dx in (-3.1,3.1):
                mb.box(-0.08,0.15,xx+dx-0.18,xx+dx+0.18,0,41.5,"stone")
    if detailed:
        for xx in (-5,0,5):
            arch_face(mb,xx,0,4.8,1.9,"stone",f=0.04)
            arch_face(mb,xx,0,4.8,1.45,"glass",f=0.07)
        # Plain recessed rose disc; no copied glazing or artwork.
        mb.cyl((0,-0.425,16), "f", 2.7, 0.015, 8, "glass")
        for xx in (-7.5,7.5):
            mb.box(-0.1,0.1,xx-0.25,xx+0.25,0,21,"stone")
    mb.build(name+"_body", mats, root)


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
    dragon_gate(mats)
    church("sf_twin_spire_lod0", 110, mats, True)
    church("sf_twin_spire_lod1", 160, mats, False)
    export(out_path(), texcoords=True)


main()
