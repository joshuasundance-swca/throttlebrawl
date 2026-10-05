"""Pacific Northwest traffic: invented silhouettes, no lettering or textures."""

from _lib import MB, P, empty, export, make_mats, out_path, reset_scene
from _vehicle_lib import COLOURS, arch_body, cabin, lamps, polygon, wheels


def boat(mb, x, centre, length, bottom, top, role, canoe=False):
    """Pointed, faceted hull with a recessed cockpit; roof cargo stays in the car envelope."""
    half = 0.28 if not canoe else 0.40
    outline = [(0, -length/2), (half, -length*0.30), (half, length*0.28),
               (0, length/2), (-half, length*0.28), (-half, -length*0.30)]
    rings = [[P(x+dx*scale, centre+f*length_scale, height) for dx, f in outline]
             for scale, length_scale, height in ((0.60, 0.82, bottom), (1, 1, top))]
    mb.loft(rings, role)
    opening_w, opening_l = (0.28, 1.85) if canoe else (0.18, 0.65)
    polygon(mb, [(x-opening_w, centre-opening_l, top+0.002),
                 (x+opening_w, centre-opening_l, top+0.002),
                 (x+opening_w, centre+opening_l, top+0.002),
                 (x-opening_w, centre+opening_l, top+0.002)], "glass", (0, 0, 1))


def streetcar(mb):
    # Two separately faceted low-floor sections and a visibly narrower bellows joint.
    for rear, front in ((-10, -0.38), (0.38, 10)):
        outline = [(-1.25, rear+0.65), (-0.95, rear), (0.95, rear),
                   (1.25, rear+0.65), (1.25, front-0.65), (0.95, front),
                   (-0.95, front), (-1.25, front-0.65)]
        faces = mb.loft([[P(x*scale, f, h) for x, f in outline]
                         for h, scale in ((0.48, 1), (1.25, 1), (2.9, 0.97),
                                          (3.35, 0.92))], "paint_primary")
        mb.tag(faces[8:16], "glass", closed=False)
        mb.tag(faces[:8], "paint_secondary", closed=False)
        for side in (-1, 1):
            for f in (rear+1.25, rear+3.35, rear+5.45, rear+7.55):
                polygon(mb, [(side*1.247, f, 1.25), (side*1.247, f+0.075, 1.25),
                             (side*1.21, f+0.075, 2.9), (side*1.21, f, 2.9)],
                        "paint_primary", (side, 0, 0))
            for f in (rear+1.2, front-2.2):
                mb.side_quad(side*1.251, f, f+0.9, 0.5, 1.2, "glass", side)
    mb.box(-0.38, 0.38, -1.12, 1.12, 0.65, 3.23, "trim")
    for f in (-0.25, 0, 0.25):
        for side in (-1, 1):
            mb.side_quad(side*1.122, f, f+0.06, 0.75, 3.17, "tyre", side)
    # Low bogies are recessed beneath each section.
    wheels(mb, 2.4, 0.34, [-6.7, 6.7])
    mb.box(-2.2, 1.5, -0.6, 0.6, 3.35, 3.55, "trim")
    # A flattened diamond pantograph, folded against its base, with a contact strip.
    for x in (-0.38, 0.38):
        mb.tube([(x, -1.7, 3.55), (x, -0.6, 3.82), (x, 0.5, 3.6)],
                [0.035]*3, "trim", sides=4)
    mb.box(-0.68, -0.52, -0.7, 0.7, 3.82, 3.9, "trim")


def wagon(mb):
    arch_body(mb, 4.8, 1.8, 0.93, 0.32, [-1.55, 1.55])
    cabin(mb, 1.8, 0.93, 1.56, -2.25, -2.02, 0.58, 1.0)
    wheels(mb, 1.8, 0.32, [-1.55, 1.55])
    for f in (-1.35, 0.35):
        mb.box(f-0.035, f+0.035, -0.82, 0.82, 1.56, 1.71, "trim")
    boat(mb, -0.36, -0.25, 4.1, 1.73, 2.1, "paint_secondary")
    boat(mb, 0.36, -0.25, 4.1, 1.73, 2.1, "paint_secondary")


