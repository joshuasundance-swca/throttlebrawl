"""throttlebrawl prop: Pacific Northwest conifers, four variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python conifers.py -- --out <path>.glb

Each variant root conifer_<v> sits on the ground at x = -9, -3, +3 and +9, with two mesh
children: conifer_<v>_trunk (bark) and conifer_<v>_boughs (foliage, foliage_dark: stacked
faceted cones, the tiers alternating the two greens so the tree reads in flat light). The four
are a tall Douglas fir, a mid fir, a young fir and a droopier cedar; the game clusters them.
Three draws per variant and three shared materials. Lean on triangles on purpose: a forest
road shows hundreds of them at once.
"""

import math
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
VARIANTS = [
    # x: root position; height: tip (m); base: where the lowest tier starts (m up); radius: the
    # lowest tier's half-width (m); tiers: cone count; sides: cone sides; droop: how far each
    # tier's rim hangs below its start (m); trunk_r: trunk radius at the ground; seed: randomness
    dict(name="conifer_a", x=-9.0, height=21.0, base=3.2, radius=3.4, tiers=5, sides=7, droop=0.9,
         trunk_r=0.42, seed=11),
    dict(name="conifer_b", x=-3.0, height=14.0, base=2.0, radius=2.8, tiers=4, sides=7, droop=0.7,
         trunk_r=0.32, seed=22),
    dict(name="conifer_c", x=3.0, height=7.5, base=0.9, radius=1.9, tiers=3, sides=6, droop=0.45,
         trunk_r=0.18, seed=33),
    dict(name="conifer_d", x=9.0, height=16.5, base=2.4, radius=3.8, tiers=5, sides=7, droop=1.4,
         trunk_r=0.5, seed=44),
]
TIER_OVERLAP = 0.45           # each tier starts this share of a tier height below the previous top
TIP_TAPER = 0.55              # the top tier's radius as a share of a straight-cone's
RIM_JITTER = 0.12             # rim radius jitter, as a share
TRUNK_SIDES = 5

COLOURS = {
    "bark": "#5b4636",          # grey-brown fir bark
    "foliage": "#2f5a3a",       # deep fir green
    "foliage_dark": "#1f3d2b",  # the shaded tiers
}


def build_trunk(mb, p):
    top = p["base"] + (p["height"] - p["base"]) * 0.45
    mb.cyl((0.0, 0.0, top / 2), "z", p["trunk_r"], top / 2, TRUNK_SIDES, "bark", r_top=p["trunk_r"] * 0.45)


def cone(mb, z0, z1, r, sides, droop, mat, rng, phase):
    """A faceted cone: a drooping rim at z0 - droop, the apex at z1, with a flat underside."""
    rim = []
    for i in range(sides):
        a = phase + 2 * math.pi * i / sides
        rr = r * (1.0 + rng.uniform(-RIM_JITTER, RIM_JITTER))
        rim.append(mb.v(_lib.P(rr * math.cos(a), rr * math.sin(a), z0 - droop)))
    apex = mb.v(_lib.P(rng.uniform(-0.05, 0.05) * r, rng.uniform(-0.05, 0.05) * r, z1))
    faces = [mb.bm.faces.new((rim[i], rim[(i + 1) % sides], apex)) for i in range(sides)]
    faces.append(mb.bm.faces.new(list(reversed(rim))))
    mb.tag(faces, mat)


def build_boughs(mb, p, rng):
    n = p["tiers"]
    span = p["height"] - p["base"]
    step = span / (n - TIER_OVERLAP * (n - 1))
    for k in range(n):
        z0 = p["base"] + k * step * (1.0 - TIER_OVERLAP)
        z1 = min(p["height"], z0 + step) if k < n - 1 else p["height"]
        # a straight silhouette from the base radius to the tip, the top tier a little slimmer
        share = 1.0 - (z0 - p["base"]) / span
        r = p["radius"] * share * (TIP_TAPER if k == n - 1 else 1.0)
        mat = "foliage" if k % 2 == 0 else "foliage_dark"
        cone(mb, z0, z1, max(0.4, r), p["sides"], p["droop"] * share, mat, rng, rng.uniform(0, math.pi))


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    for p in VARIANTS:
        rng = random.Random(p["seed"])
        root = _lib.empty(p["name"], loc=(p["x"], 0.0, 0.0))
        mb = _lib.MB(["bark"])
        build_trunk(mb, p)
        mb.build(f"{p['name']}_trunk", mats, root)
        mb = _lib.MB(["foliage", "foliage_dark"])
        build_boughs(mb, p, rng)
        mb.build(f"{p['name']}_boughs", mats, root)
    # Faceted: the game rebuilds each face's normal from its corners (models.ts), so none ship.
    _lib.export(out, normals=False)


main()
