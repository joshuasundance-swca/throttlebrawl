"""CX6: six terrace flats, apartment blocks and handed corner shops; blank names."""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {
    "paint_sage": "#9db49c", "paint_cream": "#eee0bc", "paint_lilac": "#b7a7c6",
    "paint_mint": "#9ebfaf", "paint_yellow": "#e4c986", "paint_blue": "#91acc1",
    "concrete": "#b8b3a7", "trim": "#f4efe4", "glass": "#293b43", "wood": "#77563d",
    "steel_dark": "#30373b", "canvas": "#73846e", "tile_red": "#b76446",
}
ROOTS = ["sf_flats_a", "sf_flats_b", "sf_apartment_a", "sf_apartment_b", "sf_corner_l", "sf_corner_r"]
XS = [-46, -34, -17, 4, 25, 46]
PAINTS = ["paint_sage", "paint_cream", "paint_lilac", "paint_mint", "paint_yellow", "paint_blue"]


def win(mb, x, f, h, width=0.85, height=1.9):
    mb.front_quad(f+0.025, x-width/2-0.12, x+width/2+0.12, h-0.12, h+height+0.12, "trim")
    mb.front_quad(f+0.05, x-width/2, x+width/2, h, h+height, "glass")


def sidewin(mb, side, f, h, width=1.3, x=6.8):
    mb.side_quad(side*(x+0.025), f-width/2-0.12, f+width/2+0.12, h-0.12, h+2.02, "trim", side)
    mb.side_quad(side*(x+0.05), f-width/2, f+width/2, h, h+1.9, "glass", side)


def mass(mb,w,top,paint,door_x):
    # A notched front extrusion leaves an actual 35 cm entrance recess.
    mb.box(-11,-0.35,-w,w,0,top,paint)
    mb.fprism([(-w,0),(door_x-0.65,0),(door_x-0.65,3.25),
               (door_x+0.65,3.25),(door_x+0.65,0),(w,0),(w,top),(-w,top)],-0.35,0,paint)


def entry(mb, x):
    mb.front_quad(-0.325, x-0.62, x+0.62, 0.6, 3.2, "trim")
    mb.front_quad(-0.30, x-0.48, x+0.48, 0.6, 3.05, "wood")
    for f, end, h in ((-0.35, 0.58, 0.6), (0.6, 1.08, 0.4), (1.1, 1.58, 0.2)):
        mb.box(f, end, x-0.6, x+0.6, 0, h, "trim")


def garage(mb, x, width=2.7):
    mb.front_quad(0.025, x-width/2-0.12, x+width/2+0.12, 0, 2.9, "trim")
    mb.front_quad(0.05, x-width/2, x+width/2, 0, 2.75, "wood")
    for h in (0.7, 1.4, 2.1):
        mb.front_quad(0.055, x-width/2, x+width/2, h, h+0.025, "steel_dark")


def cornice(mb, w, top, brackets=False, sparse=False):
    mb.box(-0.15, 0.55, -w-0.08, w+0.08, top-0.55, top, "trim")
    if brackets:
        positions = (-w+0.35,w-0.35) if sparse else (-w+0.35, -w/3, w/3, w-0.35)
        for x in positions:
            mb.box(0, 0.42, x-0.1, x+0.1, top-1, top-0.56, "trim")


def flats(mb, paint, curved):
    mass(mb,3.2,14.4,paint,2.1)
    garage(mb, -0.95)
    entry(mb, 2.1)
    if curved:
        # Six bowed facets sweep a wide bay; its flat rear is buried in the main volume.
        plan = [(-2.8, 0), (-2.5, 0.65), (-1.85, 1.05), (-0.95, 1.2),
                (-0.05, 1.05), (0.6, 0.65), (0.9, 0)]
        mb.loft([[P(x, f, h) for x, f in plan] for h in (3.4, 13.5)], paint)
        for h in (4.1, 7.4, 10.7):
            for x, f in ((-1.95, 1.02), (-0.95, 1.2), (0.05, 1.02)):
                win(mb, x, f, h, 0.65)
        # Faceted arched door crown, no lettering or decorative copied design.
        mb.fprism([(1.48, 3.05), (1.7, 3.48), (2.1, 3.68), (2.5, 3.48), (2.72, 3.05)],
                  0.03, 0.12, "wood")
        mb.xprism([(-0.5, 14.4), (0.65, 13.9), (0.65, 14.05), (-0.5, 14.6)], -3.28, 3.28, "tile_red")
    else:
        mb.box(0, 1.05, -2.75, 0.85, 3.4, 13.6, paint)
        for h in (4.1, 7.4, 10.7):
            for x in (-2.1, -0.95, 0.2):
                win(mb, x, 1.05, h)
        cornice(mb, 3.2, 14.6, True)
    for h in (6.7, 10):
        mb.box(0, 1.25, -2.8, 0.9, h, h+0.16, "trim")


