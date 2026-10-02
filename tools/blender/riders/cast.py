"""The cast: one costume per rider, from each pack file's `look` (description and palette) and the
interview's "real proportions, loud costumes" (2026-10-02). Runs inside Blender's Python.

Each entry is (build parameters, costume function). The costume function dresses a `Rider`
(_rider_lib.py) and gives it its one prop, the thing it sheds when it is hurt. Colours are flat
and loud; no rust, grime or wear (the maintainer's veto). Every brand is invented.
"""

import math

import _rider_lib as R
from _rider_lib import L

SKIN_A = "#e7b08c"
SKIN_B = "#c98b62"
SKIN_C = "#9a6544"
SKIN_D = "#f0c9a6"


def player(r):
    r.body("cloth_a", "cloth_b", "boot", hands="glove")
    r.helmet("full", "helmet", stripe="trim")
    r.collar("cloth_a", high=True)
    r.belt("dark", buckle="metal")
    r.tail("trim", length=0.34)
    # A red stripe down the yellow back, so the player reads from the chase camera.
    for z in range(4):
        zz = (1.12 + 0.08 * z) * r.h
        p, n = r.torso_point(-math.pi / 2, zz, lift=0.008)
        r.quad("chest", p, L.P(0.035, 0, 0) - L.P(0, 0, 0), L.P(0, 0, 0.04) - L.P(0, 0, 0), n, "trim", detail=False)
    # A hip bag on the left hip (the back stays yellow): it flies off when you are hurt.
    r.prop_on_hips(
        lambda c: (
            r.box("prop", c, (0.08, 0.2, 0.15), "prop_a"),
            r.box("prop", (c[0] + 0.041, c[1], c[2] + 0.03), (0.01, 0.18, 0.06), "prop_b"),
        ),
        at=(0.19, -0.02, 0.98),
    )


def deacon_vane(r):
    r.body("cloth_c", "cloth_a", "boot", hands="glove", shoulders=0.95)
    r.collar("cloth_b")
    r.coat("cloth_a", length=0.82, flare=0.08, lapel="cloth_a")
    r.hair("cap", "hair")
    r.face(eyes="dark", brows="hair")
    r.beard("hair", "goatee")
    r.belt("dark", buckle="metal")
    # A bolo tie: the brass slide and two cords.
    r.box("chest", (0, 0.14 * r.b, 1.38 * r.h), (0.04, 0.012, 0.04), "metal", detail=True)
    r.prop_hat("cloth_a", band="cloth_c", brim=0.21, crown=0.098, height=0.12)


def chad_speedwell(r):
    r.body("cloth_b", "cloth_c", "boot", hands="glove", chest=0.02, shoulders=1.08)
    r.collar("cloth_b", high=True)
    r.helmet("open", "helmet", stripe="cloth_c")
    r.face(eyes="dark", brows="hair", grin="cloth_b")
    r.patches(["cloth_a", "cloth_c", "print"], 9, seed=11, size=0.035)
    r.belt("dark", buckle="metal")

    def gimbal(c):
        # A phone on a gimbal stick, clipped to the chest mount; he raises it to film himself.
        x, f, z = c
        r.tube("prop", [(x, f, z - 0.12), (x, f + 0.02, z + 0.14)], [0.014, 0.012], "dark", sides=4)
        r.box("prop", (x, f + 0.03, z + 0.2), (0.085, 0.012, 0.15), "dark")
        r.box("prop", (x, f + 0.037, z + 0.2), (0.07, 0.004, 0.13), "print")
        r.mb("prop").cyl((x, f + 0.05, z + 0.2), "f", 0.07, 0.006, 10, "cloth_a")

    r.prop_on_chest(gimbal, at=(-0.06, 0.15, 1.24))


