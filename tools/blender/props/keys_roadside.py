"""throttlebrawl prop: the Florida Keys roadside kit, twenty-six variants in one GLB.

Run: blender --background --factory-startup --python-exit-code 1 --python keys_roadside.py -- --out <path>.glb

Run W-P, "fill the world" (the maintainer, 2026-10-01b: "the worlds just feel very empty"; "unique
regional flavor everywhere"; for the Keys, "likewise local"). The clutter the game scatters beside a
Keys road, among the palms, mangroves and bait shacks it already has. Each variant root keys_<v> sits
on the ground at its own x along a line, with one mesh child keys_<v>_body; its front faces the
prop's front (glTF +Z), which the game turns toward the road.

- seagrape, seagrape_tree: a sprawling sea grape bush and a taller one gone to tree;
- traps: a stack of wooden lobster traps with their buoys;
- pelican: a brown pelican on a weathered piling;
- trailer: a skiff on its trailer, bow to the road;
- cottage_a, cottage_b: pastel conch cottages up on short piers, tin roofs, porches and shutters;
- picket: a 4 m white picket fence section (the game lines sections up along the road);
- mailbox: a mailbox on a post with a fish on top;
- bait: a hand-painted BAIT ICE board on two posts;
- pie: a roadside key lime pie stand under a striped awning.

Run W-Q, "distinct keys" (interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS"), adds each key's own
props; the game stands them only on that key's stretches (roadside.ts, a rule's `district`):

- the fishing village (Chum Key): shrimp_boat (a shrimp boat up on blocks, outriggers raised, nets
  hung), fish_house (a fish house on pilings with a FISH board), buoy_line (buoys hung on a line);
- the resort strip (Lime Wedge Key): hotel_a, hotel_b (three-storey pastel hotels with balconies
  and a HOTEL sign), pool (a pool deck with loungers and umbrellas), tiki (a thatched tiki bar),
  scooters (a row of rental scooters and a RENT board);
- the junkyard key (Salvage Key): boat_stack (hulls racked three high), bus_stack (two retired
  buses, one on the other), junk_art (a deadpan junk robot on an ART plinth);
- the party key (Last Resort Key), played as the hangover: bunting (a 6 m run of pennants between
  poles), coolers (coolers and a lawn chair left where they fell), closed_bar (a shuttered bar with a
  CLOSED board), flamingo (a pool flamingo, deflated, face down).

Words are block letters drawn in _lib (no font); this script adds the letters it needs to the grid.
Flat colours only; no grime. Exported without normals: every face is flat, and the game rebuilds
them.
"""

import random
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

P = _lib.P
word = _lib.block_word

COLOURS = {
    "foliage": "#3f7d3c",       # sea grape leaves
    "leaf_light": "#9cc35a",    # key lime green
    "bark": "#6b5440",
    "wood": "#a68a5d",          # weathered planks: traps, pilings, posts, the bait board
    "car_red": "#d9483b",       # buoys
    "sign_face": "#f2d14b",     # buoys, the bait board's letters
    "stone": "#8f8577",         # the pelican
    "trim": "#f4efe4",          # white: the pelican's head, porch rails, pickets
    "body": "#e39a3b",          # the pelican's bill, the mailbox's fish
    "chrome": "#8e9499",        # the trailer, the mailbox
    "tyre": "#202224",
    "hull": "#e8e2d2",
    "paint_mint": "#a7d8c6",
    "paint_pink": "#f2b7c0",
    "roof": "#c9ccc9",          # tin
    "glass": "#2e3a44",
    "body_alt": "#3f8f8a",      # shutters
    "sign_board": "#2c3a46",    # the pie stand's letters
    # run W-Q, the four keys
    "hull_bottom": "#b5443a",   # antifouling red
    "frame": "#5d6a73",         # racks, masts, booms
    "canvas": "#3f6b4f",        # shrimp nets
    "paint_blue": "#8fcfe0",    # the aqua hotel
    "paint_yellow": "#f2c94c",  # the bus, the closed bar
    "deck": "#d9c9a3",          # pool decks
    "car_blue": "#2f8fd0",      # pool water, coolers, a scooter
    "car_white": "#f1f1ee",     # cooler lids, the robot's fridge
    "car_yellow": "#f5c518",    # a scooter, bunting, an umbrella
    "car_green": "#4fb06d",     # a scooter, bunting, an umbrella
    "coconut": "#c9a25a",       # thatch
    "seat": "#e36f5a",          # loungers, stools, scooter seats
}