def apartment(mb, modern):
    top = 20 if modern else 18
    paint = "concrete" if modern else "paint_lilac"
    mass(mb,6.8,top-0.25,paint,5.15 if modern else 0)
    if modern:
        garage(mb, -4.65, 2.6)
        garage(mb, -1.45, 2.6)
        mb.front_quad(0.03, 0.3, 3.6, 0.2, 3.1, "glass")
        entry(mb, 5.15)
        for k in range(5):
            h = 3.5+k*3.2
            mb.front_quad(0.04, -6.5, 3.9, h, h+1.6, "glass")
            mb.front_quad(0.045, -6.5, 3.9, h+1.65, h+2.85, "paint_mint")
            mb.box(0, 1.9, 4.2, 6.7, h-0.18, h, "trim")
            mb.box(1.75, 1.83, 4.2, 6.7, h+0.9, h+0.98, "steel_dark")
            for x in (4.25, 6.65):
                mb.box(1.75, 1.83, x-0.035, x+0.035, h, h+0.9, "steel_dark")
        cornice(mb, 6.8, top)
    else:
        garage(mb, -4.6)
        entry(mb, 0)
        mb.box(0, 1.6, -1.5, 1.5, 3.3, 3.55, "trim")
        for x in (-1.2, 1.2):
            mb.box(1.05, 1.35, x-0.12, x+0.12, 0.6, 3.3, "trim")
        for x in (-4.7, 0, 4.7):
            mb.box(0, 0.8, x-1.65, x+1.65, 3.6, 16.7, paint)
            for h in (4.1, 7.3, 10.5, 13.7):
                for dx in (-0.85, 0.85):
                    win(mb, x+dx, 0.8, h, 1.05)
        for k in range(4):
            h = 4+k*3.2
            mb.box(0.86, 1.6, 3.1, 6.25, h, h+0.12, "steel_dark")
            mb.box(1.52, 1.6, 3.1, 6.25, h+0.8, h+0.86, "steel_dark")
            if k < 3:
                a, b = (3.25, 6.0) if k % 2 == 0 else (6.0, 3.25)
                mb.tube([(a, 1.2, h+0.13), (b, 1.2, h+3.2)], [0.065]*2, "steel_dark", sides=3)
        cornice(mb, 6.8, top, True, sparse=True)


def corner(mb, paint, side):
    # Both hands are positively wound geometry, never a reflected object transform.
    # Chamfer the street corner for a diagonal shop entrance.
    if side < 0:
        plan = [(-6.3, -11), (6.8, -11), (6.8, 0), (-5.45, 0), (-6.3, -0.85)]
    else:
        plan = [(-6.8, -11), (6.3, -11), (6.3, -0.85), (5.45, 0), (-6.8, 0)]
    mb.loft([[P(x, f, h) for x, f in plan] for h in (0, 15)], paint)
    for x in (-3.8, 0, 3.8):
        mb.front_quad(0.04, x-1.6, x+1.6, 0.35, 3.0, "glass")
    mb.side_quad(side*6.34, -9.8, -1.5, 0.35, 3, "glass", side)
    door = [(side*5.49, 0.04, 0.2), (side*6.34, -0.81, 0.2),
            (side*6.34, -0.81, 3), (side*5.49, 0.04, 3)]
    face = mb.bm.faces.new([mb.v(P(*p)) for p in door])
    mb.tag([face], "wood", closed=False)
    face.normal_update()
    if face.normal.dot(P(side, 1, 0)) < 0:
        face.normal_flip()
    mb.xprism([(0, 3.6), (1.7, 3.1), (1.7, 3.2), (0, 3.7)], -5.8, 5.8, "canvas")
    for x in (-3.6, 2):
        mb.box(0, 0.85, x-1.5, x+1.5, 4.1, 14.35, paint)
        for h in (4.7, 7.9, 11.1):
            for dx in (-0.8, 0.8):
                win(mb, x+dx, 0.85, h)
    mb.box(-7, -3.8, side*6.3-0.5, side*6.3+0.5, 4.1, 14.35, paint)
    for h in (4.7, 7.9, 11.1):
        for f in (-9, -5.9, -2.5):
            sidewin(mb, side, f, h, x=6.8 if f == -5.9 else 6.3)
    # Polygonal corner bay carries through three storeys, ending at the cornice.
    mb.cyl((side*5.3, -0.05, 9.2), "z", 1.45, 5.1, 6, paint, phase=math.pi/6)
    for h in (4.7, 7.9, 11.1):
        win(mb, side*5.3, 1.2057, h, 0.9)
    cornice(mb, 6.8, 15.4)
    mb.box(-11, -0.9, side*6.75-0.1, side*6.75+0.1, 14.85, 15.4, "trim")


reset_scene()
mats = make_mats(COLOURS)
for i, name in enumerate(ROOTS):
    r = empty(name, loc=(XS[i], 0, 0))
    r["plots"] = 1 if i < 2 else 2
    r["width_m"] = 6.4 if i < 2 else 13.6
    mb = MB(COLOURS)
    if i < 2:
        flats(mb, PAINTS[i], i == 1)
    elif i < 4:
        apartment(mb, i == 3)
    else:
        corner(mb, PAINTS[i], -1 if i == 4 else 1)
    mb.build(name+"_body", mats, r)
    if i >= 4:
        text_panel(name+"_sign", mats, "trim", r, 4, 0.65, (0, 0.06, 3.85))
export(out_path(), texcoords=True, normals=False)
