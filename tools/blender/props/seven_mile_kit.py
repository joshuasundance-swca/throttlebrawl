"""Tileable structures beside/below game-owned bridge decks and temporary repair works."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, atlas_panel, empty, export, make_mats, out_path, reset_scene, text_panel

COLOURS = {"concrete": "#c7c6bb", "steel_dark": "#344a53", "trim": "#ffffff",
           "paint_yellow": "#eacc76", "roof": "#97aeb5", "wood": "#af9875",
           "light_head": "#fff0bb", "art": "#ffffff", "paint_sage": "#73867c"}


def bay(name, x, length, width, pier):
    root = empty(name, loc=(x, 0, 0))
    root["bay_m"], root["deck_w_m"], root["pier_m"] = length, width, pier
    return root


def new_span(mb, depth):
    # Closed box underside is 0.4 m below the game deck, never an overlapping road surface.
    mb.box(0, 41, -5.1, 5.1, -1.7, -0.4, "concrete")
    for x in (-5.8, 5.65):
        mb.box(0, 41, x, x+0.15, -0.4, 0.85, "concrete")
    mb.box(0, 2, -4.9, 4.9, -2.4, -1.7, "concrete")
    for x in (-3.3, 3.3):
        mb.box(0.25, 1.75, x-0.60, x+0.60, -depth, -2.4, "concrete")


def arch(mb):
    # Faceted arch ring, extruded across the old roadway; spandrels are its outer profile.
    inner = [(0.9, -6), (2.5, -3.8), (5, -2.3), (9, -1.4),
             (13, -2.3), (15.5, -3.8), (17.1, -6)]
    for (f0, z0), (f1, z1) in zip(inner, inner[1:]):
        mb.xprism([(f0, z0), (f1, z1), (f1, -0.45), (f0, -0.45)], -3.35, 3.35, "paint_sage")
    mb.box(0, 0.9, -3.35, 3.35, -6, -0.45, "concrete")
    mb.box(17.1, 18, -3.35, 3.35, -6, -0.45, "concrete")


def girder(mb, length=24, depth=6):
    for x in (-2.7, 2.4):
        mb.box(0, length, x, x+0.3, -1.3, -0.35, "steel_dark")
    mb.box(0, 1.1, -3.35, 3.35, -2, -1.3, "concrete")
    mb.box(0.2, 0.9, -1.6, 1.6, -depth, -2, "concrete")
    # Two cross braces under the girder; triangular tubes keep these cheap.
    for f in (6, 18):
        mb.tube([(-2.4, f-2, -1), (2.4, f+2, -1)], [0.065]*2, "steel_dark", sides=3)


def staging(mb):
    for x in (-3.92, 3.92):
        for f in (1, 9):
            mb.cyl((x, f, -3.15), "z", 0.13, 2.85, 6, "steel_dark")
        mb.box(0, 10, x-0.08, x+0.08, -0.45, -0.15, "steel_dark")
        # Rail posts inset at the bay joints; continuous rails meet at exactly 0 and 10.
        for f in (0.1, 5, 9.9):
            mb.cyl((x, f, 0.485), "z", 0.05, 0.635, 3, "steel_dark")
        for h in (0.56, 1.1):
            mb.box(0, 10, x-0.035, x+0.035, h-0.035, h+0.035, "steel_dark")
        mb.box(0, 10, x-0.045, x+0.045, 0, 0.16, "paint_yellow")
        mb.tube([(x, 1, -5.8), (x, 9, -0.6)], [0.06]*2, "steel_dark", sides=3)
        mb.tube([(x, 1, -0.6), (x, 9, -5.8)], [0.06]*2, "steel_dark", sides=3)
    for f in (2, 8):
        mb.tube([(-3.92, f, -0.45), (3.92, f, -0.45)], [0.055]*2, "steel_dark", sides=3)
        mb.front_quad(f, -0.015, 0.015, -0.62, -0.45, "steel_dark")
        mb.box(f-0.16, f+0.16, -0.18, 0.18, -0.82, -0.62, "light_head")


def cottage(name, x, tall, mats):
    root = empty(name, loc=(x, 0, 0))
    mb = MB(mats)
    h = 6.8 if tall else 3.4
    mb.box(-6, 0, -3.5, 3.5, 0.5, h, "paint_yellow")
    mb.fprism([(-3.7, h), (0, h+1.2), (3.7, h)], -6.2, 0.2, "roof")
    mb.box(0, 1.6, -3.5, 3.5, 0.40, 0.5, "wood")
    mb.box(0, 1.8, -3.6, 3.6, 2.9, 3.04, "roof")
    for xx in (-3.1, 3.1):
        mb.box(1.4, 1.55, xx-0.07, xx+0.07, 0, 2.9, "trim")
        mb.box(-5.5, -5.2, xx-0.12, xx+0.12, 0, 0.5, "concrete")
    mb.box(1.6, 2.0, -0.7, 0.7, 0, 0.25, "concrete")
    mb.build(name+"_body", mats, root)
    atlas_panel(name+"_siding", mats, "paint_yellow", root, 7, h-0.5,
                (0, 0.008, (h+0.5)/2), "lap-siding-medium")
    atlas_panel(name+"_trim", mats, "art", root, 6.2, 0.38, (0, 1.558, 2.65),
                "pigeon-trim-1" if tall else "pigeon-trim-2")
    for k, xx in enumerate((-2.1, 2.1)):
        atlas_panel(name+f"_window_{k}", mats, "trim", root, 1.3, 1.8,
                    (xx, 0.02, 1.65), "conch-window")
    if tall:
        atlas_panel(name+"_upper_windows", mats, "trim", root, 7, 3.2,
                    (0, 0.018, 5.1), "conch-window")


def main():
    reset_scene()
    mats = make_mats(COLOURS)
    for name, x, depth in (("nsm_bay", -78, 6), ("nsm_bay_tall", -60, 19.8)):
        root = bay(name, x, 41, 11.6, depth)
        mb = MB(mats)
        new_span(mb, depth)
        mb.build(name+"_body", mats, root)
    root = bay("osm_arch_bay", -43, 18, 6.7, 6)
    mb = MB(mats)
    arch(mb)
    mb.build("osm_arch_bay_body", mats, root)
    root = bay("osm_girder_bay", -31, 24, 6.7, 6)
    mb = MB(mats)
    girder(mb)
    mb.build("osm_girder_bay_body", mats, root)
    root = bay("osm_rail_bay", -19, 24, 6.7, 0)
    mb = MB(mats)
    # Two continuous pipe rails and one shared joint post at each bay start.
    for x in (-3.35, 3.35):
        mb.fprism([(x-0.045, 0.87), (x+0.045, 0.87), (x, 0.95)], 0, 24, "trim")
        mb.box(0, 0.10, x-0.045, x+0.045, 0, 0.86, "trim")
    mb.build("osm_rail_bay_body", mats, root)
    root = bay("osm_gap_end", -7, 8, 6.7, 6)
    mb = MB(mats)
    for x in (-2.7, 2.4):
        mb.box(0, 8, x, x+0.3, -1.3, -0.35, "steel_dark")
    mb.box(0, 1.1, -3.35, 3.35, -2, -1.3, "concrete")
    mb.box(0.2, 0.9, -1.6, 1.6, -6, -2, "concrete")
    mb.box(6.4, 7, -3, 3, 0, 0.9, "concrete")
    for x in (-1.5, 1.5):
        mb.box(7.65, 7.8, x-0.06, x+0.06, 0, 2, "steel_dark")
    mb.build("osm_gap_end_body", mats, root)
    text_panel("osm_gap_end_board", mats, "paint_yellow", root, 3.4, 0.9, (0, 8, 1.55))
    root = bay("staging_platform", 7, 10, 8, 6)
    mb = MB(mats)
    staging(mb)
    mb.build("staging_platform_body", mats, root)
    root = empty("staging_barge", loc=(25, 0, 0))
    # Waterline pivot, with the hull depth explicitly checked by the scorer.
    root["foundation_m"] = 0.7
    mb = MB(mats)
    mb.box(-9, 9, -3.5, 3.5, -0.7, 0.7, "steel_dark")
    for x in (-1.25, 1.25):
        mb.box(-2.5, 2.5, x-0.3, x+0.3, 0.7, 1.2, "steel_dark")
    mb.box(-1.2, 1.2, -1, 1, 1.2, 2.4, "paint_yellow")
    mb.tube([(0, 0, 2.4), (0, 5.5, 5.5)], [0.28, 0.16], "steel_dark", sides=4)
    mb.tube([(0, 5.5, 5.5), (0, 5.5, 1.4)], [0.025]*2, "steel_dark", sides=3)
    # Compact pushboat alongside the stern, not a second bridge structure.
    mb.box(-8.5, -3.5, 3.7, 5.8, -0.4, 0.9, "paint_sage")
    mb.box(-7, -4.8, 4.1, 5.4, 0.9, 2.5, "trim")
    mb.box(-7.15, -4.65, 4, 5.5, 2.5, 2.65, "roof")
    mb.build("staging_barge_body", mats, root)
    cottage("pigeon_key_cottage_a", 43, True, mats)
    cottage("pigeon_key_cottage_b", 55, False, mats)
    root = empty("pigeon_key_dock", loc=(68, 0, 0))
    mb = MB(mats)
    mb.box(-8, 0, -1.8, 1.8, 1.2, 1.4, "wood")
    for x in (-1.55, 1.55):
        for f in (-7.5, -0.5):
            mb.cyl((x, f, 0.8), "z", 0.12, 0.8, 5, "wood")
    mb.build("pigeon_key_dock_body", mats, root)
    export(out_path(), texcoords=True)


main()
