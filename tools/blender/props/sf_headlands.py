"""CX6: low coastal emplacement, olive scrub and tilted red chert beds."""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene

COLOURS = {"concrete": "#a1a497", "moss": "#6b7950", "glass": "#2a3330",
           "leaf_light": "#a0a274", "foliage_dark": "#505f3c", "chert": "#a45440"}


def battery(mb):
    mb.box(-6, 5.5, -15, 15, 0, 2, "concrete")
    # Real open hexagonal gun pits: a low floor and individual annular wall segments.
    for x in (-7, 7):
        for i in range(6):
            a, b = i*math.tau/6, (i+1)*math.tau/6
            plan = [(x+r*math.cos(t), -0.7+r*math.sin(t))
                    for r, t in ((4.3,a),(4.3,b),(3.6,b),(3.6,a))]
            mb.loft([[P(xx, f, h) for xx, f in plan] for h in (2, 4)], "concrete")
    mb.box(4.4, 5.5, -15, 15, 2, 3.7, "concrete")
    for x in (-10, 0, 10):
        mb.front_quad(5.53, x-1.1, x+1.1, 0.1, 2.7, "glass")
    for i in range(3):
        mb.box(4.3-i*1.2, 5.5-i*1.2, -1.4, 1.4, 0, 1.25+i*1.2, "concrete")
    mb.xprism([(-9,0),(-5.4,0),(-5.4,3.6)], -15, 15, "leaf_light")
    mb.front_quad(5.54, -14, -11.5, 2.8, 3.3, "moss")


def brush(mb):
    for x, f, h, rx in ((-0.55,0,0.55,0.9),(0.5,0.2,0.6,0.9)):
        faces = mb.blob((x,f,h), (rx,0.95,0.7), "foliage_dark")
        for face in faces:
            if sum(v.co.z for v in face.verts)/len(face.verts) > h+0.25:
                mb.tag([face], "leaf_light", closed=False)
    low = min(v.co.z for v in mb.bm.verts)
    for v in mb.bm.verts:
        v.co.z -= low


def chert(mb):
    # Four thin beds leaned forty degrees, sliced ends irregular rather than round rocks.
    for x, f, height in ((-2,0,1.8),(-0.8,-0.4,2.8),(0.7,0.1,3.1),(2,-0.7,2.2)):
        mb.xprism([(f-0.25,0),(f+0.2,0),(f+0.2+height*0.84,height),
                   (f-0.25+height*0.84,height)], x-0.6, x+0.6, "chert")
        # Bedding breaks are narrow darker-facing chert ledges in the same role.
        mb.xprism([(f,0.7),(f+0.45,0.7),(f+1.0,1.35),(f+0.55,1.35)],
                  x-0.65,x+0.65,"chert")
    for x in (-2.4, 0, 2.5):
        mb.cone((x,-0.5,0),0.22,0.55,3,"leaf_light")


reset_scene()
mats = make_mats(COLOURS)
for name, x, builder in (("gg_battery",-30,battery),("coyote_brush",0,brush),("sf_chert_outcrop",10,chert)):
    root = empty(name, loc=(x,0,0))
    mb = MB(COLOURS)
    builder(mb)
    mb.build(name+"_body",mats,root)
export(out_path(),normals=False)
