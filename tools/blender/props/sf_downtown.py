"""throttlebrawl prop: San Francisco's downtown kit, twelve variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python sf_downtown.py -- --out <path>.glb

Run W-R (interview, 2026-10-02: "SF first = downtown towers": a four-lane avenue between invented
AI-startup towers, giant screens, a deadpan HQ, plazas and streetlights; playtest 2: "I expected some
city feeling not just all row houses"). What the downtown layer (src/render/downtown.ts) stands
along the avenue: the towers shoulder to shoulder behind the sidewalk, a second row behind them, the
signals at each cross street, the lamps, and the plaza furniture. Each variant root dt_<v> sits on
the ground at its own x along a line, with one mesh child dt_<v>_body; its front faces the prop's
front (glTF +Z), which the game turns toward the avenue. A tower's root is the middle of its front
wall at the sidewalk; it reaches back (glTF -Z) by its depth.

- tower_glass: a blue glass slab on a lobby podium, aluminium bands every few floors;
- tower_stone: a sandstone tower in three setbacks, window bands on every face;
- tower_screen_agi, tower_screen_series: glass towers with a giant screen over the lobby, its
  words in block letters (AGI SOON; SERIES Z): the startup boom, deadpan, no brand;
- tower_crown: a slender tower with a pointed crown (a nod to the city's skyline, no copy of it);
- hq: the deadpan headquarters, a wide black monolith with INEVITABLE across its top and one small
  door marked LOBBY;
- midrise: an older eight-storey stone block with rows of windows (the second row, the cross
  streets);
- lamp: a tall double-armed street lamp; signal: a traffic signal on a mast arm reaching to its
  right (glTF -X) over the lanes;
- planter: a concrete planter with a small tree; bench: a plaza bench; orb: a polished sphere on a
  plinth, the plaza's corporate art.

Words are block letters made of flat panels (_lib.block_word: a 3 by 5 grid, no font). Flat colours
only; no grime. Exported without normals: every face is flat, and the game rebuilds them.
"""

import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

COLOURS = {
    "glass": "#3f5d78",          # tower glass
    "chrome": "#a4adb5",         # aluminium bands, lamp and signal poles
    "stone": "#bdb19b",          # sandstone
    "trim": "#e7e2d7",           # white precast, plinths
    "body": "#cfcac0",           # concrete planters and podiums
    "sign_board": "#15171a",     # screens, the HQ's black glass
    "sign_face": "#a6f4ff",      # the screens' letters
    "light_head": "#f6eccf",     # lamp heads
    "light_tail": "#d9473a",     # the signal's red lamp
    "car_green": "#56d16b",      # the signal's green lamp
    "body_alt": "#2c3530",       # the signal heads' housings
    "roof": "#5f5b55",           # roofs and crowns' caps
    "foliage": "#5f8f45",
    "bark": "#4a3a2c",
    "wood": "#7a5a3d",
    "car_white": "#f1f1ee",      # the HQ's letters
}

VARIANTS = ["tower_glass", "tower_stone", "tower_screen_agi", "tower_screen_series", "tower_crown", "hq",
            "midrise", "lamp", "signal", "planter", "bench", "orb"]
XS = [-150.0, -120.0, -90.0, -60.0, -32.0, 10.0, 52.0, 70.0, 84.0, 88.0, 92.0, 97.0]

word = _lib.block_word


def bands(mb, x0, x1, f0, f1, z0, z1, every, height, mat, sides=True):
    """Window bands on the front (f = f1) and both sides, every `every` m from z0 to z1."""
    z = z0
    while z + height <= z1 + 1e-6:
        mb.front_quad(f1 + 0.1, x0 + 0.6, x1 - 0.6, z, z + height, mat)
        if sides:
            mb.side_quad(x1 + 0.1, f0 + 0.6, f1 - 0.6, z, z + height, mat, 1)
            mb.side_quad(x0 - 0.1, f0 + 0.6, f1 - 0.6, z, z + height, mat, -1)
        z += every


def lobby(mb, hw, mat="glass"):
    """A lobby's glass front and a white canopy over the door."""
    mb.front_quad(0.1, -hw + 1.0, hw - 1.0, 0.0, 4.6, mat)
    mb.box(0.0, 1.6, -3.0, 3.0, 4.8, 5.1, "trim")


