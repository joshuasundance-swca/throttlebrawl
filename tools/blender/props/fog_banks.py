"""throttlebrawl prop: San Francisco fog banks, two variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python fog_banks.py -- --out <path>.glb

Each variant root fog_bank_<v> sits on the ground (the water) at x = -40 and +40, with one mesh
child fog_bank_<v>_body: a long low bank of flattened, faceted lumps, rising toward one end.
One opaque flat material (`fog`): the game draws the banks in the region's fog colour, unlit, so
they melt into the haze with distance. They stand offshore and on the horizon, never on a road.
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
    # x: root; length: along x (m); depth: along f (m); height: tallest lump (m); lumps; seed
    dict(name="fog_bank_a", x=-40.0, length=64.0, depth=26.0, height=16.0, lumps=7, seed=7),
    dict(name="fog_bank_b", x=40.0, length=44.0, depth=20.0, height=11.0, lumps=5, seed=8),
]

COLOURS = {"fog": "#e3e6e8"}
SIDES = 8
RINGS = (0.0, 0.45, 0.85)     # dome rings, as elevation angles in radians (then the apex)


def dome(mb, centre, radii, rng):
    """A low faceted dome on the water: SIDES around, a ring per RINGS entry, then the apex."""
    cx, cf, _ = centre
    rx, rf, rz = radii
    rings = []
    for k, el in enumerate(RINGS):
        ring = []
        for i in range(SIDES):
            a = 2 * math.pi * (i + 0.5 * k) / SIDES
            j = 1.0 + rng.uniform(-0.1, 0.1) if k else 1.0
            c = math.cos(el) * j
            ring.append(mb.v(_lib.P(cx + rx * c * math.cos(a), cf + rf * c * math.sin(a), rz * math.sin(el))))
        rings.append(ring)
    apex = mb.v(_lib.P(cx, cf, rz))
    faces = []
    for a, b in zip(rings, rings[1:]):
        for i in range(SIDES):
            j = (i + 1) % SIDES
            faces.append(mb.bm.faces.new((a[i], a[j], b[j])))
            faces.append(mb.bm.faces.new((a[i], b[j], b[i])))
    top = rings[-1]
    faces += [mb.bm.faces.new((top[i], top[(i + 1) % SIDES], apex)) for i in range(SIDES)]
    mb.tag(faces, "fog")


def build(mb, p, rng):
    n = p["lumps"]
    for k in range(n):
        t = k / (n - 1)
        x = (t - 0.5) * p["length"] * 0.8
        h = p["height"] * (0.55 + 0.45 * t) * rng.uniform(0.85, 1.0)
        rx = p["length"] / n * rng.uniform(0.9, 1.25)
        rf = p["depth"] / 2 * rng.uniform(0.8, 1.0)
        f = rng.uniform(-0.15, 0.15) * p["depth"]
        dome(mb, (x, f, 0.0), (rx, rf, h), rng)


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    for p in VARIANTS:
        rng = random.Random(p["seed"])
        root = _lib.empty(p["name"], loc=(p["x"], 0.0, 0.0))
        mb = _lib.MB(["fog"])
        build(mb, p, rng)
        mb.build(f"{p['name']}_body", mats, root)
    # Faceted: the game rebuilds each face's normal from its corners (models.ts), so none ship.
    _lib.export(out, normals=False)


main()