def camper(mb):
    arch_body(mb, 6.6, 2.2, 1.05, 0.38, [-2.05, 2.05])
    cabin(mb, 2.2, 1.05, 2.20, -3.15, -3, 1.8, 2.45)
    wheels(mb, 2.2, 0.38, [-2.05, 2.05])
    # Rear-hinged wedge: visible fabric rises 0.40 m at the front, under a tilted hard lid.
    outline = [(-0.84,-2.4), (0.84,-2.4), (0.84,1.2), (-0.84,1.2)]
    mb.loft([[P(x,f,h) for x,f in outline] for h in (2.20,2.25)], "trim")
    mb.loft([[P(x,f,2.25) for x,f in outline],
             [P(x,f,2.29 if f < 0 else 2.65) for x,f in outline]], "canvas")
    mb.loft([[P(x,f,2.29 if f < 0 else 2.65) for x,f in outline],
             [P(x,f,2.34 if f < 0 else 2.70) for x,f in outline]], "paint_secondary")
    for f in (-1.8, 0.65):
        lid_h = 2.34+(f+2.4)/3.6*0.36
        mb.box(f-0.04, f+0.04, -0.93, 0.93, lid_h, 2.72, "trim")
    boat(mb, 0, -0.25, 5.3, 2.72, 3.0, "paint_secondary", canoe=True)
    for side in (-1, 1):
        mb.side_quad(side*1.101, -2.3, 1.5, 0.86, 1.0, "paint_secondary", side)


def logger(mb):
    # Short bunk truck and a separate pole trailer; no continuous box underneath the logs.
    mb.box(3.0, 8, -1.3, 1.3, 0.55, 1.05, "paint_primary")
    # Upright day cab and long square bonnet, rather than a passenger-car greenhouse.
    mb.box(3.2, 5.6, -1.15, 1.15, 1.05, 3.3, "paint_primary")
    mb.box(5.6, 8, -0.95, 0.95, 1.05, 2.0, "paint_primary")
    mb.front_quad(5.615, -1.02, 1.02, 2.16, 3.07, "glass")
    for side in (-1, 1):
        mb.side_quad(side*1.165, 3.55, 5.35, 2.12, 3.07, "glass", side)
        mb.box(5.9, 7.3, side*1.13-0.17, side*1.13+0.17, 1.0, 1.25, "paint_primary")
    mb.front_quad(8.005, -0.83, 0.83, 1.08, 1.87, "tyre")
    for h in (1.20, 1.45, 1.70):
        mb.box(8.01, 8.03, -0.83, 0.83, h, h+0.05, "trim")
    # Tall exhaust and an open steel headache rack protect the cab from the load.
    mb.cyl((1.23,3.55,2.40), "h", 0.065, 1.25, 6, "trim")
    for x in (-1.12, 1.12):
        mb.box(2.7, 2.9, x-0.10, x+0.10, 1.12, 3.6, "trim")
    mb.box(2.7, 2.9, -1.22, 1.22, 3.4, 3.6, "trim")
    mb.box(-7.8, 3, -0.30, 0.30, 0.66, 1.12, "trim")
    for f in (-6.5, 0.8):
        mb.box(f-0.18, f+0.18, -1.3, 1.3, 1.0, 1.32, "trim")
        for side in (-1, 1):
            mb.box(f-0.07, f+0.07, side*1.15-0.07, side*1.15+0.07,
                   1.25, 3.8, "trim")
    # Six longitudinal hexagonal logs in three tiers; bark and clean sawn ends.
    for x, h, radius in ((-0.8, 1.9, 0.46), (0, 1.9, 0.46),
                         (0.8, 1.9, 0.46), (-0.4, 2.65, 0.46),
                         (0.4, 2.65, 0.46), (0, 3.44, 0.46)):
        faces = mb.cyl((x, -2.45, h), "f", radius, 5.55, 6, "bark", phase=1.5707963267948966)
        mb.tag(faces[-2:], "wood", closed=False)
    wheels(mb, 2.6, 0.5, [-6.7, -5.55, 2.1, 3.25, 6.6])


def build(style, length, width, height, wheelbase, vehicle_class, hood_top, hood_back):
    reset_scene()
    colours = dict(COLOURS, paint_secondary="#5d8175")
    if style == "logger":
        colours.update(bark="#65564b", wood="#c6ae80")
    if style == "camper":
        colours.update(canvas="#c2b99b")
    mats = make_mats(colours)
    mb = MB(mats)
    root = empty("vehicle")
    hood_front = length/2 - 0.09
    for key, value in {"length_m": length, "width_m": width, "height_m": height,
                       "wheelbase_m": wheelbase, "hood_top_m": hood_top,
                       "hood_back_m": hood_back, "hood_front_m": hood_front,
                       "class": vehicle_class}.items():
        root[key] = value
    {"streetcar": streetcar, "wagon": wagon, "camper": camper, "logger": logger}[style](mb)
    lamps(mb, root, length, width, hood_top)
    empty("hood", root, P(0, (hood_front+hood_back)/2, hood_top))
    if style == "streetcar":
        root["hood_note"] = "Front bumper top; no projecting hood."
    mb.build("vehicle_body", mats, root)
    export(out_path(), normals=False)
