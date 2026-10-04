"""throttlebrawl prop: three Keys coconut-palm variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python palms.py -- --out <path>.glb

Each variant root palm_<v> sits at x = -4, 0, +4 with two mesh children:
palm_<v>_trunk (bark, plus the coconuts) and palm_<v>_fronds (foliage, foliage_dark),
which keeps every variant at 3 draws. Both meshes carry a _SWAY point attribute: 0 at
the trunk base, rising up the trunk, 1.0 at every frond tip. All variety comes from the
parameters in VARIANTS; randomness is seeded.

Ported from the 2026-09-30 blind prop trial (the maintainer's pick, "B"). Fixed from the
trial: the coconuts were light green on light-green fronds and could not be seen; they are
now bigger brown nuts in the trunk mesh, hanging below the crown, at no extra draw.
"""

import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _winding import prepare_winding

# ---------------------------------------------------------------- tuning
VARIANTS = [
    # name, root x, trunk height, lean (m at top), lean azimuth (deg, 0 = +X), curve mode,
    # curve power, base radius, top radius, frond count, frond length, frond rise (deg),
    # droop (deg bend over the frond), frond width, coconuts, seed
    dict(name="palm_a", x=-4.0, height=7.6, lean=1.2, lean_dir=165.0, curve="over", power=1.8,
         r0=0.24, r1=0.15, fronds=10, frond_len=4.0, rise=34.0, droop=105.0, width=0.66, nuts=4, seed=11),
    dict(name="palm_b", x=0.0, height=5.3, lean=0.25, lean_dir=250.0, curve="over", power=1.2,
         r0=0.26, r1=0.18, fronds=9, frond_len=3.4, rise=58.0, droop=105.0, width=0.66, nuts=2, seed=22),
    dict(name="palm_c", x=4.0, height=6.5, lean=2.4, lean_dir=35.0, curve="up", power=1.9,
         r0=0.25, r1=0.15, fronds=8, frond_len=3.8, rise=28.0, droop=150.0, width=0.66, nuts=3, seed=33),
]
TRUNK_SIDES = 6
TRUNK_BANDS = 6
BAND_FLARE = (1.1, 0.93)      # radius factor at the bottom / top of each bark band
TRUNK_SWAY_TOP = 0.3          # sway weight at the crown (fronds rise from here to 1.0)
FROND_SEGS = 6
FROND_WIDTHS = (0.15, 0.7, 1.0, 0.95, 0.75, 0.45, 0.0)   # x frond width, base to tip
FOLD = 0.35                   # V-fold: edges sit this fraction of the width below the rib
TOOTH_OUT = 0.45              # leaflet teeth: outward push (x local width)
TOOTH_BACK = 0.35             # ... and how far they trail back toward the base (x segment)
TOOTH_DROP = 0.25             # ... and droop (x local width)
JITTER_AZ = 12.0              # deg
JITTER_RISE = 10.0            # deg
JITTER_LEN = 0.12             # fraction
NUT_R = 0.24
NUT_DROP = 0.42               # how far below the crown the nut cluster hangs (m)
NUT_OUT = 0.2                 # how far the nuts stand out from the trunk surface (m)

COLOURS = {
    "bark": "#7d6a58",          # grey-brown trunk
    "foliage": "#6fb043",       # light frond green
    "foliage_dark": "#2f7a35",  # dark frond green
}


# ---------------------------------------------------------------- helpers
def out_path():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--out" not in argv:
        raise RuntimeError("missing --out <path>.glb")
    return argv[argv.index("--out") + 1]


def srgb_to_linear(hexcol):
    h = hexcol.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def make_mat(name, cull):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb_to_linear(COLOURS[name]), 1.0)
    b.inputs["Roughness"].default_value = 0.9
    b.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = cull   # fronds: culling off -> glTF doubleSided
    return m


class MB:
    def __init__(self, mats):
        self.bm = bmesh.new()
        self.sway = self.bm.verts.layers.float.new("_SWAY")
        self.mats = list(mats)

    def v(self, co, sway):
        vert = self.bm.verts.new(co)
        vert[self.sway] = max(0.0, min(1.0, sway))
        return vert

    def face(self, verts, mat):
        f = self.bm.faces.new(verts)
        f.material_index = self.mats.index(mat)
        f.smooth = False
        return f

    def build(self, name, matlib, parent):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        if me.attributes.get("_SWAY") is None:
            raise RuntimeError(f"{name}: _SWAY attribute missing after to_mesh")
        for m in self.mats:
            me.materials.append(matlib[m])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob


# ---------------------------------------------------------------- trunk
def trunk_curve(p, s):
    """Centre point and unit tangent at s in [0, 1] (local coords, base at origin)."""
    d = math.radians(p["lean_dir"])
    hd = Vector((math.cos(d), math.sin(d), 0.0))
    k = p["power"]
    if p["curve"] == "over":        # upright base, bending over near the top
        off, doff = s ** k, k * s ** (k - 1) if s > 0 else 0.0
    else:                           # leaning base that curves back up toward vertical
        off, doff = 1 - (1 - s) ** k, k * (1 - s) ** (k - 1)
    c = hd * (p["lean"] * off) + Vector((0, 0, p["height"] * s))
    t = (hd * (p["lean"] * doff) + Vector((0, 0, p["height"]))).normalized()
    return c, t, hd


def trunk_sway(s):
    return TRUNK_SWAY_TOP * s * s


