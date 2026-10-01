"""throttlebrawl prop: a small Keys flats skiff for the water offshore (a lean far-distance boat).

Run: blender --background --factory-startup --python-exit-code 1 --python skiff.py -- --out <path>.glb

The big centre-console boat (boat.glb) costs 8 draws; this one costs 3, for the boats that sit
offshore in numbers. A low, wide hull, a poling platform over the outboard and a push pole
across the gunwales. Root empty `skiff` is the waterline pivot (identity transform), with the
same probe empties as the big boat (`probe_bow`, `probe_stern`, `probe_port`,
`probe_starboard` at y = 0), so the game bobs both boats the same way. Bow toward glTF +Z,
port toward +X. Meshes: `skiff_hull` (hull, hull_bottom) and `skiff_gear` (engine).
"""

import sys
from pathlib import Path

import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
# Hull stations, stern to bow: (f, gunwale half-width, sheer z, chine half-width, keel z)
STATIONS = [
    (-2.4, 0.86, 0.42, 0.8, -0.18),
    (-0.6, 0.94, 0.44, 0.86, -0.2),
    (1.2, 0.84, 0.5, 0.66, -0.14),
    (2.2, 0.5, 0.58, 0.3, 0.02),
    (2.75, 0.04, 0.66, 0.02, 0.4),
]
CHINE_Z = 0.0           # chine at the waterline: a flat-bottomed flats hull
INNER = 0.1             # gunwale cap width
SOLE_Z = 0.12           # cockpit floor
BOOT_TOP = 0.1          # the hull_bottom band runs up to here (just above the water)

COLOURS = {
    "hull": "#e8e2d2",          # off-white gelcoat
    "hull_bottom": "#6f9fb5",   # faded sky-blue bottom paint band
    "engine": "#30353b",        # outboard, poling platform, console, push pole
}


def ring(st):
    f, gw, sh, cw, kz = st
    iw = max(gw - INNER, 0.02)
    sw = max(gw - INNER - 0.08, 0.01)
    bx = cw + (gw - cw) * (BOOT_TOP - CHINE_Z) / (sh - CHINE_Z)
    port = [(cw, CHINE_Z if kz < CHINE_Z else kz + 0.01), (bx, max(BOOT_TOP, kz + 0.02)), (gw, sh), (iw, sh),
            (sw, max(SOLE_Z, kz + 0.04))]
    pts = [(0.0, f, kz)] + [(x, f, z) for x, z in port] + [(-x, f, z) for x, z in reversed(port)]
    return [_lib.P(*p) for p in pts]


def build_hull(mb):
    rings = [ring(st) for st in STATIONS]
    vr = [[mb.v(p) for p in r] for r in rings]
    # ring: keel, chine, boot, gunwale, cap, sole | sole', cap', gunwale', boot', chine' (11 bands)
    bands = ["hull_bottom", "hull_bottom", "hull", "hull", "hull", "hull", "hull", "hull", "hull",
             "hull_bottom", "hull_bottom"]
    n = len(rings[0])
    faces = []
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            fc = mb.bm.faces.new((a[i], a[j], b[j], b[i]))
            fc.material_index = mb.mats.index(bands[i])
            fc.smooth = False
            faces.append(fc)
    for verts in (list(reversed(vr[0])), vr[-1]):
        fc = mb.bm.faces.new(verts)
        fc.material_index = mb.mats.index("hull")
        fc.smooth = False
        faces.append(fc)
    bmesh.ops.recalc_face_normals(mb.bm, faces=faces)


def build_gear(mb):
    # outboard on the transom
    mb.hull([(sx * 0.2, f, z) for sx in (-1, 1) for f, z in ((-2.42, 0.38), (-2.42, 0.85), (-2.95, 0.8),
                                                               (-2.95, 0.42))], "engine")
    mb.box(-2.62, -2.48, -0.08, 0.08, -0.45, 0.4, "engine")
    # poling platform: four legs and a deck over the motor
    for sx in (-1, 1):
        for f in (-2.2, -2.9):
            mb.box(f - 0.03, f + 0.03, sx * 0.42 - 0.03, sx * 0.42 + 0.03, 0.42 if f > -2.4 else 0.3, 1.5, "engine")
    mb.box(-3.0, -2.1, -0.5, 0.5, 1.5, 1.55, "engine")
    # small side console with a wheel box, and the push pole lying along the starboard gunwale
    mb.box(-0.3, 0.15, -0.72, -0.4, SOLE_Z, 0.72, "engine")
    mb.tube([(-0.78, -2.3, 0.52), (-0.72, 2.3, 0.6)], [0.025, 0.025], "engine", sides=3)


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, rough={"engine": 0.55})
    root = _lib.empty("skiff")
    mb = _lib.MB(["hull", "hull_bottom"])
    build_hull(mb)
    mb.build("skiff_hull", mats, root)
    mb = _lib.MB(["engine"])
    build_gear(mb)
    mb.build("skiff_gear", mats, root)
    # probes where the hull meets the waterline (y = 0): the chine sits on it, so the widest
    # station's chine is port and starboard; the stem and transom give bow and stern
    widest = max(STATIONS, key=lambda st: st[3])
    bow_f = STATIONS[-2][0] + (STATIONS[-1][0] - STATIONS[-2][0]) * (0.0 - STATIONS[-2][4]) / (
        STATIONS[-1][4] - STATIONS[-2][4])
    for name, (x, f) in (("probe_bow", (0.0, bow_f)), ("probe_stern", (0.0, STATIONS[0][0])),
                         ("probe_port", (widest[3], widest[0])), ("probe_starboard", (-widest[3], widest[0]))):
        _lib.empty(name, parent=root, loc=_lib.P(x, f, 0.0))
    _lib.export(out)


main()
