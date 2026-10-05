"""Keys public landmarks: original buoy bands, blank sign, harbour pier furniture."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {"concrete": "#c9c8bc", "steel_dark": "#283c43", "trim": "#ffffff",
           "car_red": "#d55448", "paint_yellow": "#efca56", "sign_face": "#276548",
           "wood": "#a58463", "light_head": "#fff0c2",
           "brick": "#a76046", "foliage": "#47845a",
           "car_blue": "#203c58", "car_white": "#f2f0e8", "glass": "#293e49", "car_yellow": "#e4a23e"}


def east_martello(mats, root, far):
    """A dry moat ring, low casemates and the squat raised central keep."""
    mb = MB(["brick", "concrete", "steel_dark"])
    root["top_m"] = 12.0
    # The moat is a pale lowered-looking apron; ground never dips below the origin.
    if far:
        mb.box(-24, 24, -24, 24, 0, 0.12, "concrete")
    else:
        for f0, f1, x0, x1 in ((-24, -20, -24, 24), (20, 24, -24, 24),
                               (-20, 20, -24, -20), (-20, 20, 20, 24)):
            mb.box(f0, f1, x0, x1, 0, 0.12, "concrete")
    for f0, f1, x0, x1 in ((-20, -17, -20, 20), (17, 20, -20, 20),
                           (-17, 17, -20, -17), (-17, 17, 17, 20)):
        mb.box(f0, f1, x0, x1, 0, 6, "brick")
    mb.box(-6, 6, -6, 6, 0, 11.2, "brick")
    mb.box(-6.3, 6.3, -6.3, 6.3, 11.2, 12, "brick")
    if not far:
        for f in (-20.02, 20.02):
            for x in (-15, -9, -3, 3, 9, 15):
                if f > 0:
                    mb.front_quad(f, x - 0.48, x + 0.48, 2.8, 4.2, "steel_dark")
                else:
                    # The back's inset dark embrasures wind toward -Z.
                    face = mb.front_quad(f, x - 0.48, x + 0.48, 2.8, 4.2, "steel_dark")[0]
                    face.normal_flip()
        for x in (-20.02, 20.02):
            for f in (-12, -6, 0, 6, 12):
                mb.side_quad(x, f - 0.48, f + 0.48, 2.8, 4.2, "steel_dark", 1 if x > 0 else -1)
        for x in (-4, 0, 4):
            mb.front_quad(6.02, x - 0.45, x + 0.45, 7.3, 9.6, "steel_dark")
        for f0, f1, x0, x1 in ((-20.2, -19.7, -20.2, 20.2), (19.7, 20.2, -20.2, 20.2),
                               (-19.7, 19.7, -20.2, -19.7), (-19.7, 19.7, 19.7, 20.2)):
            mb.box(f0, f1, x0, x1, 5.65, 6.15, "brick")
        for x in (-18.5, 18.5):
            for f in (-18.5, 18.5):
                mb.box(f - 1, f + 1, x - 1, x + 1, 0, 6.15, "brick")
        # Courtyard stair and front entrance lintel make the near fort legible.
        for f, z in ((7, 0.4), (6.7, 0.8), (6.4, 1.2)):
            mb.box(f, f + 0.3, -1.2, 1.2, 0, z, "concrete")
        mb.front_quad(20.03, -1.4, 1.4, 0.12, 3.8, "steel_dark")
    mb.build(f"{root.name}_body", mats, root)


def west_martello(mats, root):
    mb = MB(["brick", "foliage", "wood"])
    # Broken wall runs, with genuine open arches between the surviving piers.
    for side in (-1, 1):
        for x in (-12, -4, 4, 12):
            mb.box(side * 14.7 - 0.35, side * 14.7 + 0.35, x - 0.45, x + 0.45, 0, 4, "brick")
        for x in (-8, 0, 8):
            if side < 0 and x == 0:
                continue
            mb.fprism([(x - 3.55, 2.3), (x - 2, 3.1), (x, 3.5),
                       (x + 2, 3.1), (x + 3.55, 2.3), (x + 3.55, 4), (x - 3.55, 4)],
                      side * 14.7 - 0.35, side * 14.7 + 0.35, "brick")
    for x in (-14.7, 14.7):
        for f0, f1, h in ((-15, -7, 2.4), (-4, 3, 3.2), (8, 15, 2.0)):
            mb.box(f0, f1, x - 0.35, x + 0.35, 0, h, "brick")
    for x, f in ((-7, -5), (6, -6), (8, 5), (-6, 7)):
        mb.blob((x, f, 1.4), (2.5, 2.4, 1.6), "foliage")
    mb.build("west_martello_body", mats, root)


def cruise(name,x,mats,detailed):
    from _lib import P

    root = empty(name,loc=(x,0,0))
    root["top_m"],root["foundation_m"] = 60,8
    mb = MB(["car_blue","car_white","glass","car_yellow","trim"])
    # Squared stern, broad beam, raked and tapered bow: two unequal hull rings.
    bottom = [(-13,-141),(13,-141),(13,104),(0,136),(-13,104)]
    upper = [(-18,-145),(18,-145),(18,110),(0,145),(-18,110)]
    mb.loft([[P(xx,f,h) for xx,f in plan] for plan,h in ((bottom,-8),(upper,12))],"car_blue")
    for f0,f1,w,low,high in ((-132,117,16.5,12,30),(-115,101,15.5,30,45),(-92,78,13.5,45,52)):
        mb.box(f0,f1,-w,w,low,high,"car_white")
    mb.box(-75,-53,-5,5,52,60,"trim")
    if detailed:
        # Eight dark balcony courses on each side, in stepped white superstructure.
        for side in (-1,1):
            for k in range(8):
                h = 14+k*4
                w,f0,f1 = (16.5,-131,115) if h<30 else ((15.5,-114,100) if h<45 else (13.5,-91,77))
                mb.side_quad(side*(w+0.035),f0,f1,h,h+1.65,"glass",side)
            for f in (-97,-65,-33,-1,31,63):
                cx = side*16.5
                boat = [(cx-0.9,f-5.4),(cx-0.9,f+5.4),(cx,f+7),
                        (cx+0.9,f+5.4),(cx+0.9,f-5.4),(cx,f-7)]
                mb.loft([[P(xx,ff,h) for xx,ff in boat] for h in (24.5,27)],"car_yellow")
        # Forward bridge has projecting wings but stays within the hull's beam.
        mb.box(72,85,-18,18,46,49,"car_white")
        mb.front_quad(85.035,-17,17,46.5,48.5,"glass")
        for side in (-1,1):
            mb.side_quad(side*18.035,73,84,46.5,48.5,"glass",side)
        # Roof recreation deck and plain rail silhouettes, no funnel markings.
        mb.box(-24,26,-7,7,52,52.3,"trim")
        mb.box(-23,25,-4,4,52.3,52.45,"glass")
    mb.build(name+"_body",mats,root)


def main():
    reset_scene()
    mats = make_mats(COLOURS)
    root = empty("southernmost_buoy", loc=(-22, 0, 0))
    mb = MB(mats)
    mb.box(-0.99, 0.99, -0.99, 0.99, 0, 0.16, "concrete")
    # Own order: yellow foot, black lower band, white centre, red shoulders and crown.
    for lo, hi, role, r, rt in ((0.16, 0.65, "paint_yellow", 1.065, 1.065),
                               (0.65, 1.35, "steel_dark", 1.065, 1.065),
                               (1.35, 2.30, "trim", 1.065, 1.065),
                               (2.30, 3.20, "car_red", 1.065, 0.72)):
        mb.cyl((0, 0, (lo + hi) / 2), "z", r, (hi - lo) / 2, 16, role, r_top=rt)
    mb.cone((0, 0, 3.2), 0.72, 3.66, 16, "car_red")
    # Backing nests into the front facets; the sign never appears to float from the front.
    mb.box(0.82, 1.068, -0.61, 0.61, 1.37, 2.28, "trim")
    mb.build("southernmost_buoy_body", mats, root)
    text_panel("southernmost_buoy_text", mats, "trim", root, 1.2, 0.9, (0, 1.07, 1.825))

    root = empty("mile_marker_0", loc=(-15, 0, 0))
    mb = MB(mats)
    mb.box(-0.13, -0.05, -0.045, 0.045, 0, 2, "steel_dark")
    mb.box(-0.03, 0.03, -0.30, 0.30, 1.1, 2, "trim")
    mb.build("mile_marker_0_body", mats, root)
    text_panel("mile_marker_0_face", mats, "sign_face", root, 0.54, 0.84, (0, 0.032, 1.55))

    root = empty("mallory_pier", loc=(12, 0, 0))
    root["foundation_m"] = 1.8
    mb = MB(mats)
    mb.box(-12, 0, -15, 15, -0.4, 0, "concrete")
    mb.box(-12, -11.6, -15, 15, -1.8, -0.4, "concrete")
    mb.box(-12, -11.5, -15, 15, 0, 0.18, "concrete")
    for x in (-13, -8, -3, 3, 8, 13):
        mb.cyl((x, -10.7, 0.34), "z", 0.19, 0.34, 6, "steel_dark")
        mb.box(-10.9, -10.5, x-0.31, x+0.31, 0.49, 0.59, "steel_dark")
    for x in (-12, -4, 4, 12):
        mb.cyl((x, -11.1, 2.1), "z", 0.075, 2.1, 6, "steel_dark")
        mb.cyl((x, -11.1, 0.25), "z", 0.16, 0.25, 6, "steel_dark")
        mb.blob((x, -11.1, 4.45), (0.31, 0.31, 0.35), "light_head")
        mb.cone((x, -11.1, 4.70), 0.24, 4.86, 6, "steel_dark")
    # Low sagging chain only between the four lamps; landward edge is entirely open.
    for a in (-12, -4, 4):
        mb.tube([(a, -11.1, 0.9), (a+4, -11.1, 0.55), (a+8, -11.1, 0.9)],
                [0.035]*3, "steel_dark", sides=3)
    for x in (-7, 7):
        mb.box(-7.0, -6.4, x-1.4, x+1.4, 0.47, 0.57, "wood")
        mb.box(-7.05, -6.95, x-1.4, x+1.4, 0.57, 1.15, "wood")
        for dx in (-1.05, 1.05):
            mb.box(-6.9, -6.5, x+dx-0.07, x+dx+0.07, 0, 0.48, "steel_dark")
    mb.build("mallory_pier_body", mats, root)
    east_martello(mats, empty("east_martello_lod0", loc=(68, 0, 0)), False)
    east_martello(mats, empty("east_martello_lod1", loc=(123, 0, 0)), True)
    west_martello(mats, empty("west_martello", loc=(170, 0, 0)))
    cruise("cruise_ship_lod0",280,mats,True)
    cruise("cruise_ship_lod1",335,mats,False)
    export(out_path(), texcoords=True)


main()
