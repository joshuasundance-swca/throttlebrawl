"""throttlebrawl prop: Keys centre-console fishing boat.

Run: blender --background --factory-startup --python-exit-code 1 --python boat.py -- --out <path>.glb

Blender axes: Z up, bow toward -Y, port toward +X. Below, f = metres toward the bow
(Blender y = -f), x = metres toward port, z = metres above the waterline.
The root empty `boat` is the waterline pivot at the origin.

Ported from the 2026-09-30 blind prop trial: the maintainer liked this hull ("A") but not its
rods ("the antennas or whatever on A are disconnected"). Every rod now stands in a holder that
is part of the boat: short stubby rods in tube holders on the T-top's aft rail and in flush
holders on the gunwale cap, the way the other trial boat did it. No rod reaches past the rub
rail, so the rods no longer widen the boat (the trial's rods made it 3.60 m wide on a 2.52 m hull).
"""

import math
import sys

import bmesh
import bpy
from mathutils import Vector

# ---------------------------------------------------------------- tuning
# Hull stations, stern to bow:
# (f, gunwale half-width, sheer z, chine half-width, chine z, keel z, sole z)
STATIONS = [
    (-3.75, 1.16, 0.92, 1.08, -0.02, -0.30, 0.38),
    (-2.40, 1.24, 0.94, 1.14, -0.08, -0.42, 0.36),
    (-0.60, 1.26, 0.98, 1.14, -0.10, -0.45, 0.36),
    (1.20, 1.21, 1.05, 1.00, -0.05, -0.43, 0.40),
    (2.40, 1.02, 1.13, 0.66, 0.06, -0.30, 0.55),
    (3.25, 0.70, 1.21, 0.30, 0.28, -0.02, 0.80),
    (3.95, 0.07, 1.28, 0.03, 0.85, 0.72, 1.05),   # raked, flared bow
]
BOOT_Z = 0.3           # antifouling line (it sweeps up toward the bow)
CAP_W = 0.14           # gunwale cap width
SOLE_INSET = 0.22      # cockpit liner inset at the sole

CONSOLE_F = (-0.25, 0.85)
CONSOLE_HALF_W = 0.46
CONSOLE_TOP = 1.38
TTOP_F = (-1.35, 1.15)
TTOP_HALF_W = 0.98
TTOP_Z = 2.34
TTOP_LEGS = ((-0.95, 0.56), (0.8, 0.56))   # (f, half-width) pairs
TTOP_RODS = 5               # holders along the T-top's aft rail
HOLDER_R = 0.04             # rod-holder tube radius
HOLDER_LEN = 0.3            # rod-holder tube length
ROD_R = (0.02, 0.008)       # rod butt and tip radius
TTOP_ROD = (0.42, 0.55)     # rod rake aft and rise above its holder (m)
GUNWALE_RODS_F = (-2.9, -2.2)
GUNWALE_ROD = (0.42, 0.78)  # gunwale rod rake aft and rise above its holder (m)

OUTBOARD_MOUNT = (-3.76, 0.9)   # (f, z) pivot of the outboard node

COLOURS = {
    "hull": "#e2d9c1",         # sun-faded cream gelcoat
    "hull_bottom": "#5aa894",  # faded teal antifouling
    "canvas": "#8ab9ad",       # faded teal canvas T-top
    "frame": "#b8bdc1",        # aluminium tube
    "engine": "#3a4048",       # outboard, rub rail, rods, windscreen tint
    "seat": "#cfb48a",         # sun-bleached vinyl
}
ROUGH = {"frame": 0.5, "engine": 0.55}


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


def make_mat(name, cull=True):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb_to_linear(COLOURS[name]), 1.0)
    b.inputs["Roughness"].default_value = ROUGH.get(name, 0.85)
    b.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = cull
    return m


def P(x, f, z):
    return Vector((x, -f, z))


