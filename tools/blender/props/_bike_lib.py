"""Faceted motorcycle construction, in (left, forward, up) metres.

Art is original AI-scripted geometry. Wheels have baked geometry and axle pivots;
the fork has a steering-head pivot, with the front wheel and grips below it.
Paint and structural colours intentionally share slots to cap instanced draws at seven.
"""

import math

import _lib as L
import bmesh
import bpy

WHEEL_SIDES = 16
TYRE = "tyre"
METAL = "rim"
PAINT = "paint_primary"


def part(mb, name, mats, parent, pivot=(0, 0, 0)):
    """Bake world-authored vertices around a pivot, retaining unit scale."""
    p = L.P(*pivot)
    for v in mb.bm.verts:
        v.co -= p
    ob = mb.build(name, mats, parent)
    ob.location = p - parent.location if parent.name == "fork" else p
    return ob


def wheel(mats, root, name, x, f, radius, width, knobby=False):
    mb = L.MB([TYRE, METAL])
    # A hollow four-band tyre section, not a solid cylinder. Axis = local X.
    profile = [(-width / 2, radius * 0.78), (-width / 2, radius), (width / 2, radius), (width / 2, radius * 0.78)]
    vr = [
        [
            mb.v(L.P(px, rr * math.cos(i * math.tau / WHEEL_SIDES), rr * math.sin(i * math.tau / WHEEL_SIDES)))
            for i in range(WHEEL_SIDES)
        ]
        for px, rr in profile
    ]
    faces = []
    for j in range(4):
        a, b = vr[j], vr[(j + 1) % 4]
        for i in range(WHEEL_SIDES):
            k = (i + 1) % WHEEL_SIDES
            faces.append(mb.bm.faces.new((a[i], a[k], b[k], b[i])))
    mb.tag(faces, TYRE)
    mb.cyl((0, 0, 0), "x", radius * 0.22, width * 0.38, 12, METAL)
    for i in range(6):
        a = i * math.tau / 6
        mb.tube(
            [
                (0, radius * 0.15 * math.cos(a), radius * 0.15 * math.sin(a)),
                (0, radius * 0.81 * math.cos(a), radius * 0.81 * math.sin(a)),
            ],
            [0.023, 0.023],
            METAL,
            sides=4,
        )
    # Segmented tread blocks on the shoulder, with contact patch still at z=0.
    if knobby:
        for i in range(12):
            a = (i + 0.5) * math.tau / 12
            mb.cyl((0, radius * 0.89 * math.cos(a), radius * 0.89 * math.sin(a)), "x", 0.045, width * 0.62, 4, TYRE)
    ob = mb.build(name, mats, root, loc=L.P(x, f, radius))
    return ob


def shaped(mb, stations, role):
    """Chamfered tank/seat/body: (forward, half-width, bottom, top) stations."""
    rings = []
    for f, w, bottom, top in stations:
        h = top - bottom
        rings.append(
            [
                L.P(x, f, z)
                for x, z in [
                    (-w * 0.65, bottom),
                    (w * 0.65, bottom),
                    (w, bottom + h * 0.25),
                    (w, top - h * 0.25),
                    (w * 0.65, top),
                    (-w * 0.65, top),
                    (-w, top - h * 0.25),
                    (-w, bottom + h * 0.25),
                ]
            ]
        )
    mb.loft(rings, role)


def fender(mb, f, r, width, role, high=0):
    # Curved, closed ribbon above the wheel, five spans.
    rings = []
    for i in range(6):
        a = 0.28 + i * (math.pi - 0.56) / 5
        cf, z = f + (r + 0.045) * math.cos(a), r + (r + 0.045) * math.sin(a) + high
        rings.append([L.P(-width, cf, z), L.P(width, cf, z), L.P(width, cf, z + 0.025), L.P(-width, cf, z + 0.025)])
    mb.loft(rings, role)


def export_bike(out):
    """Triangulate warped ribbons/tubes so exported face normals follow winding."""
    for me in bpy.data.meshes:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        for face in bm.faces:
            face.smooth = False
        bm.to_mesh(me)
        bm.free()
        me.update()
    L.export(out, normals=False)