def build_trunk(mb, p):
    n = TRUNK_SIDES
    rings = []
    for b in range(TRUNK_BANDS):
        for j, s in enumerate((b / TRUNK_BANDS, (b + 1) / TRUNK_BANDS)):
            c, t, hd = trunk_curve(p, s)
            r = (p["r0"] + (p["r1"] - p["r0"]) * s) * BAND_FLARE[j]
            side = Vector((-hd.y, hd.x, 0.0))             # perpendicular to the lean plane
            u, w = side, t.cross(side).normalized()
            if s == 0.0:                                   # base ring flat on the ground
                u, w = Vector((1, 0, 0)), Vector((0, 1, 0))
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                ring.append(mb.v(c + (u * math.cos(a) + w * math.sin(a)) * r, trunk_sway(s)))
            rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            mb.face((ra[i], ra[j], rb[j], rb[i]), "bark")
    mb.face(list(reversed(rings[0])), "bark")
    mb.face(rings[-1], "bark")
    bmesh.ops.recalc_face_normals(mb.bm, faces=list(mb.bm.faces))


# ---------------------------------------------------------------- crown
def build_frond(mb, crown, az, rise, droop, length, width):
    h = Vector((math.cos(az), math.sin(az), 0.0))
    side = Vector((-h.y, h.x, 0.0))
    step = length / FROND_SEGS
    spine = [crown + h * 0.12]
    for i in range(FROND_SEGS):
        t = (i + 0.5) / FROND_SEGS
        pitch = math.radians(rise - droop * t ** 1.3)
        spine.append(spine[-1] + (h * math.cos(pitch) + Vector((0, 0, math.sin(pitch)))) * step)
    sw = lambda t: TRUNK_SWAY_TOP + (1.0 - TRUNK_SWAY_TOP) * t ** 1.2
    S = [mb.v(spine[i], sw(i / FROND_SEGS)) for i in range(FROND_SEGS + 1)]
    for sgn, mat in ((1, "foliage"), (-1, "foliage_dark")):
        E = []
        for i in range(FROND_SEGS + 1):
            w = width * FROND_WIDTHS[i]
            E.append(None if w <= 0 else mb.v(spine[i] + side * (sgn * w) - Vector((0, 0, FOLD * w)),
                                               sw(i / FROND_SEGS)))
        for i in range(FROND_SEGS):
            a, b = E[i], E[i + 1]
            quad = [S[i], S[i + 1]] + ([b] if b else []) + [a]
            mb.face(quad if sgn > 0 else list(reversed(quad)), mat)
            if a is not None and b is not None:
                t = (i + 0.5) / FROND_SEGS
                w = width * 0.5 * (FROND_WIDTHS[i] + FROND_WIDTHS[i + 1])
                mid = (spine[i] + spine[i + 1]) / 2
                tip = (mid + side * (sgn * w * (1 + TOOTH_OUT)) - (spine[i + 1] - spine[i]) * TOOTH_BACK
                       - Vector((0, 0, (FOLD + TOOTH_DROP) * w)))
                tv = mb.v(tip, sw(t))
                tri = [a, b, tv]
                mb.face(tri if sgn > 0 else list(reversed(tri)), mat)


def build_nut(mb, centre, sway):
    r = NUT_R
    pts = [centre + Vector(d) * r for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1.2), (0, 0, -1.1))]
    vs = [mb.v(p, sway) for p in pts]
    xp, xn, yp, yn, zp, zn = vs
    faces = []
    for a, b in ((xp, yp), (yp, xn), (xn, yn), (yn, xp)):
        faces.append(mb.face((a, b, zp), "bark"))
        faces.append(mb.face((b, a, zn), "bark"))
    bmesh.ops.recalc_face_normals(mb.bm, faces=faces)


def build_crown(mb, p):
    rng = random.Random(p["seed"])
    top, t, hd = trunk_curve(p, 1.0)
    crown = top + t * 0.1
    n = p["fronds"]
    base_az = rng.uniform(0, 2 * math.pi)
    for k in range(n):
        az = base_az + 2 * math.pi * k / n + math.radians(rng.uniform(-JITTER_AZ, JITTER_AZ))
        rise = p["rise"] + rng.uniform(-JITTER_RISE, JITTER_RISE) + (18.0 if k % 3 == 0 else 0.0)
        length = p["frond_len"] * (1 + rng.uniform(-JITTER_LEN, JITTER_LEN))
        droop = p["droop"] * (1 + rng.uniform(-0.15, 0.15))
        build_frond(mb, crown, az, rise, droop, length, p["width"])


def build_nuts(mb, p):
    """Coconuts in the trunk mesh (bark colour, so they cost no draw), under the crown."""
    base_az = random.Random(p["seed"]).uniform(0, 2 * math.pi)   # the crown's base azimuth
    top, t, hd = trunk_curve(p, 1.0)
    for k in range(p["nuts"]):
        az = base_az + 2 * math.pi * (k + 0.5) / max(p["nuts"], 1)
        c = top - t * NUT_DROP + Vector((math.cos(az), math.sin(az), 0.0)) * (p["r1"] + NUT_OUT)
        build_nut(mb, c, TRUNK_SWAY_TOP)


def main():
    out = out_path()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    mats = {"bark": make_mat("bark", cull=True),
            "foliage": make_mat("foliage", cull=False),
            "foliage_dark": make_mat("foliage_dark", cull=False)}
    for p in VARIANTS:
        root = bpy.data.objects.new(p["name"], None)
        scene.collection.objects.link(root)
        root.location = (p["x"], 0.0, 0.0)
        mb = MB(["bark"])
        build_trunk(mb, p)
        build_nuts(mb, p)
        mb.build(f"{p['name']}_trunk", mats, root)
        mb = MB(["foliage", "foliage_dark"])
        build_crown(mb, p)
        mb.build(f"{p['name']}_fronds", mats, root)

    prepare_winding()
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=False,
        export_yup=True, export_apply=True, export_extras=True, export_attributes=True,
        export_vertex_color="NONE", export_texcoords=False, export_normals=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_animations=False,
    )
    print(f"PROP_OK {out}")


main()
