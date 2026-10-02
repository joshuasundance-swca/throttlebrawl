"""Shared helpers for the scenery prop scripts (runs inside Blender's own Python).

The three trial props (tow_truck, boat, palms) stay standalone, as the trial built them. The
scenery scripts import this module, so every one of them gets the same material rules, mesh
builder and export call. Conventions (tools/blender/README.md):

- Blender is Z up; the prop's front faces Blender -Y, which the export turns into glTF +Z.
- Helpers take points as (x, f, z): x toward the prop's left (+X), f metres forward (Blender
  y = -f), z metres up.
- Flat colours only: a Principled BSDF with a base colour, metallic 0, no textures.
- Faceted normals (no smooth shading), and nothing depends on time or unseeded randomness.
"""

import math
import sys

import bmesh
import bpy
from mathutils import Vector


def out_path():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--out" not in argv:
        raise RuntimeError("missing --out <path>.glb")
    return argv[argv.index("--out") + 1]


def srgb_to_linear(hexcol):
    h = hexcol.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def make_mats(colours, rough=None, double_sided=()):
    """One flat material per role. `double_sided` roles turn back-face culling off."""
    rough = rough or {}
    mats = {}
    for name, hexcol in colours.items():
        m = bpy.data.materials.new(name)
        if m.node_tree is None:
            m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*srgb_to_linear(hexcol), 1.0)
        b.inputs["Roughness"].default_value = rough.get(name, 0.9)
        b.inputs["Metallic"].default_value = 0.0
        m.use_backface_culling = name not in double_sided
        mats[name] = m
    return mats


def P(x, f, z):
    """(x, forward, up) -> Blender vector."""
    return Vector((x, -f, z))


def empty(name, parent=None, loc=(0.0, 0.0, 0.0)):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    return ob