# The letters this kit's boards need beyond _lib's (3 by 5 cells, rows top to bottom).
_lib.BLOCK_FONT.update({
    "D": ("110", "101", "101", "101", "110"),
    "F": ("111", "100", "110", "100", "100"),
    "H": ("101", "101", "111", "101", "101"),
    "L": ("100", "100", "100", "100", "111"),
    "N": ("110", "101", "101", "101", "101"),
    "O": ("111", "101", "101", "101", "111"),
    "S": ("111", "100", "111", "001", "111"),
})

VARIANTS = ["seagrape", "seagrape_tree", "traps", "pelican", "trailer", "cottage_a", "cottage_b", "picket",
            "mailbox", "bait", "pie",
            "shrimp_boat", "fish_house", "buoy_line",
            "hotel_a", "hotel_b", "pool", "tiki", "scooters",
            "boat_stack", "bus_stack", "junk_art",
            "bunting", "coolers", "closed_bar", "flamingo"]
XS = [-40.0, -34.0, -28.0, -24.0, -18.0, -8.0, 4.0, 14.0, 19.0, 23.0, 30.0,
      46.0, 62.0, 74.0,
      90.0, 108.0, 124.0, 136.0, 146.0,
      158.0, 172.0, 184.0,
      194.0, 203.0, 212.0, 222.0]


def gem(mb, centre, radii, mat, rng, jitter=0.12):
    """A jittered octahedron (8 triangles): the cheapest round bush."""
    cx, cf, cz = centre
    rx, rf, rz = radii
    pts = [(rx, 0, 0), (-rx, 0, 0), (0, rf, 0), (0, -rf, 0), (0, 0, rz), (0, 0, -rz)]
    vs = []
    for x, f, z in pts:
        k = 1.0 + rng.uniform(-jitter, jitter)
        vs.append(mb.v(P(cx + x * k, cf + f * k, cz + z * k)))
    tris = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    mb.tag([mb.bm.faces.new((vs[a], vs[b], vs[c])) for a, b, c in tris], mat)


def seagrape(mb, rng):
    for cx, cf, r, h in ((0.0, 0.0, 1.1, 0.8), (0.9, 0.4, 0.8, 0.6), (-0.8, -0.3, 0.9, 0.65),
                         (0.2, -0.7, 0.7, 0.5)):
        gem(mb, (cx, cf, h), (r, r * 0.9, h), "foliage", rng, 0.18)


def seagrape_tree(mb, rng):
    mb.tube([(0.0, 0.0, 0.0), (0.3, 0.1, 1.4), (0.1, 0.0, 2.2)], [0.16, 0.12, 0.09], "bark", sides=4)
    mb.tube([(0.2, 0.05, 1.1), (-0.9, 0.2, 2.0)], [0.08, 0.06], "bark", sides=3)
    for cx, cf, cz, r in ((0.2, 0.0, 2.7, 1.3), (-1.0, 0.3, 2.3, 0.9), (0.9, -0.3, 2.2, 0.9)):
        gem(mb, (cx, cf, cz), (r, r * 0.9, r * 0.6), "foliage", rng, 0.15)


