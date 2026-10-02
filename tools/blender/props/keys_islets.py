"""throttlebrawl prop: Florida Keys islets, four variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python keys_islets.py -- --out <path>.glb

Run W-Q, distinct keys (interview, 2026-10-02; playtest 2: "Maybe islands in the Keys", and the
pitch deck's "little islands with a shack, a palm and a stranded boat off every bridge, so the water
is never empty"). The little islands the game floats on the open water beside a Keys road, out past
the boats. Each variant root keys_islet_<v> sits at the waterline (y = 0) at its own x, with one
mesh child keys_islet_<v>_body; a sandy mound (or the pilings) runs SINK_M below the waterline so
it meets the sea. Like every prop, its lowest point is the origin: the game sinks it SINK_M into the
water (scenery.ts ISLET_SINK_M).

- shack: a sandbar with two palms, a bait shack on stilts and a skiff pulled up on the sand;
- wreck: a sandbar with a palm and a sailboat aground, heeled over, its sail furled;
- mangrove: a mangrove clump on arching roots, a short dock and a pelican on a piling;
- stilts: a stilt house standing alone in the flats on its pilings, with a ladder down to a skiff.

Flat colours only; no grime. Exported without normals: every face is flat, and the game rebuilds
them.
"""

import math
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

COLOURS = {
    "deck": "#e8d6a6",          # sand
    "bark": "#7a5d42",          # palm trunks, mangrove roots
    "foliage": "#3f8a43",       # palm fronds
    "foliage_dark": "#2f6b3a",  # mangrove canopy
    "wood": "#a68a5d",          # stilts, docks, pilings
    "paint_mint": "#a7d8c6",    # the shack
    "paint_blue": "#8fcfe0",    # the stilt house
    "roof": "#c9ccc9",          # tin
    "glass": "#2e3a44",
    "hull": "#e8e2d2",
    "hull_bottom": "#3f7fa0",
    "canvas": "#efe6d2",        # the furled sail
    "frame": "#6c757c",         # the mast
    "stone": "#8f8577",         # the pelican
    "trim": "#f4efe4",
}

SINK_M = 0.8  # how far each islet reaches below the waterline
VARIANTS = ["shack", "wreck", "mangrove", "stilts"]
XS = [-60.0, -20.0, 20.0, 60.0]


def mound(mb, r, top):
    """A low sandy mound: a wide faceted cone from below the waterline to `top`."""
    mb.cone((0.0, 0.0, 0.0), r, top, 9, "deck", phase=0.2, droop=SINK_M)


def palm(mb, rng, x, f, lean, h):
    """A palm: a curved trunk and a flattened crown of fronds (cheap: a squashed icosahedron)."""
    tip = (x + lean[0], f + lean[1], h)
    mid = (x + lean[0] * 0.4, f + lean[1] * 0.4, h * 0.55)
    mb.tube([(x, f, 0.3), mid, tip], [0.2, 0.16, 0.12], "bark", sides=4)
    mb.blob((tip[0], tip[1], h + 0.2), (2.4, 2.4, 0.55), "foliage", jitter=0.25, rng=rng)


def skiff(mb, x, f, z):
    """A small skiff pulled up (its hull along x)."""
    mb.fprism([(x - 2.0, z), (x + 1.5, z), (x + 2.2, z + 0.6), (x - 2.0, z + 0.55)], f - 0.8, f + 0.8, "hull")


def shack(mb, rng):
    mound(mb, 11.0, 1.1)
    palm(mb, rng, -4.0, -2.0, (-1.2, -0.4), 7.0)
    palm(mb, rng, -6.5, 1.5, (-0.8, 1.0), 5.8)
    for x in (1.0, 4.6):
        for f in (-1.0, 1.6):
            mb.box(f - 0.12, f + 0.12, x - 0.12, x + 0.12, 0.3, 1.9, "wood")
    mb.box(-1.2, 1.8, 0.8, 4.8, 1.9, 4.2, "paint_mint")
    mb.xprism([(-1.6, 4.2), (2.2, 4.2), (0.3, 5.3)], 0.5, 5.1, "roof")
    mb.front_quad(1.81, 2.2, 3.0, 1.9, 3.6, "glass")
    skiff(mb, 6.0, 4.5, 0.5)


