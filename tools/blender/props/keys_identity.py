"""Keys wildlife, spreading Old Town trees and invented open street bars; no lettering."""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

COLOURS = {
    "bark": "#9a7858", "bark_pale": "#a6a49a", "foliage": "#47845a",
    "foliage_dark": "#326b45", "blossom": "#e96335", "blossom_pale": "#fff0ce",
    "trim": "#ffffff", "steel_dark": "#39454b", "sign_face": "#276548",
    "paint_mint": "#a9d6c2", "paint_cream": "#eee0b8", "roof": "#697a80",
    "wood": "#876348",
}


def deer(mats, root, buck):
    mb = _lib.MB(["bark", "paint_cream", "trim", "steel_dark"])
    shoulder = 0.75 if buck else 0.65
    mb.blob((0, 0, shoulder - 0.13), (0.20, 0.55, 0.23), "bark")
    mb.blob((0, 0, shoulder - 0.23), (0.16, 0.44, 0.10), "paint_cream")
    for x in (-0.12, 0.12):
        for f in (-0.36, 0.34):
            mb.tube([(x, f, 0.04), (x, f + 0.035, shoulder - 0.15)],
                    [0.025, 0.05], "bark", sides=4)
    head_z = 1.02 if buck else 0.24
    head_f = 0.61 if buck else 0.79
    mb.tube([(0, 0.34, shoulder - 0.06), (0, head_f - 0.07, head_z)],
            [0.13, 0.075], "bark", sides=4)
    mb.blob((0, head_f, head_z), (0.105, 0.18, 0.105), "bark")
    mb.blob((0, head_f + 0.15, head_z - 0.015), (0.06, 0.04, 0.055), "steel_dark")
    mb.front_quad(head_f - 0.02, -0.067, 0.067, head_z - 0.14, head_z - 0.075, "trim")
    for x in (-0.105, 0.105):
        mb.hull([(x, head_f - 0.045, head_z), (x * 2.0, head_f - 0.08, head_z + 0.16),
                 (x * 1.65, head_f + 0.02, head_z + 0.07),
                 (x, head_f - 0.015, head_z + 0.035)], "bark")
        # Tiny dark eyes on both visible side faces, distinct from the nose.
        mb.side_quad(x, head_f + 0.01, head_f + 0.035, head_z + 0.018, head_z + 0.041,
                     "steel_dark", 1 if x > 0 else -1)
        if buck:
            mb.tube([(x * 0.6, head_f - 0.04, head_z + 0.07),
                     (x * 1.2, head_f - 0.10, head_z + 0.33)], [0.022, 0.01], "paint_cream", sides=3)
            mb.tube([(x, head_f - 0.075, head_z + 0.23),
                     (x * 1.7, head_f + 0.015, head_z + 0.30)], [0.016, 0.007], "paint_cream", sides=3)
    mb.tube([(0, -0.45, shoulder - 0.02), (0, -0.61, shoulder + 0.01)],
            [0.065, 0.03], "trim", sides=3)
    low = min(v.co.z for v in mb.bm.verts)
    for v in mb.bm.verts:
        v.co.z -= low
    mb.build(f"{root.name}_body", mats, root)


def tree(mats, root, kind):
    mb = _lib.MB(["bark_pale", "foliage", "foliage_dark", "blossom", "blossom_pale"], sway=True)
    if kind == "banyan":
        for x, f in ((0, 0), (-0.75, -0.4), (0.75, 0.3)):
            mb.tube([(x, f, 0), (x * 0.5, f * 0.5, 6.5)], [0.65, 0.35], "bark_pale", sides=5)
        for i in range(8):
            a = i * math.tau / 8
            x, f = 4 * math.cos(a), 4 * math.sin(a)
            mb.tube([(x, f, 0), (x, f, 7.1)], [0.085, 0.07], "bark_pale", sides=3)
        for x, f, z, rx, rf in ((0, 0, 10, 8.7, 8.7), (-4, 0, 8.8, 5.8, 5.3),
                               (3.7, 1, 9.3, 5.8, 5.4), (0, -4, 8.8, 5.5, 5.5)):
            mb.blob((x, f, z), (rx, rf, 2.35), "foliage_dark", sway_of=lambda z: min(1, z / 12))
    elif kind == "poinciana":
        mb.tube([(0, 0, 0), (0.1, 0, 3.5)], [0.35, 0.20], "bark_pale", sides=5)
        for x, f in ((-2.4, 0), (2.4, 0), (0, -2)):
            mb.tube([(0.1, 0, 3.2), (x, f, 5.7)], [0.16, 0.08], "bark_pale", sides=4)
            mb.blob((x, f, 5.6), (3.3, 3.1, 1.35), "foliage", sway_of=lambda z: min(1, z / 7))
            mb.blob((x, f, 6.25), (3.2, 3.0, 0.8), "blossom", sway_of=lambda z: min(1, z / 7))
    else:
        mb.tube([(0, 0, 0), (0, 0, 2.5)], [0.22, 0.16], "bark_pale", sides=3)
        for x, f in ((-1.1, 0), (1.1, 0), (0, -1.2)):
            mb.tube([(0, 0, 2), (x, f, 3.8)], [0.13, 0.075], "bark_pale", sides=3)
            mb.blob((x, f, 4.0), (0.8, 0.8, 0.65), "foliage", sway_of=lambda z: min(1, z / 4.6))
            mb.blob((x + 0.1, f + 0.25, 4.45), (0.36, 0.3, 0.24), "blossom_pale",
                    sway_of=lambda z: min(1, z / 4.6))
    low = min(v.co.z for v in mb.bm.verts)
    for v in mb.bm.verts:
        v.co.z -= low
    mb.build(f"{root.name}_body", mats, root)