def traps(mb, rng):
    """Lobster traps stacked by a shack: wooden crates, a buoy hung on the stack."""
    w, d, h = 0.6, 0.45, 0.42
    for _i, (x, z) in enumerate(((-0.62, 0.0), (0.0, 0.0), (0.62, 0.0), (-0.31, h), (0.31, h), (0.0, 2 * h))):
        mb.box(-d, d, x - w / 2 + 0.02, x + w / 2 - 0.02, z, z + h - 0.02, "wood")
    for x, mat in ((-0.95, "car_red"), (0.95, "sign_face")):
        mb.cyl((x, 0.0, 0.55), "z", 0.13, 0.22, 6, mat)


def pelican(mb, rng):
    mb.cyl((0.0, 0.0, 1.1), "z", 0.16, 1.1, 6, "wood")
    # the bird: a body, a white head on an S of neck, the long bill resting on its chest
    gem(mb, (0.0, -0.05, 2.45), (0.22, 0.42, 0.22), "stone", rng, 0.05)
    mb.box(0.12, 0.22, -0.05, 0.05, 2.55, 2.9, "stone")
    gem(mb, (0.0, 0.2, 2.95), (0.09, 0.12, 0.09), "trim", rng, 0.0)
    mb.xprism([(0.28, 2.95), (0.62, 2.62), (0.56, 2.6), (0.24, 2.9)], -0.04, 0.04, "body")


def trailer(mb, rng):
    """A boat trailer with a skiff on it, the bow (and the hitch) toward the front."""
    for x in (-0.6, 0.6):
        mb.box(-2.6, 2.4, x - 0.05, x + 0.05, 0.35, 0.47, "chrome")
    mb.box(2.4, 3.3, -0.05, 0.05, 0.35, 0.45, "chrome")
    mb.box(-0.9, -0.5, -0.95, 0.95, 0.0, 0.62, "tyre")
    # the skiff: a hull of two slanted sides and a flat transom
    mb.xprism([(-2.4, 0.55), (2.0, 0.55), (2.7, 1.25), (-2.4, 1.2)], -0.85, 0.85, "hull")
    mb.box(-1.2, 0.2, -0.3, 0.3, 1.2, 1.5, "chrome")


def cottage(mb, paint, porch_roof):
    """A conch cottage up on short piers: a pastel box, a tin roof, a porch with a rail, shutters."""
    hw, d, base, wall = 3.0, 7.0, 0.7, 2.9
    for x in (-hw + 0.2, hw - 0.2):
        for f in (-d + 0.3, -0.3):
            mb.box(f - 0.15, f + 0.15, x - 0.15, x + 0.15, 0.0, base, "wood")
    mb.box(-d, 0.0, -hw, hw, base, base + wall, paint)
    mb.xprism([(-d - 0.4, base + wall), (0.4, base + wall), (-d / 2, base + wall + 1.9)], -hw - 0.3, hw + 0.3, "roof")
    # the porch: a deck, a rail, posts, its own little roof
    mb.box(0.0, 1.8, -hw, hw, base - 0.12, base, "wood")
    mb.box(1.72, 1.8, -hw, hw, base + 0.8, base + 0.9, "trim")
    for x in (-hw + 0.1, -1.0, 1.0, hw - 0.1):
        mb.box(1.65, 1.8, x - 0.07, x + 0.07, base, base + 2.4, "trim")
    mb.xprism(porch_roof, -hw - 0.1, hw + 0.1, "roof")
    # the door, two windows, their shutters
    mb.front_quad(0.01, -0.45, 0.45, base, base + 2.1, "body_alt")
    for x in (-1.9, 1.9):
        mb.front_quad(0.01, x - 0.5, x + 0.5, base + 0.9, base + 2.2, "glass")
        for s in (-0.72, 0.72):
            mb.front_quad(0.02, x + s - 0.2, x + s + 0.2, base + 0.85, base + 2.25, "body_alt")


def cottage_a(mb, rng):
    cottage(mb, "paint_mint", [(0.0, 3.6), (2.0, 3.0), (2.0, 2.92), (0.0, 3.5)])


def cottage_b(mb, rng):
    cottage(mb, "paint_pink", [(0.0, 3.55), (2.1, 3.15), (2.1, 3.05), (0.0, 3.45)])