def tammy_two_stroke(r):
    r.body("cloth_c", "cloth_a", "boot", sleeves="none", hands="skin", chest=0.03)
    r.spots("print", 34, seed=7)
    r.hair("beehive", "hair")
    r.face(eyes="dark", mouth="cloth_a")
    r.sunglasses("dark")
    # The sun visor: a band round the beehive's base and a bill.
    k = r.hs
    z = r.head_z(0.66)
    r.loft(
        "head",
        [R.ellipse(0, -0.01, z, 0.103 * k, 0.116 * k, n=10), R.ellipse(0, -0.01, z + 0.03, 0.103 * k, 0.116 * k, n=10)],
        "trim",
    )
    r.loft(
        "head",
        [
            [
                L.P(-0.08 * k, 0.1 * k, z + 0.015),
                L.P(0.08 * k, 0.1 * k, z + 0.015),
                L.P(0.07 * k, 0.19 * k, z),
                L.P(-0.07 * k, 0.19 * k, z),
            ],
            [
                L.P(-0.08 * k, 0.1 * k, z + 0.025),
                L.P(0.08 * k, 0.1 * k, z + 0.025),
                L.P(0.07 * k, 0.19 * k, z + 0.01),
                L.P(-0.07 * k, 0.19 * k, z + 0.01),
            ],
        ],
        "trim",
    )
    # A cigarette that never seems to burn down.
    fz = r.head_front(0.29, 0.0)
    r.tube(
        "head",
        [(0.02, fz, r.head_z(0.29)), (0.03, fz + 0.07, r.head_z(0.27))],
        [0.006, 0.006],
        "cloth_b",
        sides=3,
        detail=True,
    )
    r.belt("cloth_a", buckle="metal")

    def cooler(c):
        r.box("prop", (c[0], c[1] - 0.12, c[2] + 0.05), (0.2, 0.02, 0.04), "cloth_b")

    r.prop_box_on_seat((0.36, 0.26, 0.26), "trim", lid="cloth_b", extra=cooler)


def kevin_from_accounting(r):
    r.body("cloth_a", "cloth_c", "boot", sleeves="short", hands="skin", gut=0.025)
    r.collar("cloth_a")
    r.tie("cloth_b", length=0.3)
    r.lanyard("cloth_b", "trim")
    r.helmet("bowl", "helmet", stripe=None)
    r.face(eyes="dark", brows="hair")
    # Glasses: two rims and a bridge.
    k = r.hs
    fz = r.head_front(0.6, 0.006)
    for s in (1, -1):
        r.mb("head", True).cyl((s * 0.034 * k, fz, r.head_z(0.6)), "f", 0.022 * k, 0.004, 8, "dark")
    r.belt("dark", buckle="metal")

    def briefcase(c):
        r.box("prop", (c[0], c[1], c[2] + 0.17), (0.12, 0.03, 0.03), "dark")

    r.prop_box_on_seat((0.42, 0.1, 0.3), "prop_a", back=0.3, extra=briefcase)


def mother_rust(r):
    r.body("cloth_a", "cloth_c", "boot", hands="glove", gut=0.04, shoulders=1.1)
    r.waders("cloth_c")
    r.suspenders("cloth_c")
    r.coat("cloth_a", length=0.6, flare=0.05)
    r.patches(["cloth_b", "trim"], 8, seed=21, size=0.045)
    r.hair("cap", "hair")
    r.braid("hair", band="cloth_b", length=0.42)
    r.face(eyes="dark", brows="hair")
    r.necklace("trim", count=7)
    r.prop_bucket_hat("trim")


def dial_up(r):
    r.body("cloth_a", "dark", "boot", hands="skin")
    r.helmet("open", "helmet")
    r.face(eyes="dark", brows="hair")
    r.goggles("trim", "visor", on_helmet=True)
    # The coiled phone cord for a chin strap: a little helix under the chin.
    k = r.hs
    zc = r.head_z(0.0)
    pts = [
        (0.09 * k * math.cos(t), 0.02 + 0.02 * math.sin(t * 6), zc - 0.01 + 0.002 * t)
        for t in [math.pi * (0.15 + 0.7 * i / 13) for i in range(14)]
    ]
    r.tube("head", pts, [0.008] * len(pts), "dark", sides=3, detail=True)
    r.belt("dark")

    def modem(c):
        x, f, z = c
        for i in range(4):
            r.box("prop", (x - 0.09 + 0.06 * i, f + 0.081, z + 0.03), (0.02, 0.008, 0.012), "trim", detail=True)
        r.tube("prop", [(x + 0.1, f, z + 0.05), (x + 0.12, f - 0.02, z + 0.3)], [0.008, 0.006], "dark", sides=3)

    r.prop_box_on_seat((0.3, 0.16, 0.08), "prop_a", back=0.26, extra=modem)


