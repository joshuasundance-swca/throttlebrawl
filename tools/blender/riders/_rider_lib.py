"""Rider construction: a segmented low-poly figure on a flat rig (runs inside Blender's Python).

Every rider is built the same way (tools/blender/riders/README.md has the contract):

- One root empty, `rider`, on the ground under the feet. The figure stands at rest, facing the
  front (glTF +Z), arms down in a slight A, legs straight.
- Sixteen bone empties, all direct children of `rider`, at their joints (BONES below). Every mesh
  is a child of exactly one bone, and moves rigidly with it: the game skins each vertex to the
  bone its mesh hangs from (src/render/riders/bake.ts), so a whole rider is one draw call.
- Four marker empties the game measures limbs with: `grip_l`/`grip_r` (palm centres, under the
  forearms) and `ankle_l`/`ankle_r` (under the shins).
- Flap bones carry clothing the wind moves: `coat_l`/`coat_r` (coat tails, hinged at the back of
  the waist), `tie`, `hair` (a braid, a hood, a bandana tail). `prop` carries the one prop a hurt
  rider sheds; the root's `prop_mount` extra says what it rides on (head, chest, hips or the
  bike's seat).
- Meshes with the `detail` extra are small trims (faces, prints, letters) the game drops far away.
- Flat colours by role, faceted, triangulated, exported without normals; nothing reads the clock.

Helpers take points as (x, f, z): x toward the rider's left, f forward, z up (as props/_lib.py).
"""

import math
import random
import sys
from pathlib import Path

import bmesh
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "props"))
import _lib as L  # noqa: E402

BONES = (
    "hips",
    "chest",
    "head",
    "upper_arm_l",
    "forearm_l",
    "upper_arm_r",
    "forearm_r",
    "thigh_l",
    "shin_l",
    "thigh_r",
    "shin_r",
    "coat_l",
    "coat_r",
    "tie",
    "hair",
    "prop",
)
MARKERS = ("grip_l", "grip_r", "ankle_l", "ankle_r")
PROP_MOUNTS = ("head", "chest", "hips", "seat")

# Every role a rider may use. The colours come from each rider's spec (cast.py).
ROLES = (
    "skin",
    "hair",
    "cloth_a",
    "cloth_b",
    "cloth_c",
    "trim",
    "boot",
    "glove",
    "helmet",
    "visor",
    "metal",
    "print",
    "prop_a",
    "prop_b",
    "dark",
)

BLOCK = {
    "A": ("010", "101", "111", "101", "101"),
    "E": ("111", "100", "110", "100", "111"),
    "M": ("101", "111", "101", "101", "101"),
    "O": ("111", "101", "101", "101", "111"),
    "R": ("110", "101", "110", "101", "101"),
    "T": ("111", "010", "010", "010", "010"),
    "V": ("101", "101", "101", "101", "010"),
    "Y": ("101", "101", "010", "010", "010"),
}


def ellipse(cx, cf, cz, rx, rf, n=8, front=0.0, back=0.0):
    """A horizontal ring of n points; `front`/`back` push that half out (a belly, a coat's tail)."""
    pts = []
    for i in range(n):
        a = math.pi / n + 2 * math.pi * i / n
        s = math.sin(a)
        f = cf + rf * s + (front * s if s > 0 else back * s)
        pts.append(L.P(cx + rx * math.cos(a), f, cz))
    return pts