class MB:
    def __init__(self, mats):
        self.bm = bmesh.new()
        self.mats = list(mats)

    def _tag(self, faces, mats, closed=True):
        for fc, m in zip(faces, mats):
            fc.material_index = self.mats.index(m)
            fc.smooth = False
        if closed:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)

    def loft(self, rings, mat, caps=True, edge_mats=None):
        """rings of equal length; edge_mats[i] colours the band between point i and i+1."""
        vr = [[self.bm.verts.new(p) for p in ring] for ring in rings]
        faces, fm = [], []
        n = len(rings[0])
        for a, b in zip(vr, vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                faces.append(self.bm.faces.new((a[i], a[j], b[j], b[i])))
                fm.append(edge_mats[i] if edge_mats else mat)
        if caps:
            faces.append(self.bm.faces.new(list(reversed(vr[0]))))
            faces.append(self.bm.faces.new(vr[-1]))
            fm += [mat, mat]
        self._tag(faces, fm)
        return faces

    def box(self, f0, f1, x0, x1, z0, z1, mat):
        ring = lambda f: [P(x0, f, z0), P(x1, f, z0), P(x1, f, z1), P(x0, f, z1)]
        return self.loft([ring(f0), ring(f1)], mat)

    def xprism(self, fz, x0, x1, mat):
        return self.loft([[P(x0, f, z) for f, z in fz], [P(x1, f, z) for f, z in fz]], mat)

    def strut(self, a, b, r, mat, sides=4, r_end=None):
        """A thin tube from point a to point b ((x, f, z) tuples)."""
        A, B = P(*a), P(*b)
        d = (B - A).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        v = d.cross(u).normalized()
        rings = []
        for c, rr in ((A, r), (B, r if r_end is None else r_end)):
            rings.append([c + (u * math.cos(2 * math.pi * i / sides + math.pi / sides) +
                               v * math.sin(2 * math.pi * i / sides + math.pi / sides)) * rr for i in range(sides)])
        return self.loft(rings, mat)

    def cyl_f(self, x, f, z, r, half, segs, mat):
        rings = [[P(x + r * math.cos(2 * math.pi * i / segs), f + s, z + r * math.sin(2 * math.pi * i / segs))
                  for i in range(segs)] for s in (-half, half)]
        return self.loft(rings, mat)

    def hull(self, pts, mat):
        vs = [self.bm.verts.new(P(*p)) for p in pts]
        res = bmesh.ops.convex_hull(self.bm, input=vs)
        junk = [g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)]
        if junk:
            bmesh.ops.delete(self.bm, geom=junk, context="VERTS")
        faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
        self._tag(faces, [mat] * len(faces))
        return faces

    def build(self, name, matlib, parent, loc=(0.0, 0.0, 0.0)):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(matlib[m])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location = loc
        return ob


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- hull
def station_ring(st):
    f, gw, sh, cw, cz, kz, sz = st
    bz = max(BOOT_Z, cz + 0.05)
    bx = lerp(cw, gw, (bz - cz) / (sh - cz))
    iw = max(gw - CAP_W, 0.02)
    sw = max(gw - SOLE_INSET, 0.01)
    port = [(cw, cz), (bx, bz), (gw, sh), (iw, sh), (sw, sz)]
    ring = [P(0.0, f, kz)] + [P(x, f, z) for x, z in port]
    ring += [P(-x, f, z) for x, z in reversed(port)]
    return ring


def hull_edge_mats():
    # ring: keel, c, b, g, i, s | s', i', g', b', c'   (11 points, 11 bands)
    return ["hull_bottom", "hull_bottom", "hull", "hull", "hull", "hull",
            "hull", "hull", "hull", "hull_bottom", "hull_bottom"]


def waterline_probes():
    """Where the hull's outer skin crosses z = 0: bow on the stem, stern on the transom,
    port/starboard at the widest station."""
    # bow: stem line between consecutive keel points
    bow = None
    for a, b in zip(STATIONS, STATIONS[1:]):
        if a[5] <= 0.0 <= b[5]:
            t = (0.0 - a[5]) / (b[5] - a[5])
            bow = lerp(a[0], b[0], t)
    stern = STATIONS[0][0]
    best = (0.0, 0.0)
    for f, gw, sh, cw, cz, kz, _sz in STATIONS:
        if cz <= 0.0:
            x = lerp(cw, gw, (0.0 - cz) / (sh - cz))
        else:
            x = lerp(0.0, cw, (0.0 - kz) / (cz - kz)) if kz < 0 else 0.0
        if x > best[0]:
            best = (x, f)
    return bow, stern, best


