"""Keys public landmarks: original buoy bands, blank sign, harbour pier furniture."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {"concrete": "#c9c8bc", "steel_dark": "#283c43", "trim": "#ffffff",
           "car_red": "#d55448", "paint_yellow": "#efca56", "sign_face": "#276548",
           "wood": "#a58463", "light_head": "#fff0c2"}


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
    export(out_path(), texcoords=True)


main()
