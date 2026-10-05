"""Playtest 3's baked features (T9.1; real-world spec L1, critic C1): ramp lips in the elevation,
stitched gaps over a span the map does not draw, and landmarks placed from lat/lon.

Everything here is a pure function of its inputs: no randomness, no clock, lists in config order,
so the same config and extract bake the same bytes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np

from tbgis.config import Feature, Stitch
from tbgis.graph import key
from tbgis.osm import Way, haversine_m
from tbgis.tmerc import Frame

if TYPE_CHECKING:
    from tbgis.stretch import F64, Profile, RealPath

type Json = dict[str, Any]


def r4(v: float) -> float:
    return round(float(v), 4)


# ----------------------------------------------------------------------------------------------
# Ramp lips (src/road/compile.ts: RampSource, rampProfile, and the lip moved onto a sample)


@dataclass(frozen=True)
class RampSpec:
    s0: float  # where the kicker starts, in the road's own s
    lengthM: float  # noqa: N815
    heightM: float  # noqa: N815
    backM: float  # noqa: N815


def ramp_profile(ramps: list[RampSpec], s: float) -> tuple[float, float]:
    """Height of the ramps at s, and its slope: the hand-made compiler's formula, line for line."""
    y = 0.0
    g = 0.0
    for r in ramps:
        lip = r.s0 + r.lengthM
        if r.s0 < s <= lip:
            u = (s - r.s0) / r.lengthM
            y += r.heightM * u * u
            g += (2 * r.heightM * u) / r.lengthM
        elif lip < s < lip + r.backM:
            v = 1 - (s - lip) / r.backM
            y += r.heightM * v * v
            g -= (2 * r.heightM * v) / r.backM
    return y, g


def bake_ramps(features: list[Json], length: float, n: int) -> tuple[list[Json], F64 | None, F64 | None]:
    """The road's features with every built ramp's lip moved onto a sample (the compiler's rule: the
    sampled surface keeps its full height and its kink), and the height and slope those ramps add at
    each of the road's ``n + 1`` samples (None when it builds none, so a road without one keeps its
    samples bit for bit). A gap that started at a ramp's lip starts at the moved lip,
    so a kicker always launches over its gap's edge."""
    spacing = length / n
    s: F64 = spacing * np.arange(n + 1, dtype=np.float64)
    s[-1] = length
    out: list[Json] = []
    specs: list[RampSpec] = []
    moved: dict[float, float] = {}  # old lip -> new lip
    for f in features:
        p = f.get("params") or {}
        if f["kind"] != "ramp" or "heightM" not in p:
            out.append(f)
            continue
        run, h, back = float(p["lengthM"]), float(p["heightM"]), float(p.get("backM", 0.0))
        lip = round((f["s0"] + run) / spacing) * spacing
        s0 = r4(lip - run)
        if s0 < 0 or lip + back > length + 1e-6:
            raise ValueError(
                f"ramp {f['id']}: its kicker and back ({s0:g}..{lip + back:g}) leave the {length:g} m road"
            )
        moved[f["s0"] + run] = s0 + run
        specs.append(RampSpec(s0, run, h, back))
        out.append({**f, "s0": s0, "s1": r4(s0 + run + back)})
    for i, f in enumerate(out):
        if f["kind"] == "gap":
            for old, new in moved.items():
                if abs(f["s0"] - old) < 1e-3:
                    out[i] = {**f, "s0": r4(new)}
    if not specs:
        return out, None, None
    dy = np.zeros(n + 1)
    dg = np.zeros(n + 1)
    for i in range(n + 1):
        dy[i], dg[i] = ramp_profile(specs, float(s[i]))
    return out, dy, dg


def plus(base: F64, extra: F64 | None) -> F64:
    return base if extra is None else base + extra


# ----------------------------------------------------------------------------------------------
# Stitches: a straight deck across a span the map does not draw


STITCH_WAY_ID = -1_000_000  # synthetic way ids count down from here; OSM ids are positive


def stitch_way_id(k: int) -> int:
    return STITCH_WAY_ID - k


def nearest_node(nodes: list[tuple[float, float]], want: tuple[float, float]) -> tuple[float, float] | None:
    """The node nearest a point (the first of equals, in the extract's order), or None."""
    best: tuple[float, float] | None = None
    best_d = math.inf
    for c in nodes:
        d = haversine_m(c, want)
        if d < best_d:
            best, best_d = c, d
    return best