# ---------------------------------------------------------------- fittings
def gunwale_at(f):
    """Interpolated (half-width, sheer) at f."""
    for a, b in zip(STATIONS, STATIONS[1:]):
        if a[0] <= f <= b[0]:
            t = (f - a[0]) / (b[0] - a[0])
            return lerp(a[1], b[1], t), lerp(a[2], b[2], t)
    return STATIONS[-1][1], STATIONS[-1][2]


def build_fittings(mb):
    sole = 0.36
    c0, c1 = CONSOLE_F
    w = CONSOLE_HALF_W
    # console with a raked front, windscreen on top
    mb.hull([(sx * w, f, z) for sx in (-1, 1) for f, z in ((c0, sole), (c0, CONSOLE_TOP), (c1 - 0.3, CONSOLE_TOP),
                                                              (c1, CONSOLE_TOP - 0.3), (c1, sole))], "hull")
    mb.xprism([(c1 - 0.32, CONSOLE_TOP), (c1 - 0.22, CONSOLE_TOP), (c1 - 0.5, CONSOLE_TOP + 0.42),
               (c1 - 0.58, CONSOLE_TOP + 0.42)], -w + 0.03, w - 0.03, "engine")
    # cooler seat ahead of the console, leaning post + backrest behind it
    mb.box(c1 + 0.05, c1 + 0.6, -0.42, 0.42, sole, 0.82, "seat")
    mb.box(c0 - 0.75, c0 - 0.15, -0.42, 0.42, sole, 0.86, "hull")
    mb.box(c0 - 0.78, c0 - 0.12, -0.45, 0.45, 0.86, 0.98, "seat")
    mb.xprism([(c0 - 0.8, 0.98), (c0 - 0.66, 0.98), (c0 - 0.72, 1.5), (c0 - 0.86, 1.5)], -0.42, 0.42, "seat")
    # stern bench along the transom
    mb.box(-3.62, -3.18, -0.95, 0.95, sole, 0.72, "seat")
    # T-top: four legs, canvas top with a rim of tube
    for fl, hw in TTOP_LEGS:
        for sx in (-1, 1):
            top_f = fl + (0.25 if fl < 0 else -0.2)
            mb.strut((sx * hw, fl, sole), (sx * (hw + 0.2), top_f, TTOP_Z), 0.035, "frame")
    t0, t1 = TTOP_F
    tw = TTOP_HALF_W
    mb.hull([(sx * tw, f, TTOP_Z) for sx in (-1, 1) for f in (t0, t1)] +
            [(sx * (tw - 0.14), f, TTOP_Z + 0.16) for sx in (-1, 1) for f in (t0 + 0.14, t1 - 0.14)], "canvas")
    mb.box(t0 - 0.02, t1 + 0.02, -tw - 0.02, tw + 0.02, TTOP_Z - 0.06, TTOP_Z, "frame")
    # rod holders clamped to the T-top's aft rail, each with a short stubby rod in it
    for i in range(TTOP_RODS):
        x = lerp(-tw + 0.15, tw - 0.15, i / (TTOP_RODS - 1))
        base = (x, t0 + 0.02, TTOP_Z - 0.05)                      # inside the aft rail tube
        top = (x, t0 - 0.1, TTOP_Z - 0.05 + HOLDER_LEN)
        mb.strut(base, top, HOLDER_R, "frame", sides=4)
        mb.strut(top, (x * 1.05, t0 - 0.1 - TTOP_ROD[0], top[2] + TTOP_ROD[1]), ROD_R[0], "engine",
                 sides=3, r_end=ROD_R[1])
    # flush rod holders sunk into the gunwale cap, rods raked aft, all inside the rub rail
    for fr in GUNWALE_RODS_F:
        gw, sh = gunwale_at(fr)
        for sx in (-1, 1):
            base = (sx * (gw - 0.07), fr, sh - 0.2)                 # inside the gunwale
            top = (sx * (gw - 0.04), fr - 0.1, sh + 0.1)
            mb.strut(base, top, HOLDER_R * 0.9, "frame", sides=4)
            mb.strut(top, (sx * (gw + 0.02), fr - 0.1 - GUNWALE_ROD[0], top[2] + GUNWALE_ROD[1]), ROD_R[0],
                     "engine", sides=3, r_end=ROD_R[1])
    # rub rails along the sheer
    for sx in (-1, 1):
        rings = []
        for st in STATIONS[:-1]:
            f, gw, sh = st[0], st[1], st[2]
            pts = [(gw, sh - 0.14), (gw + 0.05, sh - 0.14), (gw + 0.05, sh - 0.02), (gw, sh - 0.02)]
            rings.append([P(sx * x, f, z) for x, z in pts])
        f, gw, sh = STATIONS[-1][0], STATIONS[-1][1], STATIONS[-1][2]
        rings.append([P(sx * x, f + 0.03, z) for x, z in ((0.0, sh - 0.14), (0.04, sh - 0.14), (0.04, sh - 0.02),
                                                           (0.0, sh - 0.02))])
        mb.loft(rings, "engine")
    # bow rail on stanchions
    rail_f = (1.2, 2.5, 3.4)
    for sx in (-1, 1):
        pts = []
        for fr in rail_f:
            gw, sh = gunwale_at(fr)
            pts.append((sx * (gw - 0.08), fr, sh))
        for (x, fr, sh) in pts:
            mb.strut((x, fr, sh), (x, fr, sh + 0.38), 0.022, "frame")
        for a, b in zip(pts, pts[1:]):
            mb.strut((a[0], a[1], a[2] + 0.38), (b[0], b[1], b[2] + 0.38), 0.022, "frame")
        tip = (0.0, 3.85, STATIONS[-1][2] + 0.3)
        mb.strut((pts[-1][0], pts[-1][1], pts[-1][2] + 0.38), tip, 0.022, "frame")


