"""throttlebrawl prop: the Pacific Northwest roadside kit, twelve variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python pnw_roadside.py -- --out <path>.glb

Run W-P, "fill the world" (the maintainer, 2026-10-01b: "the worlds just feel very empty"; "unique
regional flavor everywhere, like NW tree species"). The clutter the game scatters close to a
Pacific Northwest road, so speed reads at 100 mph. Each variant root pnw_<v> sits on the ground at
its own x along a line, with one mesh child pnw_<v>_body; its front (a fence's face, the mailbox
doors, the hut's service window, the sign) faces the prop's front (glTF +Z), which the game turns
toward the road.

- fern: a sword fern clump; salal: a low glossy salal bush;
- stump: a mossy cedar stump; rock: a mossy boulder;
- mailbox: two rural mailboxes on a post, one flag up; firewood: a stacked cord under a lean-to;
- split_rail: a 6 m split-rail fence section; log_fence: a 6 m peeled-log fence section (the game
  lines sections up along the road);
- sign: a yellow diamond warning sign with a big-footed silhouette, wet-dark at the bottom;
- espresso: a drive-through espresso hut with a striped awning and a cup on the roof;
- maple: a bigleaf maple with a mossy trunk; alder: a red alder, pale bark, a narrow crown.

Lean on triangles: the game shows dozens at once. Flat colours only; no grime.
"""

import math
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

P = _lib.P

COLOURS = {
    "foliage": "#3f7a3a",       # sword fern fronds (double-sided leaf role)
    "foliage_dark": "#24452c",  # salal's glossy dark leaves
    "leaf_light": "#6f9a46",    # bigleaf maple
    "bark": "#4e3b2f",
    "bark_pale": "#b9b8ad",     # red alder's pale grey bark
    "moss": "#7f9f3f",
    "stone": "#8d918c",
    "wood": "#8a6a4c",          # posts, rails, firewood
    "chrome": "#3c4045",        # mailboxes
    "car_red": "#c23b2e",       # the mailbox flag
    "sign_face": "#e5bf2d",
    "sign_board": "#1d1f1c",    # the silhouette and the wet sign's dark band
    "body": "#2f7f84",          # the espresso hut
    "trim": "#f1ece2",
    "body_alt": "#c9503b",      # the awning's stripes
    "glass": "#26323a",
    "roof": "#3d3a37",
}

VARIANTS = ["fern", "salal", "stump", "rock", "mailbox", "firewood", "split_rail", "log_fence", "sign",
            "espresso", "maple", "alder"]
XS = [-40.0, -34.0, -28.0, -22.0, -16.0, -10.0, -2.0, 8.0, 16.0, 24.0, 34.0, 46.0]


def gem(mb, centre, radii, mat, rng, jitter=0.12):
    """A jittered octahedron (8 triangles): the cheapest round bush or rock."""
    cx, cf, cz = centre
    rx, rf, rz = radii
    pts = [(rx, 0, 0), (-rx, 0, 0), (0, rf, 0), (0, -rf, 0), (0, 0, rz), (0, 0, -rz)]
    vs = []
    for x, f, z in pts:
        k = 1.0 + rng.uniform(-jitter, jitter)
        vs.append(mb.v(P(cx + x * k, cf + f * k, cz + z * k)))
    tris = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    mb.tag([mb.bm.faces.new((vs[a], vs[b], vs[c])) for a, b, c in tris], mat)


def open_faces(mb, quads, mat):
    """Faces that are thin sheets (leaves): no closed-normal recalculation."""
    faces = [mb.bm.faces.new([mb.v(P(*q)) for q in quad]) for quad in quads]
    return mb.tag(faces, mat, closed=False)


def fern(mb, rng):
    """Eight fronds arching out from the crown, each a two-segment blade."""
    quads = []
    for k in range(8):
        a = 2 * math.pi * k / 8 + rng.uniform(-0.25, 0.25)
        length = rng.uniform(0.85, 1.15)
        h = rng.uniform(0.75, 0.95)
        ca, sa = math.cos(a), math.sin(a)
        px, pf = -sa, ca  # across the blade

        def at(t, z, w, ca=ca, sa=sa, length=length, px=px, pf=pf):
            return (ca * length * t + px * w, sa * length * t + pf * w, z)

        b0, b1 = at(0.0, 0.05, -0.05), at(0.0, 0.05, 0.05)
        m0, m1 = at(0.55, h, -0.13), at(0.55, h, 0.13)
        tip = at(1.0, h * 0.45, 0.0)
        quads.append((b0, b1, m1, m0))
        quads.append((m0, m1, tip))
    open_faces(mb, quads, "foliage")


