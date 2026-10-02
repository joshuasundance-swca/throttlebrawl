"""throttlebrawl prop: the Florida Keys roadside kit, eleven variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python keys_roadside.py -- --out <path>.glb

Run W-P, "fill the world" (the maintainer, 2026-10-01b: "the worlds just feel very empty"; "unique
regional flavor everywhere"; for the Keys, "likewise local"). The clutter the game scatters beside a
Keys road, among the palms, mangroves and bait shacks it already has. Each variant root keys_<v> sits
on the ground at its own x along a line, with one mesh child keys_<v>_body; its front faces the
prop's front (glTF +Z), which the game turns toward the road.

- seagrape, seagrape_tree: a sprawling sea grape bush and a taller one gone to tree;
- traps: a stack of wooden lobster traps with their buoys;
- pelican: a brown pelican on a weathered piling;
- trailer: a skiff on its trailer, bow to the road;
- cottage_a, cottage_b: pastel conch cottages up on short piers, tin roofs, porches and shutters;
- picket: a 4 m white picket fence section (the game lines sections up along the road);
- mailbox: a mailbox on a post with a fish on top;
- bait: a hand-painted BAIT ICE board on two posts;
- pie: a roadside key lime pie stand under a striped awning.

Words are block letters drawn in _lib (no font). Flat colours only; no grime. Exported without
normals: every face is flat, and the game rebuilds them.
"""

import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

P = _lib.P
word = _lib.block_word

COLOURS = {
    "foliage": "#3f7d3c",       # sea grape leaves
    "leaf_light": "#9cc35a",    # key lime green
    "bark": "#6b5440",
    "wood": "#a68a5d",          # weathered planks: traps, pilings, posts, the bait board
    "car_red": "#d9483b",       # buoys
    "sign_face": "#f2d14b",     # buoys, the bait board's letters
    "stone": "#8f8577",         # the pelican
    "trim": "#f4efe4",          # white: the pelican's head, porch rails, pickets
    "body": "#e39a3b",          # the pelican's bill, the mailbox's fish
    "chrome": "#8e9499",        # the trailer, the mailbox
    "tyre": "#202224",
    "hull": "#e8e2d2",
    "paint_mint": "#a7d8c6",
    "paint_pink": "#f2b7c0",
    "roof": "#c9ccc9",          # tin
    "glass": "#2e3a44",
    "body_alt": "#3f8f8a",      # shutters
    "sign_board": "#2c3a46",    # the pie stand's letters
}

VARIANTS = ["seagrape", "seagrape_tree", "traps", "pelican", "trailer", "cottage_a", "cottage_b", "picket",
            "mailbox", "bait", "pie"]
XS = [-40.0, -34.0, -28.0, -24.0, -18.0, -8.0, 4.0, 14.0, 19.0, 23.0, 30.0]


def gem(mb, centre, radii, mat, rng, jitter=0.12):
    """A jittered octahedron (8 triangles): the cheapest round bush."""
    cx, cf, cz = centre
    rx, rf, rz = radii
    pts = [(rx, 0, 0), (-rx, 0, 0), (0, rf, 0), (0, -rf, 0), (0, 0, rz), (0, 0, -rz)]
    vs = []
    for x, f, z in pts:
        k = 1.0 + rng.uniform(-jitter, jitter)
        vs.append(mb.v(P(cx + x * k, cf + f * k, cz + z * k)))
    tris = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    mb.tag([mb.bm.faces.new((vs[a], vs[b], vs[c])) for a, b, c in tris], mat)


def seagrape(mb, rng):
    for cx, cf, r, h in ((0.0, 0.0, 1.1, 0.8), (0.9, 0.4, 0.8, 0.6), (-0.8, -0.3, 0.9, 0.65),
                         (0.2, -0.7, 0.7, 0.5)):
        gem(mb, (cx, cf, h), (r, r * 0.9, h), "foliage", rng, 0.18)


