"""Portland bridge portals and original salmon sign / rain-cloud square; no baked words."""

import math
import sys
from pathlib import Path

import bmesh

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {
    "bridge_paint": "#547366", "trim": "#b4bcae", "steel_dark": "#344449",
    "concrete": "#a7aaa2", "stone": "#848e8b", "brick": "#925745",
    "glass": "#304b50", "sign_face": "#183b40", "neon": "#edba72", "foliage": "#4b6355",
}
ROOTS = ["pdx_lift_tower_lod0", "pdx_lift_tower_lod1", "pdx_truss_bay", "pdx_lift_span",
         "pdx_bascule_pier", "pdx_st_johns_tower_lod0", "pdx_st_johns_tower_lod1",
         "pdx_roof_sign", "pdx_plaza"]
XS = [-240, -190, -140, -90, -40, 10, 60, 110, 180]


def root(name, **extras):
    ob = empty(name, loc=(XS[ROOTS.index(name)], 0, 0))
    for key, value in extras.items():
        ob[key] = value
    return ob


def strut(mb, points, radius=0.15, role="bridge_paint", sides=3):
    # Ends buried in chords need no caps. Open tubes are still real three-dimensional members.
    faces = mb.tube(points, [radius]*len(points), role, sides=sides)
    bmesh.ops.delete(mb.bm, geom=faces[-2:], context="FACES_ONLY")


def lift(name, mats, detailed):
    r = root(name, top_m=36, foundation_m=20, deck_w_m=19)
    mb = MB(mats)
    for side in (-1, 1):
        x0, x1 = sorted((side*10.6, side*15.5))
        mb.box(-4, 4, x0, x1, -20, 0, "concrete")
        if detailed:
            for x in (side*11.1, side*15):
                for f in (-3, 3):
                    mb.box(f-0.35, f+0.35, x-0.35, x+0.35, 0, 34.2, "bridge_paint")
            # A pair of broad lattice faces, each subdivided into four vertical panels.
            for f in (-3, 3):
                for k in range(4):
                    lo, hi = k*8.3, (k+1)*8.3
                    a, b = (11.1, 15) if k % 2 == 0 else (15, 11.1)
                    strut(mb, [(side*a, f, lo), (side*b, f, hi)], 0.16)
                    strut(mb, [(side*11.1, f, hi), (side*15, f, hi)], 0.16)
            mb.box(-1.6, 1.6, side*13.05-1.1, side*13.05+1.1, 20, 26, "steel_dark")
            for f in (-1.4, 1.4):
                mb.cyl((side*13, f, 34.2), "f", 1.8, 0.3, 8, "steel_dark")
        else:
            mb.box(-3.35, 3.35, x0+0.2, x1-0.2, 0, 36, "bridge_paint")
    if detailed:
        for f in (-2, 2):
            for h in (30.3, 33.4):
                mb.box(f-0.18, f+0.18, -13, 13, h-0.18, h+0.18, "bridge_paint")
            for k in range(6):
                a = -13+k*26/6
                strut(mb, [(a, f, 30.3), (a+26/6, f, 33.4)], 0.12)
    else:
        mb.box(-2.18, 2.18, -13, 13, 30.12, 33.58, "bridge_paint")
    mb.build(name+"_body", mats, r)


def truss(name, mats, length, height, panels):
    r = root(name, bay_m=length, pier_m=1.5, deck_w_m=19)
    mb = MB(mats)
    for side in (-1, 1):
        x = side*10.4
        for h in (0.1, height-0.2):
            mb.box(0, length, x-0.25, x+0.25, h-0.2, h+0.2, "bridge_paint")
        for k in range(panels+1):
            f = k*length/panels
            # At the ends keep tubes' radii inside the exact bay length.
            ff = min(length-0.16, max(0.16, f))
            strut(mb, [(x, ff, 0.1), (x, ff, height-0.2)], 0.15)
        for k in range(panels):
            a, b = k*length/panels+0.16, (k+1)*length/panels-0.16
            if k >= panels/2:
                a, b = b, a
            strut(mb, [(x, a, 0.2), (x, b, height-0.25)], 0.12)
    for f in (0.3, length-0.3):
        strut(mb, [(-10.4, f, height-0.2), (10.4, f, height-0.2)], 0.16)
    # A narrow floor beam, wholly below the deck/traffic clearance, never a deck surface.
    mb.box(length/2-0.3, length/2+0.3, -10.65, 10.65, -1.5, -0.5, "steel_dark")
    mb.build(name+"_body", mats, r)