def salal(mb, rng):
    for cx, cf, r, h in ((0.0, 0.0, 0.75, 0.55), (0.45, 0.25, 0.55, 0.45), (-0.4, -0.2, 0.5, 0.4)):
        gem(mb, (cx, cf, h), (r, r * 0.9, h), "foliage_dark", rng, 0.15)


def stump(mb, rng):
    mb.cyl((0.0, 0.0, 0.35), "z", 0.42, 0.35, 6, "bark", r_top=0.36)
    # a moss cap over the cut and a patch down one side
    mb.cone((0.0, 0.0, 0.7), 0.4, 0.8, 6, "moss")
    gem(mb, (0.0, -0.36, 0.25), (0.22, 0.12, 0.2), "moss", rng, 0.1)


def rock(mb, rng):
    gem(mb, (0.0, 0.0, 0.42), (0.75, 0.6, 0.45), "stone", rng, 0.18)
    gem(mb, (0.1, 0.05, 0.8), (0.5, 0.42, 0.12), "moss", rng, 0.12)


def mailbox(mb, rng):
    mb.box(-0.06, 0.06, -0.06, 0.06, 0.0, 1.05, "wood")
    mb.box(-0.1, 0.1, -0.55, 0.55, 1.0, 1.08, "wood")
    for x in (-0.3, 0.3):
        mb.box(-0.24, 0.24, x - 0.12, x + 0.12, 1.08, 1.3, "chrome")
        mb.xprism([(-0.24, 1.3), (0.24, 1.3), (0.0, 1.38)], x - 0.12, x + 0.12, "chrome")
    # one flag up, one down
    mb.box(-0.02, 0.0, 0.43, 0.45, 1.15, 1.45, "car_red")
    mb.box(-0.02, 0.0, -0.43, -0.29, 1.12, 1.17, "car_red")


def firewood(mb, rng):
    # a cord of split rounds between two end posts, under a lean-to roof
    mb.box(-0.4, 0.4, -1.2, 1.2, 0.0, 1.1, "wood")
    for x in (-1.3, 1.3):
        mb.box(-0.06, 0.06, x - 0.06, x + 0.06, 0.0, 1.5, "bark")
    # end grain: a grid of darker rounds on the front face
    for r in range(3):
        for c in range(5):
            x0 = -1.1 + c * 0.44
            z0 = 0.1 + r * 0.33
            mb.front_quad(0.41, x0, x0 + 0.3, z0, z0 + 0.26, "bark")
    mb.xprism([(-0.6, 1.25), (0.6, 1.55), (0.6, 1.6), (-0.6, 1.3)], -1.45, 1.45, "roof")


def split_rail(mb, rng):
    """A 6 m section along x: a post at each end, three rough rails between."""
    for x in (-3.0, 3.0):
        mb.box(-0.09, 0.09, x - 0.09, x + 0.09, 0.0, 1.3, "wood")
    for k, z in enumerate((0.38, 0.75, 1.1)):
        sag = 0.03 * (k % 2)
        mb.fprism([(-3.0, z - 0.06 - sag), (3.0, z - 0.06 + sag), (3.0, z + 0.06 + sag), (-3.0, z + 0.06 - sag)],
                  -0.05, 0.05, "wood")


def log_fence(mb, rng):
    """A 6 m section along x: one round post and two peeled logs."""
    mb.cyl((-3.0, 0.0, 0.6), "z", 0.13, 0.6, 6, "bark")
    for z in (0.45, 0.95):
        mb.cyl((0.0, 0.0, z), "x", 0.11, 3.05, 6, "wood")


def sign(mb, rng):
    mb.box(-0.06, 0.06, -0.06, 0.06, 0.0, 2.3, "wood")
    # the diamond, facing front
    c, r = 1.75, 0.62
    mb.fprism([(0.0, c - r), (r, c), (0.0, c + r), (-r, c)], 0.07, 0.11, "sign_face")
    # a big-footed walking silhouette: head, body, a striding leg pair, long arms
    f = 0.115
    for x0, x1, z0, z1 in ((-0.05, 0.09, 2.0, 2.12), (-0.12, 0.12, 1.66, 1.98), (-0.13, -0.03, 1.38, 1.66),
                           (0.03, 0.15, 1.38, 1.66), (-0.2, -0.12, 1.6, 1.92), (0.12, 0.2, 1.62, 1.9),
                           (-0.2, -0.02, 1.33, 1.4), (0.03, 0.22, 1.33, 1.4)):
        mb.front_quad(f, x0, x1, z0, z1, "sign_board")
    # wet: the bottom tip has run dark
    mb.front_quad(f, -0.18, 0.18, c - r + 0.06, c - r + 0.2, "sign_board")


