"""throttlebrawl prop: San Francisco Victorian row houses, four variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python row_houses.py -- --out <path>.glb

Each variant root row_house_<v> sits on the ground at the middle of its front wall (the
sidewalk line), at x = -10.5, -3.5, +3.5 and +10.5; the facade faces the prop's front (glTF +Z),
which the game turns toward the road. One mesh child per variant, row_house_<v>_body. The game
lines them up shoulder to shoulder (7 m apart) into terraces that step down the hills.

- a: Italianate, flat roof behind a bracketed cornice, a two-storey slanted bay (pink);
- b: Queen Anne, a front gable and a corner turret with a witch's-hat roof (mint);
- c: Stick style, square bays, a tall flat front with a heavy cornice (yellow);
- d: Edwardian, a full-height box bay and a simple cornice (blue).

Every house has a garage door on the street floor and a stoop up to its front door. The
paint colour is the variant's own role (paint_pink, paint_mint, paint_yellow, paint_blue), so
a region palette can repaint them. Flat colours only; no grime.
"""

import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
HALF_W = 3.2          # half the house width (x, m); the game spaces them 7 m apart
DEPTH = 11.0          # front wall to back wall (f, m)
STREET_Z = 3.0        # the garage floor's height (the first living floor starts here)
STOREY = 3.3          # each living floor
FLOORS = 2            # living floors over the garage
WIN_W, WIN_H = 0.95, 1.9
WIN_SILL = 0.8        # above each floor
FRAME = 0.12          # trim showing around each window
PROUD = 0.03          # how far panels stand off their wall
BAY_DEPTH = 0.9

VARIANTS = [
    dict(name="row_house_a", x=-10.5, paint="paint_pink", style="italianate"),
    dict(name="row_house_b", x=-3.5, paint="paint_mint", style="queen_anne"),
    dict(name="row_house_c", x=3.5, paint="paint_yellow", style="stick"),
    dict(name="row_house_d", x=10.5, paint="paint_blue", style="edwardian"),
]

COLOURS = {
    "paint_pink": "#e7a6b4",
    "paint_mint": "#a9d6c2",
    "paint_yellow": "#f1d58a",
    "paint_blue": "#9db8d9",
    "trim": "#f4efe4",       # white cornices, frames and floor bands
    "body_alt": "#55607a",   # the accent: the front door's surround
    "glass": "#2e3a44",
    "roof": "#5d5852",
    "wood": "#6b4a35",       # doors
}


def window(mb, f, xc, z0):
    """A framed window on the front wall at f: a trim panel with the glass just in front of it."""
    mb.front_quad(f + PROUD, xc - WIN_W / 2 - FRAME, xc + WIN_W / 2 + FRAME, z0 - FRAME, z0 + WIN_H + FRAME, "trim")
    mb.front_quad(f + 2 * PROUD, xc - WIN_W / 2, xc + WIN_W / 2, z0, z0 + WIN_H, "glass")


def street_floor(mb, door_x, paint):
    """The garage door, the front door at the top of the stoop, and the stoop itself."""
    w = HALF_W
    gx = -door_x * 0.45
    mb.front_quad(PROUD, gx - 1.3, gx + 1.3, 0.0, 2.3, "trim")
    mb.front_quad(2 * PROUD, gx - 1.15, gx + 1.15, 0.0, 2.2, "wood")
    # the stoop: a wedge of steps in the house's paint from the sidewalk up to the door's sill,
    # with a white handrail up each side
    run = 2.2
    mb.xprism([(0.0, 0.0), (run, 0.0), (0.0, STREET_Z)], door_x - 0.6, door_x + 0.6, paint)
    for x in (door_x - 0.6, door_x + 0.6):
        mb.tube([(x, run, 0.9), (x, 0.0, STREET_Z + 0.9)], [0.05, 0.05], "trim", sides=4)
    mb.front_quad(PROUD, door_x - 0.65, door_x + 0.65, STREET_Z, STREET_Z + 2.5, "body_alt")
    mb.front_quad(2 * PROUD, door_x - 0.5, door_x + 0.5, STREET_Z, STREET_Z + 2.35, "wood")
    # a trim band where the street floor meets the living floors
    mb.box(0.0, 0.12, -w, w, STREET_Z - 0.18, STREET_Z, "trim")


def floor_bands(mb, w, top):
    for k in range(1, FLOORS):
        z = STREET_Z + k * STOREY
        mb.box(0.0, 0.1, -w, w, z - 0.14, z, "trim")
    # the cornice: a deep band at the top of the facade, standing proud
    mb.box(-0.2, 0.45, -w - 0.1, w + 0.1, top - 0.55, top, "trim")


