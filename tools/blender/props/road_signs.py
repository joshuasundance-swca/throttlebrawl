"""throttlebrawl prop: two blank roadside signs; the game draws the words on them.

Run: blender --background --factory-startup --python-exit-code 1 --python road_signs.py -- --out <path>.glb

Two variant roots on the ground: `sign_a` at x = -2.5, a faded green highway sign on two
galvanised posts, and `sign_b` at x = +2.5, a hand-painted plywood board on two wooden
stakes. Each variant has a text surface (`sign_a_face`, `sign_b_face`: a flat panel facing
glTF +Z with a 0..1 UV map and the extras `text_surface`, `width_m`, `height_m`) and one
support mesh (`sign_a_posts`, `sign_b_stakes`). Two draws per variant.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _lib  # noqa: E402

# ---------------------------------------------------------------- tuning
VARIANTS = [
    # face size (m), face centre height (m), support material, post half-gap (x), post size,
    # face thickness, face material
    dict(name="sign_a", x=-2.5, w=2.6, h=1.3, z=2.75, face="sign_face", posts="frame", gap=0.8, post=0.08,
         t=0.05, supports="posts"),
    dict(name="sign_b", x=2.5, w=1.7, h=0.95, z=1.05, face="sign_board", posts="wood", gap=0.6, post=0.1,
         t=0.04, supports="stakes"),
]

COLOURS = {
    "sign_face": "#2f6a50",    # faded highway green (the game paints the white words)
    "frame": "#9aa1a4",        # galvanised steel posts
    "sign_board": "#d8c9a6",   # sun-bleached plywood
    "wood": "#6d5c4a",         # stakes
}


def main():
    out = _lib.out_path()
    _lib.reset_scene()
    mats = _lib.make_mats(COLOURS, rough={"frame": 0.5})
    for p in VARIANTS:
        root = _lib.empty(p["name"], loc=(p["x"], 0.0, 0.0))
        _lib.text_panel(f"{p['name']}_face", mats, p["face"], root, p["w"], p["h"], (0.0, 0.0, p["z"]),
                        thickness=p["t"])
        mb = _lib.MB([p["posts"]])
        s = p["post"] / 2
        top = p["z"] + p["h"] / 2 - 0.08
        for x in (-p["gap"], p["gap"]):
            # posts stand just behind the panel, from the ground to near its top edge
            mb.box(-p["t"] - 2 * s, -p["t"], x - s, x + s, 0.0, top, p["posts"])
        mb.build(f"{p['name']}_{p['supports']}", mats, root)
    _lib.export(out, texcoords=True)


main()