def build(c):
    L.reset_scene()
    colours = {PAINT: c["paint"], TYRE: "#20232c", METAL: "#b5bfcb"}
    colours.update(c.get("colours", {"paint_secondary": "#ffe144"}))
    mats = L.make_mats(colours)
    root = L.empty("bike")
    wb, sh, r = c["wheelbase"], c["seat_height"], c.get("radius", 0.32)
    root["wheelbase_m"], root["seat_height_m"], root["class"] = wb, sh, c["class"]
    rear, front = -wb / 2, wb / 2
    style = c["style"]
    chopper = style == "chopper"
    sport = style in ("sport", "stickered")
    scooter = style in ("scooter", "trike")
    touring = style in ("bagger", "cop", "flagship")
    dirt = style == "dirt"
    head = (0, front - (0.52 if chopper else 0.22), 1.16 if dirt else 0.82 if style == "fighter" else 0.88)
    fork = L.empty("fork", root, L.P(*head))
    fr = 0.29 if chopper else r
    wf = wheel(mats, fork, "wheel_front", 0, front, fr, 0.11 if chopper else 0.14, dirt)
    wf.location -= fork.location
    if style == "trike":
        wr = bpy.data.objects.new("wheel_rear_l", wf.data)
        bpy.context.scene.collection.objects.link(wr)
        wr.parent, wr.location = root, L.P(0.48, rear, r)
        other = bpy.data.objects.new("wheel_rear_r", wr.data)
        bpy.context.scene.collection.objects.link(other)
        other.parent, other.location = root, L.P(-0.48, rear, r)
        # Required compatibility node: rear axle centre, no fictitious fourth wheel.
        L.empty("wheel_rear", root, L.P(0, rear, r))
    elif chopper:
        wheel(mats, root, "wheel_rear", 0, rear, 0.34, 0.28)
    else:
        wr = bpy.data.objects.new("wheel_rear", wf.data)
        bpy.context.scene.collection.objects.link(wr)
        wr.parent, wr.location = root, L.P(0, rear, r)
    # Fork geometry is one silver slot including grips to avoid another draw.
    mb = L.MB([METAL])
    grip_f = head[1] - (0.2 if sport else 0.12)
    grip_z = 1.36 if chopper else (0.88 if sport else 1.31 if dirt else 0.99 if style == "fighter" else 1.04)
    grip_x = 0.48 if dirt else 0.43 if chopper or touring else 0.36
    for s in (-1, 1):
        mb.tube([(s * 0.1, front, fr), (s * 0.1, head[1], head[2])], [0.035, 0.026], METAL, sides=6)
        mb.tube(
            [(s * 0.1, head[1], head[2]), (s * 0.17, head[1], head[2] + 0.08), (s * grip_x, grip_f, grip_z)],
            [0.022] * 3,
            METAL,
            sides=6,
        )
        mb.tube(
            [(s * (grip_x - 0.06), grip_f, grip_z), (s * (grip_x + 0.06), grip_f, grip_z)], [0.026] * 2, METAL, sides=6
        )
    mb.tube([(-0.12, front - 0.08, fr + 0.16), (0.12, front - 0.08, fr + 0.16)], [0.025] * 2, METAL)
    if dirt:
        shaped(mb, [(front - 0.31, 0.085, 1.05, 1.08), (front + 0.32, 0.07, 1.02, 1.05)], METAL)
        mb.box(head[1] + 0.08, head[1] + 0.11, -0.14, 0.14, 1.10, 1.33, METAL)
    else:
        fender(mb, front, fr, 0.09, METAL)
    lamp_f, lamp_z = (
        (0.76 if sport else head[1] + 0.16),
        (1.20 if dirt else 0.88 if sport else 0.90 if style == "fighter" else 0.93),
    )
    if style == "fighter":
        mb.fprism([(-0.10, 0.94), (0.10, 0.94), (0.055, 0.83), (-0.055, 0.83)], lamp_f, lamp_f + 0.05, METAL)
    elif not dirt and not sport and not touring and not scooter:
        mb.cyl((0, lamp_f, lamp_z), "f", 0.085, 0.04, 12, METAL)
    if style == "stickered":
        mb.tube([(0, head[1], head[2] + 0.04), (0, grip_f, 0.91)], [0.015] * 2, METAL, sides=4)
        mb.box(grip_f - 0.06, grip_f + 0.06, -0.045, 0.045, 0.91, 0.93, METAL)
    part(mb, "fork_mesh", mats, fork, head)
    for s, side in ((1, "l"), (-1, "r")):
        L.empty("bar_" + side, fork, L.P(s * grip_x, grip_f - head[1], grip_z - head[2]))
    # Body slots vary by silhouette; wheel/fork draws leave four body slots (two for chopper).
    body_roles = c.get("body_roles", [PAINT, "paint_secondary", TYRE, METAL])
    mb = L.MB(body_roles)
    dark = TYRE if TYRE in body_roles else "paint_secondary"
    metal = METAL if METAL in body_roles else dark
    secondary = "paint_secondary" if "paint_secondary" in body_roles else PAINT
    for s in (-1, 1):
        if scooter:
            mb.tube([(s * 0.11, rear, r), (s * 0.12, -0.1, 0.25), (s * 0.12, 0.45, 0.25)], [0.027] * 3, metal, sides=4)
        else:
            mb.tube(
                [
                    (s * 0.11, rear, r),
                    (s * 0.12, -0.1, 0.4),
                    (s * 0.12, head[1], head[2]),
                    (s * 0.14, -0.35, sh - 0.08),
                    (s * 0.11, rear, r),
                ],
                [0.027] * 5,
                metal,
                sides=4,
            )
        mb.tube([(s * 0.13, rear, r), (s * 0.15, -0.4, sh - 0.06)], [0.035, 0.024], metal, sides=6)
    if not scooter:
        mb.cyl((0, -0.05, 0.43), "x", 0.17, 0.17, 8, dark)
        # Single finned cylinder on starter/dirt; V heads on cruisers.
        for f in (-0.18, 0.12) if chopper or touring else (0.06,):
            for z in (0.52, 0.56, 0.60, 0.64):
                mb.box(f - 0.085, f + 0.085, -0.15, 0.15, z, z + 0.018, metal)
        if dirt:
            tank = [(-0.12, 0.10, sh - 0.17, sh - 0.02), (0.30, 0.10, sh - 0.16, sh + 0.015)]
        elif style == "fighter":
            tank = [
                (-0.23, 0.10, sh - 0.08, sh + 0.06),
                (0.10, 0.27, sh - 0.12, sh + 0.25),
                (0.35, 0.15, sh - 0.10, sh + 0.13),
            ]
        elif style == "standard":
            tank = [(-0.15, 0.14, sh - 0.09, sh + 0.09), (0.23, 0.16, sh - 0.09, sh + 0.11)]
        else:
            tw = 0.15 if chopper else 0.22
            tank = [
                (-0.24, 0.07, sh - 0.10, sh + 0.06),
                (0.05, tw, sh - 0.10, sh + 0.19),
                (0.28, tw * 0.7, sh - 0.09, sh + 0.10),
                (0.34, 0.055, sh - 0.06, sh + 0.02),
            ]
        shaped(mb, tank, PAINT if dirt or style in ("standard", "fighter") else secondary)
    seat_f = -0.28 if not scooter else -0.35
    if dirt:
        shaped(mb, [(-0.82, 0.095, sh - 0.05, sh), (0.29, 0.10, sh - 0.05, sh)], dark)
        # Exposed long rear monoshock and high, tucked silencer.
        mb.tube([(0, -0.42, 0.43), (0, -0.10, sh - 0.10)], [0.033, 0.033], metal, sides=6)
        for i in range(7):
            f = -0.40 + i * 0.04
            z = 0.47 + i * 0.055
            mb.cyl((0, f, z), "z", 0.047, 0.013, 6, secondary)
        mb.tube(
            [(-0.17, 0.12, 0.55), (-0.20, -0.08, 0.74), (-0.20, -0.74, 0.83)], [0.025, 0.045, 0.055], metal, sides=6
        )
        for side in (-1, 1):
            mb.box(-0.63, -0.32, side * 0.12 - 0.015, side * 0.12 + 0.015, 0.73, 0.87, secondary)
    else:
        end = -0.49 if style == "fighter" else -0.68
        width = 0.14 if style == "fighter" else 0.18
        shaped(mb, [(end, width, sh - 0.08, sh), (-0.3, width, sh - 0.07, sh), (-0.04, 0.12, sh - 0.05, sh)], dark)
        fender(mb, rear, 0.34 if chopper else r, 0.19 if chopper else 0.11, PAINT)
        for x in (-0.19, 0.19) if style == "fighter" else (-0.24,):
            pts = (
                [(x, 0.12, 0.52), (x, -0.22, 0.54), (x, -0.51, sh - 0.06)]
                if style == "fighter"
                else [(x, 0.12, 0.52), (x, 0.29, 0.31), (x, -0.34, 0.29), (x, -0.76, 0.37)]
            )
            mb.tube(pts, [0.025, 0.025, 0.058] if style == "fighter" else [0.025, 0.025, 0.055, 0.047], metal, sides=6)
    if style == "standard":
        for side in (-1, 1):
            mb.box(-0.40, -0.14, side * 0.16 - 0.015, side * 0.16 + 0.015, 0.52, 0.67, secondary)
            mb.tube([(side * 0.16, -0.42, 0.71), (side * 0.16, -0.89, 0.79)], [0.018] * 2, metal)
        for f in (-0.88, -0.77, -0.66, -0.55):
            mb.tube([(-0.16, f, 0.79), (0.16, f, 0.79)], [0.015] * 2, metal)
    if sport:
        for s in (-1, 1):
            # Lean belly pan and swept angular upper fairing, not a box.
            mb.xprism(
                [(-0.32, 0.31), (0.46, 0.29), (0.66, 0.67), (0.44, 1.03), (0.08, 0.94), (-0.24, 0.55)],
                s * 0.24 - 0.025,
                s * 0.24 + 0.025,
                PAINT,
            )
        shaped(
            mb,
            [(rear - 0.03, 0.12, sh + 0.10, sh + 0.23), (-0.46, 0.18, sh, sh + 0.09), (-0.22, 0.13, sh - 0.06, sh)],
            PAINT,
        )
        shaped(mb, [(0.42, 0.23, 0.82, 1.04), (0.73, 0.16, 0.78, 0.95)], PAINT)
    if style == "fighter":
        shaped(mb, [(-0.61, 0.09, sh, sh + 0.1), (-0.36, 0.16, sh - 0.07, sh)], PAINT)
    if style == "stickered":
        for s in (-1, 1):
            for f, z, role in ((0.26, 0.64, "decal_a"), (0.06, 0.75, "decal_b"), (0.41, 0.78, "decal_a")):
                mb.side_quad(s * 0.267, f - 0.07, f + 0.08, z - 0.035, z + 0.04, role, s)
    if chopper:
        for s in (-1, 1):
            mb.tube([(s * 0.15, -0.67, sh), (s * 0.15, -0.82, 1.15), (0, -0.84, 1.25)], [0.018] * 3, PAINT, sides=4)
    if scooter:
        shaped(mb, [(rear - 0.1, 0.24, 0.29, 0.68), (-0.32, 0.22, 0.32, 0.65)], PAINT)
        mb.box(-0.4, 0.39, -0.25, 0.25, 0.22, 0.28, PAINT)
        shaped(mb, [(0.35, 0.25, 0.27, 0.82), (0.51, 0.28, 0.34, 1.00), (0.61, 0.19, 0.49, 0.96)], PAINT)
        mb.box(-0.95, -0.6, -0.23, 0.23, 0.83, 1.12, PAINT)
        for s in (-1, 1):
            mb.box(-0.72, -0.68, s * 0.17 - 0.015, s * 0.17 + 0.015, 0.63, 0.83, metal)
        mb.box(-0.96, -0.59, -0.24, 0.24, 0.81, 0.83, metal)
    if touring:
        for s in (-1, 1):
            shaped_bag = [(rear - 0.17, 0.14, 0.3, 0.69), (rear + 0.42, 0.14, 0.29, 0.73)]
            # Offset the chamfered hard bag's own vertices, separate from frame.
            before = set(mb.bm.verts)
            shaped(mb, shaped_bag, PAINT)
            for v in set(mb.bm.verts) - before:
                v.co.x += s * 0.37
            mb.tube(
                [(s * 0.16, 0.12, 0.29), (s * 0.41, 0.22, 0.3), (s * 0.42, 0.27, 0.65), (s * 0.17, 0.31, 0.68)],
                [0.025] * 4,
                metal,
                sides=4,
            )
        mb.fprism(
            [
                (-0.52, 0.91),
                (-0.47, 1.12),
                (-0.21, 1.18),
                (0, 1.10),
                (0.21, 1.18),
                (0.47, 1.12),
                (0.52, 0.91),
                (0, 0.80),
            ],
            0.49,
            0.58,
            PAINT,
        )
    if style in ("scooter", "cop", "trike", "flagship"):
        glass = "glass" if "glass" in body_roles else dark
        top, wide = (1.62, 0.34) if style in ("trike", "flagship") else (1.33, 0.19)
        mb.fprism([(-wide, 1.0), (-wide * 0.85, top), (wide * 0.85, top), (wide, 1.0)], 0.52, 0.535, glass)
    if style == "flagship":
        for side in (-1, 1):
            mb.tube([(side * 0.40, -0.66, 0.70), (side * 0.40, -0.70, 1.47)], [0.012] * 2, metal)
            mb.box(-0.91, -0.70, side * 0.40 - 0.008, side * 0.40 + 0.008, 1.29, 1.46, secondary)
    if style == "cop":
        mb.box(0.37, 0.46, -0.31, 0.31, 1.15, 1.18, dark)
        mb.box(0.37, 0.46, -0.31, -0.08, 1.18, 1.24, "light_blue")
        mb.box(0.37, 0.46, 0.08, 0.31, 1.18, 1.24, "light_red")
    if style == "trike":
        mb.box(-0.91, -0.37, -0.64, 0.64, 0.37, 0.58, PAINT)
        for s in (-1, 1):
            mb.tube(
                [(s * 0.36, -0.72, 0.51), (s * 0.36, -0.65, 1.65), (s * 0.36, 0.51, 1.65), (s * 0.36, 0.58, 0.82)],
                [0.035] * 4,
                PAINT,
                sides=4,
            )
        shaped(mb, [(-0.71, 0.4, 1.64, 1.71), (0.56, 0.4, 1.64, 1.71)], PAINT)
        mb.box(-0.19, 0.04, 0.22, 0.37, 0.73, 0.85, dark)
        mb.box(-0.13, 0.0, 0.23, 0.35, 0.852, 0.86, METAL)  # printer paper
    # A real round headlamp shell; targets remain empties for runtime light effects.
    if sport or touring or scooter:
        mb.cyl((0, lamp_f, lamp_z), "f", 0.085, 0.04, 12, metal)
    mb.box(rear - 0.16, rear - 0.11, -0.065, 0.065, sh - 0.02, sh + 0.035, secondary)
    mb.tube([(0, rear - 0.09, 2 * r + 0.045), (0, rear - 0.135, sh - 0.01)], [0.015] * 2, metal, sides=3)
    for s, side in ((1, "l"), (-1, "r")):
        peg_f, peg_z = (-0.21 if sport else 0.06), (0.40 if sport else 0.31)
        mb.tube([(s * 0.14, peg_f, peg_z), (s * 0.32, peg_f, peg_z)], [0.025] * 2, metal, sides=4)
        L.empty("peg_" + side, root, L.P(s * 0.30, peg_f, peg_z))
    mb.build("bike_body", mats, root)
    L.empty("seat_anchor", root, L.P(0, seat_f, sh))
    lamp_parent = root if sport or touring or scooter else fork
    lamp_pos = L.P(0, lamp_f + 0.04, lamp_z)
    L.empty("light_head", lamp_parent, lamp_pos - fork.location if lamp_parent == fork else lamp_pos)
    L.empty("light_tail", root, L.P(0, rear - 0.16, sh))
    export_bike(L.out_path())
