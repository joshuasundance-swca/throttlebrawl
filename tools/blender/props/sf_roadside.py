"""throttlebrawl prop: the San Francisco roadside kit, ten variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python sf_roadside.py -- --out <path>.glb

Run W-P, "fill the world" (the maintainer, 2026-10-01b: "the worlds just feel very empty"; "unique
regional flavor everywhere, like ... SF AI stuff"). The clutter the game scatters on a San Francisco
street, between the row houses' stoops and the kerb. Each variant root sf_<v> sits on the ground at
its own x along a line, with one mesh child sf_<v>_body; its front faces the prop's front (glTF +Z),
which the game turns toward the road.

- sedan, hatch: cars parked nose to the kerb (their bonnet faces the road), as on the steep streets;
- robotaxi: a white driverless car with its sensor crown, someone's traffic cone on its bonnet;
- tree: a street tree in its square sidewalk cut-out; hydrant: a white hydrant with a blue cap;
- scooter: a rental scooter on its side;
- board_ai, board_agi, board_gpu: A-frame sandwich boards with one bold word in block letters
  (the startup boom, deadpan; invented, no brand);
- store: a two-storey corner store with a striped awning and a MARKET sign band.

Words are block letters made of flat panels (a 3 by 5 grid per letter, drawn here, no font).
Flat colours only; no grime. Exported without normals: every face is flat, and the game rebuilds
them.
"""

import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

P = _lib.P

COLOURS = {
    "car_red": "#b8483d",
    "car_blue": "#4b7fa6",
    "car_white": "#eeeeea",
    "car_green": "#7ccf3a",     # the rental scooter
    "tyre": "#202224",
    "glass": "#2b3640",
    "chrome": "#8e9499",        # the robotaxi's sensors, the scooter's stem
    "light_tail": "#e2563c",
    "body": "#f08a24",          # the traffic cone
    "bark": "#4a3a2c",          # trunks and the cut-out's soil
    "foliage": "#5f8f45",
    "trim": "#f4efe4",
    "body_alt": "#2f6e5b",      # the awning's stripes
    "sign_face": "#f2d14b",     # the letters
    "sign_board": "#26292c",    # boards and the sign band
    "wood": "#7a5a3d",          # the A-frame's legs
    "paint_mint": "#a9d6c2",
    "paint_yellow": "#f1d58a",
    "roof": "#5d5852",
    "light_head": "#f6eccf",    # the street lamp's globe
}

VARIANTS = ["sedan", "hatch", "robotaxi", "tree", "hydrant", "scooter", "board_ai", "board_agi", "board_gpu",
            "store", "meter", "bins", "lamp"]
XS = [-36.0, -30.0, -24.0, -18.0, -14.0, -11.0, -8.0, -5.0, -2.0, 8.0, 15.0, 18.0, 21.0]

# A 3 by 5 block font, rows top to bottom, for the words the kit writes.
FONT = {
    "A": ("010", "101", "111", "101", "101"),
    "E": ("111", "100", "110", "100", "111"),
    "G": ("111", "100", "101", "101", "111"),
    "I": ("111", "010", "010", "010", "111"),
    "K": ("101", "101", "110", "101", "101"),
    "M": ("101", "111", "101", "101", "101"),
    "P": ("110", "101", "110", "100", "100"),
    "R": ("110", "101", "110", "101", "101"),
    "T": ("111", "010", "010", "010", "010"),
    "U": ("101", "101", "101", "101", "111"),
}


def word(mb, text, f, xc, zc, cell, mat):
    """Block letters facing the front, centred at (xc, zc): one panel per run of filled cells."""
    width = len(text) * 4 - 1
    # Seen from the front, the prop's left (+X) is on the viewer's right: write from -X up.
    x0 = xc - width * cell / 2
    top = zc + 2.5 * cell
    for i, ch in enumerate(text):
        rows = FONT[ch]
        for r, row in enumerate(rows):
            c = 0
            while c < 3:
                if row[c] != "1":
                    c += 1
                    continue
                run = c
                while run < 3 and row[run] == "1":
                    run += 1
                xa = x0 + (i * 4 + c) * cell
                xb = x0 + (i * 4 + run) * cell
                z1 = top - r * cell
                mb.front_quad(f, xa, xb, z1 - cell, z1, mat)
                c = run