def the_mayor(r):
    r.body("cloth_a", "cloth_a", "boot", hands="skin", gut=0.035)
    r.coat("cloth_a", length=0.3, flare=0.02, lapel="cloth_a")
    r.stripes("cloth_c", count=14, width=0.006)
    r.sash("cloth_b", letters="MAYOR", letter_role="trim")
    r.collar("cloth_a")
    r.tie("cloth_b", length=0.24, width=0.05)
    r.helmet("full", "helmet", stripe="trim", scale=1.22)
    r.belt("dark")
    r.prop_sign_on_pole("metal", "cloth_a", text="VOTE", text_role="cloth_b")


def sgt_pruitt(r):
    r.body("cloth_a", "cloth_b", "boot", hands="glove", gut=0.02)
    r.collar("cloth_a")
    r.badge("metal", at=(0.08, 1.33))
    r.helmet("open", "helmet", stripe="trim")
    r.face(eyes="dark", brows="hair")
    r.sunglasses("visor")
    r.beard("hair", "mustache")
    r.belt("dark", buckle="metal")
    r.gloves("glove")
    r.prop_on_hips(lambda c: r.box("prop", c, (0.05, 0.12, 0.17), "prop_a"))


def trooper_dalrymple(r):
    r.body("cloth_a", "cloth_b", "boot", hands="glove")
    r.collar("cloth_a")
    r.badge("metal", at=(0.08, 1.33))
    r.hair("cap", "hair")
    r.face(eyes="dark", brows="hair")
    r.sunglasses("visor")
    r.belt("dark", buckle="metal")
    r.gloves("glove")
    r.prop_hat("prop_a", band="dark", brim=0.2, crown=0.1, height=0.1, campaign=True)


def deputy_lindqvist(r):
    r.body("cloth_a", "cloth_b", "boot", hands="glove")
    r.collar("cloth_a", high=True)
    r.badge("metal", at=(0.08, 1.33))
    r.helmet("open", "helmet", stripe="trim")
    r.face(eyes="dark", brows="hair")
    r.hair("cap", "hair")
    r.belt("dark", buckle="metal")
    r.hood("cloth_a")

    def flashlight(c):
        x, f, z = c
        r.tube("prop", [(x, f, z - 0.08), (x, f, z + 0.12)], [0.025, 0.03], "dark", sides=6)

    r.prop_on_hips(flashlight)


def juniper_moss(r):
    r.body("cloth_a", "cloth_c", "boot", hands="glove", shoulders=0.95)
    r.collar("cloth_a", high=True)
    r.helmet("bowl", "helmet", stripe="cloth_a")
    r.face(eyes="dark", brows="hair")
    r.goggles("cloth_b", "visor", on_helmet=True)
    r.hood("cloth_a")
    r.belt("cloth_b")
    r.patches(["cloth_b"], 2, seed=4, size=0.03)

    def tumbler(c):
        x, f, z = c
        r.mb("prop").cyl((x, f, z), "z", 0.04, 0.085, 8, "cloth_b", r_top=0.045)
        r.mb("prop").cyl((x, f, z + 0.095), "z", 0.047, 0.012, 8, "dark")

    r.prop_on_hips(tumbler, at=(0.17, 0.02, 1.0))


def old_growth(r):
    r.body("cloth_a", "cloth_c", "boot", hands="glove", gut=0.05, shoulders=1.12)
    r.stripes("cloth_b", count=8, width=0.01, horizontal=5)
    r.suspenders("trim")
    r.helmet("bowl", "helmet", stripe="cloth_b")
    r.face(eyes="dark", brows="hair")
    r.beard("hair", "full")
    r.belt("dark", buckle="metal")

    def thermos(c):
        x, f, z = c
        r.mb("prop").cyl((x, f - 0.4, z + 0.18), "z", 0.06, 0.16, 8, "prop_a")
        r.mb("prop").cyl((x, f - 0.4, z + 0.36), "z", 0.045, 0.03, 8, "dark")

    r.prop_box_on_seat((0.18, 0.12, 0.04), "dark", back=0.2, extra=thermos)


