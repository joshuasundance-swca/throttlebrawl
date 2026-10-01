"""throttlebrawl prop: red-mangrove clumps, two variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python mangroves.py -- --out <path>.glb

Each variant root mangrove_<v> sits on the ground (or the waterline) at x = -3 and +3, with two
mesh children: mangrove_<v>_roots (bark: the arching prop roots and the short stems) and
mangrove_<v>_canopy (foliage, foliage_dark: a lumpy faceted crown). Three draws per variant,
three materials shared by both variants. Both meshes carry a _SWAY point attribute (0 at the
ground, 1.0 at the outer canopy) like the palms, so the game can sway them the same way.
"""

import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
VARIANTS = [
    # x: root position; hub: where the prop roots meet the stems (m up); roots: count;
    # root_r: how far out the roots land (m); stems: count; height: canopy top (m);
    # crown_r: canopy half-width (m); blobs: canopy lumps; seed: fixed randomness
    dict(name="mangrove_a", x=-3.0, hub=0.75, roots=10, root_r=1.7, stems=2, height=3.3,
         crown_r=2.6, blobs=7, lean=(0.3, 0.1), seed=101),
    dict(name="mangrove_b", x=3.0, hub=0.95, roots=12, root_r=2.1, stems=3, height=4.2,
         crown_r=3.3, blobs=8, lean=(-0.4, 0.25), seed=202),
]
ROOT_SIDES = 3
ROOT_R = (0.085, 0.05)        # root radius at the hub and at the ground
ROOT_ARCH = 0.45              # how far the roots arch up above the hub before they dive (m)
STEM_SIDES = 5
STEM_R = (0.14, 0.09)
CROWN_FLAT = 0.5              # canopy lump height as a fraction of its width
ROOTS_SWAY_TOP = 0.15         # sway weight where the stems meet the canopy

COLOURS = {
    "bark": "#6e5a48",          # grey-brown roots and stems
    "foliage": "#4f8a3c",       # mangrove leaf green
    "foliage_dark": "#2c5a2e",  # the shaded underside lumps
}


def build_roots(mb, p, rng):
    hub = p["hub"]
    base_az = rng.uniform(0, 2 * math.pi)
    for k in range(p["roots"]):
        az = base_az + 2 * math.pi * k / p["roots"] + math.radians(rng.uniform(-14, 14))
        r_end = p["root_r"] * rng.uniform(0.8, 1.1)
        ca, sa = math.cos(az), math.sin(az)
        z0 = hub + rng.uniform(-0.15, 0.25)
        # out and up from the hub, over the top of the arch, then steeply down into the mud
        pts = [(0.1 * ca, 0.1 * sa, z0),
               (0.38 * r_end * ca, 0.38 * r_end * sa, z0 + ROOT_ARCH),
               (0.78 * r_end * ca, 0.78 * r_end * sa, z0 * 0.7),
               (r_end * ca, r_end * sa, 0.0)]
        sways = [ROOTS_SWAY_TOP * 0.4, ROOTS_SWAY_TOP * 0.35, ROOTS_SWAY_TOP * 0.15, 0.0]
        radii = [ROOT_R[0], ROOT_R[0] * 0.85, (ROOT_R[0] + ROOT_R[1]) / 2, ROOT_R[1]]
        mb.tube(pts, radii, "bark", sides=ROOT_SIDES, sways=sways)
    canopy_base = hub + 0.75
    for k in range(p["stems"]):
        az = base_az + 2 * math.pi * (k + 0.5) / p["stems"]
        spread = 0.25 + 0.15 * k
        lx, lf = p["lean"]
        top = (lx + spread * math.cos(az), lf + spread * math.sin(az), canopy_base + 0.3)
        mid = (0.5 * top[0], 0.5 * top[1], (hub + top[2]) / 2)
        mb.tube([(0.0, 0.0, hub - 0.35), mid, top], [STEM_R[0], (STEM_R[0] + STEM_R[1]) / 2, STEM_R[1]], "bark",
                sides=STEM_SIDES, sways=[ROOTS_SWAY_TOP * 0.4, ROOTS_SWAY_TOP * 0.7, ROOTS_SWAY_TOP])
    return canopy_base


def build_canopy(mb, p, rng, canopy_base):
    lx, lf = p["lean"]
    r = p["crown_r"]
    top = p["height"]

    def sway_of(z):
        return ROOTS_SWAY_TOP + (1.0 - ROOTS_SWAY_TOP) * max(0.0, min(1.0, (z - canopy_base) / (top - canopy_base)))

    # one central lump, the rest in a ring; the lowest, widest lumps are the dark ones
    n = p["blobs"]
    lumps = [((lx, lf, top - r * CROWN_FLAT * 0.75), (r * 0.62, r * 0.62, r * CROWN_FLAT * 0.75), "foliage")]
    base_az = rng.uniform(0, 2 * math.pi)
    for k in range(n - 1):
        az = base_az + 2 * math.pi * k / (n - 1) + math.radians(rng.uniform(-18, 18))
        d = r * rng.uniform(0.5, 0.62)
        size = r * rng.uniform(0.4, 0.5)
        z = canopy_base + size * CROWN_FLAT * 0.8 + rng.uniform(0.0, 0.5)
        mat = "foliage_dark" if k % 2 == 0 else "foliage"
        lumps.append(((lx + d * math.cos(az), lf + d * math.sin(az), z), (size, size, size * CROWN_FLAT), mat))
    for centre, radii, mat in lumps:
        mb.blob(centre, radii, mat, jitter=0.12, rng=rng, sway_of=sway_of)


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    for p in VARIANTS:
        rng = random.Random(p["seed"])
        root = _lib.empty(p["name"], loc=(p["x"], 0.0, 0.0))
        mb = _lib.MB(["bark"], sway=True)
        canopy_base = build_roots(mb, p, rng)
        mb.build(f"{p['name']}_roots", mats, root)
        mb = _lib.MB(["foliage", "foliage_dark"], sway=True)
        build_canopy(mb, p, rng, canopy_base)
        mb.build(f"{p['name']}_canopy", mats, root)
    _lib.export(out)


main()
