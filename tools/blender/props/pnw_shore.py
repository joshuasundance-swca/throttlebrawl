"""CX6: repeatable buff sandstone sections and an invented lake cabin and dock."""

import math
import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _lib import MB, P, empty, export, make_mats, out_path, reset_scene

COLOURS = {"sandstone": "#c3a272", "stone": "#766d58", "moss": "#647a45",
           "foliage_dark": "#344c33", "concrete": "#b7b5a4", "wood": "#94704e",
           "car_green": "#3e6653", "glass": "#293e46", "deck": "#a28561", "hull": "#657d84"}
ROOTS = ["chuckanut_rockcut", "chuckanut_rockcut_tall", "chuckanut_parapet", "chuckanut_bluff",
         "chuckanut_boulder_a", "chuckanut_boulder_b", "samish_lake_house", "samish_dock"]
XS = [-60,-48,-36,-16,2,10,26,44]


def fern(mb,x,f,h):
    """Unequal hanging fronds spread into a drooping fan, not upright knobs."""
    for dx,drop,reach in ((-0.57,0.64,0.28),(0.12,0.95,0.43),(0.66,0.48,0.22)):
        mb.hull([(x,f,h),(x+dx*0.45-0.12,f+reach,h-0.2),
                 (x+dx,f+reach*0.75,h-drop),
                 (x+dx*0.45+0.1,f+reach-0.07,h-0.23)],"foliage_dark")


def rockcut(mb,tall):
    rng = random.Random(614 if tall else 613)
    levels = [0,1.35,2.8,4.2] if not tall else [0,1.3,2.7,4.15,5.6,7.05,8]
    fronts = [0,-0.36,0.12] if not tall else [0,-0.35,0.1,-0.42,0.15,0.5]
    rings = []
    for x in (-3,-1.8,-0.25,1.35,3):
        taper = math.sin(math.pi*(x+3)/6)
        heights = [h + (rng.uniform(-0.35,0.35)*taper if h else 0) for h in levels]
        depths = [f+rng.uniform(-0.47,0.47)*taper for f in fronts]
        # Each ledge retains its nominal direction at every width station.
        # Independent jitter otherwise lets its two edges cross, folding the
        # triangulated strip. A positive gap also keeps it nondegenerate.
        for i in range(1,len(depths)):
            lower_top = depths[i-1]-0.12
            if fronts[i] < fronts[i-1]-0.12:
                depths[i] = min(depths[i],lower_top-0.08)
            else:
                depths[i] = max(depths[i],lower_top+0.08)
        profile = [(-3,0),(depths[0],0)]
        for i,f in enumerate(depths):
            profile.append((f-0.12,heights[i+1]))
            if i+1 < len(depths):
                profile.append((depths[i+1],heights[i+1]))
        # A rounded-off, uneven lip continues back into the hillside.
        profile.extend([(-1.45,heights[-1]+0.16*taper),(-3,levels[-1]-0.25)])
        rings.append([P(x,f,h) for f,h in profile])
    faces = mb.loft(rings,"sandstone")
    for i,face in enumerate(faces):
        face.normal_update()
        if face.normal.z > 0.5 and i%3 != 1:
            mb.tag([face],"moss",closed=False)
        elif tall and face.normal.z < -0.15:
            mb.tag([face],"stone",closed=False)
    # Local fractures break selected front quads into unequal rock facets. One
    # moss triangle droops down from each broken bed, without a separate shelf.
    fronts = [face for face in faces if len(face.verts) == 4 and
              face.normal.dot(P(0,1,0)) > 0.7]
    for face in fronts[1::3][:4 if tall else 3]:
        outer = list(face.verts)
        centre = sum((v.co for v in outer),P(0,0,0))/4
        mid = mb.v(centre-face.normal*0.23)
        mb.bm.faces.remove(face)
        for j in range(4):
            tri = mb.bm.faces.new((outer[j],outer[(j+1)%4],mid))
            mb.tag([tri],"moss" if j == 1 else "stone" if j == 2 else "sandstone",closed=False)
    fern(mb,-0.9,0.12,levels[-2])
    fern(mb,1.7,0.05,levels[1]+0.2)


def parapet(mb):
    for i in range(4):
        mb.box(-0.5,0,-3+i*1.5,-1.5+i*1.5,0,0.72,"sandstone")
    mb.box(-0.55,0.05,-3,3,0.72,0.9,"concrete")
    mb.front_quad(0.015,-2.6,-1.4,0.15,0.42,"moss")