def car(mb, paint, cabin_glass=True):
    """A parked car, its bonnet toward the front (+f), about 4.3 m long."""
    mb.box(-2.15, 2.15, -0.86, 0.86, 0.3, 1.0, paint)
    mb.xprism([(-1.25, 1.0), (0.85, 1.0), (0.45, 1.48), (-1.0, 1.48)], -0.78, 0.78, paint)
    if cabin_glass:
        mb.side_quad(0.79, -1.0, 0.5, 1.06, 1.42, "glass", 1)
        mb.side_quad(-0.79, -1.0, 0.5, 1.06, 1.42, "glass", -1)
    for f in (-1.35, 1.35):
        mb.box(f - 0.33, f + 0.33, -0.9, 0.9, 0.0, 0.62, "tyre")
    mb.front_quad(2.16, -0.7, 0.7, 0.55, 0.85, "chrome")
    for x in (-0.6, 0.6):
        mb.box(-2.18, -2.15, x - 0.18, x + 0.18, 0.7, 0.88, "light_tail")


def sedan(mb, rng):
    car(mb, "car_red")


def hatch(mb, rng):
    mb.box(-1.85, 1.85, -0.84, 0.84, 0.3, 1.0, "car_blue")
    mb.xprism([(-1.85, 1.0), (0.7, 1.0), (0.3, 1.5), (-1.75, 1.5)], -0.76, 0.76, "car_blue")
    mb.side_quad(0.77, -1.6, 0.35, 1.06, 1.44, "glass", 1)
    mb.side_quad(-0.77, -1.6, 0.35, 1.06, 1.44, "glass", -1)
    for f in (-1.2, 1.2):
        mb.box(f - 0.32, f + 0.32, -0.88, 0.88, 0.0, 0.6, "tyre")


def robotaxi(mb, rng):
    car(mb, "car_white")
    # the sensor crown: a roof rack, a spinning puck, cameras at the corners
    mb.box(-0.7, 0.45, -0.55, 0.55, 1.48, 1.58, "chrome")
    mb.cyl((0.0, -0.1, 1.72), "z", 0.24, 0.14, 6, "chrome")
    for x in (-0.6, 0.6):
        mb.box(1.2, 1.4, x - 0.1, x + 0.1, 1.0, 1.18, "chrome")
    # somebody's traffic cone on the bonnet
    mb.cone((0.0, 1.55, 1.0), 0.2, 1.62, 6, "body")


def tree(mb, rng):
    mb.box(-0.6, 0.6, -0.6, 0.6, 0.0, 0.06, "bark")
    mb.tube([(0.0, 0.0, 0.0), (0.08, 0.0, 2.4), (0.0, 0.05, 3.4)], [0.12, 0.1, 0.08], "bark", sides=4)
    mb.blob((0.0, 0.0, 4.1), (1.6, 1.5, 1.5), "foliage", jitter=0.12, rng=rng)


def hydrant(mb, rng):
    mb.cyl((0.0, 0.0, 0.3), "z", 0.13, 0.3, 6, "trim")
    mb.cone((0.0, 0.0, 0.6), 0.15, 0.82, 6, "car_blue")
    mb.box(-0.06, 0.06, -0.24, 0.24, 0.36, 0.48, "trim")
    mb.box(0.12, 0.22, -0.06, 0.06, 0.34, 0.5, "car_blue")


def scooter(mb, rng):
    # lying on its side: the deck on edge, the stem and bars along the ground
    mb.box(-0.55, 0.45, -0.05, 0.05, 0.0, 0.17, "car_green")
    mb.box(0.4, 1.35, -0.03, 0.03, 0.04, 0.12, "chrome")
    mb.box(1.3, 1.36, -0.26, 0.26, 0.02, 0.12, "tyre")
    for f in (-0.6, 0.45):
        mb.box(f - 0.1, f + 0.1, -0.04, 0.04, 0.0, 0.2, "tyre")


def board(mb, text):
    """An A-frame sandwich board, about 1.1 m wide, its front face leaning back toward the road."""
    for x in (-0.58, 0.58):
        mb.xprism([(0.2, 0.0), (0.24, 0.0), (0.05, 1.05), (0.01, 1.05)], x - 0.04, x + 0.04, "wood")
        mb.xprism([(-0.24, 0.0), (-0.2, 0.0), (-0.01, 1.05), (-0.05, 1.05)], x - 0.04, x + 0.04, "wood")
    mb.xprism([(0.17, 0.06), (0.22, 0.06), (0.06, 1.0), (0.01, 1.0)], -0.54, 0.54, "sign_board")
    mb.xprism([(-0.22, 0.06), (-0.17, 0.06), (-0.01, 1.0), (-0.06, 1.0)], -0.54, 0.54, "sign_board")
    # The word stands upright just proud of the front board, so it reads square-on from the road.
    word(mb, text, 0.2, 0.0, 0.55, 0.08, "sign_face")