def bascule(mats):
    name = "pdx_bascule_pier"
    r = root(name, foundation_m=18, deck_w_m=19)
    mb = MB(mats)
    mb.box(-5, 5, -15.5, 15.5, -18, -1.6, "concrete")
    for side in (-1, 1):
        x = side*13.5
        mb.box(-4.5, 4.5, x-2.8, x+2.8, -1.6, 0, "stone")
        mb.box(-3.5, 3.5, x-2.5, x+2.5, 0, 7.7, "stone")
        # Hipped four-face roof rising to a short ridge.
        lip = mb.loft([[P(x+dx, f, h) for dx, f in ((-2.8,-3.8),(2.8,-3.8),(2.8,3.8),(-2.8,3.8))]
                      for h in (7.7, 7.9)], "trim")
        # The roof hull closes this ring; a second coincident top face would flicker.
        bmesh.ops.delete(mb.bm, geom=[lip[-1]], context="FACES_ONLY")
        mb.hull([(x+dx, f, 7.9) for dx, f in ((-2.8,-3.8),(2.8,-3.8),(2.8,3.8),(-2.8,3.8))]
                + [(x, -1.2, 10), (x, 1.2, 10)], "steel_dark")
        for h in (1, 4.4):
            for dx in (-1.25, 1.25):
                mb.front_quad(3.53, x+dx-0.45, x+dx+0.45, h, h+2.5, "glass")
            mb.side_quad(x+side*2.53, -1.5, 1.5, h, h+2.5, "glass", side)
        mb.box(-3.51, 3.51, x-2.51, x+2.51, 3.9, 4.1, "trim")
    mb.build(name+"_body", mats, r)


def gothic(name, mats, detailed):
    r = root(name, top_m=125, cable_saddle_x_m=12, deck_y_m=62, deck_w_m=19, foundation_m=6)
    mb = MB(mats)
    for side in (-1, 1):
        x = side*12.7
        mb.box(-5, 5, x-2.5, x+2.5, -6, 0, "concrete")
        mb.loft([[P(x+dx, f, h) for dx, f in ((-w,-d),(w,-d),(w,d),(-w,d))]
                 for h, w, d in ((0,2.5,4),(112,1.8,2))], "bridge_paint")
        mb.fprism([(x-1.8,112),(x+1.8,112),(x,125)], -2, 2, "bridge_paint")
        if detailed:
            mb.box(-0.8, 0.8, side*12-0.65, side*12+0.65, 123.8, 125, "steel_dark")
            for f in (-4, 4):
                for dx in (-1.9, 1.9):
                    strut(mb, [(x+dx, f, 0), (x+dx*0.72, f/2, 112)], 0.19, sides=4)
            for h in (20,40,58,100,111):
                mb.box(-2.7, 2.7, x-2.25, x+2.25, h, h+0.7, "trim")
            for f in (-2.6, 2.6):
                for h in (78,94,108):
                    strut(mb, [(x-1.5,f,h),(x,f,h+4),(x+1.5,f,h)], 0.12)
    # Pointed portals, their inner point lifted well clear of traffic.
    for f in ([-2.3,2.3] if detailed else [0]):
        for a, b in ((-12.5,0),(12.5,0)):
            mb.fprism([(a,75),(b,93),(b,96),(a,78)], f-0.35, f+0.35, "bridge_paint")
        if detailed:
            for h in (99,108):
                for a,b in ((-12,0),(12,0)):
                    strut(mb, [(a,f,h),(b,f,h+7)],0.16)
    mb.build(name+"_body", mats, r)