def wreck(mb, rng):
    mound(mb, 9.0, 0.9)
    palm(mb, rng, -3.0, 0.5, (0.9, 0.6), 6.4)
    # the sailboat aground, heeled toward the sand: a hull along x, its mast leaning over
    mb.fprism([(1.0, 0.3), (7.0, 0.1), (8.2, 1.5), (0.6, 1.4)], 1.0, 3.2, "hull")
    mb.fprism([(1.2, 0.0), (6.8, -0.2), (7.0, 0.3), (1.0, 0.3)], 1.3, 2.9, "hull_bottom")
    mb.tube([(4.0, 2.1, 1.4), (5.5, 5.0, 8.5)], [0.09, 0.06], "frame", sides=3)
    mb.tube([(4.2, 2.3, 2.4), (5.2, 4.3, 7.2)], [0.22, 0.12], "canvas", sides=4)


def mangrove(mb, rng):
    mound(mb, 7.0, 0.5)
    for k in range(6):
        a = 2 * math.pi * k / 6 + rng.uniform(-0.3, 0.3)
        mb.tube([(1.9 * math.cos(a), 1.9 * math.sin(a), 0.0), (0.7 * math.cos(a), 0.7 * math.sin(a), 1.4),
                 (0.0, 0.0, 2.0)], [0.1, 0.09, 0.08], "bark", sides=3)
    for cx, cf, r in ((0.0, 0.0, 2.6), (1.6, -0.8, 1.8), (-1.4, 1.0, 1.9)):
        mb.blob((cx, cf, 3.2), (r, r, r * 0.6), "foliage_dark", jitter=0.2, rng=rng)
    # a short dock out from the roots, and a pelican on its end piling
    mb.box(2.6, 7.6, -0.6, 0.6, 0.55, 0.7, "wood")
    for f in (3.4, 5.4, 7.4):
        for x in (-0.55, 0.55):
            mb.box(f - 0.1, f + 0.1, x - 0.1, x + 0.1, -SINK_M, 0.55, "wood")
    mb.cyl((0.9, 7.4, 1.0), "z", 0.13, 0.45, 6, "wood")
    mb.blob((0.9, 7.35, 1.75), (0.2, 0.36, 0.2), "stone", jitter=0.05, rng=rng)
    mb.blob((0.9, 7.55, 2.15), (0.09, 0.11, 0.09), "trim")


def stilts(mb, rng):
    for x in (-2.6, 2.6):
        for f in (-2.2, 2.2):
            mb.box(f - 0.15, f + 0.15, x - 0.15, x + 0.15, -SINK_M, 3.0, "wood")
    mb.box(-2.8, 3.0, -3.0, 3.0, 2.9, 3.1, "wood")
    mb.box(-2.4, 2.4, -2.6, 2.6, 3.1, 5.6, "paint_blue")
    mb.xprism([(-3.0, 5.6), (3.0, 5.6), (0.0, 7.2)], -3.0, 3.0, "roof")
    mb.front_quad(2.41, -0.5, 0.5, 3.1, 5.0, "glass")
    for x in (-1.8, 1.8):
        mb.front_quad(2.41, x - 0.5, x + 0.5, 4.0, 4.9, "glass")
    mb.box(2.6, 2.75, -0.4, 0.4, 0.0, 2.9, "trim")
    skiff(mb, 0.0, 5.0, 0.0)


BUILDERS = {"shack": shack, "wreck": wreck, "mangrove": mangrove, "stilts": stilts}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    # Every part is a closed solid or a front-facing panel: nothing is double-sided.
    mats = _lib.make_mats(COLOURS)
    for k, (name, x) in enumerate(zip(VARIANTS, XS)):
        rng = random.Random(4100 + k)
        root = _lib.empty(f"keys_islet_{name}", loc=(x, 0.0, 0.0))
        mb = _lib.MB(list(COLOURS))
        BUILDERS[name](mb, rng)
        # stand it on its lowest point (SINK_M below the waterline it was built about)
        for v in mb.bm.verts:
            v.co.z += SINK_M
        # each body lists only the roles it paints
        used = sorted({f.material_index for f in mb.bm.faces})
        keep = [mb.mats[i] for i in used]
        for f in mb.bm.faces:
            f.material_index = keep.index(mb.mats[f.material_index])
        mb.mats = keep
        mb.build(f"keys_islet_{name}_body", mats, root)
    _lib.export(out, normals=False)


main()