def bluff(mb):
    rng = random.Random(641)
    profile = [(0,0),(-3,-7),(-1.7,-7),(-8,-17),(-5.4,-17),
               (-14,-29),(-11,-29),(-20,-40),(-27,-40),(-12,-0.3)]
    rings = []
    for x in (-10,-6,-1,4,10):
        taper = math.sin(math.pi*(x+10)/20)
        points = []
        for i,(f,h) in enumerate(profile):
            ff = f + (rng.uniform(-2.1,2.1)*taper if i else 0)
            hh = h + (rng.uniform(-2,2)*taper if -40 < h < 0 else 0)
            if i == 0:
                hh = -rng.uniform(0,1.2)*taper
            points.append(P(x,ff,hh))
        rings.append(points)
    faces = mb.loft(rings,"sandstone")
    for i,face in enumerate(faces):
        face.normal_update()
        if face.normal.z < -0.25 and i%10 in (1,3,5):
            mb.tag([face],"stone",closed=False)
        elif face.normal.z > 0.35 and i%3 != 0:
            mb.tag([face],"moss",closed=False)
    # Broad, unequal leaning buttresses break the face, rather than vertical slots.
    for x,w,f,h in ((-6,3.1,-9,-21),(0.6,3.7,-15,-32),(6,2.6,-5,-14)):
        mb.hull([(x-w,f-3,h-6),(x+w,f-2,h-5),(x+w*0.6,f+2,h-4),
                 (x-w*0.75,f+1,h-3),(x-w*0.45,f-1,h+6),
                 (x+w*0.3,f-2,h+5)],"sandstone")
    for x,f,w,h in ((-6.8,-20,2.3,3.4),(-2.2,-18.5,2.6,2.5),
                     (2.8,-21,2.2,4.1),(7,-19.5,1.8,2.8)):
        rock = mb.blob((x,f,-40+h*0.5),(w,2.8,h*0.58),"sandstone",0.22,rng)
        # Keep the lowest scree vertices exactly on the forty-metre toe.
        for face in rock:
            for v in face.verts:
                v.co.z = max(-40,v.co.z)


def boulder(mb,large):
    h,w,d = (2.8,2.4,1.7) if large else (1.5,1.25,1)
    rng = random.Random(653 if large else 652)
    points = []
    for n,z,scale,phase in ((5,0,0.75,0),(5,h*0.48,1,0.25),(4,h*0.89,0.63,0.7)):
        for i in range(n):
            a = math.tau*i/n+phase+rng.uniform(-0.17,0.17)
            k = scale*rng.uniform(0.82,1.16)
            points.append((w*k*math.cos(a)+z*0.08,d*k*math.sin(a),
                           z if z == 0 else min(h,z+rng.uniform(-0.2,0.12)*h)))
    points[-1] = (points[-1][0],points[-1][1],h)
    faces = mb.hull(points,"sandstone")
    dark = 0
    for face in faces:
        face.normal_update()
        if face.normal.z > 0.28 and min(v.co.z for v in face.verts) > h*0.35:
            mb.tag([face],"moss",closed=False)
        elif face.normal.y < -0.15 and dark < 3:
            mb.tag([face],"stone",closed=False)
            dark += 1


def lakehouse(mb):
    mb.box(-8,0,-4.5,4.5,0,4.3,"wood")
    mb.fprism([(-4.5,4.3),(4.5,4.3),(0,8)],-8,0,"wood")
    # Two thin roof slope solids avoid a filled triangle hiding the attic windows.
    for side in (-1,1):
        mb.fprism([(0,8.15),(side*4.85,4.25),(side*4.85,4.4),(0,8.3)],-8.4,0.4,"car_green")
    mb.box(-6.5,-5.5,2.8,3.8,0,8.5,"stone")
    mb.front_quad(0.03,-0.55,0.55,0.25,2.7,"wood")
    for x in (-2.6,2.6):
        mb.front_quad(0.04,x-0.95,x+0.95,1,3.4,"glass")
    for x in (-2.5,0,2.5):
        face = mb.front_quad(-8.03,x-1,x+1,0.8,3.7,"glass")[0]
        face.normal_flip()
    face = mb.front_quad(-8.03,-1.1,1.1,4.6,6.1,"glass")[0]
    face.normal_flip()
    mb.box(-11,-8,-4.5,4.5,0.6,0.8,"deck")
    for x in (-4.3,0,4.3):
        mb.box(-10.8,-10.6,x-0.07,x+0.07,0,1.75,"wood")
    mb.box(-10.85,-10.65,-4.5,4.5,1.65,1.75,"wood")
    mb.box(0,1.4,-1.3,1.3,0,0.25,"deck")
    for x in (-1.1,1.1):
        mb.box(1.15,1.3,x-0.06,x+0.06,0.25,2.9,"wood")
    mb.box(0,1.5,-1.4,1.4,2.9,3.05,"car_green")


def dock(mb):
    mb.box(-14,0,-1,1,0.4,0.55,"deck")
    mb.box(-14,-12.2,-2.5,2.5,0.4,0.55,"deck")
    for f in (-2,-7,-13):
        for x in (-0.85,0.85):
            mb.cyl((x,f,-0.425),"z",0.13,1.075,3,"wood")
    # One closed hollow shell: outer hull, gunwale rim, inner wall and the bowl floor.
    plan = [(1.4,-6),(2.3,-5.3),(3.2,-6),(3.1,-9.1),(1.5,-9.1)]
    inner = [(x+(2.3-x)*0.15,f+(-7.3-f)*0.1) for x,f in plan]
    mb.loft([[P(x,f,h) for x,f in ring] for ring,h in
             ((inner,-0.1),(plan,0.6),(inner,0.6),(inner,0.1))],"hull")
    mb.box(-7.8,-7.55,1.7,2.9,0.45,0.55,"wood")


reset_scene()
mats = make_mats(COLOURS)
for i,name in enumerate(ROOTS):
    r = empty(name,loc=(XS[i],0,0))
    mb = MB(COLOURS)
    if i < 2:
        rockcut(mb,i==1)
    elif i == 2:
        parapet(mb)
    elif i == 3:
        r["drop_m"],r["section_m"],r["foundation_m"] = 40,20,40
        bluff(mb)
    elif i < 6:
        boulder(mb,i==5)
    elif i == 6:
        lakehouse(mb)
    else:
        r["foundation_m"] = 1.5
        dock(mb)
    mb.build(name+"_body",mats,r)
export(out_path(),normals=False)