def furniture(mb, a):
    # A counter open to the street and two shelves against the back wall.
    mb.box(-3.9, -3.3, -4.6, 3.5, 0, 1.1, "wood")
    for z in (1.9, 2.7):
        mb.box(-6.7, -6.3, -4.5, 3.5, z, z + 0.12, "wood")
    for x in (-3, -1, 1, 3):
        mb.cyl((x, -2.5, 0.43), "z", 0.055, 0.43, 3, "steel_dark")
        mb.cyl((x, -2.5, 0.90), "z", 0.25, 0.05, 4, "wood")
    if a:
        for x in (-3, 3):
            mb.box(-3.5, -3.43, x - 0.03, x + 0.03, 2.75, 3.4, "steel_dark")
            # Thin open fan blades face downward and remain visible through the bays.
            for pts in (((x - 0.12, -3.95, 2.74), (x + 0.12, -3.95, 2.74),
                         (x + 0.12, -3.05, 2.74), (x - 0.12, -3.05, 2.74)),
                        ((x - 0.5, -3.62, 2.74), (x + 0.5, -3.62, 2.74),
                         (x + 0.5, -3.38, 2.74), (x - 0.5, -3.38, 2.74))):
                face = mb.bm.faces.new([mb.v(_lib.P(*p)) for p in pts])
                face.normal_update()
                if face.normal.z > 0:
                    face.normal_flip()
                mb.tag([face], "steel_dark", closed=False)
        mb.box(-6.2, -4.2, 4.3, 6.6, 0, 0.35, "wood")
        mb.cyl((5.3, -5.3, 0.8), "f", 0.38, 0.26, 6, "roof")
        for x in (4.95, 5.65):
            mb.cyl((x, -5.4, 1.27), "z", 0.22, 0.16, 6, "roof")
        mb.cyl((6.15, -4.65, 0.95), "z", 0.025, 0.6, 3, "steel_dark")
        mb.cone((6.15, -4.65, 1.55), 0.32, 1.6, 4, "trim")
        for x in (4.5, 6.3):
            mb.box(-6, -5.5, x - 0.23, x + 0.23, 0.35, 1.35, "steel_dark")
    else:
        mb.cyl((3.8, -6.52, 2.6), "f", 0.38, 0.03, 8, "steel_dark")
        for x in (-3, 3):
            mb.cyl((x, 2, 0.55), "z", 0.06, 0.55, 4, "steel_dark")
            mb.cyl((x, 2, 1.15), "z", 0.55, 0.05, 4, "wood")
            mb.cyl((x, 2, 2), "z", 0.04, 0.8, 4, "steel_dark")
            mb.cone((x, 2, 2.5), 1.1, 2.85, 4, "roof")