def picket(mb, rng):
    """A 4 m white picket fence section along x: two rails and eleven pointed pickets, flat panels
    facing the road (a fence is seen from the road; panels keep a run of sections cheap)."""
    for z in (0.3, 0.75):
        mb.front_quad(0.0, -2.0, 2.0, z, z + 0.07, "trim")
    for k in range(11):
        x = -2.0 + 0.2 + k * 0.36
        pts = [P(x - 0.05, 0.02, 0.0), P(x + 0.05, 0.02, 0.0), P(x + 0.05, 0.02, 0.92), P(x, 0.02, 1.0),
               P(x - 0.05, 0.02, 0.92)]
        mb.tag([mb.bm.faces.new([mb.v(p) for p in pts])], "trim", closed=False)


def mailbox(mb, rng):
    mb.box(-0.06, 0.06, -0.06, 0.06, 0.0, 1.05, "wood")
    mb.box(-0.25, 0.25, -0.12, 0.12, 1.05, 1.3, "chrome")
    mb.xprism([(-0.25, 1.3), (0.25, 1.3), (0.0, 1.38)], -0.12, 0.12, "chrome")
    # a painted fish on the lid, nose to the road
    mb.fprism([(-0.02, 1.4), (0.02, 1.4), (0.02, 1.5), (-0.02, 1.5)], -0.28, 0.2, "body")
    mb.xprism([(-0.28, 1.45), (-0.42, 1.38), (-0.42, 1.52)], -0.02, 0.02, "body")


def bait(mb, rng):
    for x in (-0.9, 0.9):
        mb.box(-0.06, 0.06, x - 0.06, x + 0.06, 0.0, 1.9, "wood")
    mb.box(-0.04, 0.04, -1.1, 1.1, 1.0, 1.85, "trim")
    word(mb, "BAIT", 0.05, 0.0, 1.62, 0.07, "car_red")
    word(mb, "ICE", 0.05, 0.0, 1.2, 0.07, "sign_board")


def pie(mb, rng):
    """A key lime pie stand: a counter, a striped awning on posts and a PIE board."""
    mb.box(-0.6, 0.0, -1.2, 1.2, 0.0, 1.0, "paint_pink")
    mb.box(0.0, 0.05, -1.2, 1.2, 0.95, 1.02, "trim")
    for x in (-1.15, 1.15):
        mb.box(-0.6, -0.5, x - 0.05, x + 0.05, 0.0, 2.3, "wood")
    for k in range(6):
        x0 = -1.35 + k * 0.45
        mat = "leaf_light" if k % 2 == 0 else "trim"
        mb.fprism([(x0, 2.3), (x0 + 0.45, 2.3), (x0 + 0.45, 2.22), (x0, 2.22)], -0.9, 0.5, mat)
    mb.box(-0.02, 0.02, -0.75, 0.75, 1.15, 1.75, "trim")
    word(mb, "PIE", 0.03, 0.0, 1.45, 0.09, "sign_board")


# --- Run W-Q: the fishing village (Chum Key) ---


def shrimp_boat(mb, rng):
    """A shrimp boat up on blocks in the yard, broadside to the road: its hull along x, its
    wheelhouse forward, the outrigger booms raised either side of the mast, nets hung to dry."""
    fc = -2.0  # the hull's centre line, back from the anchor, so its beam ends near f = 0
    for x in (-3.5, 0.0, 3.5):
        mb.box(fc - 0.4, fc + 0.4, x - 0.25, x + 0.25, 0.0, 0.6, "wood")
    mb.fprism([(-5.2, 0.6), (3.9, 0.6), (4.4, 1.0), (-5.4, 1.0)], fc - 1.6, fc + 1.6, "hull_bottom")
    mb.fprism([(-5.4, 1.0), (4.4, 1.0), (5.9, 2.9), (-5.6, 2.5)], fc - 1.9, fc + 1.9, "hull")
    mb.box(fc - 1.3, fc + 1.3, 1.4, 3.9, 2.6, 4.6, "trim")
    mb.box(fc - 1.5, fc + 1.5, 1.2, 4.1, 4.6, 4.75, "roof")
    mb.front_quad(fc + 1.31, 1.7, 3.6, 3.7, 4.35, "glass")
    mb.tube([(-1.2, fc, 2.5), (-1.2, fc, 8.0)], [0.13, 0.09], "frame", sides=4)
    for side in (-1, 1):
        tip = (-1.2, fc + side * 1.8, 7.4)
        mb.tube([(-1.2, fc, 3.0), tip], [0.08, 0.06], "frame", sides=3)
        mb.blob((tip[0], tip[1], 6.0), (0.55, 0.35, 1.2), "canvas", jitter=0.12, rng=rng)


