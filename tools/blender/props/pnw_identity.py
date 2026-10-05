"""CX5: red-barked bluff madrones and a dry-masonry highway guard wall."""

import sys
from pathlib import Path

import bmesh

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, empty, export, make_mats, out_path, reset_scene

COLOURS = {"bark": "#a45135", "foliage_dark": "#244837", "stone": "#858881", "moss": "#60764c"}
ROOTS = ["pnw_madrone_a", "pnw_madrone_b", "gorge_guard_wall"]
XS = [-18, 0, 18]


def madrone(mb, small):
    h, lean = (4.5, 0.6) if small else (7.4, 3.5)
    for dx in ((-0.35, 0.35) if small else (0,)):
        mb.tube([(dx, 0, 0.25), (dx+0.3, lean*0.25, h*0.4),
                 (dx-0.2, lean*0.7, h*0.75), (dx+0.3, lean, h)],
                [0.3, 0.24, 0.17, 0.1], "bark", sides=5)
        for sign in (-1, 1):
            mb.tube([(dx-0.2, lean*0.7, h*0.75), (sign*1.8, lean+sign*0.5, h+0.6)],
                    [0.16, 0.06], "bark", sides=4)
    mb.cur_sway = 0.95
    for x, f, z, rx, rz in ((0, lean, h+0.6, 2.4, 1.4), (-1.8, lean-0.5, h, 1.9, 1.1),
                            (1.8, lean+0.5, h+0.3, 1.7, 1.3)):
        mb.blob((x, f, z), (rx, 1.7, rz), "foliage_dark")


def wall(mb):
    # Four piers and three faceted arch heads leave genuine through openings.
    for xa, xb in ((-3, -2.55), (-1.45, -0.55), (0.55, 1.45), (2.55, 3)):
        mb.box(-0.225, 0.225, xa, xb, 0, 0.84, "stone")
    for x in (-2, 0, 2):
        mb.fprism([(x-0.55, 0.55), (x-0.275, 0.758), (x+0.275, 0.758), (x+0.55, 0.55),
                   (x+0.55, 0.84), (x-0.55, 0.84)], -0.225, 0.225, "stone")
    cap = mb.box(-0.26, 0.26, -3, 3, 0.84, 0.9, "stone")
    # One triangulated cap half is moss; it adds no overlapping surface or triangles.
    top = bmesh.ops.triangulate(mb.bm, faces=[cap[2]])["faces"]
    mb.tag([top[0]], "moss", closed=False)


reset_scene()
mats = make_mats(COLOURS)
for name, x in zip(ROOTS, XS):
    r = empty(name, loc=(x, 0, 0))
    mb = MB(COLOURS, sway=True)
    if name == "gorge_guard_wall":
        wall(mb)
    else:
        madrone(mb, name.endswith("b"))
        # Tube rings tilt at the foot; place the actual lowest point on the ground.
        low = min(v.co.z for v in mb.bm.verts)
        for v in mb.bm.verts:
            v.co.z -= low
    mb.build(name+"_body", mats, r)
export(out_path(), normals=False)