def seagrape_tree(mb, rng):
    mb.tube([(0.0, 0.0, 0.0), (0.3, 0.1, 1.4), (0.1, 0.0, 2.2)], [0.16, 0.12, 0.09], "bark", sides=4)
    mb.tube([(0.2, 0.05, 1.1), (-0.9, 0.2, 2.0)], [0.08, 0.06], "bark", sides=3)
    for cx, cf, cz, r in ((0.2, 0.0, 2.7, 1.3), (-1.0, 0.3, 2.3, 0.9), (0.9, -0.3, 2.2, 0.9)):
        gem(mb, (cx, cf, cz), (r, r * 0.9, r * 0.6), "foliage", rng, 0.15)


def traps(mb, rng):
    """Lobster traps stacked by a shack: wooden crates, a buoy hung on the stack."""
    w, d, h = 0.6, 0.45, 0.42
    for i, (x, z) in enumerate(((-0.62, 0.0), (0.0, 0.0), (0.62, 0.0), (-0.31, h), (0.31, h), (0.0, 2 * h))):
        mb.box(-d, d, x - w / 2 + 0.02, x + w / 2 - 0.02, z, z + h - 0.02, "wood")
    for x, mat in ((-0.95, "car_red"), (0.95, "sign_face")):
        mb.cyl((x, 0.0, 0.55), "z", 0.13, 0.22, 6, mat)


def pelican(mb, rng):
    mb.cyl((0.0, 0.0, 1.1), "z", 0.16, 1.1, 6, "wood")
    # the bird: a body, a white head on an S of neck, the long bill resting on its chest
    gem(mb, (0.0, -0.05, 2.45), (0.22, 0.42, 0.22), "stone", rng, 0.05)
    mb.box(0.12, 0.22, -0.05, 0.05, 2.55, 2.9, "stone")
    gem(mb, (0.0, 0.2, 2.95), (0.09, 0.12, 0.09), "trim", rng, 0.0)
    mb.xprism([(0.28, 2.95), (0.62, 2.62), (0.56, 2.6), (0.24, 2.9)], -0.04, 0.04, "body")


def trailer(mb, rng):
    """A boat trailer with a skiff on it, the bow (and the hitch) toward the front."""
    for x in (-0.6, 0.6):
        mb.box(-2.6, 2.4, x - 0.05, x + 0.05, 0.35, 0.47, "chrome")
    mb.box(2.4, 3.3, -0.05, 0.05, 0.35, 0.45, "chrome")
    mb.box(-0.9, -0.5, -0.95, 0.95, 0.0, 0.62, "tyre")
    # the skiff: a hull of two slanted sides and a flat transom
    mb.xprism([(-2.4, 0.55), (2.0, 0.55), (2.7, 1.25), (-2.4, 1.2)], -0.85, 0.85, "hull")
    mb.box(-1.2, 0.2, -0.3, 0.3, 1.2, 1.5, "chrome")


def cottage(mb, paint, porch_roof):
    """A conch cottage up on short piers: a pastel box, a tin roof, a porch with a rail, shutters."""
    hw, d, base, wall = 3.0, 7.0, 0.7, 2.9
    for x in (-hw + 0.2, hw - 0.2):
        for f in (-d + 0.3, -0.3):
            mb.box(f - 0.15, f + 0.15, x - 0.15, x + 0.15, 0.0, base, "wood")
    mb.box(-d, 0.0, -hw, hw, base, base + wall, paint)
    mb.xprism([(-d - 0.4, base + wall), (0.4, base + wall), (-d / 2, base + wall + 1.9)], -hw - 0.3, hw + 0.3, "roof")
    # the porch: a deck, a rail, posts, its own little roof
    mb.box(0.0, 1.8, -hw, hw, base - 0.12, base, "wood")
    mb.box(1.72, 1.8, -hw, hw, base + 0.8, base + 0.9, "trim")
    for x in (-hw + 0.1, -1.0, 1.0, hw - 0.1):
        mb.box(1.65, 1.8, x - 0.07, x + 0.07, base, base + 2.4, "trim")
    mb.xprism(porch_roof, -hw - 0.1, hw + 0.1, "roof")
    # the door, two windows, their shutters
    mb.front_quad(0.01, -0.45, 0.45, base, base + 2.1, "body_alt")
    for x in (-1.9, 1.9):
        mb.front_quad(0.01, x - 0.5, x + 0.5, base + 0.9, base + 2.2, "glass")
        for s in (-0.72, 0.72):
            mb.front_quad(0.02, x + s - 0.2, x + s + 0.2, base + 0.85, base + 2.25, "body_alt")


