"""Original bicycle and four-wheel joke rides; same bike rig as the motorcycles."""

import math

import _bike_lib as B
import _lib as L
import bpy

P, DARK, M, ALT = B.PAINT, B.TYRE, B.METAL, "paint_secondary"


def basket(mb, f, z, width):
    """Open wire basket with visible gaps, a base and a top rim."""
    mb.box(f - 0.14, f + 0.14, -width, width, z, z + 0.025, M)
    for side in (-1, 1):
        for df in (-0.14, 0, 0.14):
            mb.tube([(side * width, f + df, z), (side * width, f + df, z + 0.24)], [0.012] * 2, M)
        mb.tube([(side * width, f - 0.14, z + 0.24), (side * width, f + 0.14, z + 0.24)], [0.014] * 2, M)
    for df in (-0.14, 0.14):
        mb.tube([(-width, f + df, z + 0.24), (width, f + df, z + 0.24)], [0.014] * 2, M)


def build(c):
    L.reset_scene()
    style = c["style"]
    bicycle = style in ("ebike", "moped")
    cart = style == "golf"
    mower = style == "mower"
    wb, sh, r = c["wheelbase"], c["seat_height"], c["radius"]
    rear, front = -wb / 2, wb / 2
    mats = L.make_mats({P: c["paint"], ALT: "#e8cc65", DARK: "#252b32", M: "#aebcc8"})
    root = L.empty("bike")
    root["wheelbase_m"], root["seat_height_m"], root["class"] = wb, sh, c["class"]
    head = (0, front - 0.13 if bicycle else 0.20, 0.94 if bicycle else 0.84)
    fork = L.empty("fork", root, L.P(*head))
    track = 0 if bicycle else 0.50 if cart else 0.38 if mower else 0.30
    wf = B.wheel(mats, fork, "wheel_front" if bicycle else "wheel_front_l", track, front, r, 0.065 if bicycle else 0.19)
    wf.location -= fork.location
    if not bicycle:
        L.empty("wheel_front", fork, L.P(0, front, r) - fork.location)
    wheels = (
        [("wheel_rear", 0, rear, root)]
        if bicycle
        else [
            ("wheel_front_r", -track, front, fork),
            ("wheel_rear_l", track, rear, root),
            ("wheel_rear_r", -track, rear, root),
        ]
    )
    for name, x, f, parent in wheels:
        ob = bpy.data.objects.new(name, wf.data)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location = L.P(x, f, r) - (fork.location if parent == fork else L.P(0, 0, 0))
    if not bicycle:
        L.empty("wheel_rear", root, L.P(0, rear, r))
    grip_f, grip_z = (front - 0.22, 1.08) if bicycle else (0.04, 1.03)
    grip_x = 0.32 if bicycle else 0.23
    mb = L.MB([M])
    if bicycle:
        for side in (-1, 1):
            mb.tube(
                [(side * 0.065, front, r), (side * 0.065, head[1], head[2]), (side * grip_x, grip_f, grip_z)],
                [0.018] * 3,
                M,
                sides=6,
            )
    else:
        # Steering column and hand wheel/tiller; all hand targets follow the fork pivot.
        mb.tube([(0, 0.30, 0.37), (0, grip_f, grip_z)], [0.024] * 2, M, sides=6)
        if cart or mower:
            for i in range(8):
                a, b = i * math.tau / 8, (i + 1) * math.tau / 8
                mb.tube(
                    [
                        (grip_x * math.cos(a), grip_f + 0.12 * math.sin(a), grip_z),
                        (grip_x * math.cos(b), grip_f + 0.12 * math.sin(b), grip_z),
                    ],
                    [0.014] * 2,
                    M,
                )
        else:
            mb.tube([(-grip_x, grip_f, grip_z), (grip_x, grip_f, grip_z)], [0.025] * 2, M, sides=6)
    B.part(mb, "fork_mesh", mats, fork, head)
    for side, name in ((1, "l"), (-1, "r")):
        L.empty("bar_" + name, fork, L.P(side * grip_x, grip_f, grip_z) - fork.location)
    mb = L.MB([P, ALT, DARK, M])
    seat_f = -0.28
    if bicycle:
        # Open diamond carbon frame or low moped cradle; no motorcycle tank.
        top_z = 0.88 if style == "ebike" else 0.54
        mb.tube(
            [(0, rear, r), (0, -0.20, 0.35), (0, head[1], head[2]), (0, -0.22, top_z), (0, rear, r)],
            [0.023] * 5,
            P,
            sides=6,
        )
        mb.tube([(0, -0.20, 0.35), (0, -0.22, sh - 0.06)], [0.023] * 2, P, sides=6)
        for side in (-1, 1):
            mb.tube([(side * 0.06, rear, r), (side * 0.06, -0.22, sh - 0.10)], [0.016] * 2, M)
        B.shaped(mb, [(-0.43, 0.12, sh - 0.06, sh), (-0.18, 0.095, sh - 0.06, sh)], DARK)
        mb.cyl((0, -0.20, 0.35), "x", 0.11, 0.025, 12, M)
        for side in (-1, 1):
            f = -0.20 + side * 0.12
            mb.tube([(side * 0.07, -0.20, 0.35), (side * 0.14, f, 0.35)], [0.015] * 2, M)
            mb.box(f - 0.04, f + 0.04, side * 0.17 - 0.055, side * 0.17 + 0.055, 0.33, 0.37, DARK)
        if style == "ebike":
            mb.tube([(0, -0.14, 0.43), (0, 0.28, 0.79)], [0.050] * 2, DARK, sides=4)  # battery
            mb.cyl((0, rear, r), "x", 0.075, 0.065, 12, DARK)  # tiny rear hub motor
            mb.box(-0.27, -0.05, -0.055, 0.055, 0.87, 0.94, ALT)  # controller box
        else:
            mb.box(-0.30, 0.08, -0.10, 0.10, 0.43, 0.57, ALT)  # tiny fuel tank
            mb.cyl((0, -0.02, 0.38), "x", 0.10, 0.09, 8, DARK)
            mb.tube([(-0.12, 0.03, 0.35), (-0.15, -0.58, 0.29)], [0.025, 0.042], M, sides=6)
            B.fender(mb, rear, r, 0.06, P)
        # Slender tail bracket connects the rear lens to the saddle frame.
        mb.tube([(0, -0.25, sh - 0.08), (0, rear - 0.15, sh - 0.02)], [0.012] * 2, M)
    else:
        mb.box(rear - 0.14, front + 0.14, -track, track, 0.25, 0.36, P)
        width = 0.53 if cart else 0.24
        if cart:
            for side in (-1, 1):
                x0, x1 = (0.025, width) if side > 0 else (-width, -0.025)
                mb.box(-0.51, -0.03, x0, x1, sh - 0.09, sh, DARK)
                mb.box(-0.55, -0.48, x0, x1, sh, sh + 0.35, DARK)
        else:
            mb.box(-0.51, -0.03, -width, width, sh - 0.09, sh, DARK)
            mb.box(-0.55, -0.48, -width, width, sh, sh + 0.35, DARK)
        for side in (-1, 1):
            mb.tube([(side * width * 0.75, -0.4, 0.34), (side * width * 0.75, -0.4, sh)], [0.025] * 2, M)
        if mower:
            # The cutting deck leads the front axle, the hood sits over the engine.
            B.shaped(mb, [(0.18, 0.26, 0.37, 0.70), (front + 0.16, 0.24, 0.39, 0.65)], P)
            mb.box(front - 0.25, front + 0.38, -0.57, 0.57, 0.09, 0.18, ALT)
            for x in (-0.18, -0.09, 0, 0.09, 0.18):
                mb.box(front + 0.163, front + 0.18, x - 0.016, x + 0.016, 0.45, 0.59, DARK)
            mb.tube([(-0.27, 0.35, 0.45), (-0.27, 0.36, 0.80)], [0.023] * 2, M, sides=6)
        elif cart:
            mb.box(0.20, front + 0.15, -0.52, 0.52, 0.36, 0.48, P)
            mb.box(-0.96, -0.58, -0.53, 0.53, 0.38, 0.45, ALT)  # rear cargo shelf
            for side in (-1, 1):
                mb.box(-0.53, -0.03, side * 0.035 - 0.025, side * 0.035 + 0.025, sh, sh + 0.015, M)
                mb.tube(
                    [
                        (side * 0.48, -0.56, 0.36),
                        (side * 0.48, -0.59, 1.72),
                        (side * 0.48, 0.63, 1.72),
                        (side * 0.48, 0.70, 0.46),
                    ],
                    [0.025] * 4,
                    M,
                )
            B.shaped(mb, [(-0.74, 0.60, 1.72, 1.79), (0.78, 0.60, 1.72, 1.79)], P)
            mb.box(0.61, 0.64, -0.46, 0.46, 0.56, 0.64, ALT)  # low windscreen rail
        else:
            mb.box(0.18, front + 0.12, -0.20, 0.20, 0.36, 0.57, P)
            for side in (-1, 1):
                mb.tube(
                    [(side * 0.24, -0.44, sh), (side * 0.24, -0.44, sh + 0.15), (side * 0.24, -0.05, sh + 0.15)],
                    [0.025] * 3,
                    M,
                )
            mb.tube([(-0.27, -0.50, 0.38), (-0.27, -0.55, 1.57)], [0.012] * 2, M)
            mb.xprism([(-0.55, 1.55), (-0.81, 1.42), (-0.55, 1.36)], -0.278, -0.262, ALT)
        for side in (-1, 1):
            mb.cyl((side * track * 0.7, front + 0.15, 0.49), "f", 0.042, 0.015, 8, ALT)
    for side, name in ((1, "l"), (-1, "r")):
        peg_z = 0.35 if bicycle else 0.37
        L.empty("peg_" + name, root, L.P(side * (0.18 if bicycle else 0.22), -0.10, peg_z))
    tail_z = sh if bicycle else 0.34
    mb.box(rear - 0.17, rear - 0.14, -0.055, 0.055, tail_z - 0.04, tail_z, ALT)
    mb.build("bike_body", mats, root)
    # Phone and moped basket follow steering; only metal here preserves seven derived draws.
    if bicycle or style == "mobility":
        mb = L.MB([M])
        if bicycle:
            mb.cyl((0, front - 0.07, 0.94), "f", 0.05, 0.03, 8, M)
        if style == "ebike":
            mb.tube([(0, grip_f, grip_z), (0, grip_f, grip_z + 0.07)], [0.012] * 2, M)
            mb.box(grip_f - 0.08, grip_f + 0.08, -0.04, 0.04, grip_z + 0.07, grip_z + 0.085, M)
        else:
            basket(mb, front + 0.02, 0.92 if bicycle else 0.67, 0.19)
            mb.tube([(0, head[1], head[2]), (0, front + 0.02, 0.92 if bicycle else 0.67)], [0.018] * 2, M)
        # Join into the fork mesh, retaining its pivot and material slot.
        extra = B.part(mb, "steering_extra", mats, fork, head)
        base = bpy.data.objects["fork_mesh"]
        bpy.ops.object.select_all(action="DESELECT")
        base.select_set(True)
        extra.select_set(True)
        bpy.context.view_layer.objects.active = base
        bpy.ops.object.join()
    L.empty("seat_anchor", root, L.P(0.26 if cart else 0, seat_f, sh))
    if bicycle:
        L.empty("light_head", fork, L.P(0, front - 0.04, 0.94) - fork.location)
    else:
        L.empty("light_head", root, L.P(0, front + 0.16, 0.49))
    L.empty("light_tail", root, L.P(0, rear - 0.17, tail_z))
    B.export_bike(L.out_path())