def tower_glass(mb, rng):
    hw, d, h = 11.0, 20.0, 60.0
    mb.box(-d, 0.0, -hw, hw, 0.0, 6.0, "body")
    mb.box(-d + 1.0, -1.0, -hw + 1.0, hw - 1.0, 6.0, h, "glass")
    bands(mb, -hw + 1.0, hw - 1.0, -d + 1.0, -1.0, 9.0, h - 3.0, 7.0, 0.8, "chrome")
    mb.box(-d + 3.0, -3.0, -hw + 3.0, hw - 3.0, h, h + 3.0, "roof")
    lobby(mb, hw)


def tower_stone(mb, rng):
    mb.box(-22.0, 0.0, -12.0, 12.0, 0.0, 24.0, "stone")
    mb.box(-20.0, -2.0, -10.0, 10.0, 24.0, 46.0, "stone")
    mb.box(-17.0, -5.0, -7.0, 7.0, 46.0, 62.0, "stone")
    mb.box(-16.0, -6.0, -6.0, 6.0, 62.0, 63.0, "roof")
    bands(mb, -12.0, 12.0, -22.0, 0.0, 7.0, 23.0, 4.0, 1.8, "glass")
    bands(mb, -10.0, 10.0, -20.0, -2.0, 26.0, 45.0, 4.0, 1.8, "glass")
    bands(mb, -7.0, 7.0, -17.0, -5.0, 48.0, 61.0, 4.0, 1.8, "glass")
    lobby(mb, 12.0)


def screen_tower(mb, lines):
    """A glass tower with a giant screen on its front over the lobby: (text, cell, z) per line."""
    hw, d, h = 11.0, 20.0, 52.0
    mb.box(-d, 0.0, -hw, hw, 0.0, 6.0, "body")
    mb.box(-d + 1.0, -1.0, -hw + 1.0, hw - 1.0, 6.0, h, "glass")
    bands(mb, -hw + 1.0, hw - 1.0, -d + 1.0, -1.0, 26.0, h - 3.0, 6.0, 0.8, "chrome")
    mb.box(-d + 3.0, -3.0, -hw + 3.0, hw - 3.0, h, h + 2.5, "roof")
    # The screen: a black slab proud of the facade, its words lit in big block letters you read at
    # speed from down the avenue.
    mb.box(-1.0, 0.4, -9.8, 9.8, 7.0, 23.0, "sign_board")
    for text, cell, z in lines:
        word(mb, text, 0.55, 0.0, z, cell, "sign_face")
    lobby(mb, hw)


def tower_screen_agi(mb, rng):
    screen_tower(mb, [("AGI", 1.0, 18.5), ("SOON", 1.0, 11.5)])


def tower_screen_series(mb, rng):
    screen_tower(mb, [("SERIES", 0.75, 19.0), ("Z", 1.5, 11.5)])


def tower_crown(mb, rng):
    hw, d, h = 9.0, 18.0, 70.0
    mb.box(-d, 0.0, -hw, hw, 0.0, 6.0, "trim")
    mb.box(-d + 0.8, -0.8, -hw + 0.8, hw - 0.8, 6.0, h, "trim")
    bands(mb, -hw + 0.8, hw - 0.8, -d + 0.8, -0.8, 9.0, h - 2.0, 3.6, 1.6, "glass")
    # The crown: four faceted faces to a point.
    mb.hull([(-hw + 0.8, -0.8, h), (hw - 0.8, -0.8, h), (hw - 0.8, -d + 0.8, h), (-hw + 0.8, -d + 0.8, h),
             (0.0, -d / 2, h + 16.0)], "roof")
    lobby(mb, hw)


def hq(mb, rng):
    """The deadpan headquarters: a black monolith, its name across the top, one small door."""
    hw, d, h = 23.0, 30.0, 40.0
    mb.box(-d, 0.0, -hw, hw, 0.0, h, "sign_board")
    mb.box(-d - 0.5, 0.5, -hw - 0.5, hw + 0.5, -0.0, 0.6, "trim")
    word(mb, "INEVITABLE", 0.52, 0.0, h - 5.0, 1.0, "car_white")
    mb.front_quad(0.52, -1.4, 1.4, 0.6, 3.4, "glass")
    word(mb, "LOBBY", 0.53, 0.0, 4.4, 0.12, "car_white")