def fish_house(mb, rng):
    """A fish house on pilings: a white shed with a tin roof, a roll-up door and a FISH board."""
    d, hw, base = 5.0, 5.0, 0.9
    for x in (-hw + 0.3, 0.0, hw - 0.3):
        for f in (-d + 0.3, -0.3):
            mb.box(f - 0.15, f + 0.15, x - 0.15, x + 0.15, 0.0, base, "wood")
    mb.box(-d, 0.0, -hw, hw, base, base + 3.0, "trim")
    mb.xprism([(-d - 0.3, base + 3.0), (0.6, base + 3.0), (0.6, base + 3.15), (-d - 0.3, base + 3.55)],
              -hw - 0.2, hw + 0.2, "roof")
    mb.front_quad(0.01, -3.8, -1.0, base, base + 2.4, "frame")
    mb.front_quad(0.01, 1.0, 3.6, base + 1.2, base + 2.2, "glass")
    mb.box(-0.1, 0.05, -2.0, 2.0, base + 3.4, base + 4.7, "sign_face")
    word(mb, "FISH", 0.06, 0.0, base + 4.05, 0.17, "car_red")


def buoy_line(mb, rng):
    """Buoys hung on a line between two posts, every one its own colour: the village's bunting."""
    for x in (-2.0, 2.0):
        mb.box(-0.07, 0.07, x - 0.07, x + 0.07, 0.0, 2.0, "wood")
    mb.box(-0.02, 0.02, -2.0, 2.0, 1.86, 1.9, "frame")
    cols = ["car_red", "sign_face", "trim", "car_blue", "car_green", "car_red", "sign_face"]
    for k, mat in enumerate(cols):
        x = -1.5 + k * 0.5
        mb.cyl((x, 0.0, 1.45), "z", 0.13, 0.24, 6, mat)


# --- the resort strip (Lime Wedge Key) ---


def hotel(mb, paint):
    """A three-storey pastel hotel: balconies the length of its front, a door to each room, a
    parapet, and a HOTEL sign on the roof."""
    d, hw, floor = 8.0, 7.0, 3.1
    mb.box(-d, 0.0, -hw, hw, 0.0, 3 * floor, paint)
    mb.box(-d - 0.2, 0.2, -hw - 0.2, hw + 0.2, 3 * floor, 3 * floor + 0.35, "trim")
    for k in range(3):
        z = k * floor
        for x in (-5.4, -2.7, 0.0, 2.7, 5.4):
            mb.front_quad(0.01, x - 0.6, x + 0.6, z + 0.2, z + 2.3, "glass")
        if k > 0:
            mb.box(0.0, 1.2, -hw, hw, z - 0.15, z, "trim")
            mb.box(1.1, 1.2, -hw, hw, z + 0.85, z + 0.95, "trim")
    top = 3 * floor + 0.35
    for x in (-3.4, 3.4):
        mb.box(-1.0, -0.8, x - 0.08, x + 0.08, top, top + 0.6, "frame")
    mb.box(-0.9, -0.75, -3.8, 3.8, top + 0.6, top + 2.0, "sign_board")
    word(mb, "HOTEL", -0.74, 0.0, top + 1.3, 0.2, "trim")