def board_ai(mb, rng):
    board(mb, "AI")


def board_agi(mb, rng):
    board(mb, "AGI")


def board_gpu(mb, rng):
    board(mb, "GPU")


def store(mb, rng):
    """A corner store: a shopfront under a striped awning and a sign band, a flat above it."""
    hw, d = 3.4, 10.0
    mb.box(-d, 0.0, -hw, hw, 0.0, 3.8, "paint_mint")
    mb.box(-d, 0.0, -hw, hw, 3.8, 7.4, "paint_yellow")
    mb.box(-d, 0.25, -hw - 0.1, hw + 0.1, 7.4, 7.8, "trim")
    mb.box(-d, 0.0, -hw, hw, 7.8, 7.9, "roof")
    # the shopfront: a big window, the door, the sign band and its word
    mb.front_quad(0.01, -2.9, 0.9, 0.5, 2.7, "glass")
    mb.front_quad(0.01, 1.3, 2.6, 0.0, 2.6, "sign_board")
    mb.box(0.0, 0.08, -hw, hw, 2.95, 3.75, "sign_board")
    word(mb, "MARKET", 0.09, 0.0, 3.35, 0.13, "sign_face")
    # the striped awning over the window
    for k in range(6):
        x0 = -hw + k * (2 * hw / 6)
        mat = "body_alt" if k % 2 == 0 else "trim"
        mb.fprism([(x0, 2.9), (x0 + 2 * hw / 6, 2.9), (x0 + 2 * hw / 6, 2.82), (x0, 2.82)], 0.0, 1.2, mat)
    # upstairs: two windows and a box bay
    mb.box(0.0, 0.6, -1.6, 1.6, 4.3, 6.9, "paint_yellow")
    mb.front_quad(0.61, -1.3, 1.3, 4.7, 6.5, "glass")
    for x in (-2.6, 2.6):
        mb.front_quad(0.01, x - 0.45, x + 0.45, 4.7, 6.5, "glass")


def meter(mb, rng):
    """A parking meter: a post and its head, the dial facing the kerb."""
    mb.box(-0.04, 0.04, -0.04, 0.04, 0.0, 1.05, "chrome")
    mb.box(-0.08, 0.08, -0.1, 0.1, 1.05, 1.4, "chrome")
    mb.front_quad(0.081, -0.07, 0.07, 1.18, 1.32, "glass")


def bins(mb, rng):
    """Collection day: the blue, green and black carts out at the kerb."""
    for x, mat in ((-0.62, "car_blue"), (0.0, "body_alt"), (0.62, "sign_board")):
        mb.box(-0.32, 0.3, x - 0.28, x + 0.28, 0.0, 0.98, mat)
        mb.box(-0.36, 0.34, x - 0.3, x + 0.3, 0.98, 1.04, mat)


def lamp(mb, rng):
    """A street lamp: a tall post, an arm over the kerb and a globe."""
    mb.box(-0.07, 0.07, -0.07, 0.07, 0.0, 4.6, "sign_board")
    mb.box(0.0, 0.9, -0.04, 0.04, 4.45, 4.55, "sign_board")
    mb.cyl((0.0, 0.95, 4.25), "z", 0.16, 0.2, 6, "light_head")


BUILDERS = {"sedan": sedan, "hatch": hatch, "robotaxi": robotaxi, "tree": tree, "hydrant": hydrant,
            "scooter": scooter, "board_ai": board_ai, "board_agi": board_agi, "board_gpu": board_gpu,
            "store": store, "meter": meter, "bins": bins, "lamp": lamp}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    # Every part is a closed solid: nothing is double-sided, so the game culls back faces.
    mats = _lib.make_mats(COLOURS)
    for k, (name, x) in enumerate(zip(VARIANTS, XS)):
        rng = random.Random(2000 + k)
        root = _lib.empty(f"sf_{name}", loc=(x, 0.0, 0.0))
        mb = _lib.MB(list(COLOURS))
        BUILDERS[name](mb, rng)
        # stand it on the ground: its lowest point at z = 0
        low = min(v.co.z for v in mb.bm.verts)
        for v in mb.bm.verts:
            v.co.z -= low
        # each body lists only the roles it paints
        used = sorted({f.material_index for f in mb.bm.faces})
        keep = [mb.mats[i] for i in used]
        for f in mb.bm.faces:
            f.material_index = keep.index(mb.mats[f.material_index])
        mb.mats = keep
        mb.build(f"sf_{name}_body", mats, root)
    _lib.export(out, normals=False)


main()
