"""From an OSM travel path to a smooth, gameplay-fied centreline profile.

The pipeline (docs/milestones/M2.md, gis-1): stitch the ways into the travel path, clip the
stretch, smooth, compress long straights, integrate positions, add elevation, then the emitter
resamples each road at the nominal spacing.

The profile is built *intrinsically*: heading as a function of arc length is smoothed and edited,
and positions are integrated from it. Curvature (``dheading/ds``) and positions therefore agree by
construction, which is what the road lint checks.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from tbgis.config import BakeConfig
from tbgis.features import stitch_ways
from tbgis.graph import Graph, path_via
from tbgis.osm import Way
from tbgis.tmerc import Frame

type F64 = NDArray[np.float64]
type Bool = NDArray[np.bool_]

MPH = 0.44704
ABUTMENT_M = 15.0


@dataclass
class RealPath:
    """The travel path as OSM draws it, projected into the region frame."""

    lat: F64
    lon: F64
    x: F64
    z: F64
    cum: F64  # arc length at each vertex
    seg_bridge: Bool
    seg_speed: F64  # m/s, nan when untagged
    seg_way: NDArray[np.int64]
    names: dict[int, str] = field(default_factory=dict)
    seg_tunnel: Bool | None = None


def parse_speed(tag: str | None) -> float:
    if not tag:
        return math.nan
    parts = tag.split()
    try:
        value = float(parts[0])
    except ValueError:
        return math.nan
    return value * MPH if len(parts) > 1 and parts[1] == "mph" else value / 3.6


def _tag(w: Way, k: str) -> str:
    return str(w.id) if k == "@id" else w.tags.get(k, "")


def route_ways(cfg: BakeConfig, ways: list[Way]) -> list[Way]:
    """The ways allowed to carry the path: every ``routeTags`` regex must match its tag and, when the
    config has a ``wayFilter``, every regex of at least one of its groups (``@id`` is the way id)."""
    rules = [(k, re.compile(v)) for k, v in cfg.routeTags.items()]
    groups = [[(k, re.compile(v)) for k, v in g.items()] for g in cfg.wayFilter]
    return [
        w
        for w in ways
        if all(rx.search(_tag(w, k)) for k, rx in rules)
        and (not groups or any(all(rx.search(_tag(w, k)) for k, rx in g) for g in groups))
    ]


def real_path(cfg: BakeConfig, ways: list[Way]) -> RealPath:
    allowed = route_ways(cfg, ways)
    graph = Graph([*allowed, *stitch_ways(cfg.stitches, allowed)], respect_oneway=cfg.respectOneway)
    points = [cfg.pathFrom.tup(), *(v.tup() for v in cfg.via), cfg.pathTo.tup()]
    steps = path_via(graph, points)
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    verts = [steps[0].a, *(s.b for s in steps)]
    xz = np.array([frame.to_world(lat, lon) for lat, lon in verts], dtype=np.float64)
    seglen = np.hypot(np.diff(xz[:, 0]), np.diff(xz[:, 1]))
    return RealPath(
        lat=np.array([v[0] for v in verts]),
        lon=np.array([v[1] for v in verts]),
        x=xz[:, 0],
        z=xz[:, 1],
        cum=np.concatenate([[0.0], np.cumsum(seglen)]),
        seg_bridge=np.array([s.way.is_bridge or s.way.id in cfg.bridgeWays for s in steps]),
        seg_speed=np.array([parse_speed(s.way.tags.get("maxspeed")) for s in steps]),
        seg_way=np.array([s.way.id for s in steps], dtype=np.int64),
        names={s.way.id: s.way.tags.get("name", "") for s in steps},
        seg_tunnel=np.array([s.way.tags.get("tunnel", "no") not in ("no", "") for s in steps]),
    )


def project_s(rp: RealPath, x: float, z: float) -> float:
    """Arc length of the point on the path nearest to (x, z)."""
    best, best_s = math.inf, 0.0
    for i in range(len(rp.x) - 1):
        ax, az, bx, bz = rp.x[i], rp.z[i], rp.x[i + 1], rp.z[i + 1]
        dx, dz = bx - ax, bz - az
        ll = dx * dx + dz * dz
        t = 0.0 if ll == 0 else min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / ll))
        d = math.hypot(ax + t * dx - x, az + t * dz - z)
        if d < best:
            best, best_s = d, float(rp.cum[i] + t * math.sqrt(ll))
    return best_s


def at_s(rp: RealPath, s: F64) -> NDArray[np.int64]:
    """Segment index for each arc length."""
    return np.clip(np.searchsorted(rp.cum, s, side="right") - 1, 0, len(rp.cum) - 2).astype(np.int64)


def gaussian(values: F64, sigma_samples: float) -> F64:
    """Gaussian low-pass with edge-value padding (no pull toward zero at the ends)."""
    if sigma_samples <= 0:
        return values.copy()
    r = max(1, math.ceil(4 * sigma_samples))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_samples) ** 2)
    k /= k.sum()
    padded = np.concatenate([np.full(r, values[0]), values, np.full(r, values[-1])])
    return np.convolve(padded, k, mode="valid")


@dataclass
class Profile:
    """The finished centreline on a uniform ~1 m grid in game arc length."""

    h: float  # grid spacing, metres
    s: F64  # game arc length, from 0
    s_real: F64  # the real arc length each grid point came from
    x: F64
    y: F64
    z: F64
    heading: F64  # radians, 0 = north (-z), clockwise positive: a right turn raises it
    kappa: F64
    grade: F64
    bridge: Bool
    speed: F64
    real_length: float
    compressed: list[tuple[float, float, float]]  # (real s0, real s1, kept fraction)
    way: NDArray[np.int64] | None = None  # the OSM way under each grid point
    names: dict[int, str] = field(default_factory=dict)  # way id -> its OSM name tag


def straight_runs(kappa: F64, allowed: Bool, kmax: float, min_len: float, h: float) -> list[tuple[int, int]]:
    """Index ranges [a, b) where |kappa| stays under ``kmax`` for more than ``min_len`` metres."""
    ok = (np.abs(kappa) < kmax) & allowed
    runs: list[tuple[int, int]] = []
    i = 0
    n = len(ok)
    while i < n:
        if not ok[i]:
            i += 1
            continue
        j = i
        while j < n and ok[j]:
            j += 1
        if (j - i) * h > min_len:
            runs.append((i, j))
        i = j
    return runs


def build_profile(cfg: BakeConfig, rp: RealPath, land_y: F64 | None, land_s: F64 | None) -> Profile:
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    s0 = project_s(rp, *frame.to_world(cfg.start.lat, cfg.start.lon))
    s1 = project_s(rp, *frame.to_world(cfg.end.lat, cfg.end.lon))
    if s1 <= s0:
        raise ValueError("config end lies before its start along the travel path")
    n = max(2, round(s1 - s0))
    h = (s1 - s0) / n
    s_real: F64 = s0 + h * np.arange(n + 1, dtype=np.float64)
    seg = at_s(rp, s_real)
    seg_heading = np.unwrap(np.arctan2(np.diff(rp.x), -np.diff(rp.z)))
    heading = gaussian(seg_heading[seg], cfg.smoothing.headingSigmaM / h)
    bridge = rp.seg_bridge[seg]
    speed = rp.seg_speed[seg]

    # Gameplay-fy: compress long straights by stretching nothing and shrinking arc length.
    kappa_real = np.gradient(heading, h)
    weight = np.ones_like(s_real)
    compressed: list[tuple[float, float, float]] = []
    c = cfg.compression
    if c.enabled:
        allowed = np.ones_like(bridge) if c.onBridges else ~bridge
        for a, b in straight_runs(kappa_real, allowed, c.straightKappaMax, c.minStraightM, h):
            length = (b - a) * h
            keep = max(c.minKeepM, c.keepFraction * length)
            if keep < length:
                weight[a:b] = keep / length
                compressed.append((float(s_real[a]), float(s_real[b - 1]), keep / length))
    ds_game = (weight[:-1] + weight[1:]) / 2 * h
    s_game = np.concatenate([[0.0], np.cumsum(ds_game)])

    # Resample onto a uniform game grid, then integrate positions from the heading.
    m = max(2, round(s_game[-1]))
    hg = s_game[-1] / m
    s = hg * np.arange(m + 1)
    heading_g = np.interp(s, s_game, heading)
    s_real_g = np.interp(s, s_game, s_real)
    bridge_g = bridge[np.clip(np.searchsorted(s_game, s, side="right") - 1, 0, len(bridge) - 1)]
    speed_g = speed[np.clip(np.searchsorted(s_game, s, side="right") - 1, 0, len(speed) - 1)]
    way_real = rp.seg_way[seg]
    way_g = way_real[np.clip(np.searchsorted(s_game, s, side="right") - 1, 0, len(way_real) - 1)]
    mid = (heading_g[:-1] + heading_g[1:]) / 2
    x0, z0 = np.interp(s0, rp.cum, rp.x), np.interp(s0, rp.cum, rp.z)
    x = x0 + np.concatenate([[0.0], np.cumsum(np.sin(mid) * hg)])
    z = z0 + np.concatenate([[0.0], np.cumsum(-np.cos(mid) * hg)])
    kappa = np.gradient(heading_g, hg)

    at = cfg.elevation.humpAt
    hump_real = None if at is None else project_s(rp, *frame.to_world(at.lat, at.lon))
    y = elevation(cfg, s, s_real_g, bridge_g, land_y, land_s, hg, hump_real)
    return Profile(
        h=hg,
        s=s,
        s_real=s_real_g,
        x=x,
        y=y,
        z=z,
        heading=heading_g,
        kappa=kappa,
        grade=np.gradient(y, hg),
        bridge=bridge_g,
        speed=speed_g,
        real_length=s1 - s0,
        compressed=compressed,
        way=way_g,
        names=dict(rp.names),
    )


def runs_of(flags: Bool) -> list[tuple[int, int]]:
    """Index ranges [a, b) where ``flags`` is true."""
    out: list[tuple[int, int]] = []
    i, n = 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def smoothstep(u: F64) -> F64:
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3 - 2 * u)


def elevation(
    cfg: BakeConfig,
    s: F64,
    s_real: F64,
    bridge: Bool,
    land_y: F64 | None,
    land_s: F64 | None,
    h: float,
    hump_real: float | None = None,
) -> F64:
    """Land from the elevation samples (by real arc length); bridge decks and humps synthesized.
    ``hump_real`` (real arc length, from ``elevation.humpAt``) puts the hump there, on the long
    bridge that holds it and no other; None humps each long bridge at its middle."""
    e = cfg.elevation
    if land_y is None or land_s is None:
        raw = np.full_like(s, e.minLandM)
    else:
        raw = np.interp(s_real, land_s, land_y)
    if e.bridgeDeck == "span":
        # Each deck runs straight between its abutments, taken as the highest unsmoothed land
        # within ABUTMENT_M outside each end (OSM bridge ends are approximate). The decks replace
        # the valley in the raw profile *before* the low-pass, so land and deck meet smoothly.
        raw = raw.copy()
        k = max(1, round(ABUTMENT_M / h))
        for a, b in runs_of(bridge):
            ya = float(raw[max(0, a - k) : a + 1].max())
            yb = float(raw[min(len(s) - 1, b - 1) : min(len(s), b + k)].max())
            raw[a:b] = ya + (yb - ya) * (s[a:b] - s[a]) / max(s[b - 1] - s[a], 1e-9)
    if land_y is None or land_s is None:
        land = raw
    else:
        land = np.maximum(gaussian(raw, e.lowPassSigmaM / h) * e.landExaggeration, e.minLandM)
    y = land.copy()
    for a, b in runs_of(bridge):
        length = (b - a) * h
        on = (np.arange(len(s)) >= a) & (np.arange(len(s)) < b)
        if e.bridgeDeck == "sea":
            ramp = min(e.deckRampM, length / 2)
            u = s - s[a]
            rise = smoothstep(u / ramp) * smoothstep((s[b - 1] - s) / ramp)
            y = np.where(on, y + (e.deckM - y) * rise, y)
        if length >= e.humpMinBridgeM and e.humpHeightM > 0:
            if hump_real is None:
                centre = (s[a] + s[b - 1]) / 2
            elif s_real[a] <= hump_real <= s_real[b - 1]:
                centre = float(np.interp(hump_real, s_real, s))
            else:
                continue
            v = (s - (centre - e.humpLengthM / 2)) / e.humpLengthM
            inside = (v > 0) & (v < 1)
            y = y + np.where(inside, e.humpHeightM * (1 - np.cos(2 * np.pi * v)) / 2, 0.0)
    return y
