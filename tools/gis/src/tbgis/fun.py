"""The fun report: what a baked stretch offers a rider, computed from the profile, never typed.

Curvature (corners, the tightest radius), grades (climbs, the steepest block), launch crests (where
a bike at speed leaves the ground), junctions (cross streets the route passes), bridges, tunnels,
and how far the smoothed line strays from the real one. A launch crest is a physics estimate: a
body following a vertical curve of curvature ``c`` (the rate the grade falls, 1/m) leaves the
surface above ``sqrt(g / c)``. The game's own airborne rule decides what really happens.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np

from tbgis.config import BakeConfig
from tbgis.graph import degrees, key
from tbgis.osm import Way
from tbgis.stretch import F64, Profile, RealPath, gaussian, runs_of

G = 9.81
CORNER_R_M = 150.0  # a corner: |kappa| above 1/150 m ...
CORNER_MIN_TURN_DEG = 20.0  # ... turning at least this much in one run
LAUNCH_SPEED_MPS = 44.7  # the starter bike's top speed (100 mph, playtest 1 item 10)
CREST_SMOOTH_M = 4.0  # the vertical-curvature estimate is smoothed over a few metres


@dataclass(frozen=True)
class FunReport:
    real_length_m: float
    game_length_m: float
    corners: int
    tightest_radius_m: float
    share_tighter_than_m: dict[int, float]  # radius -> share of the length
    turn_deg_per_km: float
    elev_min_m: float
    elev_max_m: float
    climb_m: float
    descent_m: float
    max_grade_pct: float
    p95_grade_pct: float
    share_steeper_than_pct: dict[int, float]  # grade % -> share of the length
    launch_crests: int
    launch_speed_mps: float | None  # the lowest take-off speed over any crest, if under top speed
    junctions: int
    junctions_per_km: float
    bridges_m: float
    tunnels_m: float
    max_deviation_m: float

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _deviation(p: Profile, rp: RealPath) -> float:
    """Largest distance from the baked line (every ~10 m) to the real OSM line."""
    step = max(1, round(10.0 / p.h))
    px, pz = p.x[::step][:, None], p.z[::step][:, None]
    ax, az = rp.x[:-1][None, :], rp.z[:-1][None, :]
    dx, dz = (rp.x[1:] - rp.x[:-1])[None, :], (rp.z[1:] - rp.z[:-1])[None, :]
    ll = np.maximum(dx * dx + dz * dz, 1e-12)
    t = np.clip(((px - ax) * dx + (pz - az) * dz) / ll, 0.0, 1.0)
    d = np.hypot(ax + t * dx - px, az + t * dz - pz).min(axis=1)
    return float(d.max())


def _corners(p: Profile) -> int:
    n = 0
    for a, b in runs_of(np.abs(p.kappa) > 1 / CORNER_R_M):
        turn = abs(float(np.trapezoid(p.kappa[a:b], p.s[a:b]))) if b - a > 1 else 0.0
        if math.degrees(turn) >= CORNER_MIN_TURN_DEG:
            n += 1
    return n


def _crests(p: Profile) -> tuple[int, float | None]:
    falling: F64 = -np.gradient(gaussian(p.grade, CREST_SMOOTH_M / p.h), p.h)  # 1/m, + over a crest
    with np.errstate(divide="ignore"):
        take_off = np.where(falling > 0, np.sqrt(G / np.maximum(falling, 1e-12)), np.inf)
    runs = runs_of(take_off < LAUNCH_SPEED_MPS)
    return len(runs), (float(take_off.min()) if runs else None)


def _junctions(p: Profile, rp: RealPath, ways: list[Way]) -> int:
    """Path nodes where a public road meets the route (driveways and parking aisles, OSM's
    ``highway=service``, are left out: they are not junctions a rider reads as one)."""
    deg = degrees([w for w in ways if w.tags.get("highway") != "service"])
    lo, hi = float(p.s_real[0]), float(p.s_real[-1])
    inside = (rp.cum > lo + 1.0) & (rp.cum < hi - 1.0)
    keys = [key((float(a), float(b))) for a, b in zip(rp.lat[inside], rp.lon[inside], strict=True)]
    return sum(1 for k in dict.fromkeys(keys) if deg.get(k, 0) >= 3)


def _real_flag_length(rp: RealPath, flags: np.ndarray | None, lo: float, hi: float) -> float:
    if flags is None:
        return 0.0
    a, b = np.clip(rp.cum[:-1], lo, hi), np.clip(rp.cum[1:], lo, hi)
    return float(((b - a) * flags).sum())


def fun_report(cfg: BakeConfig, rp: RealPath, p: Profile, ways: list[Way]) -> FunReport:
    del cfg  # the report reads the profile; the config is kept in the signature for later knobs
    length = float(p.s[-1])
    ds = np.full_like(p.s, p.h)
    radius = np.where(np.abs(p.kappa) > 0, 1 / np.maximum(np.abs(p.kappa), 1e-12), np.inf)
    grade = np.abs(p.grade) * 100
    dy = np.diff(p.y)
    crests, take_off = _crests(p)
    junctions = _junctions(p, rp, ways)
    lo, hi = float(p.s_real[0]), float(p.s_real[-1])
    return FunReport(
        real_length_m=round(p.real_length, 1),
        game_length_m=round(length, 1),
        corners=_corners(p),
        tightest_radius_m=round(float(radius.min()), 1),
        share_tighter_than_m={r: round(float(ds[radius < r].sum() / ds.sum()), 4) for r in (50, 100, 200)},
        turn_deg_per_km=round(math.degrees(float(np.abs(p.kappa).sum() * p.h)) / (length / 1000), 1),
        elev_min_m=round(float(p.y.min()), 1),
        elev_max_m=round(float(p.y.max()), 1),
        climb_m=round(float(dy[dy > 0].sum()), 1),
        descent_m=round(float(-dy[dy < 0].sum()), 1),
        max_grade_pct=round(float(grade.max()), 1),
        p95_grade_pct=round(float(np.percentile(grade, 95)), 1),
        share_steeper_than_pct={g: round(float(ds[grade > g].sum() / ds.sum()), 4) for g in (8, 15)},
        launch_crests=crests,
        launch_speed_mps=None if take_off is None else round(take_off, 1),
        junctions=junctions,
        junctions_per_km=round(junctions / (p.real_length / 1000), 2),
        bridges_m=round(_real_flag_length(rp, rp.seg_bridge, lo, hi), 1),
        tunnels_m=round(_real_flag_length(rp, rp.seg_tunnel, lo, hi), 1),
        max_deviation_m=round(_deviation(p, rp), 1),
    )