def build_outboard(mb):
    """Outboard in local coordinates: origin at the transom mount (the node sits there)."""
    # cowling
    mb.hull([(sx * 0.3, f, z) for sx in (-1, 1) for f, z in ((-0.12, 0.05), (-0.12, 0.72), (-0.35, 0.82),
                                                               (-0.78, 0.7), (-0.82, 0.12))] +
            [(sx * 0.22, -0.55, 0.88) for sx in (-1, 1)], "engine")
    # midsection and lower unit
    mb.hull([(sx * 0.16, f, z) for sx in (-1, 1) for f, z in ((-0.2, 0.08), (-0.62, 0.08), (-0.26, -0.95),
                                                               (-0.5, -0.95))], "engine")
    mb.box(-0.62, -0.14, -0.22, 0.22, -0.98, -0.93, "engine")          # anti-cavitation plate
    mb.xprism([(-0.3, -1.1), (-0.52, -1.1), (-0.5, -1.4), (-0.4, -1.4)], -0.035, 0.035, "engine")  # skeg
    mb.cyl_f(0.0, -0.6, -1.15, 0.09, 0.08, 6, "engine")                # prop hub
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3
        mb.strut((0.0, -0.64, -1.15), (0.3 * math.cos(a), -0.66, -1.15 + 0.3 * math.sin(a)), 0.04, "engine",
                 sides=3, r_end=0.07)
    mb.box(-0.14, 0.0, -0.18, 0.18, -0.35, 0.15, "engine")              # transom bracket


def main():
    out = out_path()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    mats = {k: make_mat(k) for k in COLOURS}

    root = bpy.data.objects.new("boat", None)
    scene.collection.objects.link(root)

    mb = MB(["hull", "hull_bottom"])
    mb.loft([station_ring(st) for st in STATIONS], "hull", caps=True, edge_mats=hull_edge_mats())
    mb.build("hull", mats, root)

    mb = MB(["hull", "seat", "engine", "frame", "canvas"])
    build_fittings(mb)
    mb.build("console", mats, root)

    mb = MB(["engine"])
    build_outboard(mb)
    mb.build("outboard", mats, root, loc=P(0.0, *OUTBOARD_MOUNT))

    bow, stern, (px, pf) = waterline_probes()
    for name, loc in (("probe_bow", P(0.0, bow, 0.0)), ("probe_stern", P(0.0, stern, 0.0)),
                      ("probe_port", P(px, pf, 0.0)), ("probe_starboard", P(-px, pf, 0.0))):
        e = bpy.data.objects.new(name, None)
        scene.collection.objects.link(e)
        e.parent = root
        e.location = loc

    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=False,
        export_yup=True, export_apply=True, export_extras=True, export_attributes=True,
        export_vertex_color="NONE", export_texcoords=False, export_normals=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_animations=False,
    )
    print(f"PROP_OK {out}")


main()