class MB:
    """A small bmesh builder. Closed parts get outward normals; `sway` adds a _SWAY weight."""

    def __init__(self, mats, sway=False):
        self.bm = bmesh.new()
        self.mats = list(mats)
        self.sway = self.bm.verts.layers.float.new("_SWAY") if sway else None
        self.cur_sway = 0.0

    def v(self, co, sway=None):
        vert = self.bm.verts.new(co)
        if self.sway is not None:
            vert[self.sway] = max(0.0, min(1.0, self.cur_sway if sway is None else sway))
        return vert

    def tag(self, faces, mat, closed=True):
        for fc in faces:
            fc.material_index = self.mats.index(mat)
            fc.smooth = False
        if closed:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return faces

    def loft(self, rings, mat, caps=True, sways=None):
        """Rings of equal length (Vectors). Side quads plus end caps. `sways` per ring."""
        vr = [[self.v(p, None if sways is None else sways[k]) for p in ring] for k, ring in enumerate(rings)]
        faces = []
        n = len(rings[0])
        for a, b in zip(vr, vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                faces.append(self.bm.faces.new((a[i], a[j], b[j], b[i])))
        if caps:
            faces.append(self.bm.faces.new(list(reversed(vr[0]))))
            faces.append(self.bm.faces.new(vr[-1]))
        return self.tag(faces, mat)

    def box(self, f0, f1, x0, x1, z0, z1, mat):
        def ring(f):
            return [P(x0, f, z0), P(x1, f, z0), P(x1, f, z1), P(x0, f, z1)]
        return self.loft([ring(f0), ring(f1)], mat)

    def xprism(self, fz, x0, x1, mat):
        """A profile in the (f, z) plane, extruded across x0..x1."""
        return self.loft([[P(x0, f, z) for f, z in fz], [P(x1, f, z) for f, z in fz]], mat)

    def fprism(self, xz, f0, f1, mat):
        """A profile in the (x, z) plane, extruded along f0..f1."""
        return self.loft([[P(x, f0, z) for x, z in xz], [P(x, f1, z) for x, z in xz]], mat)

    def tube(self, pts, radii, mat, sides=4, sways=None, phase=None):
        """A tube through points ((x, f, z) tuples) with a radius per point."""
        cs = [P(*p) for p in pts]
        rings = []
        for k, c in enumerate(cs):
            d = (cs[min(k + 1, len(cs) - 1)] - cs[max(k - 1, 0)]).normalized()
            up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            u = d.cross(up).normalized()
            w = d.cross(u).normalized()
            ph = math.pi / sides if phase is None else phase
            rings.append([c + (u * math.cos(2 * math.pi * i / sides + ph) +
                               w * math.sin(2 * math.pi * i / sides + ph)) * radii[k] for i in range(sides)])
        return self.loft(rings, mat, sways=sways)

    def cyl(self, centre, axis, r, half, segs, mat, phase=0.0, r_top=None):
        """A cylinder along x, f or z about centre (x, f, z)."""
        cx, cf, cz = centre
        rings = []
        for s, rr in ((-half, r), (half, r if r_top is None else r_top)):
            ring = []
            for i in range(segs):
                a = phase + 2 * math.pi * i / segs
                u, w = rr * math.cos(a), rr * math.sin(a)
                if axis == "x":
                    ring.append(P(cx + s, cf + u, cz + w))
                elif axis == "f":
                    ring.append(P(cx + u, cf + s, cz + w))
                else:
                    ring.append(P(cx + u, cf + w, cz + s))
            rings.append(ring)
        return self.loft(rings, mat)

    def hull(self, pts, mat):
        """The convex hull of (x, f, z) points."""
        vs = [self.v(P(*p)) for p in pts]
        res = bmesh.ops.convex_hull(self.bm, input=vs)
        junk = [g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)]
        if junk:
            bmesh.ops.delete(self.bm, geom=junk, context="VERTS")
        faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
        return self.tag(faces, mat)

    def blob(self, centre, radii, mat, jitter=0.0, rng=None, sway_of=None):
        """A faceted icosahedron (20 triangles) scaled to radii (x, f, z), optionally jittered."""
        t = (1.0 + math.sqrt(5.0)) / 2.0
        base = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
                (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        tris = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
                (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5),
                (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        n = math.sqrt(1 + t * t)
        cx, cf, cz = centre
        verts = []
        for bx, by, bz in base:
            k = 1.0 + (rng.uniform(-jitter, jitter) if rng else 0.0)
            x, f, z = cx + bx / n * radii[0] * k, cf + by / n * radii[1] * k, cz + bz / n * radii[2] * k
            verts.append(self.v(P(x, f, z), None if sway_of is None else sway_of(z)))
        faces = [self.bm.faces.new((verts[a], verts[b], verts[c])) for a, b, c in tris]
        return self.tag(faces, mat)

    def front_quad(self, f, x0, x1, z0, z1, mat):
        """A single flat panel at f facing the prop's front (glTF +Z): a window, a door."""
        vs = [self.v(P(x0, f, z0)), self.v(P(x1, f, z0)), self.v(P(x1, f, z1)), self.v(P(x0, f, z1))]
        return self.tag([self.bm.faces.new(vs)], mat, closed=False)

    def side_quad(self, x, f0, f1, z0, z1, mat, facing):
        """A single flat panel at x facing +X (`facing` = 1) or -X (-1): a window on a side wall."""
        fs = (f1, f0) if facing > 0 else (f0, f1)
        vs = [self.v(P(x, fs[0], z0)), self.v(P(x, fs[1], z0)), self.v(P(x, fs[1], z1)), self.v(P(x, fs[0], z1))]
        return self.tag([self.bm.faces.new(vs)], mat, closed=False)

    def cone(self, centre, r, z1, sides, mat, phase=0.0, droop=0.0):
        """A faceted cone: its rim (radius r) at centre's z minus `droop`, its apex at z1, a flat base."""
        cx, cf, cz = centre
        rim = [self.v(P(cx + r * math.cos(phase + 2 * math.pi * i / sides),
                        cf + r * math.sin(phase + 2 * math.pi * i / sides), cz - droop)) for i in range(sides)]
        apex = self.v(P(cx, cf, z1))
        faces = [self.bm.faces.new((rim[i], rim[(i + 1) % sides], apex)) for i in range(sides)]
        faces.append(self.bm.faces.new(list(reversed(rim))))
        return self.tag(faces, mat)

    def build(self, name, mats, parent=None, loc=(0.0, 0.0, 0.0)):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        if self.sway is not None and me.attributes.get("_SWAY") is None:
            raise RuntimeError(f"{name}: _SWAY attribute missing after to_mesh")
        for m in self.mats:
            me.materials.append(mats[m])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location = loc
        return ob


def text_panel(name, mats, mat, parent, width, height, centre, thickness=0.0):
    """A flat rectangle facing the prop's front (-Y in Blender, glTF +Z), with a 0..1 UV map.

    This is a text surface: the game draws the sign's words onto it, so it is its own node
    and it carries extras the game reads (`text_surface`, `width_m`, `height_m`). UV (0, 0)
    is the bottom-left corner as seen from the front. `thickness` > 0 adds a back slab in the
    same material behind it (no UVs needed there: only the front face is drawn on).
    """
    cx, cf, cz = centre
    hw, hh = width / 2, height / 2
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    # A viewer in front of the prop looks back along +Y (Blender), so the prop's left (+X) is on
    # the viewer's right. u therefore runs from -X (screen left) to +X (screen right).
    corners = [(cx - hw, cz - hh, (0.0, 0.0)), (cx + hw, cz - hh, (1.0, 0.0)),
               (cx + hw, cz + hh, (1.0, 1.0)), (cx - hw, cz + hh, (0.0, 1.0))]
    vs = [bm.verts.new(P(x, cf, z)) for x, z, _ in corners]
    face = bm.faces.new(vs)
    face.smooth = False
    for loop, (_, _, t) in zip(face.loops, corners):
        loop[uv].uv = t
    face.normal_update()
    if face.normal.y > 0:  # it must face -Y (the prop's front)
        face.normal_flip()
    if thickness > 0:
        back = [bm.verts.new(P(x, cf - thickness, z)) for x, z, _ in corners]
        sides = [bm.faces.new(list(reversed(back)))]
        for i in range(4):
            j = (i + 1) % 4
            sides.append(bm.faces.new((vs[j], vs[i], back[i], back[j])))
        for s in sides:
            s.smooth = False
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mats[mat])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob["text_surface"] = True
    ob["width_m"] = round(width, 4)
    ob["height_m"] = round(height, 4)
    return ob


# A 3 by 5 block font, rows top to bottom, for the words a kit writes on its signs (run W-P). Drawn
# here, cell by cell: no font file, so nothing to license.
BLOCK_FONT = {
    "A": ("010", "101", "111", "101", "101"),
    "B": ("110", "101", "110", "101", "110"),
    "C": ("111", "100", "100", "100", "111"),
    "E": ("111", "100", "110", "100", "111"),
    "G": ("111", "100", "101", "101", "111"),
    "I": ("111", "010", "010", "010", "111"),
    "K": ("101", "101", "110", "101", "101"),
    "M": ("101", "111", "101", "101", "101"),
    "P": ("110", "101", "110", "100", "100"),
    "R": ("110", "101", "110", "101", "101"),
    "T": ("111", "010", "010", "010", "010"),
    "U": ("101", "101", "101", "101", "111"),
}


def block_word(mb, text, f, xc, zc, cell, mat):
    """Block letters facing the front, centred at (xc, zc): one flat panel per run of filled cells."""
    width = len(text) * 4 - 1
    # Seen from the front, the prop's left (+X) is on the viewer's right: write from -X up.
    x0 = xc - width * cell / 2
    top = zc + 2.5 * cell
    for i, ch in enumerate(text):
        if ch == " ":
            continue
        for r, row in enumerate(BLOCK_FONT[ch]):
            c = 0
            while c < 3:
                if row[c] != "1":
                    c += 1
                    continue
                run = c
                while run < 3 and row[run] == "1":
                    run += 1
                xa = x0 + (i * 4 + c) * cell
                xb = x0 + (i * 4 + run) * cell
                z1 = top - r * cell
                mb.front_quad(f, xa, xb, z1 - cell, z1, mat)
                c = run


def export(out, texcoords=False, normals=True):
    """The trial's export call; `texcoords` is on only for props with text surfaces.

    `normals=False` leaves the normals out: every prop is faceted, so the game rebuilds each face's
    normal from its corners (models.ts), and a kit of many small props ships in about half the bytes.
    """
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=False,
        export_yup=True, export_apply=True, export_extras=True, export_attributes=True,
        export_vertex_color="NONE", export_texcoords=texcoords, export_normals=normals,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_animations=False,
    )
    print(f"PROP_OK {out}")