def hotel_a(mb, rng):
    hotel(mb, "paint_pink")


def hotel_b(mb, rng):
    hotel(mb, "paint_blue")


def pool(mb, rng):
    """A pool deck: the pool, two loungers and two umbrellas."""
    mb.box(-5.6, 0.0, -4.4, 4.4, 0.0, 0.2, "deck")
    mb.box(-4.6, -1.0, -3.0, 3.0, 0.2, 0.24, "car_blue")
    for side in (-1, 1):
        x = side * 3.7
        mb.box(-4.6, -2.8, x - 0.3, x + 0.3, 0.2, 0.5, "seat")
        mb.xprism([(-4.6, 0.5), (-4.0, 0.5), (-4.6, 1.1)], x - 0.3, x + 0.3, "seat")
        mb.tube([(x, -1.6, 0.2), (x, -1.6, 2.4)], [0.04, 0.04], "frame", sides=3)
        mb.cone((x, -1.6, 2.35), 1.3, 2.9, 6, "car_yellow" if side < 0 else "car_green")


def tiki(mb, rng):
    """A tiki bar: a thatched roof on four posts over the counter, stools facing the road, a TIKI
    board under the eave."""
    for x in (-1.9, 1.9):
        for f in (-2.6, -0.1):
            mb.box(f - 0.1, f + 0.1, x - 0.1, x + 0.1, 0.0, 2.6, "wood")
    mb.box(-0.7, 0.0, -1.8, 1.8, 0.0, 1.1, "wood")
    mb.box(-0.8, 0.12, -1.9, 1.9, 1.1, 1.2, "coconut")
    mb.cone((0.0, -1.35, 2.75), 3.0, 4.4, 4, "coconut", phase=0.7853982, droop=0.35)
    for x in (-1.2, 0.0, 1.2):
        mb.cyl((x, 0.55, 0.38), "z", 0.17, 0.38, 5, "seat")
    mb.box(0.3, 0.38, -1.1, 1.1, 2.0, 2.55, "sign_board")
    word(mb, "TIKI", 0.39, 0.0, 2.27, 0.085, "car_yellow")


def scooters(mb, rng):
    """Four rental scooters in a row, noses to the road, and a RENT board on two posts."""
    for k, mat in enumerate(("car_yellow", "car_green", "car_blue", "paint_pink")):
        x = -3.0 + k * 1.3
        mb.box(-0.6, 0.6, x - 0.17, x + 0.17, 0.22, 0.42, mat)
        mb.box(-0.55, 0.0, x - 0.16, x + 0.16, 0.42, 0.7, mat)
        mb.box(-0.5, -0.05, x - 0.14, x + 0.14, 0.7, 0.78, "seat")
        mb.tube([(x, 0.55, 0.42), (x, 0.68, 1.12)], [0.05, 0.04], "chrome", sides=3)
        for f in (-0.5, 0.5):
            mb.box(f - 0.2, f + 0.2, x - 0.05, x + 0.05, 0.0, 0.32, "tyre")
    for x in (2.6, 4.2):
        mb.box(-0.05, 0.05, x - 0.05, x + 0.05, 0.0, 1.8, "wood")
    mb.box(-0.04, 0.04, 2.5, 4.3, 1.0, 1.75, "trim")
    word(mb, "RENT", 0.05, 3.4, 1.37, 0.1, "car_red")


# --- the junkyard key (Salvage Key) ---


def boat_stack(mb, rng):
    """Boat hulls racked three high on a steel frame."""
    for x in (-2.6, 2.6):
        for f in (-1.9, -0.1):
            mb.box(f - 0.08, f + 0.08, x - 0.08, x + 0.08, 0.0, 4.6, "frame")
    for k, mat in enumerate(("hull", "car_blue", "paint_yellow")):
        z = 0.35 + k * 1.5
        mb.box(-2.0, 0.0, -2.7, 2.7, z - 0.12, z, "frame")
        mb.fprism([(-3.0, z), (2.3, z), (3.2, z + 0.85), (-3.0, z + 0.8)], -1.85, -0.15, mat)