def gripman_gus(r):
    r.body("cloth_c", "cloth_a", "boot", hands="glove", gut=0.045, shoulders=1.05)
    r.vest("cloth_a", trim="metal")
    r.collar("cloth_c")
    # A red neckerchief knotted at the throat.
    r.loft(
        "chest",
        [R.ellipse(0, 0.0, 1.44 * r.h, 0.09, 0.085, n=8), R.ellipse(0, 0.0, 1.47 * r.h, 0.085, 0.08, n=8)],
        "cloth_b",
    )
    r.hair("cap", "hair")
    r.face(eyes="dark", brows="hair")
    r.beard("hair", "mustache")
    # A gripman's cap.
    k = r.hs
    z = r.head_z(0.82)
    r.mb("head").cyl((0, -0.01, z + 0.03), "z", 0.1 * k, 0.04, 10, "cloth_a")
    r.loft(
        "head",
        [
            [
                L.P(-0.07 * k, 0.08 * k, z),
                L.P(0.07 * k, 0.08 * k, z),
                L.P(0.06 * k, 0.16 * k, z - 0.02),
                L.P(-0.06 * k, 0.16 * k, z - 0.02),
            ],
            [
                L.P(-0.07 * k, 0.08 * k, z + 0.012),
                L.P(0.07 * k, 0.08 * k, z + 0.012),
                L.P(0.06 * k, 0.16 * k, z - 0.008),
                L.P(-0.06 * k, 0.16 * k, z - 0.008),
            ],
        ],
        "dark",
    )

    def bell(c):
        # A brass bell on a strap round his neck: it swings before he hits.
        x, f, z = c
        r.tube("prop", [(x, f, z), (x, f + 0.02, z - 0.1)], [0.008, 0.008], "dark", sides=3)
        r.mb("prop").cone((x, f + 0.025, z - 0.24), 0.075, z - 0.1, 8, "metal")
        r.blob("prop", (x, f + 0.025, z - 0.255), (0.02, 0.02, 0.02), "dark")

    r.prop_on_chest(bell, at=(0.0, 0.15, 1.44))


def pivot(r):
    r.body("cloth_c", "cloth_b", "boot", hands="skin", shoulders=0.95)
    r.vest("cloth_a")
    r.collar("cloth_c")
    r.helmet("bowl", "helmet", stripe="cloth_a")
    r.face(eyes="dark", brows="hair")
    r.hair("cap", "hair")
    # White earbuds.
    k = r.hs
    for s in (1, -1):
        r.blob("head", (s * 0.09 * k, 0.0, r.head_z(0.5)), (0.012, 0.012, 0.012), "trim", detail=True)

    def headset(c):
        # A mixed-reality headset pushed up on his helmet.
        x, f, z = c
        r.box("prop", (x, f + 0.12 * k, z + 0.02), (0.17 * k, 0.07, 0.07), "dark")
        r.box("prop", (x, f + 0.157 * k, z + 0.02), (0.15 * k, 0.006, 0.05), "visor")
        r.tube(
            "prop",
            [
                (0.11 * k, f + 0.08, z + 0.02),
                (0.12 * k, f - 0.08, z + 0.03),
                (-0.12 * k, f - 0.08, z + 0.03),
                (-0.11 * k, f + 0.08, z + 0.02),
            ],
            [0.01] * 4,
            "cloth_a",
            sides=3,
        )

    r.prop_on_head(headset, at=0.85)


def officer_meter(r):
    r.body("cloth_a", "cloth_b", "boot", hands="glove")
    r.vest("trim", trim="metal")
    r.collar("cloth_a")
    r.hair("cap", "hair")
    r.face(eyes="dark", brows="hair")
    # A peaked cap with a white top.
    k = r.hs
    z = r.head_z(0.84)
    r.mb("head").cyl((0, -0.01, z + 0.035), "z", 0.105 * k, 0.04, 10, "cloth_b", r_top=0.12 * k)
    r.mb("head").cyl((0, -0.01, z + 0.08), "z", 0.122 * k, 0.008, 10, "helmet")
    r.loft(
        "head",
        [
            [
                L.P(-0.07 * k, 0.09 * k, z),
                L.P(0.07 * k, 0.09 * k, z),
                L.P(0.06 * k, 0.165 * k, z - 0.02),
                L.P(-0.06 * k, 0.165 * k, z - 0.02),
            ],
            [
                L.P(-0.07 * k, 0.09 * k, z + 0.012),
                L.P(0.07 * k, 0.09 * k, z + 0.012),
                L.P(0.06 * k, 0.165 * k, z - 0.008),
                L.P(-0.06 * k, 0.165 * k, z - 0.008),
            ],
        ],
        "dark",
    )
    r.belt("dark", buckle="metal")

    def printer(c):
        # The ticket printer on his belt, a ticket half out.
        x, f, z = c
        r.box("prop", (x, f, z), (0.07, 0.14, 0.1), "prop_a")
        r.box("prop", (x, f + 0.02, z + 0.08), (0.05, 0.004, 0.08), "trim")

    r.prop_on_hips(printer)


