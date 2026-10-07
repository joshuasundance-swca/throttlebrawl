"""throttlebrawl prop: car-carrier tow truck that is a jumpable ramp from behind.

Run: blender --background --factory-startup --python-exit-code 1 --python tow_truck.py -- --out <path>.glb

Ported from the 2026-09-30 blind prop trial (the maintainer's pick, "B"), with the trial's
known issues fixed: the headlights now use a pale `light_head` lens instead of the dark glass,
and the rear loading ramp is one full-width deck with no slot between two planks.

Layout (Blender, Z up, front = -Y). All distances below are written as f = metres
forward of the ramp foot (Blender y = -f), x = metres toward the driver's side (+X),
z = metres up. The ramp foot sits at the origin; the truck runs forward from there.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _winding import prepare_winding

# ---------------------------------------------------------------- tuning
RAMP_RUN = 11.5            # horizontal run of ramp_surface (m)
RAMP_LIP = 2.8             # lip height (m)
RAMP_HALF_W = 1.25         # ramp half width (m) -> 2.5 m wide
RAMP_T = 0.14              # deck plate thickness (m)
LOAD_LEN = 4.2             # length of the extended loading ramp (f 0..LOAD_LEN)

UPPER_DECK_END = 16.8      # forward end of the flat upper deck (f)
LOWER_DECK = (7.2, 16.6, 1.02, 1.12)   # f0, f1, z0, z1 of the lower deck plate
SIDE_RAIL_X = (1.27, 1.39) # side rails sit just outside the ramp footprint
POSTS_F = (4.5, 8.2, 11.3, 14.0, 16.6)

WHEEL_R = 0.5
WHEEL_HALF_W = 0.16
WHEEL_SEGS = 12
WHEEL_X = 1.07
WHEELS_F = (5.3, 6.5, 14.6, 15.8, 19.95)   # trailer tandem, drive tandem, steer

CAB_F = (17.0, 18.9)       # cab box
CAB_Z = (1.05, 2.95)
CAB_HALF_W = 1.2
HOOD_F = (18.9, 20.85)
BUMPER_F = (20.8, 21.05)
STACK_R = 0.09
STACK_TOP = 3.7

CAR_LEN = 4.5
CAR_HALF_W = 0.9
CAR_WHEEL_R = 0.31
# The upper deck carries no car (the maintainer's rules, 2026-10-06: "what is drawn is what is met"): a car
# there was passed through at the lip speeds and a solid one crashes every carrier jump, so the deck is
# empty, in the model and in the sim (src/sim/riders/features.ts; the coordinator's [default], vetoable).
CAR2_F = 10.4              # rear end of car_2 (sedan, lower deck, under the upper deck)

COLOURS = {                # sRGB hex, per role
    "body": "#9fb9c8",      # sun-faded pale blue cab
    "body_alt": "#9a5638",  # rust primer panel + marker lights
    "frame": "#3b4046",     # hauler frame, chassis, bumper
    "deck": "#c9c1ab",      # weathered galvanised deck and hubs
    "tyre": "#1f2022",
    "glass": "#2f3d47",     # opaque dark tint
    "light_head": "#f4e6b2",  # pale warm headlight lenses
    "car_green": "#acd3c4", # sun-bleached seafoam sedan
}
ROUGH = {"glass": 0.35, "deck": 0.8}


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
    b.inputs["Roughness"].default_value = ROUGH.get(name, 0.9)
    b.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = cull
    return m


def P(x, f, z):
    """(x, forward, up) -> Blender vector."""
    return Vector((x, -f, z))


class MB:
    """Tiny mesh builder: closed parts get outward normals via recalc per part."""

    def __init__(self, mats):
        self.bm = bmesh.new()
        self.mats = list(mats)

    def _tag(self, faces, mat, closed=True):
        for fc in faces:
            fc.material_index = self.mats.index(mat)
            fc.smooth = False
        if closed:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)

    def loft(self, rings, mat, caps=True):
        """rings: list of equal-length point loops (Vectors). Side quads + end caps."""
        vr = [[self.bm.verts.new(p) for p in ring] for ring in rings]
        faces = []
        n = len(rings[0])
        for a, b in zip(vr, vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                faces.append(self.bm.faces.new((a[i], a[j], b[j], b[i])))
        if caps:
            faces.append(self.bm.faces.new(list(reversed(vr[0]))))
            faces.append(self.bm.faces.new(vr[-1]))
        self._tag(faces, mat)
        return faces

    def box(self, f0, f1, x0, x1, z0, z1, mat):
        ring = lambda f: [P(x0, f, z0), P(x1, f, z0), P(x1, f, z1), P(x0, f, z1)]
        return self.loft([ring(f0), ring(f1)], mat)

    def xprism(self, fz, x0, x1, mat):
        """Profile in the (f, z) plane, extruded across x0..x1."""
        return self.loft([[P(x0, f, z) for f, z in fz], [P(x1, f, z) for f, z in fz]], mat)

    def cyl(self, centre, axis, r, half, segs, mat, phase=0.0):
        cx, cf, cz = centre
        rings = []
        for s in (-half, half):
            ring = []
            for i in range(segs):
                a = phase + 2 * math.pi * i / segs
                u, v = r * math.cos(a), r * math.sin(a)
                if axis == "x":
                    ring.append(P(cx + s, cf + u, cz + v))
                elif axis == "f":
                    ring.append(P(cx + u, cf + s, cz + v))
                else:
                    ring.append(P(cx + u, cf + v, cz + s))
            rings.append(ring)
        return self.loft(rings, mat)

    def hull(self, pts, mat):
        vs = [self.bm.verts.new(P(*p)) for p in pts]
        res = bmesh.ops.convex_hull(self.bm, input=vs)
        junk = [g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)]
        if junk:
            bmesh.ops.delete(self.bm, geom=junk, context="VERTS")
        faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
        self._tag(faces, mat)
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


def surf(f):
    return f * RAMP_LIP / RAMP_RUN


# ---------------------------------------------------------------- parts
def build_ramp(mb):
    t_foot = RAMP_T * RAMP_RUN / RAMP_LIP   # where the plank underside meets the road
    s_ll = surf(LOAD_LEN)
    # one full-width loading plate (the trial's two planks left a slot a tyre could drop into)
    plank = [(0.0, 0.0), (LOAD_LEN, s_ll), (LOAD_LEN, s_ll - RAMP_T), (t_foot, 0.0)]
    mb.xprism(plank, -RAMP_HALF_W, RAMP_HALF_W, "deck")
    deck = [(LOAD_LEN, s_ll), (RAMP_RUN, RAMP_LIP), (RAMP_RUN, RAMP_LIP - RAMP_T), (LOAD_LEN, s_ll - RAMP_T)]
    mb.xprism(deck, -RAMP_HALF_W, RAMP_HALF_W, "deck")


def build_trailer(mb):
    x0, x1 = SIDE_RAIL_X
    # flat upper deck forward of the lip
    mb.box(RAMP_RUN, UPPER_DECK_END, -RAMP_HALF_W, RAMP_HALF_W, RAMP_LIP - RAMP_T, RAMP_LIP, "deck")
    for sx in (-1, 1):
        a, b = sorted((sx * x0, sx * x1))
        # side rail: follows the ramp, then the flat deck (outside the ramp footprint)
        rail = [(LOAD_LEN, surf(LOAD_LEN) + 0.08), (RAMP_RUN, RAMP_LIP + 0.08), (UPPER_DECK_END, RAMP_LIP + 0.08),
                (UPPER_DECK_END, RAMP_LIP - 0.34), (RAMP_RUN, RAMP_LIP - 0.34), (LOAD_LEN, surf(LOAD_LEN) - 0.34)]
        mb.xprism(rail, a, b, "frame")
        # vertical posts
        for fp in POSTS_F:
            top = min(surf(fp), RAMP_LIP) - 0.3
            mb.box(fp - 0.09, fp + 0.09, a, b, 0.62, top, "frame")
        # diagonal braces (the hydraulic-ram look of the concept)
        for fa, fb in ((4.6, 8.1), (8.3, 11.2), (11.4, 13.9)):
            za, zb = 0.8, min(surf(fb), RAMP_LIP) - 0.35
            mb.xprism([(fa, za), (fa + 0.22, za), (fb, zb), (fb - 0.22, zb)], a, b, "frame")
        # lower main rails
        mb.box(4.2, 16.7, sx * 0.4 - 0.1, sx * 0.4 + 0.1, 0.6, 0.92, "frame")
        # side sill joining the post feet
        mb.box(4.3, 16.7, a, b, 0.62, 0.8, "frame")
        # landing-gear leg + foot
        mb.box(13.1, 13.3, sx * 0.75 - 0.08, sx * 0.75 + 0.08, 0.22, 0.62, "frame")
        mb.box(12.95, 13.45, sx * 0.75 - 0.15, sx * 0.75 + 0.15, 0.1, 0.22, "frame")
        # rear tail/marker lights and side markers (rust-orange panel colour)
        mb.box(4.12, 4.2, sx * 1.0 - 0.14, sx * 1.0 + 0.14, 0.62, 0.8, "body_alt")
        for fm in (6.0, 10.0, 13.7):
            mb.box(fm - 0.1, fm + 0.1, (b + 0.005) if sx > 0 else (a - 0.03), (b + 0.03) if sx > 0 else (a - 0.005),
                   0.66, 0.76, "body_alt")
    # rear bumper / light bar, axles, lower deck plate
    mb.box(4.1, 4.4, -1.2, 1.2, 0.5, 0.82, "frame")
    for fw in WHEELS_F[:2]:
        mb.box(fw - 0.08, fw + 0.08, -0.95, 0.95, WHEEL_R - 0.08, WHEEL_R + 0.08, "frame")
    f0, f1, z0, z1 = LOWER_DECK
    mb.box(f0, f1, -1.2, 1.2, z0, z1, "frame")
    # cross members under the lower deck
    for fc in (7.6, 9.4, 11.2, 13.0):
        mb.box(fc - 0.07, fc + 0.07, -1.25, 1.25, 0.8, z0, "frame")


def build_cab(mb):
    c0, c1 = CAB_F
    z0, z1 = CAB_Z
    w = CAB_HALF_W
    # chassis rails + fifth wheel
    for sx in (-1, 1):
        mb.box(13.9, 20.85, sx * 0.45 - 0.1, sx * 0.45 + 0.1, 0.55, 0.95, "frame")
    mb.box(14.8, 15.7, -0.7, 0.7, 0.92, 1.0, "frame")
    for fw in WHEELS_F[2:]:
        mb.box(fw - 0.08, fw + 0.08, -0.95, 0.95, WHEEL_R - 0.08, WHEEL_R + 0.08, "frame")
    # cab box with a slightly narrower roof cap
    mb.box(c0, c1, -w, w, z0, z1, "body")
    mb.hull([(sx * w, f, z1) for sx in (-1, 1) for f in (c0, c1)] +
            [(sx * (w - 0.1), f, z1 + 0.2) for sx in (-1, 1) for f in (c0 + 0.08, c1 - 0.2)], "body")
    # hood: tapers toward the grille
    h0, h1 = HOOD_F
    mb.hull([(sx * 0.98, h0, z) for sx in (-1, 1) for z in (0.95, 2.05)] +
            [(sx * 0.9, h1, z) for sx in (-1, 1) for z in (0.95, 1.8)] +
            [(sx * 0.86, h1 - 0.25, 1.95) for sx in (-1, 1)], "body")
    # steer fenders
    for sx in (-1, 1):
        a, b = sorted((sx * 0.9, sx * 1.25))
        mb.xprism([(19.2, 1.05), (19.45, 1.3), (20.5, 1.3), (20.75, 1.05), (20.75, 0.98), (19.2, 0.98)], a, b,
                  "body" if sx < 0 else "body_alt")
    # grille, bumper, headlights (pale lenses, so they read as lights)
    mb.box(h1, h1 + 0.06, -0.62, 0.62, 1.02, 1.72, "frame")
    mb.box(*BUMPER_F, -1.25, 1.25, 0.45, 0.82, "frame")
    for sx in (-1, 1):
        mb.box(h1 - 0.05, h1 + 0.04, sx * 0.78 - 0.13, sx * 0.78 + 0.13, 1.28, 1.5, "light_head")
    # windscreen (two panes) and side windows
    for sx in (-1, 1):
        a, b = sorted((sx * 0.06, sx * 1.02))
        mb.box(c1, c1 + 0.03, a, b, 2.1, 2.8, "glass")
        a, b = sorted((sx * w, sx * (w + 0.02)))
        mb.box(17.95, 18.72, a, b, 2.1, 2.8, "glass")
    # rust primer driver's door (+X) and a primer patch on the hood's right side
    mb.box(17.25, 18.72, w, w + 0.02, 1.2, 1.95, "body_alt")
    mb.box(19.3, 20.4, -0.99, -0.955, 1.15, 1.85, "body_alt")
    # exhaust stacks behind the cab, mirrors, tanks, roof marker lights
    for sx in (-1, 1):
        mb.cyl((sx * 1.05, c0 - 0.1, (1.2 + STACK_TOP) / 2), "z", STACK_R, (STACK_TOP - 1.2) / 2, 6, "frame")
        a, b = sorted((sx * (w + 0.05), sx * (w + 0.2)))
        mb.box(18.72, 18.84, a, b, 1.95, 2.55, "frame")
        mb.cyl((sx * 0.9, 17.55, 0.72), "f", 0.3, 0.55, 8, "frame", phase=math.pi / 8)
        mb.box(18.55, 18.75, sx * 0.4 - 0.1, sx * 0.4 + 0.1, z1 + 0.18, z1 + 0.26, "body_alt")
    mb.box(18.55, 18.75, -0.1, 0.1, z1 + 0.18, z1 + 0.26, "body_alt")
    # sun visor over the windscreen, mud flaps behind the drive tandem
    mb.xprism([(c1, z1 - 0.05), (c1 + 0.3, z1 - 0.12), (c1 + 0.3, z1 - 0.07), (c1, z1 + 0.02)], -1.1, 1.1, "body")
    for sx in (-1, 1):
        a, b = sorted((sx * 0.9, sx * 1.24))
        mb.box(13.93, 13.99, a, b, 0.28, 0.95, "frame")


def car_parts(mb, f_rear, z_floor, paint, convertible):
    """A simple car facing forward (toward +f): wheels, lower body, cabin."""
    L, hw = CAR_LEN, CAR_HALF_W
    f = lambda d: f_rear + d
    zb0, zb1 = z_floor + 0.22, z_floor + (0.78 if not convertible else 0.74)
    # lower body: raked nose and tail
    mb.hull([(sx * hw, f(0.0), zb0 + 0.08) for sx in (-1, 1)] +
            [(sx * hw, f(0.15), zb1 - 0.05) for sx in (-1, 1)] +
            [(sx * hw, f(0.3), zb0) for sx in (-1, 1)] +
            [(sx * hw, f(L - 0.25), zb0) for sx in (-1, 1)] +
            [(sx * hw, f(L), zb0 + 0.1) for sx in (-1, 1)] +
            [(sx * hw, f(L - 0.05), zb1 - 0.18) for sx in (-1, 1)] +
            [(sx * hw, f(L - 1.2), zb1) for sx in (-1, 1)] +
            [(sx * hw, f(0.9), zb1) for sx in (-1, 1)], paint)
    for d in (0.85, L - 0.95):
        for sx in (-1, 1):
            mb.cyl((sx * (hw - 0.08), f(d), z_floor + CAR_WHEEL_R), "x", CAR_WHEEL_R, 0.11, 8, "tyre",
                   phase=math.pi / 8)
    if convertible:
        # raked windscreen, dark cockpit tub, two seat backs
        mb.xprism([(f(2.55), zb1), (f(2.7), zb1), (f(2.35), zb1 + 0.38), (f(2.25), zb1 + 0.38)], -hw + 0.08,
                  hw - 0.08, "glass")
        mb.box(f(1.2), f(2.5), -hw + 0.14, hw - 0.14, zb1 - 0.02, zb1 + 0.03, "tyre")
        for sx in (-1, 1):
            a, b = sorted((sx * 0.12, sx * 0.62))
            mb.xprism([(f(1.55), zb1), (f(1.8), zb1), (f(1.6), zb1 + 0.42), (f(1.45), zb1 + 0.42)], a, b, "tyre")
    else:
        # glasshouse with a painted roof slab on top; it uses the dark tyre colour, so the sedan
        # costs two draws (paint, tyre) and the headlights' lens slot stays inside the budget
        zr = z_floor + 1.36
        mb.hull([(sx * (hw - 0.06), f(d), zb1) for sx in (-1, 1) for d in (1.05, 3.35)] +
                [(sx * (hw - 0.2), f(d), zr) for sx in (-1, 1) for d in (1.5, 2.95)], "tyre")
        mb.box(f(1.45), f(3.0), -hw + 0.18, hw - 0.18, zr, zr + 0.06, paint)


def main():
    out = out_path()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    mats = {k: make_mat(k) for k in COLOURS}

    root = bpy.data.objects.new("tow_truck", None)
    scene.collection.objects.link(root)

    mb = MB(["deck"])
    build_ramp(mb)
    ramp = mb.build("ramp_surface", mats, root)
    angle = math.degrees(math.atan2(RAMP_LIP, RAMP_RUN))
    ramp["ramp_angle_deg"] = round(angle, 3)
    ramp["ramp_run_m"] = RAMP_RUN
    ramp["ramp_lip_height_m"] = RAMP_LIP

    mb = MB(["frame", "deck", "body_alt"])
    build_trailer(mb)
    mb.build("trailer", mats, root)

    mb = MB(["body", "body_alt", "frame", "glass", "light_head"])
    build_cab(mb)
    mb.build("cab", mats, root)

    f0, f1, z0, z1 = LOWER_DECK
    mb = MB(["car_green", "tyre"])
    car_parts(mb, CAR2_F, z1, "car_green", convertible=False)
    mb.build("car_2", mats, root)

    # shared wheel mesh: axle along X, origin at the centre, one vertex at the bottom
    mb = MB(["tyre", "deck"])
    mb.cyl((0.0, 0.0, 0.0), "x", WHEEL_R, WHEEL_HALF_W, WHEEL_SEGS, "tyre", phase=-math.pi / 2)
    mb.cyl((0.0, 0.0, 0.0), "x", WHEEL_R * 0.55, WHEEL_HALF_W + 0.015, 6, "deck")
    me = bpy.data.meshes.new("wheel")
    mb.bm.to_mesh(me)
    mb.bm.free()
    for m in mb.mats:
        me.materials.append(mats[m])
    n = 0
    for fw in WHEELS_F:
        for sx in (1, -1):
            n += 1
            ob = bpy.data.objects.new(f"wheel_{n}", me)
            scene.collection.objects.link(ob)
            ob.parent = root
            ob.location = P(sx * WHEEL_X, fw, WHEEL_R)

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
