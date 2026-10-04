"""Detached parked car-hauler trailer: a continuous, lowered shortcut ramp.

The ramp foot is the origin, front is Blender -Y (glTF +Z), and the deck runs
11.5 m to a 2.8 m lip. No cab or carried cars obstruct the riding surface.
"""

import math
import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib

RAMP_RUN = 11.5
RAMP_LIP = 2.8
RAMP_HALF_WIDTH = 1.3
DECK_THICKNESS = 0.14
WHEEL_RADIUS = 0.45
WHEEL_HALF_WIDTH = 0.13
WHEEL_X = 1.15
AXLES_F = (5.6, 6.7)
LEG_F = 10.3

COLOURS = {
    "deck": "#b9c3cb",
    "frame": "#39444e",
    "tyre": "#202326",
    "rim": "#7b858d",
    "light_tail": "#9a3438",
}


def surface_height(f):
    return f * RAMP_LIP / RAMP_RUN


def build_ramp(mb):
    # A single closed wedge: its underside meets the road after the sharp foot,
    # with no zero-area end cap or slot. Every top triangle shares one plane.
    underside_foot = DECK_THICKNESS * RAMP_RUN / RAMP_LIP
    mb.xprism(
        [(0.0, 0.0), (RAMP_RUN, RAMP_LIP),
         (RAMP_RUN, RAMP_LIP - DECK_THICKNESS), (underside_foot, 0.0)],
        -RAMP_HALF_WIDTH, RAMP_HALF_WIDTH, "deck",
    )


def build_frame(mb):
    for sx in (-1, 1):
        # The two tapered side girders stay below the deck, leaving clear air
        # above its full width. Their front edge ends exactly under the lip.
        xa, xb = sorted((sx * 1.15, sx * 1.3))
        mb.xprism(
            [(2.2, surface_height(2.2) - DECK_THICKNESS),
             (RAMP_RUN, RAMP_LIP - DECK_THICKNESS),
             (RAMP_RUN, RAMP_LIP - 0.36), (2.2, 0.18)],
            xa, xb, "frame",
        )
        # Chassis rail and a deployed landing leg replace the tractor's cab.
        x = sx * 0.62
        mb.box(3.3, 10.7, x - 0.08, x + 0.08, 0.62, 0.78, "frame")
        mb.box(LEG_F - 0.09, LEG_F + 0.09, x - 0.08, x + 0.08,
               0.12, surface_height(LEG_F) - DECK_THICKNESS, "frame")
        mb.box(LEG_F - 0.23, LEG_F + 0.23, x - 0.2, x + 0.2, 0.0, 0.12, "frame")
        # Rear lamps belong to the chassis, well below the loading surface.
        mb.box(3.25, 3.31, sx * 0.98 - 0.12, sx * 0.98 + 0.12, 0.45, 0.59, "light_tail")
    for f in AXLES_F:
        mb.box(f - 0.075, f + 0.075, -WHEEL_X, WHEEL_X,
               WHEEL_RADIUS - 0.075, WHEEL_RADIUS + 0.075, "frame")
    for f in (4.1, 8.1, 10.7):
        top = surface_height(f) - DECK_THICKNESS
        mb.box(f - 0.075, f + 0.075, -1.15, 1.15, top - 0.15, top, "frame")


def main():
    out = _lib.out_path()
    scene = _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    root = _lib.empty("ramp_trailer")
    mb = _lib.MB(["deck"])
    build_ramp(mb)
    ramp = mb.build("ramp_surface", mats, root)
    ramp["ramp_angle_deg"] = 13.7
    ramp["ramp_run_m"] = RAMP_RUN
    ramp["ramp_lip_height_m"] = RAMP_LIP
    mb = _lib.MB(["frame", "light_tail"])
    build_frame(mb)
    mb.build("trailer", mats, root)

    # All four wheel nodes share one faceted mesh, with the rim baked in.
    mb = _lib.MB(["tyre", "rim"])
    mb.cyl((0.0, 0.0, 0.0), "x", WHEEL_RADIUS, WHEEL_HALF_WIDTH,
           8, "tyre", phase=-math.pi / 2)
    mb.cyl((0.0, 0.0, 0.0), "x", WHEEL_RADIUS * 0.53, WHEEL_HALF_WIDTH + 0.01,
           6, "rim")
    wheel = mb.build("wheel_1", mats, root, _lib.P(WHEEL_X, AXLES_F[0], WHEEL_RADIUS))
    for n, (f, sx) in enumerate(((AXLES_F[0], -1), (AXLES_F[1], 1), (AXLES_F[1], -1)), 2):
        ob = bpy.data.objects.new(f"wheel_{n}", wheel.data)
        scene.collection.objects.link(ob)
        ob.parent = root
        ob.location = _lib.P(sx * WHEEL_X, f, WHEEL_RADIUS)
    _lib.export(out, normals=False)


main()