# Each rider: (height, bulk, head, colours, costume). Heights and bulks are "real proportions";
# the palettes are each pack file's `look.palette`, or invented here where the pack has none.
CAST = {
    "player": (
        1.0,
        1.0,
        1.0,
        {
            "skin": SKIN_A,
            "hair": "#3b2a1e",
            "cloth_a": "#f2c14e",
            "cloth_b": "#4a6fa5",
            "cloth_c": "#4a6fa5",
            "trim": "#b8322a",
            "boot": "#1e1e22",
            "glove": "#2a2a2e",
            "helmet": "#fff3c4",
            "visor": "#20242c",
            "metal": "#c9cfd6",
            "dark": "#1b1b1f",
            "prop_a": "#4a6b3a",
            "prop_b": "#2f4426",
        },
        player,
    ),
    "deacon-vane": (
        1.07,
        0.95,
        1.0,
        {
            "skin": SKIN_D,
            "hair": "#4a4540",
            "cloth_a": "#1b1b1f",
            "cloth_b": "#e8e1cf",
            "cloth_c": "#7a1f1f",
            "boot": "#2a1d17",
            "glove": "#1b1b1f",
            "metal": "#b08d3c",
            "dark": "#141414",
            "trim": "#b08d3c",
        },
        deacon_vane,
    ),
    "chad-speedwell": (
        1.0,
        1.02,
        1.0,
        {
            "skin": "#d9925f",
            "hair": "#e8c46a",
            "cloth_a": "#ff3d7f",
            "cloth_b": "#f4f4f4",
            "cloth_c": "#1a73e8",
            "print": "#ffd23f",
            "boot": "#f4f4f4",
            "glove": "#1a73e8",
            "helmet": "#ff3d7f",
            "visor": "#20242c",
            "metal": "#ffd23f",
            "dark": "#18181c",
        },
        chad_speedwell,
    ),
    "tammy-two-stroke": (
        0.97,
        0.98,
        1.0,
        {
            "skin": SKIN_A,
            "hair": "#f1e2b4",
            "cloth_a": "#c0392b",
            "cloth_b": "#f5e6c8",
            "cloth_c": "#d9a35a",
            "print": "#2b2b2b",
            "trim": "#3fa7a0",
            "boot": "#f5e6c8",
            "metal": "#d9d9d9",
            "dark": "#2b2b2b",
        },
        tammy_two_stroke,
    ),
    "kevin-from-accounting": (
        0.96,
        1.0,
        1.0,
        {
            "skin": SKIN_D,
            "hair": "#6b4a2e",
            "cloth_a": "#e9e4d4",
            "cloth_b": "#2c3e66",
            "cloth_c": "#8c8c8c",
            "trim": "#c9a227",
            "boot": "#5a3a22",
            "helmet": "#e9e4d4",
            "metal": "#c9a227",
            "dark": "#1e1e22",
            "prop_a": "#6b4a2e",
        },
        kevin_from_accounting,
    ),
    "mother-rust": (
        1.0,
        1.28,
        1.02,
        {
            "skin": SKIN_B,
            "hair": "#b5b2a8",
            "cloth_a": "#4b5a2a",
            "cloth_b": "#8b3a1a",
            "cloth_c": "#1f2a1f",
            "trim": "#d8c9a3",
            "boot": "#1f2a1f",
            "glove": "#8b3a1a",
            "metal": "#b0b0b0",
            "dark": "#1b1b1b",
        },
        mother_rust,
    ),
    "dial-up": (
        0.94,
        0.82,
        1.05,
        {
            "skin": SKIN_D,
            "hair": "#3b2a1e",
            "cloth_a": "#2f6f3e",
            "trim": "#f0f0f0",
            "boot": "#e04e2b",
            "helmet": "#d9d2b6",
            "visor": "#e04e2b",
            "dark": "#1e1e1e",
            "prop_a": "#d9d2b6",
            "metal": "#b0b0b0",
        },
        dial_up,
    ),
    "the-mayor": (
        1.0,
        1.08,
        1.0,
        {
            "skin": SKIN_D,
            "hair": "#cfcfcf",
            "cloth_a": "#f2ead3",
            "cloth_b": "#a3242d",
            "cloth_c": "#8fb0d9",
            "trim": "#f4c430",
            "boot": "#3a2a1e",
            "helmet": "#2a4d8f",
            "visor": "#1d2433",
            "metal": "#c9cfd6",
            "dark": "#1e1e22",
        },
        the_mayor,
    ),
    "sgt-pruitt": (
        1.0,
        1.06,
        1.0,
        {
            "skin": SKIN_A,
            "hair": "#5a4030",
            "cloth_a": "#c8b48a",
            "cloth_b": "#4a3a26",
            "trim": "#2a4d8f",
            "boot": "#151515",
            "glove": "#151515",
            "helmet": "#f4f4f4",
            "visor": "#2b2f36",
            "metal": "#e0c050",
            "dark": "#151515",
            "prop_a": "#2a2a2a",
        },
        sgt_pruitt,
    ),
    "trooper-dalrymple": (
        1.04,
        1.0,
        1.0,
        {
            "skin": SKIN_C,
            "hair": "#1e1a17",
            "cloth_a": "#7f8a96",
            "cloth_b": "#2e3540",
            "boot": "#121212",
            "glove": "#121212",
            "visor": "#2b2f36",
            "metal": "#e0c050",
            "dark": "#121212",
            "prop_a": "#b89a6a",
        },
        trooper_dalrymple,
    ),
    "deputy-lindqvist": (
        1.02,
        1.0,
        1.0,
        {
            "skin": SKIN_D,
            "hair": "#d8c27a",
            "cloth_a": "#2f5a3a",
            "cloth_b": "#3a3a33",
            "trim": "#e0c050",
            "boot": "#151515",
            "glove": "#151515",
            "helmet": "#f4f4f4",
            "metal": "#e0c050",
            "dark": "#151515",
        },
        deputy_lindqvist,
    ),
    "juniper-moss": (
        0.98,
        0.88,
        1.12,
        {
            "skin": SKIN_A,
            "hair": "#7a3b22",
            "cloth_a": "#13a89e",
            "cloth_b": "#e0457b",
            "cloth_c": "#3a3a40",
            "boot": "#5a3a22",
            "glove": "#3a3a40",
            "helmet": "#f4f1e8",
            "visor": "#2b2f36",
            "dark": "#1e1e22",
        },
        juniper_moss,
    ),
    "old-growth": (
        1.03,
        1.36,
        1.1,
        {
            "skin": SKIN_B,
            "hair": "#6b3f22",
            "cloth_a": "#d63a1f",
            "cloth_b": "#1d2a22",
            "cloth_c": "#2c4a6b",
            "trim": "#1d2a22",
            "boot": "#4a2e1a",
            "glove": "#c8a050",
            "helmet": "#f2c14e",
            "metal": "#c9cfd6",
            "dark": "#151515",
            "prop_a": "#2f6f3e",
        },
        old_growth,
    ),
    "gripman-gus": (
        1.0,
        1.18,
        1.05,
        {
            "skin": SKIN_A,
            "hair": "#9a9a9a",
            "cloth_a": "#1f2f5a",
            "cloth_b": "#c0392b",
            "cloth_c": "#f4f1e8",
            "boot": "#151515",
            "glove": "#f4f1e8",
            "metal": "#d4a933",
            "dark": "#151515",
        },
        gripman_gus,
    ),
    "pivot": (
        0.98,
        0.9,
        1.0,
        {
            "skin": SKIN_D,
            "hair": "#2a1d14",
            "cloth_a": "#3a3f4a",
            "cloth_b": "#c9c3b5",
            "cloth_c": "#e8e8ea",
            "trim": "#fafafa",
            "boot": "#fafafa",
            "helmet": "#1c1c1f",
            "visor": "#3cc8d8",
            "dark": "#141416",
        },
        pivot,
    ),
    "officer-meter": (
        0.99,
        1.05,
        1.0,
        {
            "skin": SKIN_C,
            "hair": "#1e1a17",
            "cloth_a": "#2b3a55",
            "cloth_b": "#1d2433",
            "trim": "#c8f03c",
            "boot": "#121212",
            "glove": "#121212",
            "helmet": "#f4f4f4",
            "metal": "#d0d0d0",
            "dark": "#121212",
            "prop_a": "#3a3a3a",
        },
        officer_meter,
    ),
}


def build(rider_id, out):
    height, bulk, head, colours, costume = CAST[rider_id]
    r = R.Rider(rider_id, colours, height=height, bulk=bulk, head=head)
    costume(r)
    r.finish(out)