def cottage_a(mb, rng):
    cottage(mb, "paint_mint", [(0.0, 3.6), (2.0, 3.0), (2.0, 2.92), (0.0, 3.5)])


def cottage_b(mb, rng):
    cottage(mb, "paint_pink", [(0.0, 3.55), (2.1, 3.15), (2.1, 3.05), (0.0, 3.45)])


def picket(mb, rng):
    """A 4 m white picket fence section along x: two rails and eleven pointed pickets, flat panels
    facing the road (a fence is seen from the road; panels keep a run of sections cheap)."""
    for z in (0.3, 0.75):
        mb.front_quad(0.0, -2.0, 2.0, z, z + 0.07, "trim")
    for k in range(11):
        x = -2.0 + 0.2 + k * 0.36
        pts = [P(x - 0.05, 0.02, 0.0), P(x + 0.05, 0.02, 0.0), P(x + 0.05, 0.02, 0.92), P(x, 0.02, 1.0),
               P(x - 0.05, 0.02, 0.92)]
        mb.tag([mb.bm.faces.new([mb.v(p) for p in pts])], "trim", closed=False)


def mailbox(mb, rng):
    mb.box(-0.06, 0.06, -0.06, 0.06, 0.0, 1.05, "wood")
    mb.box(-0.25, 0.25, -0.12, 0.12, 1.05, 1.3, "chrome")
    mb.xprism([(-0.25, 1.3), (0.25, 1.3), (0.0, 1.38)], -0.12, 0.12, "chrome")
    # a painted fish on the lid, nose to the road
    mb.fprism([(-0.02, 1.4), (0.02, 1.4), (0.02, 1.5), (-0.02, 1.5)], -0.28, 0.2, "body")
    mb.xprism([(-0.28, 1.45), (-0.42, 1.38), (-0.42, 1.52)], -0.02, 0.02, "body")


def bait(mb, rng):
    for x in (-0.9, 0.9):
        mb.box(-0.06, 0.06, x - 0.06, x + 0.06, 0.0, 1.9, "wood")
    mb.box(-0.04, 0.04, -1.1, 1.1, 1.0, 1.85, "trim")
    word(mb, "BAIT", 0.05, 0.0, 1.62, 0.07, "car_red")
    word(mb, "ICE", 0.05, 0.0, 1.2, 0.07, "sign_board")


def pie(mb, rng):
    """A key lime pie stand: a counter, a striped awning on posts and a PIE board."""
    mb.box(-0.6, 0.0, -1.2, 1.2, 0.0, 1.0, "paint_pink")
    mb.box(0.0, 0.05, -1.2, 1.2, 0.95, 1.02, "trim")
    for x in (-1.15, 1.15):
        mb.box(-0.6, -0.5, x - 0.05, x + 0.05, 0.0, 2.3, "wood")
    for k in range(6):
        x0 = -1.35 + k * 0.45
        mat = "leaf_light" if k % 2 == 0 else "trim"
        mb.fprism([(x0, 2.3), (x0 + 0.45, 2.3), (x0 + 0.45, 2.22), (x0, 2.22)], -0.9, 0.5, mat)
    mb.box(-0.02, 0.02, -0.75, 0.75, 1.15, 1.75, "trim")
    word(mb, "PIE", 0.03, 0.0, 1.45, 0.09, "sign_board")


BUILDERS = {"seagrape": seagrape, "seagrape_tree": seagrape_tree, "traps": traps, "pelican": pelican,
            "trailer": trailer, "cottage_a": cottage_a, "cottage_b": cottage_b, "picket": picket,
            "mailbox": mailbox, "bait": bait, "pie": pie}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    # Every part is a closed solid or a front-facing panel: nothing is double-sided.
    mats = _lib.make_mats(COLOURS)
    for k, (name, x) in enumerate(zip(VARIANTS, XS)):
        rng = random.Random(3000 + k)
        root = _lib.empty(f"keys_{name}", loc=(x, 0.0, 0.0))
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
        mb.build(f"keys_{name}_body", mats, root)
    _lib.export(out, normals=False)


main()