def bus_stack(mb, rng):
    """Two retired buses, one stacked on the other a little askew: a school-bus yellow and a
    church-bus mint, windows dark, wheels still on. Clean paint: no rust."""
    for k, (mat, dx) in enumerate((("paint_yellow", 0.0), ("paint_mint", 1.4))):
        z = 0.45 + k * 2.75
        mb.box(-2.5, 0.0, -5.0 + dx, 5.0 + dx, z, z + 2.6, mat)
        mb.front_quad(0.01, -4.4 + dx, 3.6 + dx, z + 1.5, z + 2.3, "glass")
        mb.front_quad(0.01, 4.1 + dx, 4.8 + dx, z + 0.3, z + 2.3, "glass")
        if k == 0:
            for x in (-3.4, 3.2):
                mb.box(-0.15, 0.05, x - 0.5, x + 0.5, 0.0, 1.0, "tyre")


def junk_art(mb, rng):
    """A deadpan junk-art robot on an ART plinth: drum legs, a fridge body, outboard-motor arms and
    a satellite-dish head."""
    mb.box(-1.0, 0.0, -1.2, 1.2, 0.0, 0.6, "stone")
    word(mb, "ART", 0.01, 0.0, 0.3, 0.07, "sign_board")
    for x in (-0.45, 0.45):
        mb.cyl((x, -0.5, 1.1), "z", 0.33, 0.5, 6, "car_blue")
    mb.box(-0.9, -0.1, -0.7, 0.7, 1.6, 3.4, "car_white")
    mb.front_quad(-0.09, -0.55, 0.55, 2.5, 2.55, "chrome")
    for side in (-1, 1):
        x = side * 0.95
        mb.box(-0.75, -0.25, x - 0.25, x + 0.25, 2.6, 3.3, "trim")
        mb.box(-0.6, -0.4, x - 0.08, x + 0.08, 1.9, 2.6, "frame")
    mb.tube([(0.0, -0.5, 3.4), (0.0, -0.5, 3.7)], [0.08, 0.08], "frame", sides=3)
    mb.cone((0.0, -0.4, 3.9), 0.7, 4.3, 6, "chrome")


# --- the party key (Last Resort Key), the morning after ---

BUNTING_LINE = [(-3.0, 2.9), (-1.5, 2.55), (0.0, 2.45), (1.5, 2.55), (3.0, 2.9)]


def bunting_sag(x):
    """The bunting line's height at x."""
    for (ax, az), (bx, bz) in zip(BUNTING_LINE, BUNTING_LINE[1:]):
        if ax <= x <= bx:
            return az + (bz - az) * (x - ax) / (bx - ax)
    return BUNTING_LINE[-1][1]


def bunting(mb, rng):
    """A 6 m run of bunting along x: two poles, a sagging line, pennants facing the road."""
    for x in (-3.0, 3.0):
        mb.box(-0.05, 0.05, x - 0.05, x + 0.05, 0.0, 3.0, "wood")
    mb.tube([(x, 0.0, z) for x, z in BUNTING_LINE], [0.02] * 5, "frame", sides=3)
    cols = ["car_red", "car_yellow", "car_blue", "paint_pink", "car_green"]
    for k in range(10):
        x0 = -2.85 + k * 0.58
        x1 = x0 + 0.42
        xm = (x0 + x1) / 2
        # wound like _lib's front_quad (counter-clockwise seen from the front), so it faces the road
        pts = [P(x0, 0.03, bunting_sag(x0)), P(xm, 0.03, bunting_sag(xm) - 0.5), P(x1, 0.03, bunting_sag(x1))]
        mb.tag([mb.bm.faces.new([mb.v(p) for p in pts])], cols[k % len(cols)], closed=False)


