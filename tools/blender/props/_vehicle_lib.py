"""Deterministic traffic silhouettes, with open wheel arches and inset window frames."""

import math

import bmesh
import bpy
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene

COLOURS = {
    "paint_primary": "#ffffff", "glass": "#253743", "tyre": "#15191d",
    "trim": "#444b51", "light_head": "#aaa88e", "light_tail": "#652c31",
}


def polygon(mb, points, material, normal=None):
    face = mb.bm.faces.new([mb.v(P(*p)) for p in points])
    face.normal_update()
    if normal is not None and face.normal.dot(P(*normal)) < 0:
        face.normal_flip()
    return mb.tag([face], material, closed=False)


def arch_body(mb, length, width, top, radius, axles):
    """The underside follows two real polygonal arches, rather than painting circles on a box."""
    lo, hi = -length / 2, length / 2
    profile = [(lo, 0.22)]
    for axle in sorted(axles):
        r = radius + 0.075
        profile.append((axle - r, 0.22))
        for theta in (math.pi, 3 * math.pi / 4, math.pi / 2, math.pi / 4, 0):
            profile.append((axle + r * math.cos(theta), radius + r * math.sin(theta)))
        profile.append((axle + r, 0.22))
    profile += [(hi, 0.22), (hi, top - 0.09), (hi - 0.09, top),
                (lo + 0.09, top), (lo, top - 0.09)]
    mb.xprism(profile, -width / 2, width / 2, "paint_primary")


def wheels(mb, width, radius, axles, dual=False):
    for axle in axles:
        for side in (-1, 1):
            x = side * (width / 2 - 0.10)
            mb.cyl((x, axle, radius), "x", radius, 0.09, 8, "tyre")
            outer = side * (width / 2 - 0.009)
            pts = [(outer, axle + radius * 0.53 * math.cos(i * math.pi / 4),
                    radius + radius * 0.53 * math.sin(i * math.pi / 4)) for i in range(8)]
            polygon(mb, pts, "trim", (side, 0, 0))


def cabin(mb, width, bottom, height, rear, roof_rear, roof_front, front, doors=2):
    """A closed cabin: narrower roof, inset side glass and bevelled window surrounds."""
    half, roof = width / 2 - 0.025, width / 2 - 0.14
    side_low = bottom + 0.10
    top = height - 0.06
    # Solid sill and pillars surround inset side panes. Roof bevels give the broad flat roof a facet.
    rings = [[P(-half, rear, bottom), P(half, rear, bottom), P(roof, roof_rear, top),
              P(-roof, roof_rear, top)],
             [P(-half, front, bottom), P(half, front, bottom), P(roof, roof_front, top),
              P(-roof, roof_front, top)]]
    # Roof and underside; all side and end openings get explicitly wound recessed frames below.
    vr = [[mb.v(p) for p in ring] for ring in rings]
    closed = []
    for i in (0, 2):
        j = (i + 1) % 4
        closed.append(mb.bm.faces.new((vr[0][i], vr[0][j], vr[1][j], vr[1][i])))
    mb.tag(closed, "paint_primary", closed=False)
    # Side outer polygon and a slightly recessed inner polygon are joined with four painted facets.
    # The pane's corners stay inside the sloped pillars, or a shallow windscreen (the sedan's)
    # folds the frame facets over each other at the lower corners.
    def pillar(f_low, f_top, z):
        return f_low + (f_top - f_low) * (z - bottom) / (top - bottom)

    rear_low = max(rear + 0.14, pillar(rear, roof_rear, side_low) + 0.06)
    front_low = min(front - 0.16, pillar(front, roof_front, side_low) - 0.06)
    for side in (-1, 1):
        outer = [(side * half, rear, bottom), (side * half, front, bottom),
                 (side * roof, roof_front, top), (side * roof, roof_rear, top)]
        inner = [(side * (half - 0.018), rear_low, side_low),
                 (side * (half - 0.018), front_low, side_low),
                 (side * (roof - 0.018), roof_front - 0.09, top - 0.09),
                 (side * (roof - 0.018), roof_rear + 0.09, top - 0.09)]
        for i in range(4):
            j = (i + 1) % 4
            polygon(mb, [outer[i], outer[j], inner[j], inner[i]], "paint_primary", (side, 0, 0))
        polygon(mb, inner, "glass", (side, 0, 0))
        # The B pillar is a narrow dark inset strip; no decal or floating wheel geometry.
        middle_low = (inner[0][1] + inner[1][1]) / 2
        middle_high = (inner[2][1] + inner[3][1]) / 2
        polygon(mb, [(inner[0][0] + side * 0.002, middle_low - 0.035, side_low),
                     (inner[0][0] + side * 0.002, middle_low + 0.035, side_low),
                     (inner[2][0] + side * 0.002, middle_high + 0.035, top - 0.09),
                     (inner[2][0] + side * 0.002, middle_high - 0.035, top - 0.09)],
                "trim", (side, 0, 0))
    # Sloped front and rear glass are genuinely recessed, leaving a painted bevel around each opening.
    for back, f0, ft in ((False, front, roof_front), (True, rear, roof_rear)):
        direction = -1 if back else 1
        outer = [(-half, f0, bottom), (half, f0, bottom),
                 (roof, ft, top), (-roof, ft, top)]
        rise = top - bottom
        def inset_f(z, f0=f0, ft=ft, rise=rise, direction=direction):
            return f0 + (ft - f0) * (z - bottom) / rise - direction * 0.018
        inner = [(-half + 0.11, inset_f(bottom + 0.10), bottom + 0.10),
                 (half - 0.11, inset_f(bottom + 0.10), bottom + 0.10),
                 (roof - 0.10, inset_f(top - 0.08), top - 0.08),
                 (-roof + 0.10, inset_f(top - 0.08), top - 0.08)]
        for i in range(4):
            j = (i + 1) % 4
            polygon(mb, [outer[i], outer[j], inner[j], inner[i]], "paint_primary", (0, direction, 0.2))
        polygon(mb, inner, "glass", (0, direction, 0.2))
    # Roof crown completes the declared height without smoothing.
    mb.box(roof_rear + 0.04, roof_front - 0.04, -roof + 0.02, roof - 0.02,
           top, height, "paint_primary")