class Rider:
    """One rider being built. `h` scales heights, `b` widths (bulk), `hs` the head."""

    def __init__(self, rider_id, colours, height=1.0, bulk=1.0, head=1.0, seed=1):
        L.reset_scene()
        self.id = rider_id
        self.h, self.b, self.hs = height, bulk, head
        self.rng = random.Random(seed)
        cols = {r: "#ff00ff" for r in ROLES}
        cols.update(colours)
        self.mats = L.make_mats(cols)
        self.roles = list(ROLES)
        self.root = L.empty("rider")
        self.root["rider_id"] = rider_id
        self.root["height_m"] = round(1.78 * height, 3)
        h, b = height, bulk
        self.joint = {
            "hips": (0.0, 0.0, 0.97 * h),
            "chest": (0.0, 0.0, 1.08 * h),
            "head": (0.0, 0.0, 1.49 * h),
            "upper_arm_l": (0.19 * b, 0.0, 1.43 * h),
            "forearm_l": (0.215 * b, -0.01, 1.14 * h),
            "upper_arm_r": (-0.19 * b, 0.0, 1.43 * h),
            "forearm_r": (-0.215 * b, -0.01, 1.14 * h),
            "thigh_l": (0.095 * b, 0.0, 0.92 * h),
            "shin_l": (0.1 * b, 0.01, 0.5 * h),
            "thigh_r": (-0.095 * b, 0.0, 0.92 * h),
            "shin_r": (-0.1 * b, 0.01, 0.5 * h),
            "coat_l": (0.11 * b, -0.11 * b, 1.07 * h),
            "coat_r": (-0.11 * b, -0.11 * b, 1.07 * h),
            "tie": (0.0, 0.1 * b, 1.44 * h),
            "hair": (0.0, -0.085 * head, 1.66 * h),
            "prop": (0.0, 0.0, 1.3 * h),
        }
        self.marker = {
            "grip_l": ("forearm_l", (0.225 * b, 0.0, 0.84 * h)),
            "grip_r": ("forearm_r", (-0.225 * b, 0.0, 0.84 * h)),
            "ankle_l": ("shin_l", (0.1 * b, 0.0, 0.085 * h)),
            "ankle_r": ("shin_r", (-0.1 * b, 0.0, 0.085 * h)),
        }
        self.prop_mount = "chest"
        self.parts = {}
        # Torso rings (z, rx, rf, front) for placing prints on its surface.
        self.torso_rings = []

    # ---- building blocks -------------------------------------------------------------

    def z(self, k):
        return k * self.h

    def mb(self, bone, detail=False):
        key = (bone, detail)
        if key not in self.parts:
            self.parts[key] = L.MB(self.roles)
        return self.parts[key]

    def loft(self, bone, rings, role, detail=False):
        return self.mb(bone, detail).loft(rings, role)

    def tube(self, bone, pts, radii, role, sides=6, detail=False):
        return self.mb(bone, detail).tube(pts, radii, role, sides=sides)

    def box(self, bone, centre, size, role, detail=False):
        x, f, z = centre
        sx, sf, sz = size
        return self.mb(bone, detail).box(f - sf / 2, f + sf / 2, x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2, role)

    def blob(self, bone, centre, radii, role, detail=False):
        return self.mb(bone, detail).blob(centre, radii, role)

    def quad(self, bone, centre, u, v, normal, role, detail=True):
        """A flat quad: centre +- u +- v (Blender vectors), wound to face `normal`."""
        mb = self.mb(bone, detail)
        c = Vector(centre)
        vs = [mb.v(c - u - v), mb.v(c + u - v), mb.v(c + u + v), mb.v(c - u + v)]
        face = mb.bm.faces.new(vs)
        face.material_index = self.roles.index(role)
        face.smooth = False
        face.normal_update()
        if face.normal.dot(Vector(normal)) < 0:
            face.normal_flip()
        return face

    def torso_point(self, angle, z, lift=0.006):
        """A point on the torso's surface at a height and an angle (0 = left, pi/2 = front)."""
        rings = self.torso_rings
        for (z0, rx0, rf0, fr0), (z1, rx1, rf1, fr1) in zip(rings, rings[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / max(1e-6, z1 - z0)
                rx, rf, fr = rx0 + (rx1 - rx0) * t, rf0 + (rf1 - rf0) * t, fr0 + (fr1 - fr0) * t
                break
        else:
            _, rx, rf, fr = rings[-1]
        s = math.sin(angle)
        x = (rx + lift) * math.cos(angle)
        f = (rf + lift) * s + (fr * s if s > 0 else 0.0)
        n = Vector((math.cos(angle) / max(rx, 1e-3), -s / max(rf, 1e-3), 0.0)).normalized()
        return L.P(x, f, z), n

    # ---- the body ----------------------------------------------------------------------

    def body(self, top, bottom, boots, sleeves="long", hands="skin", gut=0.0, chest=0.0, shoulders=1.0):
        """The whole figure: pelvis, torso, neck, head, arms and legs, in their roles."""
        h, b = self.h, self.b
        # Pelvis (hips bone), crotch to waist.
        self.loft(
            "hips",
            [
                ellipse(0, 0, 0.84 * h, 0.115 * b, 0.085 * b),
                ellipse(0, 0, 0.94 * h, 0.155 * b, 0.105 * b, front=gut * 0.5),
                ellipse(0, 0, 1.1 * h, 0.15 * b, 0.1 * b, front=gut),
            ],
            bottom,
        )
        # Torso (chest bone), waist to the base of the neck.
        rings = [
            (1.04 * h, 0.15 * b, 0.1 * b, gut),
            (1.2 * h, 0.165 * b, 0.115 * b, gut * 0.8 + chest * 0.3),
            (1.33 * h, 0.19 * b * shoulders, 0.125 * b, chest),
            (1.44 * h, 0.2 * b * shoulders, 0.105 * b, chest * 0.3),
            (1.5 * h, 0.075, 0.07, 0.0),
        ]
        self.torso_rings = [(z, rx, rf, fr) for z, rx, rf, fr in rings]
        self.loft("chest", [ellipse(0, 0, z, rx, rf, front=fr) for z, rx, rf, fr in rings], top)
        # Neck and head (head bone).
        self.tube("head", [(0, 0.0, 1.46 * h), (0, 0.005, 1.57 * h)], [0.052, 0.048], "skin", sides=6)
        self.head_shape()
        # Arms: upper arm, forearm (with the hand) per side.
        for side, s in (("l", 1), ("r", -1)):
            sh = self.joint[f"upper_arm_{side}"]
            el = self.joint[f"forearm_{side}"]
            gr = self.marker[f"grip_{side}"][1]
            wrist = (gr[0] - s * 0.002, gr[1], gr[2] + 0.06 * h)
            upper_role = top if sleeves in ("long", "short") else "skin"
            self.tube(f"upper_arm_{side}", [sh, el], [0.058 * b, 0.046 * b], upper_role, sides=6)
            self.blob(f"upper_arm_{side}", el, (0.05 * b, 0.05 * b, 0.05 * b), upper_role)
            fore_role = top if sleeves == "long" else "skin"
            self.tube(f"forearm_{side}", [el, wrist], [0.045 * b, 0.036 * b], fore_role, sides=6)
            self.blob(f"forearm_{side}", (gr[0], gr[1] + 0.005, gr[2] + 0.01), (0.042, 0.05, 0.058), hands)
            # Legs: thigh and shin, a knee cap, and the boot.
            hp = self.joint[f"thigh_{side}"]
            kn = self.joint[f"shin_{side}"]
            an = self.marker[f"ankle_{side}"][1]
            self.tube(f"thigh_{side}", [hp, kn], [0.08 * b, 0.058 * b], bottom, sides=6)
            self.blob(f"thigh_{side}", kn, (0.058 * b, 0.06 * b, 0.055 * b), bottom)
            self.tube(f"shin_{side}", [kn, (an[0], an[1], an[2] + 0.1 * h)], [0.055 * b, 0.045 * b], bottom, sides=6)
            x = an[0]
            self.loft(
                f"shin_{side}",
                [
                    [
                        L.P(x - 0.05, -0.06, 0.0),
                        L.P(x + 0.05, -0.06, 0.0),
                        L.P(x + 0.05, -0.06, an[2] + 0.13 * h),
                        L.P(x - 0.05, -0.06, an[2] + 0.13 * h),
                    ],
                    [
                        L.P(x - 0.055, 0.06, 0.0),
                        L.P(x + 0.055, 0.06, 0.0),
                        L.P(x + 0.05, 0.06, an[2] + 0.06),
                        L.P(x - 0.05, 0.06, an[2] + 0.06),
                    ],
                    [
                        L.P(x - 0.05, 0.17, 0.0),
                        L.P(x + 0.05, 0.17, 0.0),
                        L.P(x + 0.045, 0.17, 0.05),
                        L.P(x - 0.045, 0.17, 0.05),
                    ],
                ],
                boots,
            )

    def head_shape(self, role="skin"):
        h, k = self.h, self.hs
        zc = 1.5 * h
        self.loft("head", [ellipse(0, cf * k, zc + z * k, rx * k, rf * k) for z, rx, rf, cf in self.HEAD_RINGS], role)

    HEAD_RINGS = (
        (0.03, 0.05, 0.05, 0.035),
        (0.08, 0.078, 0.088, 0.015),
        (0.15, 0.088, 0.103, 0.0),
        (0.21, 0.083, 0.098, -0.005),
        (0.26, 0.045, 0.06, -0.01),
    )

    def head_z(self, k):
        """A height on the head: 0 at the chin, 1 at the crown."""
        return 1.5 * self.h + (0.03 + 0.23 * k) * self.hs

    def head_front(self, k, out=0.004):
        """How far forward the head's flat front face is at height k (0 chin, 1 crown)."""
        z = 0.03 + 0.23 * k
        rings = self.HEAD_RINGS
        for (z0, _, rf0, cf0), (z1, _, rf1, cf1) in zip(rings, rings[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / (z1 - z0)
                rf, cf = rf0 + (rf1 - rf0) * t, cf0 + (cf1 - cf0) * t
                break
        else:
            rf, cf = rings[-1][2], rings[-1][3]
        return (0.924 * rf + cf) * self.hs + out

    def face(self, eyes="dark", mouth="dark", brows=None, nose=True, grin=None):
        """Eyes, a nose, a mouth (and a grin's teeth), as small detail parts on the head."""
        k = self.hs
        n = Vector((0, -1, 0))
        u = Vector((0.016 * k, 0, 0))
        v = Vector((0, 0, 0.011 * k))
        for s in (1, -1):
            self.quad("head", L.P(s * 0.033 * k, self.head_front(0.6), self.head_z(0.6)), u, v, n, eyes)
            if brows:
                self.quad(
                    "head", L.P(s * 0.035 * k, self.head_front(0.7), self.head_z(0.7)), u * 1.3, v * 0.5, n, brows
                )
        if nose:
            fz = self.head_front(0.5, 0.0)
            self.mb("head", True).hull(
                [
                    (0.0, fz + 0.03 * k, self.head_z(0.42)),
                    (0.016 * k, fz - 0.004, self.head_z(0.42)),
                    (-0.016 * k, fz - 0.004, self.head_z(0.42)),
                    (0.0, fz - 0.004, self.head_z(0.6)),
                ],
                "skin",
            )
        if grin:
            self.quad("head", L.P(0, self.head_front(0.29), self.head_z(0.29)), u * 2.0, v * 0.75, n, grin)
        elif mouth:
            self.quad("head", L.P(0, self.head_front(0.29), self.head_z(0.29)), u * 1.5, v * 0.35, n, mouth)

    # ---- headgear and hair ----------------------------------------------------------------

    def helmet(self, kind, role, visor="visor", stripe=None, scale=1.0):
        """A helmet: `full` (a visor across the face), `open` (face showing) or `bowl` (a low shell)."""
        k = self.hs * scale
        zc = self.head_z(0.0)
        low = {"full": 0.0, "open": 0.36, "bowl": 0.5}[kind]
        # An open shell pulls its front in below the brow, so the face shows through.
        cut = 0.0 if kind == "full" else 0.06 * k
        rings = [
            ellipse(0, 0.0, zc + (low * 0.23) * k, 0.112 * k, 0.13 * k, n=10, front=-cut),
            ellipse(0, -0.005, zc + 0.155 * k, 0.12 * k, 0.138 * k, n=10, front=-cut * 0.75),
            ellipse(0, -0.01, zc + 0.22 * k, 0.108 * k, 0.126 * k, n=10),
            ellipse(0, -0.015, zc + 0.285 * k, 0.07 * k, 0.085 * k, n=10),
            ellipse(0, -0.02, zc + 0.31 * k, 0.02 * k, 0.025 * k, n=10),
        ]
        if kind == "full":
            rings.insert(0, ellipse(0, 0.02, zc - 0.03 * k, 0.1 * k, 0.12 * k, n=10))
        self.loft("head", rings, role)
        if kind == "full":
            # The visor: a curved band across the eyes, standing just proud of the shell.
            self.loft(
                "head",
                [
                    [
                        L.P(0.1 * k * math.cos(a), 0.135 * k * math.sin(a) + 0.002, zc + 0.12 * k)
                        for a in [math.radians(d) for d in range(25, 160, 22)]
                    ],
                    [
                        L.P(0.104 * k * math.cos(a), 0.14 * k * math.sin(a) + 0.004, zc + 0.19 * k)
                        for a in [math.radians(d) for d in range(25, 160, 22)]
                    ],
                ],
                visor,
            )
        if stripe:
            self.tube(
                "head",
                [
                    (0, 0.13 * k, zc + 0.2 * k),
                    (0, 0.06 * k, zc + 0.3 * k),
                    (0, -0.07 * k, zc + 0.3 * k),
                    (0, -0.135 * k, zc + 0.16 * k),
                ],
                [0.022 * k] * 4,
                stripe,
                sides=4,
                detail=True,
            )

    def goggles(self, strap, lens, z=0.62, on_helmet=False):
        k = self.hs
        r = 0.122 if on_helmet else 0.1
        zc = self.head_z(z + (0.12 if on_helmet else 0.0))
        pts = [
            (r * k * math.cos(a), r * k * 1.12 * math.sin(a), zc)
            for a in [math.radians(d) for d in range(-200, 30, 23)]
        ]
        self.tube("head", pts, [0.012 * k] * len(pts), strap, sides=4)
        for s in (1, -1):
            self.mb("head").cyl((s * 0.036 * k, r * k * 1.12 + 0.004, zc), "f", 0.026 * k, 0.012, 8, lens)

    def sunglasses(self, role):
        k = self.hs
        zc = self.head_z(0.6)
        f = 0.105 * k
        for s in (1, -1):
            self.box("head", (s * 0.037 * k, f, zc), (0.05 * k, 0.012, 0.034 * k), role)
        self.box("head", (0, f, zc + 0.008), (0.03 * k, 0.01, 0.008), role)

    def hair(self, kind, role):
        """Hair on the head bone: `cap` (short), `beehive` (tall and frosted), `perm`, `shaggy`."""
        k = self.hs
        zc = self.head_z(0.0)
        if kind in ("cap", "shaggy", "perm"):
            puff = {"cap": 1.03, "shaggy": 1.1, "perm": 1.2}[kind]
            low = {"cap": 0.62, "shaggy": 0.45, "perm": 0.4}[kind]
            self.loft(
                "head",
                [
                    ellipse(
                        0, -0.012, zc + low * 0.26 * k, 0.09 * k * puff, 0.1 * k * puff, back=0.012, front=-0.07 * k
                    ),
                    ellipse(0, -0.012, zc + 0.21 * k, 0.092 * k * puff, 0.104 * k * puff, back=0.01, front=-0.012 * k),
                    ellipse(
                        0, -0.012, zc + 0.27 * k + (0.03 if kind == "perm" else 0), 0.06 * k * puff, 0.075 * k * puff
                    ),
                ],
                role,
            )
        elif kind == "beehive":
            self.loft(
                "head",
                [
                    ellipse(0, -0.01, zc + 0.15 * k, 0.1 * k, 0.112 * k, n=10, front=-0.06 * k),
                    ellipse(0, -0.02, zc + 0.25 * k, 0.13 * k, 0.14 * k, n=10),
                    ellipse(0, -0.03, zc + 0.36 * k, 0.138 * k, 0.148 * k, n=10),
                    ellipse(0, -0.035, zc + 0.46 * k, 0.115 * k, 0.125 * k, n=10),
                    ellipse(0, -0.035, zc + 0.53 * k, 0.065 * k, 0.075 * k, n=10),
                    ellipse(0, -0.035, zc + 0.555 * k, 0.02 * k, 0.025 * k, n=10),
                ],
                role,
            )

    def beard(self, role, kind="full"):
        k = self.hs
        zc = self.head_z(0.0)
        if kind == "full":
            self.loft(
                "head",
                [
                    ellipse(0, 0.04 * k, zc - 0.07 * k, 0.04 * k, 0.03 * k),
                    ellipse(0, 0.035 * k, zc + 0.03 * k, 0.085 * k, 0.07 * k, back=-0.05),
                    ellipse(0, 0.02 * k, zc + 0.12 * k, 0.09 * k, 0.09 * k, back=-0.07),
                ],
                role,
            )
        elif kind == "goatee":
            self.blob("head", (0, 0.095 * k, zc + 0.02 * k), (0.022 * k, 0.018 * k, 0.04 * k), role)
        if kind in ("full", "mustache", "goatee"):
            self.box("head", (0, 0.108 * k, self.head_z(0.37)), (0.07 * k, 0.014, 0.016 * k), role)

    def braid(self, role, band=None, length=0.5):
        """A braid down the back, on the hair bone (it swings with speed)."""
        hx, hf, hz = self.joint["hair"]
        n = 6
        pts = [(hx, hf - 0.02 * i, hz - length * self.h * i / (n - 1)) for i in range(n)]
        self.tube("hair", pts, [0.035, 0.032, 0.03, 0.028, 0.025, 0.02], role, sides=5)
        if band:
            self.blob("hair", pts[-1], (0.028, 0.028, 0.02), band)

    def hood(self, role):
        """A rain hood hanging down the back, on the hair bone (it flaps with speed)."""
        hx, hf, hz = self.joint["hair"]
        self.loft(
            "hair",
            [
                ellipse(hx, hf + 0.02, hz - 0.02, 0.1, 0.03),
                ellipse(hx, hf - 0.02, hz - 0.12, 0.12, 0.05),
                ellipse(hx, hf - 0.04, hz - 0.22, 0.09, 0.045),
            ],
            role,
        )

    def tail(self, role, length=0.32, width=0.05):
        """A bandana or scarf tail off the back of the neck, on the hair bone."""
        hx, hf, hz = self.joint["hair"]
        z0 = hz - 0.12 * self.h
        for s in (1, -1):
            self.loft(
                "hair",
                [
                    [
                        L.P(s * 0.02, hf, z0),
                        L.P(s * 0.02 + width, hf, z0),
                        L.P(s * 0.02 + width, hf - 0.012, z0),
                        L.P(s * 0.02, hf - 0.012, z0),
                    ],
                    [
                        L.P(s * 0.04, hf - 0.02, z0 - length),
                        L.P(s * 0.04 + width * 0.6, hf - 0.02, z0 - length),
                        L.P(s * 0.04 + width * 0.6, hf - 0.03, z0 - length),
                        L.P(s * 0.04, hf - 0.03, z0 - length),
                    ],
                ],
                role,
            )

    # ---- clothes -------------------------------------------------------------------------

    def collar(self, role, high=False):
        h = self.h
        z0 = 1.45 * h
        self.loft(
            "chest",
            [
                ellipse(0, 0.0, z0, 0.095, 0.09, n=8),
                ellipse(0, 0.0, z0 + (0.09 if high else 0.06) * h, 0.08, 0.077, n=8),
            ],
            role,
        )

    def coat(self, role, length=0.75, flare=0.06, lapel=None, sleeves=True):
        """A coat: a shell over the torso and two tails hinged at the back of the waist (they flap)."""
        h, b = self.h, self.b
        rings = [(z, rx + 0.02, rf + 0.02, fr) for z, rx, rf, fr in self.torso_rings[:4]]
        self.loft("chest", [ellipse(0, 0, z, rx, rf, front=fr) for z, rx, rf, fr in rings], role)
        if lapel:
            for s in (1, -1):
                self.loft(
                    "chest",
                    [
                        [
                            L.P(s * 0.03, 0.135 * b, 1.42 * h),
                            L.P(s * 0.1, 0.12 * b, 1.42 * h),
                            L.P(s * 0.1, 0.11 * b, 1.42 * h),
                            L.P(s * 0.03, 0.125 * b, 1.42 * h),
                        ],
                        [
                            L.P(s * 0.01, 0.15 * b, 1.15 * h),
                            L.P(s * 0.04, 0.15 * b, 1.15 * h),
                            L.P(s * 0.04, 0.14 * b, 1.15 * h),
                            L.P(s * 0.01, 0.14 * b, 1.15 * h),
                        ],
                    ],
                    lapel,
                )
        if sleeves:
            for side in ("l", "r"):
                sh = self.joint[f"upper_arm_{side}"]
                el = self.joint[f"forearm_{side}"]
                self.tube(f"upper_arm_{side}", [sh, el], [0.07 * b, 0.058 * b], role, sides=6)
        # The tails: each a curved slab from the side round to the back, flaring at the hem.
        for side, s in (("coat_l", 1), ("coat_r", -1)):
            jx, jf, jz = self.joint[side]
            top_z = jz + 0.02
            hem_z = jz - length * h
            cols = []
            for i in range(5):
                a = math.radians(-6 - 21 * i)  # from the side (0) round to the back (-90)
                rt, rft = 0.17 * b, 0.115 * b
                rh, rfh = rt + flare, rft + flare * 1.6
                c, sn = math.cos(a), math.sin(a)
                cols.append(
                    [
                        L.P(s * rt * c, rft * sn, top_z),
                        L.P(s * rh * c, rfh * sn - 0.02, hem_z),
                        L.P(s * (rh - 0.02) * c, (rfh - 0.02) * sn - 0.02, hem_z),
                        L.P(s * (rt - 0.02) * c, (rft - 0.02) * sn, top_z),
                    ]
                )
            self.loft(side, cols, role)

    def vest(self, role, trim=None):
        """A sleeveless shell over the torso (a hi-vis vest, a puffer, a gripman's waistcoat)."""
        rings = [(z, rx + 0.016, rf + 0.016, fr) for z, rx, rf, fr in self.torso_rings[:4]]
        self.loft("chest", [ellipse(0, 0, z, rx, rf, front=fr) for z, rx, rf, fr in rings], role)
        if trim:
            for zk in (1.2, 1.3):
                z = zk * self.h
                rx, rf = rings[1][1] + 0.006, rings[1][2] + 0.006
                self.loft("chest", [ellipse(0, 0, z, rx, rf, n=10), ellipse(0, 0, z + 0.025, rx, rf, n=10)], trim)

    def tie(self, role, length=0.3, width=0.07):
        """A tie hanging from the collar, on the tie bone (it streams over the shoulder at speed)."""
        tx, tf, tz = self.joint["tie"]
        self.box("tie", (tx, tf + 0.012, tz - 0.015), (0.035, 0.02, 0.035), role)
        self.loft(
            "tie",
            [
                [
                    L.P(-0.018, tf + 0.006, tz - 0.03),
                    L.P(0.018, tf + 0.006, tz - 0.03),
                    L.P(0.018, tf + 0.018, tz - 0.03),
                    L.P(-0.018, tf + 0.018, tz - 0.03),
                ],
                [
                    L.P(-width / 2, tf + 0.006, tz - length * 0.8),
                    L.P(width / 2, tf + 0.006, tz - length * 0.8),
                    L.P(width / 2, tf + 0.018, tz - length * 0.8),
                    L.P(-width / 2, tf + 0.018, tz - length * 0.8),
                ],
                [
                    L.P(0, tf + 0.006, tz - length),
                    L.P(0.002, tf + 0.006, tz - length),
                    L.P(0.002, tf + 0.018, tz - length),
                    L.P(0, tf + 0.018, tz - length),
                ],
            ],
            role,
        )

    def sash(self, role, letters=None, letter_role=None):
        """A sash from the left shoulder to the right hip: a tilted band round the torso."""
        h = self.h
        tilt = math.radians(32)
        rings = []
        for off in (-0.035, 0.035):
            ring = []
            for i in range(12):
                a = 2 * math.pi * i / 12
                x, f = 0.215 * self.b * math.cos(a), 0.158 * self.b * math.sin(a)
                ring.append(L.P(x, f, 1.25 * h + off + x * math.tan(tilt)))
            rings.append(ring)
        mb = self.mb("chest")
        a_ring = [mb.v(p) for p in rings[0]]
        b_ring = [mb.v(p) for p in rings[1]]
        faces = []
        for i in range(12):
            j = (i + 1) % 12
            faces.append(mb.bm.faces.new((a_ring[i], a_ring[j], b_ring[j], b_ring[i])))
        mb.tag(faces, role, closed=False)
        for fc in faces:
            fc.normal_update()
            c = fc.calc_center_median()
            if fc.normal.dot(Vector((c.x, c.y, 0))) < 0:
                fc.normal_flip()
        if letters:
            self.back_letters(letters, letter_role or "trim", z=1.22 * h, cell=0.022)

    def back_letters(self, text, role, z, cell):
        """Block letters across the back, reading left to right for whoever rides behind."""
        width = len(text) * 4 - 1
        f = -(self.torso_rings[1][2] + 0.026)
        x0 = width * cell / 2  # the viewer behind sees the rider's right (-x) on their right
        top = z + 2.5 * cell
        n = Vector((0, 1, 0))
        for i, ch in enumerate(text):
            for r, row in enumerate(BLOCK[ch]):
                for c, bit in enumerate(row):
                    if bit != "1":
                        continue
                    x = x0 - (i * 4 + c + 0.5) * cell
                    zz = top - (r + 0.5) * cell
                    self.quad("chest", L.P(x, f, zz), Vector((cell / 2, 0, 0)), Vector((0, 0, cell / 2)), n, role)

    def spots(self, role, count, seed=3, z0=1.08, z1=1.42, size=0.022):
        """Leopard spots (or any print) scattered over the torso's surface."""
        rng = random.Random(seed)
        for _ in range(count):
            a = rng.uniform(0, 2 * math.pi)
            z = rng.uniform(z0, z1) * self.h
            p, n = self.torso_point(a, z)
            t = Vector((-n.y, n.x, 0)).normalized()
            s = size * rng.uniform(0.7, 1.3)
            self.quad("chest", p, t * s, Vector((0, 0, s * 0.8)), n, role)

    def stripes(self, role, count=12, z0=1.06, z1=1.42, width=0.012, horizontal=0):
        """Vertical pinstripes round the torso (seersucker), plus `horizontal` bands (flannel)."""
        for i in range(count):
            a = 2 * math.pi * (i + 0.5) / count
            for zz in range(4):
                za = (z0 + (z1 - z0) * zz / 4) * self.h
                zb = (z0 + (z1 - z0) * (zz + 1) / 4) * self.h
                p, n = self.torso_point(a, (za + zb) / 2)
                t = Vector((-n.y, n.x, 0)).normalized()
                self.quad("chest", p, t * width, Vector((0, 0, (zb - za) / 2)), n, role)
        for k in range(horizontal):
            z = (z0 + (z1 - z0) * (k + 0.5) / horizontal) * self.h
            for i in range(10):
                a = 2 * math.pi * (i + 0.5) / 10
                p, n = self.torso_point(a, z, lift=0.008)
                t = Vector((-n.y, n.x, 0)).normalized()
                self.quad("chest", p, t * 0.055 * self.b, Vector((0, 0, width * 1.4)), n, role)

    def patches(self, roles, count, seed=5, size=0.04):
        """Square patches on the torso: sponsor patches, oilskin repairs."""
        rng = random.Random(seed)
        for i in range(count):
            a = rng.uniform(0, 2 * math.pi)
            z = rng.uniform(1.1, 1.38) * self.h
            p, n = self.torso_point(a, z, lift=0.01)
            t = Vector((-n.y, n.x, 0)).normalized()
            self.quad("chest", p, t * size, Vector((0, 0, size * 0.8)), n, roles[i % len(roles)])

    def belt(self, role, buckle=None):
        h = self.h
        rx, rf = 0.158 * self.b, 0.108 * self.b
        self.loft("hips", [ellipse(0, 0, 1.03 * h, rx, rf, n=10), ellipse(0, 0, 1.07 * h, rx, rf, n=10)], role)
        if buckle:
            self.box("hips", (0, rf + 0.01, 1.05 * h), (0.05, 0.012, 0.04), buckle, detail=True)

    def suspenders(self, role):
        h, b = self.h, self.b
        for s in (1, -1):
            pts = [
                (s * 0.07 * b, 0.12 * b, 1.06 * h),
                (s * 0.09 * b, 0.135 * b, 1.3 * h),
                (s * 0.11 * b, 0.0, 1.47 * h),
                (s * 0.08 * b, -0.125 * b, 1.3 * h),
                (s * 0.06 * b, -0.11 * b, 1.06 * h),
            ]
            self.tube("chest", pts, [0.014] * 5, role, sides=4)

    def necklace(self, role, count=7):
        h = self.h
        for i in range(count):
            a = math.radians(30 + 120 * i / (count - 1))
            x, f = 0.085 * math.cos(a), 0.075 * math.sin(a) + 0.01
            z = 1.46 * h - 0.04 * math.sin(a)
            self.mb("chest", True).cone((x, f + 0.01, z), 0.009, z - 0.035, 3, role)

    def badge(self, role, at=(0.08, 1.33), size=(0.05, 0.06)):
        x, z = at
        rx = self.torso_point(0.0, z * self.h, lift=0.0)[0].x
        p, n = self.torso_point(math.acos(max(-0.95, min(0.95, x / max(rx, 1e-3)))), z * self.h, lift=0.012)
        t = Vector((-n.y, n.x, 0)).normalized()
        self.quad("chest", p, t * (size[0] / 2), Vector((0, 0, size[1] / 2)), n, role)

    def lanyard(self, role, card):
        h, b = self.h, self.b
        f = 0.13 * b
        self.tube(
            "chest",
            [(0.06, 0.06, 1.47 * h), (0.02, f, 1.3 * h), (-0.02, f, 1.3 * h), (-0.06, 0.06, 1.47 * h)],
            [0.006] * 4,
            role,
            sides=3,
            detail=True,
        )
        self.box("chest", (0, f + 0.006, 1.27 * h), (0.055, 0.008, 0.07), card, detail=True)

    def gloves(self, role):
        """Gauntlet cuffs over the wrists (the hands take `role` through body(hands=...))."""
        for side in ("l", "r"):
            gr = self.marker[f"grip_{side}"][1]
            self.tube(
                f"forearm_{side}",
                [(gr[0], gr[1], gr[2] + 0.05 * self.h), (gr[0], gr[1], gr[2] + 0.12 * self.h)],
                [0.05, 0.048],
                role,
                sides=6,
            )

    def waders(self, role, top=1.32):
        """Chest waders: the legs and pelvis in one colour up to the chest, with a bib."""
        h = self.h
        rings = [(z, rx + 0.012, rf + 0.012, fr) for z, rx, rf, fr in self.torso_rings[:3]]
        rings[-1] = (top * h, rings[-1][1], rings[-1][2], rings[-1][3])
        self.loft("chest", [ellipse(0, 0, z, rx, rf, front=fr) for z, rx, rf, fr in rings], role)

    # ---- props (one per rider; it flies off when they are hurt) ----------------------------

    def set_prop(self, mount, at):
        if mount not in PROP_MOUNTS:
            raise ValueError(mount)
        self.prop_mount = mount
        self.joint["prop"] = at

    def seat_point(self):
        """Where a seat-mounted prop's bone sits: the seat under the hips (the game maps it onto
        the bike's `seat_anchor`)."""
        return (0.0, 0.0, 0.87 * self.h)

    def prop_hat(self, role, band=None, brim=0.2, crown=0.1, height=0.11, campaign=False):
        k = self.hs
        z = self.head_z(0.9)
        self.set_prop("head", (0.0, -0.005, z))
        mb = self.mb("prop")
        mb.cyl((0, 0, z + 0.008), "z", brim * k, 0.008, 12, role)
        if campaign:
            mb.cone((0, 0, z + 0.015), crown * k, z + height * k * 1.3, 4, role)
        else:
            mb.cyl((0, 0, z + height * k / 2), "z", crown * k, height * k / 2, 10, role, r_top=crown * k * 0.88)
        if band:
            mb.cyl((0, 0, z + 0.03 * k), "z", crown * k + 0.003, 0.012, 10, band)

    def prop_bucket_hat(self, role):
        k = self.hs
        z = self.head_z(0.82)
        self.set_prop("head", (0.0, -0.01, z))
        mb = self.mb("prop")
        mb.cyl((0, -0.01, z), "z", 0.145 * k, 0.03, 10, role, r_top=0.11 * k)
        mb.cyl((0, -0.01, z + 0.07 * k), "z", 0.105 * k, 0.045 * k, 10, role, r_top=0.085 * k)

    def prop_box_on_seat(self, size, role, lid=None, back=0.28, extra=None):
        """A box strapped on the seat behind the rider: a cooler, a modem, a briefcase."""
        sx, sf, sz = size
        p = self.seat_point()
        self.set_prop("seat", p)
        c = (0.0, -back - sf / 2, p[2] + sz / 2)
        self.box("prop", c, size, role)
        if lid:
            self.box("prop", (c[0], c[1], c[2] + sz / 2 + 0.012), (sx + 0.02, sf + 0.02, 0.024), lid)
        if extra:
            extra(c)

    def prop_sign_on_pole(self, pole, face, text=None, text_role=None):
        """A campaign sign on a pole zip-tied behind the seat, like a flag."""
        p = self.seat_point()
        self.set_prop("seat", p)
        top = p[2] + 1.15
        self.tube("prop", [(0.0, -0.32, p[2]), (0.0, -0.36, top)], [0.014, 0.012], pole, sides=4)
        self.box("prop", (0.0, -0.37, top - 0.2), (0.5, 0.02, 0.32), face)
        if text:
            cell = 0.045
            width = len(text) * 4 - 1
            x0 = width * cell / 2
            for i, ch in enumerate(text):
                for r, row in enumerate(BLOCK[ch]):
                    for c, bit in enumerate(row):
                        if bit != "1":
                            continue
                        x = x0 - (i * 4 + c + 0.5) * cell
                        zz = top - 0.2 + 2.5 * cell - (r + 0.5) * cell
                        self.quad(
                            "prop",
                            L.P(x, -0.381, zz),
                            Vector((cell / 2, 0, 0)),
                            Vector((0, 0, cell / 2)),
                            Vector((0, 1, 0)),
                            text_role,
                        )

    def prop_on_chest(self, build, at=(0.0, 0.13, 1.3)):
        """A prop hung on the chest (a phone gimbal, a bell); `build(centre)` adds its parts."""
        x, f, z = at
        self.set_prop("chest", (x, f * self.b, z * self.h))
        build(self.joint["prop"])

    def prop_on_hips(self, build, at=(-0.17, 0.02, 1.0)):
        x, f, z = at
        self.set_prop("hips", (x * self.b, f, z * self.h))
        build(self.joint["prop"])

    def prop_on_head(self, build, at=0.8):
        self.set_prop("head", (0.0, 0.02, self.head_z(at)))
        build(self.joint["prop"])

    # ---- export ----------------------------------------------------------------------------

    def finish(self, out):
        bones = {}
        for name in BONES:
            bones[name] = L.empty(name, self.root, L.P(*self.joint[name]))
        self.root["prop_mount"] = self.prop_mount
        self.root["seat_m"] = round(self.seat_point()[2], 4)
        for name, (bone, at) in self.marker.items():
            b = bones[bone]
            L.empty(name, b, L.P(*at) - b.location)
        tris = 0
        for (bone, detail), mb in sorted(self.parts.items(), key=lambda kv: (BONES.index(kv[0][0]), kv[0][1])):
            if not mb.bm.faces:
                mb.bm.free()
                continue
            b = bones[bone]
            for vtx in mb.bm.verts:
                vtx.co -= b.location
            bmesh.ops.triangulate(mb.bm, faces=list(mb.bm.faces))
            for fc in mb.bm.faces:
                fc.smooth = False
            tris += len(mb.bm.faces)
            ob = mb.build(f"{bone}_{'detail' if detail else 'mesh'}", self.mats, b)
            if detail:
                ob["detail"] = True
        self.root["triangles"] = tris
        L.export(out, normals=False)
        print(f"RIDER_OK {self.id} {tris} tris")