def slanted_bay(mb, xa, xb, z0, z1, mat):
    """A slanted (Italianate) bay: a three-sided prism off the front wall, glass on its front."""
    d = BAY_DEPTH
    inset = d * 0.7
    ring0 = [_lib.P(xa, 0.0, z0), _lib.P(xa + inset, d, z0), _lib.P(xb - inset, d, z0), _lib.P(xb, 0.0, z0)]
    ring1 = [_lib.P(xa, 0.0, z1), _lib.P(xa + inset, d, z1), _lib.P(xb - inset, d, z1), _lib.P(xb, 0.0, z1)]
    mb.loft([ring0, ring1], mat)
    mb.box(-0.05, d + 0.15, xa - 0.1, xb + 0.1, z1, z1 + 0.25, "trim")


def box_bay(mb, xa, xb, z0, z1, mat):
    mb.box(0.0, BAY_DEPTH, xa, xb, z0, z1, mat)
    mb.box(-0.05, BAY_DEPTH + 0.15, xa - 0.1, xb + 0.1, z1, z1 + 0.25, "trim")


def bay_windows(mb, xa, xb, inset):
    for k in range(FLOORS):
        z0 = STREET_Z + k * STOREY + WIN_SILL
        mb.front_quad(BAY_DEPTH + PROUD, xa + inset + 0.15, xb - inset - 0.15, z0, z0 + WIN_H, "glass")


def build(mb, p):
    w = HALF_W
    paint = p["paint"]
    living_top = STREET_Z + FLOORS * STOREY
    style = p["style"]
    door_x = 1.9 if style in ("italianate", "stick") else -1.9
    bay = (-w + 0.5, 0.9) if door_x > 0 else (-0.9, w - 0.5)
    # the main volume: a box from the sidewalk back to the back wall
    top = living_top + (1.0 if style in ("italianate", "stick") else 0.4)
    mb.box(-DEPTH, 0.0, -w, w, 0.0, top, paint)
    street_floor(mb, door_x, paint)
    # the bay over the garage, through both living floors
    xa, xb = bay
    if style in ("italianate", "queen_anne"):
        slanted_bay(mb, xa, xb, STREET_Z, living_top, paint)
        bay_windows(mb, xa, xb, BAY_DEPTH * 0.7)
    else:
        box_bay(mb, xa, xb, STREET_Z, living_top, paint)
        bay_windows(mb, xa, xb, 0.0)
    # a window over the front door on each living floor
    for k in range(FLOORS):
        if k == 0:
            continue
        window(mb, 0.0, door_x, STREET_Z + k * STOREY + WIN_SILL)
    floor_bands(mb, w, top)
    if style == "queen_anne":
        # a front gable over the flat roof line, and a turret on the door's corner
        gh = 3.0
        mb.fprism([(-w, top), (w, top), (0.0, top + gh)], -DEPTH + 0.5, 0.0, paint)
        mb.fprism([(-w - 0.3, top - 0.05), (w + 0.3, top - 0.05), (0.0, top + gh + 0.25)], -DEPTH + 0.3, -0.25,
                  "roof")
        window(mb, 0.0, 0.0, top + 0.4)
        tx = w - 0.9 if door_x < 0 else -w + 0.9
        mb.cyl((tx, 0.4, (STREET_Z + top + 1.2) / 2), "z", 1.15, (top + 1.2 - STREET_Z) / 2, 6, paint,
               phase=math.pi / 6)
        mb.cone((tx, 0.4, top + 1.2), 1.4, top + 4.4, 6, "roof", phase=math.pi / 6)
    elif style == "italianate":
        # brackets under the cornice
        for x in (-w + 0.3, -w / 3, w / 3, w - 0.3):
            mb.box(0.0, 0.4, x - 0.12, x + 0.12, top - 1.2, top - 0.55, "trim")
    elif style == "stick":
        # a false-front parapet with a little pediment
        mb.fprism([(-1.2, top), (1.2, top), (0.0, top + 0.9)], -0.3, 0.2, "trim")
    # a dark roof deck just under the parapet line (seen from the hills above)
    mb.box(-DEPTH + 0.2, -0.6, -w + 0.15, w - 0.15, top - 0.1, top + 0.02, "roof")


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS)
    for p in VARIANTS:
        root = _lib.empty(p["name"], loc=(p["x"], 0.0, 0.0))
        used = [p["paint"], "trim", "body_alt", "glass", "roof", "wood"]
        mb = _lib.MB(used)
        build(mb, p)
        mb.build(f"{p['name']}_body", mats, root)
    # Faceted: the game rebuilds each face's normal from its corners (models.ts), so none ship.
    _lib.export(out, normals=False)


main()