def roof_sign(mats):
    name = "pdx_roof_sign"
    r = root(name, roof_m=12)
    mb = MB(mats)
    mb.box(-8, 8, -12, 12, 0, 11.5, "brick")
    mb.box(-8.2, 8.2, -12.2, 12.2, 11.5, 12, "trim")
    for h in (1, 4.7, 8.4):
        for x in (-9,-5,-1,3,7):
            mb.front_quad(8.03,x,x+2,h,h+2.4,"glass")
    for x in (-8,8):
        mb.box(3.7,4.1,x-0.2,x+0.2,12,16,"steel_dark")
        strut(mb,[(x,-2,12),(x,3.9,16)],0.15,"steel_dark")
    # Plain rectangular board, wholly unlike the real sign's silhouette and layout.
    mb.box(3.8,4,-8.2,8.2,13.5,17.1,"steel_dark")
    text_panel("pdx_roof_sign_words",mats,"sign_face",r,16,3.2,(0,4.01,15.3))
    # Neon tubing is drawn as open strokes, each running one way along x (or straight): `MB.tube`
    # orients its rings from the travel direction, so a stroke that doubles back, or a loop that
    # closes on itself, twists its tube where the direction flips (CX4 review: a folded, inside-out
    # loop once the optimiser welded its ends).
    corners = [(-8.15,13.55),(8.15,13.55),(8.15,17.05),(-8.15,17.05)]
    for k in range(4):
        (xa,ha),(xb,hb) = corners[k],corners[(k+1) % 4]
        mb.tube([(xa,4.05,ha),(xb,4.05,hb)],[0.10]*2,"neon",sides=3)
    mb.build(name+"_body",mats,r)
    fish = MB(mats)
    # Leaping fish in profile: upturned head, arched back, narrow peduncle and forked tail; the back
    # and the belly are two strokes meeting at the nose and at the tail.
    strokes = (
        ([(-11.8,18.1),(-10.6,19.5),(-8.8,20.6),(-6.9,20.9),(-5.1,20.2),(-4.0,19.0)], 0.175),
        ([(-4.0,19.0),(-5.0,18.9),(-6.8,19.5),(-8.6,19.5),(-10.3,18.5),(-11.8,18.1)], 0.175),
        ([(-11.6,18.2),(-11.9,17.3)], 0.14),
        ([(-11.9,17.3),(-10.8,17.8),(-10.3,18.5)], 0.14),
        ([(-8.8,20.6),(-8.5,21),(-7.8,20.8)], 0.14),
        ([(-7.4,19.5),(-8,18.6)], 0.14),
        ([(-8,18.6),(-8.3,19.5)], 0.14),
    )
    for points, radius in strokes:
        fish.tube([(x,4.1,h) for x,h in points],[radius]*len(points),"neon",sides=3)
    fish.build(name+"_salmon",mats,r)
    mounts = MB(mats)
    for x0,x1,top in ((-8.05,-10.3,18.5),(-7.9,-8.6,19.5),(-5.0,-5.0,18.9)):
        mounts.tube([(x0,3.88,17.1),(x1,4.0,top)], [0.13]*2, "steel_dark", sides=3)
    mounts.build(name+"_mounts",mats,r)


def plaza(mats):
    name = "pdx_plaza"
    r = root(name,column_top_m=13)
    paving = MB(mats)
    paving.box(-28,28,-28,28,0,0.12,"brick")
    paving.build(name+"_paving",mats,r)
    mb = MB(mats)
    for k in range(4):
        edge = 16+k*3
        mb.box(-28,28,edge,edge+3,0,0.6*(k+1),"brick")
        mb.box(edge,edge+3,-28,16,0,0.6*(k+1),"brick")
    for f in (-22,0,22):
        mb.box(f-0.12,f+0.12,-25.12,-24.88,0.12,4.5,"steel_dark")
        mb.box(f-0.55,f+0.55,-25.6,-24.4,4.4,4.65,"trim")
    for f in (-18,-10,10,18):
        mb.box(f-0.16,f+0.16,-27.2,-26.8,0.12,0.85,"steel_dark")
    for x,f in ((-10,-20),(10,-20),(10,10)):
        mb.box(f-1,f+1,x-1,x+1,0.12,0.9,"concrete")
        mb.blob((x,f,1),(1,1,0.5),"foliage")
    mb.build(name+"_body",mats,r)
    weather = MB(mats)
    weather.box(-2,2,-22,-18,0.12,0.55,"stone")
    weather.loft([[P(-20+dx,f,h) for dx,f in ((-w,-w),(w,-w),(w,w),(-w,w))]
                  for h,w in ((0.55,0.8),(10.1,0.45))],"stone")
    cloud_height = 1/math.sqrt(1+((1+math.sqrt(5))/2)**2)*(1+math.sqrt(5))/2
    for x,f,h,s in ((-21.8,0,11.7,1),(-20.6,-0.3,12.1,1),(-19.2,0,12,1.1),
                    (-18,0,11.7,0.9),(-20,0.8,13-cloud_height,1)):
        weather.blob((x,f,h),(1.55,1.2,s),"concrete")
    for x in (-22,-21,-20,-19,-18):
        strut(weather,[(x,0.1,10.9),(x-0.3,0.1,10.2)],0.07,"steel_dark")
    weather.build(name+"_weather",mats,r)


reset_scene()
mats = make_mats(COLOURS)
lift(ROOTS[0],mats,True)
lift(ROOTS[1],mats,False)
truss(ROOTS[2],mats,40,8,3)
truss(ROOTS[3],mats,64,10,6)
bascule(mats)
gothic(ROOTS[5],mats,True)
gothic(ROOTS[6],mats,False)
roof_sign(mats)
plaza(mats)
export(out_path(),texcoords=True,normals=False)