def lamps(mb, root, length, width, hood_top):
    for end, role in ((1, "light_head"), (-1, "light_tail")):
        z = min(hood_top - 0.15, 0.82)
        body_end = end * length / 2
        # A shallow lens projects off the body face so neither lamp nor bumper can depth-fight it.
        f = body_end + end * 0.003
        for side, suffix in ((1, "l"), (-1, "r")):
            x = side * width * 0.33
            polygon(mb, [(x - 0.14, f, z - 0.065), (x + 0.14, f, z - 0.065),
                         (x + 0.14, f, z + 0.065), (x - 0.14, f, z + 0.065)],
                    role, (0, end, 0))
            empty(f"{role}_{suffix}", root, P(x, f, z))
        bumper_edges = sorted((body_end - end * 0.012, body_end + end * 0.008))
        mb.box(*bumper_edges,
               -width * 0.39, width * 0.39, 0.29, 0.37, "trim")


def side_panel(mats, root, x, front, back, bottom, top):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    # Viewed from +X, front (+Z) is left. UVs are Blender-bottom-left before glTF's V flip.
    pts = [(x, front, bottom), (x, back, bottom), (x, back, top), (x, front, top)]
    face = bm.faces.new([bm.verts.new(P(*p)) for p in pts])
    face.normal_update()
    if face.normal.x < 0:
        face.normal_flip()
    for loop in face.loops:
        loop[uv].uv = (0 if abs(-loop.vert.co.y - front) < 1e-6 else 1,
                       0 if abs(loop.vert.co.z - bottom) < 1e-6 else 1)
    mesh = bpy.data.meshes.new("side_panel")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mats["paint_primary"])
    ob = bpy.data.objects.new("side_panel", mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root
    ob["text_surface"] = True
    ob["width_m"] = front - back
    ob["height_m"] = top - bottom
    ob["facing_axis"] = "x"


def build_vehicle(name, length, width, height, wheelbase, hood_top, hood_back, style):
    reset_scene()
    colours = dict(COLOURS)
    if style == "bus":
        colours["paint_secondary"] = "#344a55"
    mats = make_mats(colours)
    mb = MB(mats)
    root = empty("vehicle")
    hood_front = length / 2 - 0.09
    vehicle_class = "bus" if style == "bus" else "truck" if style in ("box", "semi", "pickup") else "car"
    for key, value in {"length_m": length, "width_m": width, "height_m": height,
                       "wheelbase_m": wheelbase, "hood_top_m": hood_top,
                       "hood_front_m": hood_front, "hood_back_m": hood_back,
                       "class": vehicle_class}.items():
        root[key] = value
    axles = [-wheelbase / 2, wheelbase / 2]
    if style == "semi":
        axles += [2.8, -wheelbase / 2 + 1.05]
    radius = 0.44 if style in ("box", "bus", "semi") else 0.32 if style in ("sedan", "hatch") else 0.37
    arch_body(mb, length, width, hood_top, radius, axles)
    if style == "sedan":
        cabin(mb, width, hood_top, height, -1.6, -0.95, 0.28, hood_back)
    elif style == "hatch":
        cabin(mb, width, hood_top, height, -1.9, -1.55, 0.38, hood_back)
    elif style == "pickup":
        cabin(mb, width, hood_top, height, -0.65, -0.50, 0.66, hood_back)
        # Recessed bed floor, three walls and distinct tailgate; no roof over the bed.
        mb.box(-length / 2 + 0.12, -0.72, -width / 2 + 0.14, width / 2 - 0.14,
               hood_top + 0.01, hood_top + 0.035, "trim")
        for side in (-1, 1):
            x = side * width / 2
            mb.box(-length / 2 + 0.06, -0.68, min(x, x - side * 0.13), max(x, x - side * 0.13),
                   hood_top, hood_top + 0.25, "paint_primary")
        mb.box(-length / 2, -length / 2 + 0.12, -width / 2, width / 2,
               hood_top, hood_top + 0.25, "paint_primary")
    elif style in ("suv", "van"):
        cabin(mb, width, hood_top, height - (0.055 if style == "suv" else 0),
              -length / 2 + 0.10, -length / 2 + 0.30, 0.64 if style == "suv" else 1.1, hood_back)
        if style == "suv":
            for side in (-1, 1):
                x = side * width * 0.32
                mb.box(-1.85, 0.65, x - 0.035, x + 0.035, height - 0.08, height, "trim")
        else:
            for side in (-1, 1):
                mb.side_quad(side * (width / 2 + 0.001), -1.35, -1.32, 0.50, hood_top - 0.02,
                             "trim", side)
    elif style == "box":
        cabin(mb, width, hood_top, 2.3, 1.13, 1.22, 2.8, hood_back)
        mb.box(-length / 2, 1.08, -width / 2, width / 2, hood_top, height, "paint_primary")
        side_panel(mats, root, width / 2 + 0.001, 0.65, -3.25, 1.55, 2.95)
    elif style == "bus":
        cabin(mb, width, hood_top, height, -length / 2, -length / 2 + 0.10,
              length / 2 - 0.10, hood_back)
        for side in (-1, 1):
            mb.side_quad(side * (width / 2 + 0.001), -length / 2 + 0.1, length / 2 - 0.1,
                         0.94, 1.10, "paint_secondary", side)
            # Big windows are divided by solid dark pillars, preserving the city-bus rhythm.
            for f in (-4.3, -2.7, -1.1, 0.5, 2.1, 3.7):
                mb.side_quad(side * (width / 2 - 0.08), f, f + 0.055, 1.35, height - 0.22, "trim", side)
        side_panel(mats, root, width / 2 + 0.002, 3.6, -4.5, 1.12, 1.48)
    elif style == "semi":
        cabin(mb, width, hood_top, 3.05, 3.5, 3.6, 6.3, hood_back)
        mb.box(-length / 2, 3.3, -width / 2, width / 2, 1.25, height, "paint_primary")
        mb.box(3.35, 4.7, -width * 0.34, width * 0.34, 1.05, 2.6, "trim")
        # A roof fairing rising to just under the trailer's top: the tractor's own silhouette,
        # so the cab no longer reads as a car towing a box.
        fairing = width / 2 - 0.16
        mb.xprism([(3.6, 3.05), (5.5, 3.05), (3.6, height - 0.12)], -fairing, fairing,
                  "paint_primary")
        # Twin rear tractor wheels and a second trailer axle remain in the same body mesh.
    wheels(mb, width, radius, axles)
    lamps(mb, root, length, width, hood_top)
    empty("hood", root, P(0, (hood_front + hood_back) / 2, hood_top))
    if style in ("box", "bus"):
        root["hood_note"] = "Front bumper top; this cab has no projecting hood."
    mb.build("vehicle_body", mats, root)
    export(out_path(), texcoords=style in ("box", "bus"), normals=False)