def coolers(mb, rng):
    """Coolers and a lawn chair where the party left them: one cooler on another, the chair down."""
    for x, z, mat in ((-0.9, 0.0, "car_blue"), (0.0, 0.0, "car_blue"), (0.0, 0.48, "car_red")):
        mb.box(-0.27, 0.27, x - 0.36, x + 0.36, z, z + 0.4, mat)
        mb.box(-0.29, 0.29, x - 0.38, x + 0.38, z + 0.4, z + 0.48, "car_white")
    mb.box(-0.2, 0.6, 0.8, 1.4, 0.0, 0.06, "frame")
    mb.box(-0.15, 0.55, 0.85, 1.35, 0.06, 0.1, "car_green")
    mb.box(0.6, 1.3, 0.85, 1.35, 0.0, 0.08, "car_green")
    mb.blob((-1.6, 0.4, 0.22), (0.22, 0.22, 0.22), "car_yellow")


def closed_bar(mb, rng):
    """The bar, closed: a shack with its shutters down, chairs up on the deck and a CLOSED board."""
    d, hw, base = 4.0, 3.2, 0.3
    mb.box(-d, 0.0, -hw, hw, 0.0, base + 3.0, "paint_yellow")
    mb.xprism([(-d - 0.3, base + 3.0), (1.6, base + 2.6), (1.6, base + 2.75), (-d - 0.3, base + 3.6)],
              -hw - 0.2, hw + 0.2, "roof")
    mb.front_quad(0.01, -2.5, 2.5, base + 1.0, base + 2.5, "body_alt")
    mb.box(0.0, 1.6, -hw, hw, 0.0, base, "wood")
    for x in (-1.8, 1.8):
        mb.box(0.5, 1.0, x - 0.25, x + 0.25, base, base + 0.75, "wood")
        mb.box(0.5, 1.0, x - 0.25, x + 0.25, base + 0.75, base + 1.45, "seat")
    mb.box(-0.6, -0.45, -2.5, 2.5, base + 3.4, base + 4.3, "trim")
    word(mb, "CLOSED", -0.44, 0.0, base + 3.85, 0.1, "car_red")


def flamingo(mb, rng):
    """A pool flamingo, deflated, face down on the sand."""
    mb.blob((0.0, 0.0, 0.22), (1.0, 0.7, 0.24), "paint_pink", jitter=0.1, rng=rng)
    mb.tube([(0.7, 0.1, 0.3), (1.2, 0.2, 0.75), (1.55, 0.3, 0.55), (1.7, 0.4, 0.2)], [0.14, 0.12, 0.1, 0.1],
            "paint_pink", sides=5)
    mb.blob((1.75, 0.45, 0.16), (0.18, 0.16, 0.14), "paint_pink")
    mb.box(0.5, 0.75, 1.82, 1.9, 0.0, 0.12, "tyre")


BUILDERS = {"seagrape": seagrape, "seagrape_tree": seagrape_tree, "traps": traps, "pelican": pelican,
            "trailer": trailer, "cottage_a": cottage_a, "cottage_b": cottage_b, "picket": picket,
            "mailbox": mailbox, "bait": bait, "pie": pie,
            "shrimp_boat": shrimp_boat, "fish_house": fish_house, "buoy_line": buoy_line,
            "hotel_a": hotel_a, "hotel_b": hotel_b, "pool": pool, "tiki": tiki, "scooters": scooters,
            "boat_stack": boat_stack, "bus_stack": bus_stack, "junk_art": junk_art,
            "bunting": bunting, "coolers": coolers, "closed_bar": closed_bar, "flamingo": flamingo}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    # Every part is a closed solid or a front-facing panel: nothing is double-sided.
    mats = _lib.make_mats(COLOURS)
    for k, (name, x) in enumerate(zip(VARIANTS, XS)):
        rng = random.Random(3000 + k)
        root = _lib.empty(f"keys_{name}", loc=(x, 0.0, 0.0))
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
        mb.build(f"keys_{name}_body", mats, root)
    _lib.export(out, normals=False)


main()