def midrise(mb, rng):
    hw, d, h = 10.0, 18.0, 26.0
    mb.box(-d, 0.0, -hw, hw, 0.0, h, "stone")
    mb.box(-d - 0.3, 0.3, -hw - 0.3, hw + 0.3, h, h + 0.8, "trim")
    bands(mb, -hw, hw, -d, 0.0, 5.0, h - 2.0, 3.2, 1.6, "glass")
    mb.front_quad(0.1, -hw + 1.0, hw - 1.0, 0.0, 3.8, "glass")


def lamp(mb, rng):
    """A tall street lamp with an arm each way, its heads over the sidewalk and the kerb lane."""
    mb.box(-0.1, 0.1, -0.1, 0.1, 0.0, 8.0, "chrome")
    mb.box(-1.6, 1.6, -0.06, 0.06, 7.8, 7.95, "chrome")
    for f in (-1.6, 1.6):
        mb.box(f - 0.35, f + 0.35, -0.2, 0.2, 7.6, 7.8, "light_head")


def signal(mb, rng):
    """A traffic signal: a pole at the kerb, a mast arm out over the lanes to its right (-X), two
    heads facing the front."""
    mb.box(-0.14, 0.14, -0.14, 0.14, 0.0, 6.4, "chrome")
    mb.box(-0.08, 0.08, -9.0, 0.08, 6.0, 6.2, "chrome")
    for x in (-4.0, -8.0):
        mb.box(-0.3, 0.1, x - 0.25, x + 0.25, 4.6, 6.0, "body_alt")
        mb.front_quad(0.11, x - 0.15, x + 0.15, 5.55, 5.85, "light_tail")
        mb.front_quad(0.11, x - 0.15, x + 0.15, 4.75, 5.05, "car_green")
    # The pedestrian head on the pole, at eye level.
    mb.box(-0.25, 0.2, -0.2, 0.2, 2.6, 3.2, "body_alt")


def planter(mb, rng):
    mb.box(-0.9, 0.9, -0.9, 0.9, 0.0, 0.7, "body")
    mb.tube([(0.0, 0.0, 0.7), (0.05, 0.0, 2.2), (0.0, 0.05, 2.9)], [0.1, 0.08, 0.06], "bark", sides=4)
    mb.blob((0.0, 0.0, 3.3), (1.2, 1.1, 1.0), "foliage", jitter=0.1, rng=rng)


def bench(mb, rng):
    mb.box(-0.3, 0.3, -1.0, 1.0, 0.42, 0.5, "wood")
    mb.box(-0.32, -0.24, -1.0, 1.0, 0.5, 0.95, "wood")
    for x in (-0.85, 0.85):
        mb.box(-0.3, 0.3, x - 0.06, x + 0.06, 0.0, 0.42, "chrome")


def orb(mb, rng):
    """The plaza's corporate art: a polished sphere on a plinth. It means nothing, on purpose."""
    mb.box(-1.4, 1.4, -1.4, 1.4, 0.0, 1.2, "trim")
    mb.blob((0.0, 0.0, 3.0), (1.8, 1.8, 1.8), "chrome")


BUILDERS = {"tower_glass": tower_glass, "tower_stone": tower_stone, "tower_screen_agi": tower_screen_agi,
            "tower_screen_series": tower_screen_series, "tower_crown": tower_crown, "hq": hq,
            "midrise": midrise, "lamp": lamp, "signal": signal, "planter": planter, "bench": bench,
            "orb": orb}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    # Every part is a closed solid or a panel on one: nothing is double-sided.
    mats = _lib.make_mats(COLOURS)
    for k, (name, x) in enumerate(zip(VARIANTS, XS)):
        rng = random.Random(3100 + k)
        root = _lib.empty(f"dt_{name}", loc=(x, 0.0, 0.0))
        mb = _lib.MB(list(COLOURS))
        BUILDERS[name](mb, rng)
        # stand it on the ground: its lowest point at z = 0
        low = min(v.co.z for v in mb.bm.verts)
        for v in mb.bm.verts:
            v.co.z -= low
        # each body lists only the roles it paints
        used = sorted({f.material_index for f in mb.bm.faces})
        keep = [mb.mats[i] for i in used]
        for f in mb.bm.faces:
            f.material_index = keep.index(mb.mats[f.material_index])
        mb.mats = keep
        mb.build(f"dt_{name}_body", mats, root)
    _lib.export(out, normals=False)


main()
