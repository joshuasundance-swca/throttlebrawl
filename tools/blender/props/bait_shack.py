"""throttlebrawl prop: a Keys bait-and-tackle shack on short stilts, with a blank rooftop sign.

Run: blender --background --factory-startup --python-exit-code 1 --python bait_shack.py -- --out <path>.glb

The root empty `bait_shack` sits on the ground at the centre of the footprint; the porch and
the sign face the prop's front (glTF +Z), which the game turns toward the road. Two mesh
children: `bait_shack_body` (body, wood, roof) and `bait_shack_sign` (sign_board), a text
surface the game paints the shop's words onto. Four draws in all.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
HALF_W = 2.3            # half width of the shack (x, m)
BACK_F = -2.0           # back wall (f, m)
FRONT_F = 1.0           # front wall (f, m)
PORCH_F = 2.4           # front edge of the porch deck (f, m)
FLOOR_Z = (0.7, 0.85)   # deck slab on the stilts
WALL_TOP = 3.0
RIDGE_Z = 4.0           # gable ridge (the ridge runs along x)
EAVE = 0.3              # roof overhang
ROOF_T = 0.08
PORCH_ROOF_Z = (2.75, 2.35)   # porch roof height at the wall and at the porch edge
STILT = 0.18            # stilt size (square)
SIGN_W, SIGN_H = 3.4, 0.9
SIGN_Z = 3.45           # centre of the sign board, standing on the porch roof
SIGN_F = 1.9            # sign plane (f)

COLOURS = {
    "body": "#86b9b0",        # sun-faded turquoise board-and-batten walls
    "wood": "#6d6052",        # weathered grey-brown stilts, deck, door, shutters, rails
    "roof": "#b9bdbb",        # pale galvanised tin roof (no rust: the maintainer's call)
    "sign_board": "#efe6cf",  # hand-painted cream board; the game draws the words on it
}


def build_body(mb):
    w = HALF_W
    # stilts and the deck slab (the porch is the front of the same deck)
    for x in (-w + 0.2, 0.0, w - 0.2):
        for f in (BACK_F + 0.2, FRONT_F - 0.2, PORCH_F - 0.15):
            mb.box(f - STILT / 2, f + STILT / 2, x - STILT / 2, x + STILT / 2, 0.0, FLOOR_Z[0], "wood")
    mb.box(BACK_F - 0.05, PORCH_F, -w - 0.05, w + 0.05, *FLOOR_Z, "wood")
    # walls: a box with a gable on each side (the ridge runs along x, so the gables face the sides)
    mb.box(BACK_F, FRONT_F, -w, w, FLOOR_Z[1], WALL_TOP, "body")
    mid_f = (BACK_F + FRONT_F) / 2
    for sx in (-1, 1):
        a, b = sorted((sx * (w - 0.02), sx * w))
        mb.xprism([(BACK_F, WALL_TOP), (FRONT_F, WALL_TOP), (mid_f, RIDGE_Z - 0.05)], a, b, "body")
    # main roof: two slabs over the ridge, with eaves
    half = (FRONT_F - BACK_F) / 2 + EAVE
    drop = (RIDGE_Z - WALL_TOP) * half / ((FRONT_F - BACK_F) / 2)
    for sf in (-1, 1):
        f_edge = mid_f + sf * half
        prof = [(mid_f, RIDGE_Z + ROOF_T), (f_edge, RIDGE_Z + ROOF_T - drop), (f_edge, RIDGE_Z - drop),
                (mid_f, RIDGE_Z)]
        mb.xprism(prof, -w - EAVE, w + EAVE, "roof")
    # porch roof: a shed roof from the front wall to the porch edge on two posts
    z0, z1 = PORCH_ROOF_Z
    mb.xprism([(FRONT_F, z0), (PORCH_F + 0.15, z1), (PORCH_F + 0.15, z1 - ROOF_T), (FRONT_F, z0 - ROOF_T)],
              -w - 0.1, w + 0.1, "roof")
    for x in (-w + 0.1, w - 0.1):
        mb.box(PORCH_F - 0.2, PORCH_F - 0.08, x - 0.06, x + 0.06, FLOOR_Z[1], z1 - ROOF_T, "wood")
    # porch rail on both sides of the steps
    for sx in (-1, 1):
        a, b = sorted((sx * 0.7, sx * (w - 0.1)))
        mb.box(PORCH_F - 0.12, PORCH_F - 0.06, a, b, FLOOR_Z[1] + 0.85, FLOOR_Z[1] + 0.93, "wood")
        mb.box(PORCH_F - 0.12, PORCH_F - 0.06, sx * 0.7 - 0.05, sx * 0.7 + 0.05, FLOOR_Z[1], FLOOR_Z[1] + 0.93,
               "wood")
    # steps down to the ground
    for f0, z in ((PORCH_F, 0.55), (PORCH_F + 0.3, 0.28)):
        mb.box(f0, f0 + 0.3, -0.6, 0.6, 0.0, z, "wood")   # solid treads down to the ground
    # door and two shuttered windows on the front wall
    mb.box(FRONT_F, FRONT_F + 0.04, -0.45, 0.45, FLOOR_Z[1], 2.4, "wood")
    for sx in (-1, 1):
        a, b = sorted((sx * 1.15, sx * 1.95))
        mb.box(FRONT_F, FRONT_F + 0.04, a, b, 1.5, 2.25, "wood")
    # an ice chest on the porch (tin coloured), crab traps stacked by the steps
    mb.box(1.35, 2.05, 1.1, 2.1, FLOOR_Z[1], FLOOR_Z[1] + 0.85, "roof")
    for k in range(3):
        mb.box(1.4 + 0.02 * k, 2.05, -2.15 + 0.03 * k, -1.35, FLOOR_Z[1] + 0.42 * k, FLOOR_Z[1] + 0.42 * k + 0.38,
               "wood")
    # two short legs behind the rooftop sign hold it on the porch roof
    for x in (-SIGN_W / 2 + 0.3, SIGN_W / 2 - 0.3):
        mb.box(SIGN_F - 0.18, SIGN_F - 0.06, x - 0.05, x + 0.05, PORCH_ROOF_Z[0] - 0.4, SIGN_Z - SIGN_H / 2 + 0.05,
               "wood")


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, rough={"roof": 0.6})
    root = _lib.empty("bait_shack")
    mb = _lib.MB(["body", "wood", "roof"])
    build_body(mb)
    mb.build("bait_shack_body", mats, root)
    _lib.text_panel("bait_shack_sign", mats, "sign_board", root, SIGN_W, SIGN_H, (0.0, SIGN_F, SIGN_Z),
                    thickness=0.06)
    _lib.export(out, texcoords=True)


main()
