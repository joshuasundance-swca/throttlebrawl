"""Duval Street's invented shops and conch cottages; every word stays a runtime text panel.

Roots are at the front-wall sidewalk line; local forward is glTF +Z. Dimensions are
approximate choices from the asset brief, rather than surveyed individual buildings.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

COLOURS = {
    "paint_pink": "#e7a6b4", "paint_mint": "#a9d6c2", "paint_yellow": "#f1d58a",
    "paint_blue": "#9db8d9", "paint_lilac": "#b9a1d1", "paint_sage": "#a9b798",
    "paint_cream": "#eee0b8", "trim": "#ffffff", "roof": "#697a80",
    "art": "#ffffff", "wood": "#876348", "steel_dark": "#39454b",
    "glass": "#35565f", "tyre": "#252a2d", "bark": "#967449",
    "foliage": "#47845a", "foliage_dark": "#326b45", "concrete": "#b5b2a7",
}

BUILDINGS = [
    ("duval_balcony_a", -46.0, 8.0, "paint_pink", "hip"),
    ("duval_balcony_b", -32.0, 11.0, "paint_mint", "gable"),
    ("duval_balcony_c", -15.0, 14.0, "paint_yellow", "parapet"),
    ("duval_conch_a", 1.0, 7.0, "paint_blue", "gable"),
    ("duval_conch_b", 12.0, 7.0, "paint_lilac", "hip"),
]


def panel(mats, root, suffix, width, height, centre, tile, role):
    crop = (0, 0, 1, 1)
    if suffix.startswith("window_"):
        crop = (14/120, 7/120, 48/120, 53/120)
    elif suffix.startswith("shutter_"):
        crop = (12/120, 8/120, 50/120, 52/120)
    return _lib.atlas_panel(f"{root.name}_{suffix}", mats, role, root,
                            width, height, centre, tile, uv_rect=crop)


def siding(mats, root, width, height, z0, role, tile):
    """A 7 m tile has two bays/two storeys: cut wider walls into <=7 m sections."""
    count = math.ceil(width / 7.0)
    bay = width / count
    for i in range(count):
        x = -width / 2 + (i + 0.5) * bay
        panel(mats, root, f"siding_{i}", bay, height, (x, 0.018, z0 + height / 2), tile, role)


def roof(mb, width, depth, eave, style):
    w = width / 2 + 0.25
    if style == "gable":
        mb.fprism([(-w, eave), (w, eave), (0, eave + 1.5)], -depth - 0.25, 0.25, "roof")
    elif style == "hip":
        mb.hull([(-w, 0.25, eave), (w, 0.25, eave), (-w, -depth - 0.25, eave),
                 (w, -depth - 0.25, eave), (0, -depth * 0.25, eave + 1.5),
                 (0, -depth * 0.75, eave + 1.5)], "roof")
    else:
        mb.box(-depth, 0, -w + 0.25, w - 0.25, eave - 0.2, eave, "roof")
        mb.box(-0.15, 0.12, -w + 0.25, w - 0.25, eave, eave + 1.4, "trim")
        for x in (-w + 0.25, w - 0.25):
            mb.box(-depth, 0, x - 0.08, x + 0.08, eave, eave + 0.65, "trim")


def tin_panels(mats, root, width, depth, eave, style):
    """Tile planes sit on the sloped roof; never put UVs on the closed roof volume."""
    if style == "parapet":
        ob = panel(mats, root, "tin_roof", width - 0.3, depth - 0.3,
                   (0, 0, 0), "tin-5v", "roof")
        ob.rotation_euler.x = -math.pi / 2
        ob.location = _lib.P(0, -depth / 2, eave + 0.025)
        return
    w = width / 2 + 0.25
    # Longitudinal ridge, 1.5 m above the eave. Hip roofs have a shortened ridge;
    # use the central metal section only so the UV rectangle stays inside the roof.
    run = depth + 0.4 if style == "gable" else depth * 0.32
    for side in (-1, 1):
        ob = panel(mats, root, f"tin_roof_{'l' if side < 0 else 'r'}", run,
                   math.hypot(w, 1.5) * 0.98, (0, 0, 0), "tin-5v", "roof")
        # Rotate the plane around its longitudinal axis: local X becomes -forward.
        ob.rotation_euler = (-math.atan2(w, 1.5), 0, side * math.pi / 2)
        ob.location = _lib.P(side * w / 2, -depth / 2, eave + 0.78)


def balcony(mats, root, width, paint, style, variant):
    w, depth, eave = width / 2, 8.0, 7.5
    mb = _lib.MB([paint, "trim", "roof"])
    mb.box(-depth, 0, -w, w, 0, eave, paint)
    siding(mats, root, width, 7.0, 0.35, paint, ("lap-siding-fine", "lap-siding-medium", "board-batten")[variant])
    mb.box(-0.1, 2.1, -w, w, 3.35, 3.55, "trim")
    for x in (-w + 0.15, -w / 3, w / 3, w - 0.15):
        mb.box(1.87, 2.07, x - 0.09, x + 0.09, 0, 7.4, "trim")
    # Continuous rail frame, with the gingerbread/spindles supplied by facade art.
    for z in (3.65, 4.6):
        mb.box(1.9, 2.12, -w, w, z, z + 0.09, "trim")
    panel(mats, root, "spindles", width - 0.25, 0.9,
          (0, 2.125, 4.14), "balcony-spindles", "trim")
    for side in (-1, 1):
        mb.box(0, 2.03, side * w - 0.045, side * w + 0.045, 4.57, 4.67, "trim")
    # Eave frieze and three visible second-floor window bays.
    mb.box(-0.02, 0.22, -w, w, 7.15, 7.42, "trim")
    for i, x in enumerate((-width / 3, 0, width / 3)):
        panel(mats, root, f"window_{i}", 1.7, 2.3, (x, 0.035, 5.6), "conch-window", "trim")
    stores = math.ceil(width / 5)
    for i in range(stores):
        sw = width / stores - 0.15
        x = -w + (i + 0.5) * width / stores
        panel(mats, root, f"store_{i}", sw, 2.65, (x, 0.05, 1.48),
              f"storefront-{variant * 2 + i + 1}", "art")
        panel(mats, root, f"awning_{i}", sw, 0.38, (x, 0.08, 3.02),
              f"awning-{variant + 1}", "art")
        _lib.text_panel(f"{root.name}_shop_name_{i}", mats, "trim", root,
                        sw * 0.7, 0.35, (x, 0.09, 2.58))
    roof(mb, width, depth, eave, style)
    tin_panels(mats, root, width, depth, eave, style)
    mb.build(f"{root.name}_body", mats, root)


def cottage(mats, root, paint, style, variant):
    w, depth, eave = 3.5, 7.0, 5.5
    mb = _lib.MB([paint, "trim", "roof", "concrete"])
    mb.box(-depth, 0, -w, w, 0.65, eave, paint)
    for x in (-2.8, 2.8):
        for f in (-5.9, 1.4):
            mb.box(f - 0.15, f + 0.15, x - 0.15, x + 0.15, 0, 0.65, "concrete")
    mb.box(-0.1, 1.8, -w, w, 0.55, 0.72, "trim")
    for x in (-3.25, 3.25):
        mb.box(1.53, 1.73, x - 0.09, x + 0.09, 0.72, 3.55, "trim")
        mb.box(0, 1.7, x - 0.05, x + 0.05, 1.4, 1.5, "trim")
    mb.xprism([(0, 3.65), (1.95, 3.1), (1.95, 3.22), (0, 3.77)], -w - 0.1, w + 0.1, "roof")
    for f, h in ((2.0, 0.24), (1.8, 0.48), (1.6, 0.72)):
        mb.box(f, f + 0.25, -0.65, 0.65, 0, h, "trim")
    siding(mats, root, 7.0, 4.8, 0.7, paint, "lap-siding-wide" if variant else "lap-siding-medium")
    panel(mats, root, "porch_lattice", 5.6, 0.48, (0, 1.805, 0.28), "porch-lattice", "trim")
    panel(mats, root, "door", 1.2, 2.2, (0, 0.04, 1.82), "porch-panels", "trim")
    for i, x in enumerate((-2.05, 2.05)):
        panel(mats, root, f"window_{i}", 1.2, 1.8, (x, 0.04, 2.4), "conch-window", "trim")
        panel(mats, root, f"shutter_{i}", 1.85, 0.65, (x, 0.065, 3.35),
              "bahama-open" if variant else "bahama-closed", paint)
    roof(mb, 7.0, depth, eave, style)
    tin_panels(mats, root, 7.0, depth, eave, style)
    mb.build(f"{root.name}_body", mats, root)


def bar(mats, root):
    mb = _lib.MB(["paint_sage", "paint_cream", "trim", "roof", "wood", "steel_dark"])
    # Open front and right side, with rolled-up side shutters above the counter.
    mb.box(-14, 0, -7, 7, 0, 0.2, "paint_cream")
    mb.box(-14, -13.7, -7, 7, 0.2, 4.55, "paint_sage")
    mb.box(-14, 0, -7, -6.7, 0.2, 4.55, "paint_sage")
    for x, f in ((-6.7, 0), (6.7, 0), (6.7, -13.7), (0, 0)):
        mb.box(f - 0.12, f + 0.12, x - 0.12, x + 0.12, 0.2, 4.7, "trim")
    mb.box(-14.3, 0.4, -7.3, 7.3, 4.6, 4.8, "roof")
    roof(mb, 14, 14, 4.5, "hip")
    mb.box(-4.5, -3.9, -5.6, 4.6, 0.2, 1.2, "wood")
    mb.box(-4.65, -3.8, -5.8, 4.8, 1.2, 1.32, "trim")
    mb.box(-13.1, -9.3, 3.0, 6.5, 0.2, 0.8, "wood")
    mb.box(-0.12, 0.2, -6.7, 6.7, 3.6, 4.55, "trim")
    panel(mats, root, "rollup_front", 13.0, 0.6, (0, 0.215, 4.14), "tin-shed-1", "art")
    panel(mats, root, "mural", 5.0, 2.6, (-2.5, -13.65, 2.6), "mural-roosters", "art")
    # Ceiling fans: stems and three broad blades, horizontal and visible from below.
    for f in (-3.4, -9.5):
        mb.box(f - 0.04, f + 0.04, -0.04, 0.04, 3.65, 4.6, "steel_dark")
        for k in range(3):
            a = k * 2 * math.pi / 3
            c, s = math.cos(a), math.sin(a)
            mb.hull([(0, f, 3.7), (0.9 * c - 0.15 * s, f + 0.9 * s + 0.15 * c, 3.7),
                     (0.9 * c + 0.15 * s, f + 0.9 * s - 0.15 * c, 3.7),
                     (0.55 * c, f + 0.55 * s, 3.74)], "wood")
    _lib.text_panel("duval_corner_bar_name", mats, "trim", root, 6.0, 0.75, (0, 0.24, 3.2))
    mb.build("duval_corner_bar_body", mats, root)


def scooter_rack(mats, root):
    mb = _lib.MB(["steel_dark", "tyre", "paint_blue", "paint_mint", "paint_cream", "paint_pink"])
    mb.front_quad(-0.65, -2.0, 2.0, 0.15, 0.23, "steel_dark")
    # Tetrahedral wheels and body pods are deliberately tiny roadside silhouettes.
    for i, role in enumerate(("paint_blue", "paint_mint", "paint_cream", "paint_pink")):
        x = -1.5 + i
        for f in (-0.55, 0.65):
            vs = [mb.v(_lib.P(x+0.12, f-0.19, 0.19)), mb.v(_lib.P(x+0.12, f, 0)),
                  mb.v(_lib.P(x+0.12, f+0.19, 0.19)), mb.v(_lib.P(x+0.12, f, 0.38))]
            mb.tag([mb.bm.faces.new(list(reversed(vs)))], "tyre", closed=False)
        mb.hull([(x - 0.17, -0.55, 0.30), (x + 0.17, -0.55, 0.30),
                 (x, 0.65, 0.28), (x, -0.45, 0.58)], role)
        mb.side_quad(x+0.13, 0.58, 0.65, 0.3, 1.0, "steel_dark", 1)
        mb.front_quad(0.65, x - 0.28, x + 0.28, 0.94, 1.0, "steel_dark")
        mb.front_quad(-0.4, x-0.21, x+0.21, 0.58, 0.65, "steel_dark")
    mb.build("duval_scooter_rack_body", mats, root)


def palm(mats, root):
    mb = _lib.MB(["paint_cream", "wood", "bark", "foliage", "foliage_dark"], sway=True)
    mb.box(-0.6, 0.6, -0.6, 0.6, 0, 0.45, "paint_cream")
    mb.box(-0.52, 0.52, -0.52, 0.52, 0.43, 0.46, "wood")
    mb.tube([(0, 0, 0.43), (0.07, 0, 1.95)], [0.13, 0.09], "bark", sides=6, sways=[0, 0.5])
    for i in range(7):
        a = i * 2 * math.pi / 7
        c, s = math.cos(a), math.sin(a)
        vs = [mb.v(_lib.P(0.07, 0, 1.95), 0.5),
              mb.v(_lib.P(0.07 + 0.65 * c - 0.22 * s, 0.65 * s + 0.22 * c, 2.5), 0.8),
              mb.v(_lib.P(0.07 + 1.25 * c, 1.25 * s, 1.85), 1),
              mb.v(_lib.P(0.07 + 0.65 * c + 0.22 * s, 0.65 * s - 0.22 * c, 2.5), 0.8)]
        mb.tag([mb.bm.faces.new(vs)], "foliage" if i % 2 else "foliage_dark", closed=False)
    mb.build("duval_planter_palm_body", mats, root)


def main():
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, double_sided=("foliage", "foliage_dark"))
    for i, (name, x, width, paint, style) in enumerate(BUILDINGS):
        root = _lib.empty(name, loc=(x, 0, 0))
        if i < 3:
            balcony(mats, root, width, paint, style, i)
        else:
            cottage(mats, root, paint, style, i - 3)
    bar(mats, _lib.empty("duval_corner_bar", loc=(28, 0, 0)))
    scooter_rack(mats, _lib.empty("duval_scooter_rack", loc=(42, 0, 0)))
    palm(mats, _lib.empty("duval_planter_palm", loc=(49, 0, 0)))
    _lib.export(_lib.out_path(), texcoords=True, normals=False)


main()
