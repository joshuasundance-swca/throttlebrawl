"""San Francisco traffic, with white primary paint and baked CX1 vehicle nodes."""

from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _vehicle_lib import COLOURS, arch_body, cabin, lamps, polygon, wheels


def streetcar_body(mb, width, length, axles):
    # Fourteen plan facets round the ends while keeping a long, low side belt.
    outline = [(-width/2, -length/2+1.5), (-1.24, -length/2+0.7),
               (-1.08, -length/2+0.18), (-0.94, -length/2),
               (0.94, -length/2), (1.08, -length/2+0.18),
               (1.24, -length/2+0.7), (width/2, -length/2+1.5),
               (width/2, length/2-1.5), (1.08, length/2-0.18),
               (0.94, length/2), (-0.94, length/2),
               (-1.08, length/2-0.18), (-width/2, length/2-1.5)]
    rings = [[P(x*scale, f, h) for x, f in outline]
             for h, scale in ((0.72, 1), (1.2, 1), (1.6, 1),
                              (2.5, 0.97), (2.65, 0.97), (2.85, 0.88))]
    faces = mb.loft(rings, "paint_primary")
    n = len(outline)
    mb.tag(faces[n:2*n], "paint_secondary", closed=False)
    mb.tag(faces[2*n:3*n], "glass", closed=False)
    for side in (-1, 1):
        for f in (-4.4, -2.8, -1.2, 0.4, 2, 3.6):
            polygon(mb, [(side*width/2, f, 1.6), (side*width/2, f+0.08, 1.6),
                         (side*width/2*0.97, f+0.08, 2.5),
                         (side*width/2*0.97, f, 2.5)], "paint_primary", (side, 0, 0))
    for bogie in axles:
        mb.box(bogie-1, bogie+1, -0.95, 0.95, 0.24, 0.6, "tyre")
        for f in (bogie-0.53, bogie+0.53):
            for side in (-1, 1):
                mb.cyl((side*1.03, f, 0.32), "x", 0.32, 0.09, 8, "trim")
    mb.box(-1.8, 1.6, -0.5, 0.5, 2.85, 3.03, "paint_primary")


def build(style, length, width, height, wheelbase):
    reset_scene()
    colours = dict(COLOURS, paint_secondary="#64796c")
    mats = make_mats(colours)
    mb = MB(mats)
    root = empty("vehicle")
    car = style == "robotaxi"
    hood_top = 1.02 if car else 1.2
    hood_back = 0.85 if car else length / 2 - 0.16
    hood_front = length / 2 - 0.09
    for key, value in {"length_m": length, "width_m": width, "height_m": height,
                       "wheelbase_m": wheelbase, "hood_top_m": hood_top,
                       "hood_front_m": hood_front, "hood_back_m": hood_back,
                       "class": "car" if car else "bus"}.items():
        root[key] = value
    axles = [-wheelbase / 2, wheelbase / 2]
    radius = 0.32 if car else 0.43
    if style == "streetcar":
        streetcar_body(mb, width, length, axles)
    else:
        arch_body(mb, length, width, hood_top, radius, axles)
    if car:
        cabin(mb, width, hood_top, 1.6, -1.55, -1.20, 0.40, hood_back)
        # The parked roadside robotaxi's sensor crown becomes roof-mounted moving traffic.
        mb.box(-0.75, 0.45, -0.55, 0.55, 1.6, 1.69, "trim")
        mb.cyl((0, -0.1, 1.79), "z", 0.25, 0.11, 8, "trim")
        for side in (-1, 1):
            mb.box(1.15, 1.4, side * 0.65 - 0.10, side * 0.65 + 0.10, 1.03, 1.22, "trim")
    else:
        roof = 2.85 if style == "streetcar" else 2.95 if style == "trolleybus" else height
        inset = 0.45 if style == "streetcar" else 0.12
        if style != "streetcar":
            cabin(mb, width, hood_top, roof, -length / 2, -length / 2 + inset,
                  length / 2 - inset, hood_back)
        for side in (() if style == "streetcar" else (-1, 1)):
            x = side * (width / 2 + 0.001)
            if style != "shuttle":
                mb.side_quad(x, -length / 2 + 0.4, length / 2 - 0.4,
                             0.78, 1.16, "paint_secondary", side)
            # Narrow upright divisions read as a transit cabin, without text or operator marks.
            for i in range(6):
                f = -length / 2 + 1 + i * (length - 2) / 6
                mb.side_quad(side * (width / 2 - 0.08), f, f + 0.07,
                             1.4, roof - 0.22, "trim", side)
            # Dark two-leaf doors on either side keep this invented vehicle direction-neutral.
            for df in (-length / 2 + 1.0, length / 2 - 1.8):
                mb.side_quad(x, df, df + 0.8, 0.3, 1.15, "glass", side)
        if style in ("streetcar", "trolleybus"):
            poles = [0] if style == "streetcar" else [-0.38, 0.38]
            for x in poles:
                mb.box(-0.2, 0.2, x - 0.12, x + 0.12, roof, roof + 0.10, "trim")
                # Four-sided poles, fixed to the roof and contained within the declared size.
                mb.xprism([(-3.0, height - 0.05), (-3.0, height),
                           (0, roof + 0.10), (0, roof + 0.05)], x - 0.025, x + 0.025, "trim")
                polygon(mb, [(x - 0.08, -3.08, height), (x + 0.08, -3.08, height),
                             (x + 0.08, -2.92, height), (x - 0.08, -2.92, height)], "trim", (0, 0, 1))
    if style != "streetcar":
        wheels(mb, width, radius, axles)
    lamps(mb, root, length, width, hood_top)
    empty("hood", root, P(0, (hood_back + hood_front) / 2, hood_top))
    if not car:
        root["hood_note"] = "Front bumper top; no projecting hood."
    mb.build("vehicle_body", mats, root)
    export(out_path(), normals=False)