def espresso(mb, rng):
    w, d, h = 1.9, 1.4, 2.8  # half width, half depth, wall height
    mb.box(-d, d, -w, w, 0.0, h, "body")
    mb.box(-d - 0.05, d + 0.05, -w - 0.05, w + 0.05, 0.0, 0.35, "trim")
    # the service window on the front, a counter under it, and the drive-up side window
    mb.front_quad(d + 0.01, -1.1, 0.6, 1.1, 2.2, "glass")
    mb.box(d, d + 0.35, -1.2, 0.7, 1.05, 1.12, "trim")
    mb.side_quad(w + 0.01, -0.6, 0.6, 1.1, 2.2, "glass", 1)
    # a striped awning over the window
    for k in range(5):
        x0 = -1.4 + k * 0.48
        mat = "body_alt" if k % 2 == 0 else "trim"
        mb.fprism([(x0, h - 0.05), (x0 + 0.48, h - 0.05), (x0 + 0.48, h - 0.12), (x0, h - 0.12)], d, d + 0.9, mat)
    mb.xprism([(-d - 0.2, h), (d + 0.2, h), (d + 0.2, h + 0.18), (-d - 0.2, h + 0.18)], -w - 0.2, w + 0.2, "roof")
    # a takeaway cup on the roof: sleeve, cup and lid
    mb.cyl((0.0, 0.0, h + 0.75), "z", 0.42, 0.55, 8, "trim", r_top=0.55)
    mb.cyl((0.0, 0.0, h + 0.65), "z", 0.47, 0.18, 8, "body_alt")
    mb.cyl((0.0, 0.0, h + 1.36), "z", 0.6, 0.06, 8, "roof")


def maple(mb, rng):
    """A bigleaf maple: a stout leaning trunk, mossy below, two limbs and a broad round crown."""
    mb.tube([(0.0, 0.0, 0.0), (0.25, 0.1, 3.0), (0.2, 0.0, 5.5)], [0.42, 0.34, 0.26], "bark", sides=5)
    mb.tube([(0.0, 0.0, 0.0), (0.12, 0.05, 1.8)], [0.47, 0.4], "moss", sides=5)
    mb.tube([(0.2, 0.0, 4.5), (-1.8, 0.4, 7.2)], [0.2, 0.12], "bark", sides=3)
    mb.tube([(0.2, 0.0, 4.8), (2.0, -0.5, 7.6)], [0.2, 0.12], "bark", sides=3)
    mb.blob((0.0, 0.0, 9.4), (3.6, 3.2, 2.6), "leaf_light", jitter=0.12, rng=rng)
    for cx, cf, cz, rx, rz in ((-2.4, 0.6, 7.9, 2.5, 2.0), (2.5, -0.5, 8.3, 2.6, 2.1)):
        gem(mb, (cx, cf, cz), (rx, rx * 0.9, rz), "leaf_light", rng, 0.12)


def alder(mb, rng):
    """A red alder: a straight pale trunk and a narrow, open crown."""
    mb.tube([(0.0, 0.0, 0.0), (0.1, 0.0, 4.0), (0.0, 0.05, 8.0)], [0.24, 0.19, 0.12], "bark_pale", sides=4)
    mb.blob((0.0, 0.0, 8.6), (1.9, 1.9, 2.4), "foliage", jitter=0.12, rng=rng)
    for cx, cf, cz, rx, rz in ((0.6, 0.3, 6.6, 1.6, 1.6), (-0.5, -0.3, 10.6, 1.3, 1.5)):
        gem(mb, (cx, cf, cz), (rx, rx, rz), "foliage", rng, 0.12)


BUILDERS = {"fern": fern, "salal": salal, "stump": stump, "rock": rock, "mailbox": mailbox,
            "firewood": firewood, "split_rail": split_rail, "log_fence": log_fence, "sign": sign,
            "espresso": espresso, "maple": maple, "alder": alder}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, double_sided=("foliage",))
    for k, (name, x) in enumerate(zip(VARIANTS, XS)):
        rng = random.Random(1000 + k)
        root = _lib.empty(f"pnw_{name}", loc=(x, 0.0, 0.0))
        mb = _lib.MB(list(COLOURS))
        BUILDERS[name](mb, rng)
        # stand it on the ground: its lowest point at z = 0
        low = min(v.co.z for v in mb.bm.verts)
        for v in mb.bm.verts:
            v.co.z -= low
        # drop the unused material slots: each body lists only the roles it paints
        used = sorted({f.material_index for f in mb.bm.faces})
        keep = [mb.mats[i] for i in used]
        for f in mb.bm.faces:
            f.material_index = keep.index(mb.mats[f.material_index])
        mb.mats = keep
        mb.build(f"pnw_{name}_body", mats, root)
    _lib.export(out, normals=False)


main()