def bar(mats, root, a):
    paint = "paint_mint" if a else "paint_cream"
    mb = _lib.MB([paint, "trim", "roof", "wood", "steel_dark"])
    w, eave = (7, 7.3) if a else (6, 5.5)
    mb.box(-7, 0, -w, w, 0, 0.1, paint)
    mb.box(-7, -6.7, -w, w, 0, eave, paint)
    for x in (-w, w):
        mb.box(-7, 0, x - 0.1, x + 0.1, 0, eave, paint)
    if a:
        mb.box(-6.7, 0, -w, w, 3.5, 7.3, paint)
        # Horizontal lap-siding seams and plain upper windows read behind the veranda.
        for z in (4.1, 4.55, 5.0, 5.45, 5.9, 6.35, 6.8):
            mb.front_quad(0.025, -w, w, z, z + 0.022, "wood")
        for x in (-4.6, 0, 4.6):
            mb.front_quad(0.035, x - 0.75, x + 0.75, 4.7, 6.65, "steel_dark")
        mb.box(-0.1, 2.5, -w, w, 3.35, 3.5, "trim")
        for x in (-6.8, -2.3, 2.3, 6.8):
            mb.box(2.25, 2.4, x - 0.07, x + 0.07, 0, 7.2, "trim")
        for z in (3.6, 4.5):
            mb.box(2.3, 2.45, -w, w, z, z + 0.09, "trim")
        # Slim raised shutters over the three fully open ground-floor bays.
        mb.box(-0.08, 0.1, -w, w, 3.15, 3.35, "roof")
        # Spindles are open panels; no filled veranda wall hides the open floor.
        for i in range(14):
            x = -6.5 + i
            mb.front_quad(2.46, x - 0.035, x + 0.035, 3.69, 4.5, "trim")
        mb.fprism([(-7.2, 7.3), (7.2, 7.3), (0, 8)], -7.2, 2.6, "roof")
    else:
        for x in (-6, -2, 2, 6):
            mb.box(-0.18, 0.18, x - 0.18, x + 0.18, 0, 4.1, paint)
        # The lower edge follows three open arches, not dark painted windows.
        for x in (-4, 0, 4):
            profile = [(x - 1.82, 3.2), (x - 1.25, 3.9), (x, 4.25),
                       (x + 1.25, 3.9), (x + 1.82, 3.2), (x + 1.82, 5.5), (x - 1.82, 5.5)]
            mb.fprism(profile, -0.18, 0.18, paint)
        mb.box(-7, -0.25, -w, w, 4.55, 4.7, "roof")
    furniture(mb, a)
    mb.build(f"{root.name}_body", mats, root)
    _lib.text_panel(f"{root.name}_name", mats, "trim", root, 5, 0.65,
                    (0, 2.62 if a else 0.19, 7.3 if a else 4.95))


def osprey(mats):
    root = _lib.empty("keys_osprey_post",loc=(65,0,0))
    mb = _lib.MB(["wood","bark","trim","steel_dark"])
    mb.box(-0.12,0.12,-0.12,0.12,0,9,"wood")
    mb.box(-0.7,0.7,-0.7,0.7,8.9,9.05,"wood")
    # Irregular overlapping angular sticks leave a nest bowl, with a perched bird above.
    for i in range(5):
        a = i*math.tau/5
        b = a+1.4
        mb.tube([(0.75*math.cos(a),0.75*math.sin(a),9.13),
                 (0.75*math.cos(b),0.75*math.sin(b),9.24)], [0.08]*2,"bark",sides=3)
    mb.blob((0,0.05,9.45),(0.22,0.35,0.29),"trim")
    mb.hull([(-0.25,-0.22,9.15),(0.25,-0.22,9.15),(0,0.2,9.65),(0,-0.4,9.6)],"bark")
    mb.hull([(-0.22,-0.12,9.3),(0,-0.35,9.15),(0.22,-0.12,9.3),(0,-0.1,9.66)],"bark")
    mb.box(0.1,0.34,-0.12,0.12,9.65,9.89,"trim")
    for side in (-1,1):
        mb.side_quad(side*0.125,0.13,0.29,9.73,9.78,"steel_dark",side)
    mb.hull([(-0.055,0.34,9.7),(0.055,0.34,9.7),(0,0.47,9.71),(0,0.34,9.78)],"steel_dark")
    mb.build("keys_osprey_post_body",mats,root)


def main():
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    deer(mats, _lib.empty("key_deer_buck", loc=(-42, 0, 0)), True)
    deer(mats, _lib.empty("key_deer_doe", loc=(-39, 0, 0)), False)
    root = _lib.empty("keys_mile_marker", loc=(-36, 0, 0))
    mb = _lib.MB(["steel_dark", "trim"])
    mb.box(-0.08, 0, -0.035, 0.035, 0, 1.6, "steel_dark")
    mb.box(0, 0.05, -0.225, 0.225, 0.85, 1.6, "trim")
    mb.build("keys_mile_marker_body", mats, root)
    _lib.text_panel("keys_mile_marker_face", mats, "sign_face", root, 0.40, 0.70, (0, 0.051, 1.225))
    for name, x, kind in (("keys_banyan", -18, "banyan"), ("keys_poinciana", 4, "poinciana"),
                          ("keys_frangipani", 17, "frangipani")):
        tree(mats, _lib.empty(name, loc=(x, 0, 0)), kind)
    bar(mats, _lib.empty("duval_open_bar_a", loc=(31, 0, 0)), True)
    bar(mats, _lib.empty("duval_open_bar_b", loc=(50, 0, 0)), False)
    osprey(mats)
    _lib.export(_lib.out_path(), texcoords=True, normals=False)


main()
