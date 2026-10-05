"""Stackable downtown modules: four-storey facade tiles never stretch their windows."""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene, text_panel
from _sf_atlas import atlas_panel
from _vehicle_lib import polygon

COLOURS = {
    "glass": "#597c89", "stone": "#d4c9b3", "concrete": "#bcbcb4",
    "steel_dark": "#36464f", "sign_face": "#ffffff", "light_head": "#f2dfa7",
}
STYLES = ["glass", "stone", "screen", "crown", "midrise"]
WIDTHS = [28, 30, 32, 34, 24]
DEPTHS = [24, 26, 26, 28, 20]
XS = list(range(-280, 281, 40))
TILES = ["curtain-wall-1", "stone-pilasters-1", "curtain-wall-2",
         "curtain-wall-3", "stone-pilasters-2"]


def facades(root, name, mats, width, depth, height, tile, role):
    # Panels' local +Z fronts rotate into each outward face; each face uses one complete tile.
    for face, w, centre, angle in (
        ("front", width, (0, 0, height / 2), 0),
        ("back", width, (0, -depth, height / 2), math.pi),
        ("left", depth, (width / 2, -depth / 2, height / 2), math.pi / 2),
        ("right", depth, (-width / 2, -depth / 2, height / 2), -math.pi / 2),
    ):
        ob = atlas_panel(f"{name}_facade_{face}", mats, role, root, w, height, (0, 0, 0), tile)
        ob.location = P(*centre)
        # Blender's Z rotation maps front -Y to +X at +pi/2.
        ob.rotation_euler.z = angle


reset_scene()
mats = make_mats(COLOURS)
for k, (style, width, depth, tile) in enumerate(zip(STYLES, WIDTHS, DEPTHS, TILES)):
    role = "stone" if style in ("stone", "midrise") else "glass"
    for j, module in enumerate(("base", "mid", "crown")):
        name = f"{style}_{module}"
        root = empty(name, loc=(XS[k * 3 + j], 0, 0))
        root["module_m"] = 7 if module == "base" else 14 if module == "mid" else 8
        mb = MB(mats)
        hw = width / 2
        if module == "mid":
            # End caps share the side panels' exact rectangle. No protruding mullions at seams.
            for y, direction in ((0, -1), (14, 1)):
                polygon(mb, [(-hw, -depth, y), (hw, -depth, y), (hw, 0, y), (-hw, 0, y)],
                        role, (0, 0, direction))
            facades(root, name, mats, width, depth, 14, tile, role)
        elif module == "base":
            mb.box(-depth, 0, -hw, hw, 0, 7, "concrete")
            # Glass lobby and inset door sit just proud of the street wall, beneath a dark lintel.
            mb.front_quad(0.003, -hw + 1, hw - 1, 0.5, 5.6, "glass")
            mb.front_quad(0.006, -1.6, 1.6, 0, 4.8, "steel_dark")
            mb.box(-0.05, 0.01, -hw, hw, 5.7, 6.1, "steel_dark")
        else:
            # The first tier matches the mid footprint; all setbacks happen above the join.
            mb.box(-depth, 0, -hw, hw, 0, 1, role)
            mb.box(-depth + 2, -2, -hw + 2, hw - 2, 1, 5, role)
            mb.box(-depth + 4, -4, -hw + 4, hw - 4, 5, 8, "steel_dark")
            if style == "crown":
                mb.box(-depth + 3, -3, -hw + 3, hw - 3, 4.6, 5.2, "light_head")
            if style == "screen":
                mb.box(-2.3, -1.95, -9.2, 9.2, 1.5, 5.4, "steel_dark")
                text_panel("screen_crown_screen", mats, "sign_face", root, 18, 3.5, (0, -1.94, 3.45))
        mb.build(f"{name}_body", mats, root)
export(out_path(), texcoords=True, normals=False)