def stitch_ways(stitches: list[Stitch], ways: list[Way]) -> list[Way]:
    """One synthetic two-node bridge way per stitch, between the way nodes nearest its two ends, so
    the path can cross the span. Refused when an end is more than ``snapM`` from any node."""
    if not stitches:
        return []
    nodes = list(dict.fromkeys(c for w in ways for c in w.coords))
    out: list[Way] = []
    for k, st in enumerate(stitches):
        ends: list[tuple[float, float]] = []
        for label, at in (("from", st.from_), ("to", st.to)):
            want = at.tup()
            best = nearest_node(nodes, want)
            if best is None or haversine_m(best, want) > st.snapM:
                far = "no way" if best is None else f"{haversine_m(best, want):.1f} m"
                raise ValueError(
                    f"stitch {st.id}: its {label} end is {far} from the nearest way node (snapM {st.snapM:g})"
                )
            ends.append(best)
        if key(ends[0]) == key(ends[1]):
            raise ValueError(f"stitch {st.id}: both ends snap to one node")
        tags = {"bridge": "yes", "tbgis:stitch": st.id}
        out.append(Way(id=stitch_way_id(k), tags=tags, coords=ends))
    return out


def stitch_span(rp: RealPath, p: Profile, st: Stitch, k: int) -> tuple[float, float]:
    """The game arc lengths (on the profile) of the stitch's two way ends, in travel order."""
    hit = np.nonzero(rp.seg_way == stitch_way_id(k))[0]
    if len(hit) != 1:
        raise ValueError(
            f"stitch {st.id}: the line's path does not cross it (check its ends and the way filter)"
        )
    i = int(hit[0])
    real0, real1 = float(rp.cum[i]), float(rp.cum[i + 1])
    lo, hi = float(p.s_real[0]), float(p.s_real[-1])
    if real0 < lo or real1 > hi:
        raise ValueError(f"stitch {st.id}: it lies outside the clipped line")
    return float(np.interp(real0, p.s_real, p.s)), float(np.interp(real1, p.s_real, p.s))


KICKER_BACK_SHARE = 0.5  # a stitched kicker's back runs over this share of its gap


def stitch_features(st: Stitch, s_from: float, s_to: float, half_width: float) -> list[Feature]:
    """A gap stitch's features in line s: the gap ``trimM`` in from each way end, and its kicker."""
    if st.kind != "gap":
        return []
    s0, s1 = s_from + st.trimM, s_to - st.trimM
    if s1 - s0 < 1:
        raise ValueError(f"stitch {st.id}: trimM {st.trimM:g} leaves no gap over {s_to - s_from:.1f} m")
    d0 = st.d0 if st.d0 is not None else -half_width
    d1 = st.d1 if st.d1 is not None else half_width
    out: list[Feature] = []
    if st.kicker is not None:
        k = st.kicker
        # The kicker's back falls to the deck over the first half of the gap, where nobody rides: a
        # lip that dropped to the deck in one sample would break the game's grade rule (the road
        # lint skips a ramp's own range, and the back puts the drop inside it, over several samples
        # at any spacing). Render still counts the ramp as the gap's kicker (it runs into the gap).
        back = r4((s1 - s0) * KICKER_BACK_SHARE)
        params = {"heightM": k.heightM, "lengthM": k.lengthM, "backM": back}
        out.append(
            Feature(
                kind="ramp",
                id=f"{st.id}-kicker",
                s0=s0 - k.lengthM,
                s1=s0 + back,
                d0=d0,
                d1=d1,
                params=params,
            )
        )
    out.append(Feature(kind="gap", id=st.id, s0=s0, s1=s1, d0=d0, d1=d1, params=st.params))
    return out


# ----------------------------------------------------------------------------------------------
# Landmarks: placed against the real line, then mapped into the baked road


def real_station(rp: RealPath, frame: Frame, lat: float, lon: float) -> tuple[float, float, float, float]:
    """A real point against the real path: (real s, signed offset d, positive to the right of the
    direction of travel, and the point's world x, z)."""
    x, z = frame.to_world(lat, lon)
    best, best_s, best_d = math.inf, 0.0, 0.0
    for i in range(len(rp.x) - 1):
        ax, az, bx, bz = rp.x[i], rp.z[i], rp.x[i + 1], rp.z[i + 1]
        dx, dz = bx - ax, bz - az
        ll = dx * dx + dz * dz
        if ll == 0:
            continue
        t = min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / ll))
        px, pz = ax + t * dx, az + t * dz
        dist = math.hypot(px - x, pz - z)
        if dist < best:
            seg = math.sqrt(ll)
            # Right of a heading h (0 = north, clockwise) is (cos h, sin h) = (-dz, dx) / |d|.
            best, best_s, best_d = dist, float(rp.cum[i] + t * seg), ((x - px) * -dz + (z - pz) * dx) / seg
    return best_s, best_d, x, z
