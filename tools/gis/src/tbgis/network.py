"""Road networks from the real map: several real roads joined at their real junctions (run W-S).

A stretch bake (``tbgis bake``) follows one real road end to end, with pass-through junctions only.
A network bake (``tbgis network``) takes a network config (``tools/gis/networks/<id>.json``) that
names several *lines*, each one real path through the OSM graph baked the way a stretch is, and
*branches*: a line that leaves a main line at a real junction and rejoins it at another, which a
race offers as a junction choice (interview, 2026-10-02: "junction choices in races", "map-based
networks").

Three things make the lines meet:

1. **Closure.** Positions are integrated from the smoothed heading, so a baked line drifts from the
   real one (about 6 m over one 500 m city block; tens of metres over kilometres, the routes lane
   measured in run W-O). Each line is pinned back onto the real map at every junction it meets: the
   error there is spread back along the line with a smoothstep between anchors, and the line is
   resampled at uniform arc length, so its curvature still comes from its positions.
2. **Connector pieces.** At a junction the main line is cut around the junction point: a short piece
   of it becomes the junction's main-through connector road, with one row per drive lane.
3. **Branch connectors.** The branch line's own roads start and stop a few tens of metres inside it,
   and a connector road on each side is solved (a smooth turn, a straight and a smooth turn, as the
   hand-made compiler's branches in src/road/compile.ts) to leave the main road's end at an offset
   with its heading and land on the branch road's end with its heading. The leaving row carries the
   split zone; the connectors carry one shortcut lane, so traffic never takes them (the format's
   rule: traffic only takes drive-lane connectors).

Every route runs along one line; it allows the connector pieces between its roads and every branch
that leaves and rejoins inside its span, and names those branches.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import Field

from tbgis import __version__
from tbgis.config import (
    BakeConfig,
    Compression,
    Crs,
    Elevation,
    LatLon,
    RoadName,
    Route,
    Smoothing,
    Strict,
    Verges,
)
from tbgis.emit import (
    OSM_ATTRIBUTION,
    USGS_ATTRIBUTION,
    lanes,
    longest_name,
    r4,
    r5,
    road_splits,
    without,
)
from tbgis.fetch import FetchMeta
from tbgis.osm import Way
from tbgis.stretch import F64, Profile, RealPath, build_profile, real_path, runs_of
from tbgis.tmerc import Frame

type Json = dict[str, Any]

ID = r"^[a-z0-9]+(-[a-z0-9]+)*$"
OSM_ID = r"^osm-[a-z0-9]+(-[a-z0-9]+)*$"
ROUTE_NOTES = (
    "A route drawn from a real-road network (run W-S; interview, 2026-10-02: map-based networks): "
    "the race-setup picker offers it in its region, and the career's events sit on its roads."
)
# A base cut (a name change, a long bridge) this close to a junction piece is dropped, so no road
# is a sliver between the piece and the cut.
PIECE_CLEAR_M = 50.0


# ----------------------------------------------------------------------------------------------
# The config


class CrossSection(Strict):
    """A line's lanes: as the stretch config's cross-section fields (docs/content-packs.md)."""

    laneWidthM: float = Field(4.0, ge=2.5, le=5.0)  # noqa: N815
    lanesPerDirection: int = Field(1, ge=1, le=3)  # noqa: N815
    medianM: float = Field(0.0, ge=0, le=30)  # noqa: N815
    medianKind: Literal["paint", "kerb", "grass", "barrier"] = "paint"  # noqa: N815
    verges: Verges | None = None


class SideTags(Strict):
    left: list[str] = Field(default_factory=list)
    right: list[str] = Field(default_factory=list)


class Line(Strict):
    """One real path through the OSM graph, cut into named roads, like a stretch config."""

    id: str = Field(pattern=ID)
    pathFrom: LatLon  # noqa: N815
    via: list[LatLon] = Field(default_factory=list)
    pathTo: LatLon  # noqa: N815
    # Where the line is clipped. A branch line is clipped at its branch's leave and join points.
    start: LatLon | None = None
    end: LatLon | None = None
    routeTags: dict[str, str] = Field(default_factory=dict)  # noqa: N815
    respectOneway: bool = True  # noqa: N815
    splitAt: list[LatLon] = Field(default_factory=list)  # noqa: N815
    splitOnNameChange: bool = False  # noqa: N815
    minRoadM: float = Field(150.0, gt=0)  # noqa: N815
    splitBridgeMinM: float = Field(800.0, gt=0)  # noqa: N815
    realName: str = ""  # noqa: N815 (a road's realName when OSM names none)
    smoothing: Smoothing = Smoothing()
    elevation: Elevation = Elevation()
    crossSection: CrossSection = CrossSection()  # noqa: N815
    speedLimitMps: float | None = Field(None, gt=0)  # noqa: N815 (else the OSM maxspeed mode)
    surface: Literal["asphalt", "concrete", "brick", "cobbles", "gravel", "dirt", "sand", "grass"] = "asphalt"
    # The ordinary roads, in order: the pieces between every cut (name changes, long bridges,
    # splitAt points and junction pieces), leaving out the junction pieces themselves.
    roads: list[RoadName]
    # Per road id: its own cross-section (a boulevard narrowing to a side street; lanes carry over
    # a join by id, and traffic merges out of the lanes that end) and tags for one side only (the
    # sea on one side of a beach road).
    roadLanes: dict[str, CrossSection] = Field(default_factory=dict)  # noqa: N815
    sideTags: dict[str, SideTags] = Field(default_factory=dict)  # noqa: N815

    def lanes_of(self, rid: str) -> CrossSection:
        return self.roadLanes.get(rid, self.crossSection)

    def sides_of(self, rid: str) -> SideTags:
        return self.sideTags.get(rid, SideTags())


class Zone(Strict):
    """The split zone: the last ``lengthM`` of the road the branch leaves, between d0 and d1."""

    lengthM: float = Field(gt=0)  # noqa: N815
    d0: float
    d1: float


class Leave(Strict):
    at: LatLon  # the real junction on the main line where the branch line starts
    pieceM: float = Field(40.0, gt=0)  # noqa: N815 (the main line's connector piece, centred on it)
    # Moves the junction (its piece and the turn-off) along the main line from the real fork,
    # negative = earlier: at a wide fork the main road is already bending at the fork itself.
    shiftM: float = 0.0  # noqa: N815
    offsetM: float  # noqa: N815 (across the main road's end, where the branch connector starts)
    lane: str  # the main lane the row names
    zone: Zone
    insetM: float = Field(40.0, gt=0)  # noqa: N815 (along the branch line, where its first road starts)
    toOffsetM: float = 0.0  # noqa: N815 (across the branch's first road, where the connector lands)
    toLane: str = "R1"  # noqa: N815
    turnsM: tuple[float, float] = (15.0, 15.0)  # noqa: N815


class Join(Strict):
    at: LatLon  # the real junction on the main line where the branch line ends
    pieceM: float = Field(40.0, gt=0)  # noqa: N815
    shiftM: float = 0.0  # noqa: N815 (as Leave.shiftM; positive = later, past the real junction)
    offsetM: float  # noqa: N815 (across the main road's start, where the branch connector lands)
    lane: str
    insetM: float = Field(40.0, gt=0)  # noqa: N815 (back from the branch line's end, where its last road ends)
    fromOffsetM: float = 0.0  # noqa: N815 (across the branch's last road, where the connector starts)
    fromLane: str = "R1"  # noqa: N815
    turnsM: tuple[float, float] = (15.0, 15.0)  # noqa: N815


class Branch(Strict):
    """A junction choice: ``line`` leaves line ``of`` at ``leave`` and rejoins it at ``join``."""

    id: str = Field(pattern=ID)  # the branch id the routes name (the career's `route#id`)
    line: str
    of: str
    leave: Leave
    join: Join
    kind: Literal["shortcut", "detour", "alternate"] | None = None
    marked: bool = True
    sign: str | None = None
    connectorWidthM: float = Field(6.0, gt=0, le=12)  # noqa: N815 (the connectors' one shortcut lane)
    # Names the junction roads the bake makes for it (<network>-<label>-leave, -join, -in, -out);
    # the line id when left out. The route-facing `id` keeps the id the game would derive (the
    # branch's first road), so a career's `route#id` never changes with it.
    label: str | None = Field(None, pattern=ID)

    @property
    def tag(self) -> str:
        return self.label or self.line


class StartGrid(Strict):
    rows: int = 3
    perRow: int = 2  # noqa: N815
    rowGapM: float = 8  # noqa: N815


class NetRoute(Strict):
    id: str = Field(pattern=OSM_ID)
    name: str
    line: str
    startRoad: str  # noqa: N815
    startS: float = 40.0  # noqa: N815
    finishRoad: str  # noqa: N815
    finishS: float = -40.0  # noqa: N815 (a negative value counts back from the road's end)
    notes: str = ROUTE_NOTES
    startGrid: StartGrid = StartGrid()  # noqa: N815


class NetworkConfig(Strict):
    id: str = Field(pattern=OSM_ID)
    name: str
    region: str
    crs: Crs
    osmQuery: str  # noqa: N815
    osmExtract: str  # noqa: N815 (cache path, relative to tools/gis)
    outRoot: str  # noqa: N815 (the region pack folder, relative to the repo root)
    sampleSpacingM: float = Field(2.0, ge=1, le=10)  # noqa: N815
    bridgeRailHeightM: float = Field(1.0, gt=0)  # noqa: N815
    waysLabel: str = "OSM"  # noqa: N815
    networkNotes: str  # noqa: N815
    lines: list[Line]
    branches: list[Branch] = Field(default_factory=list)
    routes: list[NetRoute]

    @staticmethod
    def load(path: Path) -> NetworkConfig:
        return NetworkConfig.model_validate_json(path.read_text(encoding="utf-8"))

    def line(self, lid: str) -> Line:
        for ln in self.lines:
            if ln.id == lid:
                return ln
        raise ValueError(f"network {self.id}: no line {lid}")

    def elevation_extract(self, ln: Line) -> str:
        return f".cache/usgs/{self.id}-{ln.id}.json"


# ----------------------------------------------------------------------------------------------
# Lines: path, profile, closure


def branch_of_line(cfg: NetworkConfig, lid: str) -> Branch | None:
    return next((b for b in cfg.branches if b.line == lid), None)


def stretch_config(cfg: NetworkConfig, ln: Line) -> BakeConfig:
    """The stretch config one line bakes with, so a line is exactly a stretch bake's path and
    profile (compression off: a network keeps its real lengths, so the lines still meet)."""
    br = branch_of_line(cfg, ln.id)
    start = br.leave.at if br else ln.start
    end = br.join.at if br else ln.end
    if start is None or end is None:
        raise ValueError(f"line {ln.id}: a main line needs start and end")
    return BakeConfig(
        id=f"{cfg.id}-{ln.id}",
        name=ln.id,
        region=cfg.region,
        crs=cfg.crs,
        osmExtract=cfg.osmExtract,
        elevationExtract=cfg.elevation_extract(ln),
        osmQuery=cfg.osmQuery,
        outRoot=cfg.outRoot,
        pathFrom=ln.pathFrom,
        via=ln.via,
        pathTo=ln.pathTo,
        routeTags=ln.routeTags,
        respectOneway=ln.respectOneway,
        splitAt=ln.splitAt,
        splitOnNameChange=ln.splitOnNameChange,
        minRoadM=ln.minRoadM,
        splitBridgeMinM=ln.splitBridgeMinM,
        realName=ln.realName or "real road",
        realNameFromOsm=True,
        start=start,
        end=end,
        roads=ln.roads,
        route=Route(id=f"osm-{ln.id}-line", name=ln.id),
        smoothing=ln.smoothing,
        compression=Compression(enabled=False),
        elevation=ln.elevation,
        sampleSpacingM=cfg.sampleSpacingM,
        laneWidthM=ln.crossSection.laneWidthM,
    )


def smoothstep(u: F64) -> F64:
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3 - 2 * u)


def correction(s: F64, anchors: list[tuple[float, float, float]]) -> tuple[F64, F64]:
    """The closure correction at each s: zero at the line's start, the anchor errors (ex, ez) at
    their s, a smoothstep between consecutive anchors and held after the last one."""
    pts = sorted([(0.0, 0.0, 0.0), *anchors])
    ex = np.zeros_like(s)
    ez = np.zeros_like(s)
    for (s0, x0, z0), (s1, x1, z1) in pairwise(pts):
        if s1 <= s0:
            raise ValueError(f"two junctions at s {s0:.1f} and {s1:.1f} on one line")
        u = smoothstep((s - s0) / (s1 - s0))
        on = (s >= s0) & (s <= s1)
        ex = np.where(on, x0 + (x1 - x0) * u, ex)
        ez = np.where(on, z0 + (z1 - z0) * u, ez)
    last = pts[-1]
    ex = np.where(s > last[0], last[1], ex)
    ez = np.where(s > last[0], last[2], ez)
    return ex, ez


def heading_of(x: F64, z: F64, h: float) -> F64:
    """Unwrapped heading at each point (0 = north, clockwise), from central differences."""
    hx = np.gradient(x, h)
    hz = np.gradient(z, h)
    return np.unwrap(np.arctan2(hx, -hz))


def resample(p: Profile, x: F64, z: F64) -> Profile:
    """The profile with new positions, resampled at uniform arc length along them."""
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(z)))])
    m = max(2, round(float(cum[-1])))
    h = float(cum[-1]) / m
    s: F64 = h * np.arange(m + 1, dtype=np.float64)
    idx = np.interp(s, cum, np.arange(len(cum), dtype=np.float64))
    near = np.clip(np.rint(idx).astype(np.int64), 0, len(cum) - 1)
    nx = np.interp(s, cum, x)
    nz = np.interp(s, cum, z)
    ny = np.interp(s, cum, p.y)
    heading = heading_of(nx, nz, h)
    return Profile(
        h=h,
        s=s,
        s_real=np.interp(s, cum, p.s_real),
        x=nx,
        y=ny,
        z=nz,
        heading=heading,
        kappa=np.gradient(heading, h),
        grade=np.gradient(ny, h),
        bridge=p.bridge[near],
        speed=p.speed[near],
        real_length=p.real_length,
        compressed=[],
        way=p.way[near] if p.way is not None else None,
        names=dict(p.names),
    )


@dataclass
class BakedLine:
    """A line after closure: its profile, its real path, and how far each junction drifted."""

    line: Line
    cfg: BakeConfig
    rp: RealPath
    p: Profile
    usgs: FetchMeta | None
    drift: dict[str, float] = field(default_factory=dict)  # junction label -> metres corrected

    def s_at(self, pt: LatLon) -> float:
        """Arc length on the closed profile at the grid point nearest a real point."""
        frame = Frame(self.cfg.crs.originLatDeg, self.cfg.crs.originLonDeg)
        x, z = frame.to_world(pt.lat, pt.lon)
        return float(self.p.s[int(np.argmin(np.hypot(self.p.x - x, self.p.z - z)))])

    def at(self, s: float) -> tuple[float, float, float, float]:
        """(x, y, z, heading) on the profile at s."""
        p = self.p
        return (
            float(np.interp(s, p.s, p.x)),
            float(np.interp(s, p.s, p.y)),
            float(np.interp(s, p.s, p.z)),
            float(np.interp(s, p.s, p.heading)),
        )


def real_point(rp: RealPath, frame: Frame, pt: LatLon) -> tuple[float, float, float]:
    """The point of the real path nearest a real point: (real s, x, z)."""
    x, z = frame.to_world(pt.lat, pt.lon)
    best, best_s = math.inf, 0.0
    for i in range(len(rp.x) - 1):
        ax, az, bx, bz = rp.x[i], rp.z[i], rp.x[i + 1], rp.z[i + 1]
        dx, dz = bx - ax, bz - az
        ll = dx * dx + dz * dz
        t = 0.0 if ll == 0 else min(1.0, max(0.0, ((x - ax) * dx + (z - az) * dz) / ll))
        d = math.hypot(ax + t * dx - x, az + t * dz - z)
        if d < best:
            best, best_s = d, float(rp.cum[i] + t * math.sqrt(ll))
    return best_s, float(np.interp(best_s, rp.cum, rp.x)), float(np.interp(best_s, rp.cum, rp.z))


type Land = Callable[[BakeConfig, RealPath], tuple[F64 | None, F64 | None, FetchMeta | None]]


def bake_line(cfg: NetworkConfig, ln: Line, ways: list[Way], land: Land) -> BakedLine:
    """A line's profile, pinned onto the real map at every junction it meets (the closure)."""
    sc = stretch_config(cfg, ln)
    rp = real_path(sc, ways)
    land_s, land_y, usgs = land(sc, rp)
    p = build_profile(sc, rp, land_y, land_s)
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    anchors: list[tuple[float, float, float]] = []
    labels: list[tuple[str, float]] = []
    marks: list[tuple[str, LatLon]] = []
    for b in cfg.branches:
        if b.of == ln.id:
            marks += [(f"{b.tag} leave", b.leave.at), (f"{b.tag} join", b.join.at)]
        if b.line == ln.id:
            marks.append((f"{b.tag} join", b.join.at))  # its start is the leave point already
    for label, pt in marks:
        s_real, rx, rz = real_point(rp, frame, pt)
        s = float(np.interp(s_real, p.s_real, p.s))
        bx, bz = float(np.interp(s, p.s, p.x)), float(np.interp(s, p.s, p.z))
        anchors.append((s, rx - bx, rz - bz))
        labels.append((label, math.hypot(rx - bx, rz - bz)))
    if not anchors:
        return BakedLine(ln, sc, rp, p, usgs)
    ex, ez = correction(p.s, anchors)
    closed = resample(p, p.x + ex, p.z + ez)
    return BakedLine(ln, sc, rp, closed, usgs, dict(labels))


# ----------------------------------------------------------------------------------------------
# Connector curves (the hand-made compiler's branch shape, src/road/compile.ts buildBranchCurve)


def ease_turn(t: float) -> float:
    return t * t * t * (10 - 15 * t + 6 * t * t)


def ease_rate(t: float) -> float:
    return 30 * t * t * (1 - t) * (1 - t)


@dataclass(frozen=True)
class Shape:
    h0: float
    phi1: float
    phi2: float
    l1: float
    ls: float
    l2: float

    @property
    def length(self) -> float:
        return self.l1 + self.ls + self.l2

    def heading(self, u: float) -> float:
        if u <= self.l1:
            return self.h0 + self.phi1 * ease_turn(u / self.l1)
        if u <= self.l1 + self.ls:
            return self.h0 + self.phi1
        t = min(1.0, (u - self.l1 - self.ls) / self.l2)
        return self.h0 + self.phi1 + self.phi2 * ease_turn(t)

    def kappa(self, u: float) -> float:
        if u <= self.l1:
            return self.phi1 / self.l1 * ease_rate(u / self.l1)
        if u <= self.l1 + self.ls:
            return 0.0
        t = min(1.0, (u - self.l1 - self.ls) / self.l2)
        return self.phi2 / self.l2 * ease_rate(t)

    def end(self, x0: float, z0: float, n: int) -> tuple[float, float]:
        du = self.length / n
        x, z = x0, z0
        for k in range(n):
            h = self.heading((k + 0.5) * du)
            x += math.sin(h) * du
            z -= math.cos(h) * du
        return x, z


def wrap_to(angle: float, ref: float) -> float:
    while angle - ref > math.pi:
        angle -= 2 * math.pi
    while angle - ref < -math.pi:
        angle += 2 * math.pi
    return angle


def solve_shape(
    x0: float, z0: float, h0: float, x1: float, z1: float, h1: float, l1: float, l2: float
) -> Shape | None:
    """Newton on the first turn's angle and the straight's length so the curve lands on (x1, z1);
    the second turn takes the rest of the heading. None when no straight fits."""
    h1 = wrap_to(h1, h0)
    chord = math.hypot(x1 - x0, z1 - z0)
    n = max(16, round(chord / 0.25))
    phi1 = wrap_to(math.atan2(x1 - x0, -(z1 - z0)), h0) - h0
    ls = chord - (l1 + l2) / 2

    def shape(a: float, b: float) -> Shape:
        return Shape(h0, a, h1 - h0 - a, l1, b, l2)

    for _ in range(60):
        ex, ez = shape(phi1, ls).end(x0, z0, n)
        rx, rz = ex - x1, ez - z1
        if rx * rx + rz * rz < 1e-14:
            break
        px, pz = shape(phi1 + 1e-7, ls).end(x0, z0, n)
        lx, lz = shape(phi1, ls + 1e-5).end(x0, z0, n)
        a, c = (px - ex) / 1e-7, (pz - ez) / 1e-7
        bb, d = (lx - ex) / 1e-5, (lz - ez) / 1e-5
        det = a * d - bb * c
        if det == 0:
            return None
        phi1 -= (d * rx - bb * rz) / det
        ls -= (-c * rx + a * rz) / det
        if not math.isfinite(phi1) or not math.isfinite(ls):
            return None
    s = shape(phi1, ls)
    ex, ez = s.end(x0, z0, n)
    if not (ls > 0) or math.hypot(ex - x1, ez - z1) > 1e-3:
        return None
    return s


def connector_shape(
    a: tuple[float, float, float], b: tuple[float, float, float], turns: tuple[float, float], width: float
) -> Shape:
    """The curve from point a to point b (x, z, heading), with the given turns or others; refused
    when even the best one bends too hard for its lane (the road lint wants |kappa| x half-width
    under 0.5; this keeps it under 0.45)."""
    best: Shape | None = None
    worst_kd = math.inf
    for scale in (1.0, 1.5, 0.75, 2.0, 0.5, 2.5, 0.35, 3.0):
        sh = solve_shape(a[0], a[1], a[2], b[0], b[1], b[2], turns[0] * scale, turns[1] * scale)
        if sh is None:
            continue
        kd = max(abs(sh.kappa(u)) for u in np.linspace(0, sh.length, 200)) * (width / 2)
        if kd < worst_kd:
            best, worst_kd = sh, kd
        if kd < 0.35:
            break
    if best is None or worst_kd >= 0.45:
        raise ValueError(f"no connector fits from {a} to {b} (|kappa| x half-width {worst_kd:.2f})")
    return best


# ----------------------------------------------------------------------------------------------
# Roads


@dataclass
class Piece:
    """One baked road's geometry and what it is."""

    id: str
    name: str
    real_name: str
    x: F64
    y: F64
    z: F64
    kappa_ends: tuple[float, float]
    lane_section: Json
    speed: float
    surface: str
    tags: list[Json]
    barriers: list[Json]
    features: list[Json]
    connector: bool = False
    frm: str = ""
    to: str = ""


def lane_section(cs: CrossSection) -> Json:
    section: Json = {"s0": 0, "lanes": lanes(cs.laneWidthM, cs.lanesPerDirection, cs.medianM)}
    if cs.medianM > 0:
        section["median"] = {"widthM": cs.medianM, "kind": cs.medianKind}
    if cs.verges is not None:
        section["verges"] = cs.verges.model_dump(exclude_none=True)
    return section


def shortcut_section(width: float) -> Json:
    return {
        "s0": 0,
        "lanes": [{"id": "S1", "dCenterM": 0, "widthM": width, "direction": 1, "kind": "shortcut"}],
    }


def resample_line(bl: BakedLine, s_a: float, s_b: float, spacing: float) -> tuple[F64, F64, F64, F64]:
    """Uniform samples (s, x, y, z) of a line between two arc lengths."""
    length = s_b - s_a
    n = max(1, round(length / spacing))
    s: F64 = s_a + (length / n) * np.arange(n + 1, dtype=np.float64)
    s[-1] = s_b
    p = bl.p
    return s, np.interp(s, p.s, p.x), np.interp(s, p.s, p.y), np.interp(s, p.s, p.z)


def speed_of(bl: BakedLine, a: float, b: float) -> float:
    if bl.line.speedLimitMps is not None:
        return bl.line.speedLimitMps
    p = bl.p
    on = (p.s >= a) & (p.s <= b)
    speeds = [round(float(v), 1) for v in p.speed[on] if math.isfinite(v)]
    if not speeds:
        return 24.6
    vals, counts = np.unique(speeds, return_counts=True)
    return float(vals[int(np.argmax(counts))])


def tag_ranges(bl: BakedLine, a: float, b: float, land: list[str], sides: SideTags) -> list[Json]:
    """Tags for the line stretch [a, b]: bridges (and the sea under a sea deck) by the real map, the
    road's tags (both sides, then each side's own) everywhere else (scenery stands on land only:
    playtest 1c item 3)."""
    p = bl.p
    length = b - a
    on = (p.s >= a - 1e-9) & (p.s <= b + 1e-9)
    idx = np.nonzero(on)[0]
    tags: list[Json] = []
    decks: list[tuple[float, float]] = []
    water = bl.line.elevation.bridgeDeck == "sea"
    if len(idx):
        for ra, rb in runs_of(p.bridge[idx[0] : idx[-1] + 1]):
            t0 = r4(max(0.0, float(p.s[idx[0] + ra]) - a))
            t1 = r4(min(float(p.s[idx[0] + rb - 1]) - a, length))
            if t1 - t0 < 1:
                continue
            decks.append((t0, t1))
            tags.append({"s0": t0, "s1": t1, "side": "both", "tag": "bridge"})
            if water:
                tags.append({"s0": t0, "s1": t1, "side": "both", "tag": "water-open"})
    tags += [
        {"s0": r4(t0), "s1": r4(t1), "side": side, "tag": t}
        for side, names in (("both", land), ("left", sides.left), ("right", sides.right))
        for t in names
        for t0, t1 in without(0, length, decks)
    ]
    return tags


def rails(tags: list[Json], height: float) -> list[Json]:
    return [
        {"s0": t["s0"], "s1": t["s1"], "side": "both", "kind": "rail", "heightM": height}
        for t in tags
        if t["tag"] == "bridge"
    ]


@dataclass
class LineCuts:
    """A line cut into pieces: (s_a, s_b, piece label or None for an ordinary road)."""

    spans: list[tuple[float, float, str | None]]


def line_cuts(cfg: NetworkConfig, bl: BakedLine, pieces: list[tuple[float, float, str]]) -> LineCuts:
    """The line's ordinary roads and junction pieces, in order along it."""
    p = bl.p
    br = branch_of_line(cfg, bl.line.id)
    lo = br.leave.insetM if br else 0.0
    hi = float(p.s[-1]) - (br.join.insetM if br else 0.0)
    if hi - lo < 60:
        raise ValueError(f"line {bl.line.id}: {hi - lo:.0f} m left between its insets")
    base = {float(p.s[a]) for a, _ in road_splits(bl.cfg, p)} | {float(p.s[road_splits(bl.cfg, p)[-1][1]])}
    cuts = {lo, hi}
    for s0, s1, _ in pieces:
        cuts |= {s0, s1}
    for c in base:
        if lo + PIECE_CLEAR_M <= c <= hi - PIECE_CLEAR_M and all(
            not (s0 - PIECE_CLEAR_M < c < s1 + PIECE_CLEAR_M) for s0, s1, _ in pieces
        ):
            cuts.add(c)
    ordered = sorted(c for c in cuts if lo <= c <= hi)
    spans: list[tuple[float, float, str | None]] = []
    for a, b in pairwise(ordered):
        label = next((lab for s0, s1, lab in pieces if abs(s0 - a) < 1e-6 and abs(s1 - b) < 1e-6), None)
        spans.append((a, b, label))
    return LineCuts(spans)


def make_piece(
    cfg: NetworkConfig,
    bl: BakedLine,
    a: float,
    b: float,
    rn: RoadName | None,
    pid: str,
    name: str,
    land: list[str],
    sides: SideTags,
    cs: CrossSection,
) -> Piece:
    _, x, y, z = resample_line(bl, a, b, cfg.sampleSpacingM)
    tags = tag_ranges(bl, a, b, land, sides)
    features: list[Json] = []
    length = r4(b - a)
    for f in rn.features if rn else []:
        if not 0 <= f.s0 <= f.s1 <= length:
            raise ValueError(f"{pid}: feature {f.id} at {f.s0}..{f.s1} is off the {length} m road")
        features.append(f.model_dump(exclude_none=True))
    p = bl.p
    i0 = int(np.argmin(np.abs(p.s - a)))
    i1 = int(np.argmin(np.abs(p.s - b)))
    real = longest_name(p, i0, i1) or bl.line.realName or name
    return Piece(
        id=pid,
        name=name,
        real_name=real,
        x=x,
        y=y,
        z=z,
        kappa_ends=(float(np.interp(a, p.s, p.kappa)), float(np.interp(b, p.s, p.kappa))),
        lane_section=lane_section(cs),
        speed=speed_of(bl, a, b),
        surface=bl.line.surface,
        tags=tags,
        barriers=rails(tags, cfg.bridgeRailHeightM),
        features=features,
        connector=rn is None,
    )


def offset_point(bl: BakedLine, s: float, d: float) -> tuple[float, float, float, float]:
    """(x, y, z, heading) at s on a line, d metres to the right of it."""
    x, y, z, h = bl.at(s)
    return x + d * math.cos(h), y, z + d * math.sin(h), h


def curve_piece(
    pid: str,
    name: str,
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    turns: tuple[float, float],
    width: float,
    spacing: float,
    speed: float,
    land: list[str],
) -> Piece:
    """A branch connector road: the solved curve from a to b, its height eased between theirs."""
    sh = connector_shape((a[0], a[2], a[3]), (b[0], b[2], b[3]), turns, width)
    fine = max(64, math.ceil(sh.length / 0.1))
    du = sh.length / fine
    fx = [a[0]]
    fz = [a[2]]
    for k in range(fine):
        h = sh.heading((k + 0.5) * du)
        fx.append(fx[-1] + math.sin(h) * du)
        fz.append(fz[-1] - math.cos(h) * du)
    u = du * np.arange(fine + 1)
    n = max(1, round(sh.length / spacing))
    s: F64 = (sh.length / n) * np.arange(n + 1, dtype=np.float64)
    s[-1] = sh.length
    x = np.interp(s, u, np.array(fx))
    z = np.interp(s, u, np.array(fz))
    x[-1], z[-1] = b[0], b[2]
    y = a[1] + (b[1] - a[1]) * smoothstep(s / sh.length)
    length = float(sh.length)
    return Piece(
        id=pid,
        name=name,
        real_name=name,
        x=x,
        y=y,
        z=z,
        kappa_ends=(sh.kappa(0.0), sh.kappa(sh.length)),
        lane_section=shortcut_section(width),
        speed=speed,
        surface="asphalt",
        tags=[{"s0": 0, "s1": r4(length), "side": "both", "tag": t} for t in land],
        barriers=[],
        features=[],
        connector=True,
    )


def discrete_kappa(x: F64, z: F64, spacing: float, ends: tuple[float, float]) -> F64:
    """Curvature from the sampled positions: the turn between consecutive chords over the spacing
    (what the road lints measure), so stored curvature and positions agree by construction."""
    hd = np.unwrap(np.arctan2(np.diff(x), -np.diff(z)))
    k = np.empty(len(x))
    k[1:-1] = np.diff(hd) / spacing
    k[0], k[-1] = ends
    return k


def road_json(cfg: NetworkConfig, pc: Piece, prov: Json, notes: str) -> Json:
    length = float(np.sum(np.hypot(np.diff(pc.x), np.diff(pc.z))))
    n = len(pc.x) - 1
    spacing = length / n
    kappa = discrete_kappa(pc.x, pc.z, spacing, pc.kappa_ends)
    grade = np.gradient(pc.y, spacing) if n > 1 else np.full(n + 1, (pc.y[-1] - pc.y[0]) / length)
    cols = {
        "x": [r4(v) for v in pc.x],
        "y": [r4(v) for v in pc.y],
        "z": [r4(v) for v in pc.z],
        "kappa": [r5(v) for v in kappa],
        "grade": [r5(v) for v in grade],
        "bankRad": [0.0] * (n + 1),
    }
    length = r4(length)
    clip = [{**t, "s1": min(t["s1"], length)} for t in pc.tags]
    return {
        "type": "road",
        "id": pc.id,
        "name": pc.name,
        "realName": pc.real_name,
        "network": cfg.id,
        "from": pc.frm,
        "to": pc.to,
        "lengthM": length,
        "sampleSpacingM": length / n,
        "speedLimitMps": pc.speed,
        "surface": pc.surface,
        "laneSections": [pc.lane_section],
        "tags": clip,
        "features": pc.features,
        "barriers": [{**b, "s1": min(b["s1"], length)} for b in pc.barriers],
        "samples": {"encoding": "json-columns", "columns": list(cols), "data": cols},
        "provenance": prov,
        "meta": {"status": "live", "notes": notes},
    }


# ----------------------------------------------------------------------------------------------
# The network


def provenance(cfg: NetworkConfig, created_at: str, osm: FetchMeta, lines: list[BakedLine]) -> Json:
    sources: list[Json] = [
        {
            "name": "OpenStreetMap",
            "spdx": "ODbL-1.0",
            "attribution": OSM_ATTRIBUTION,
            "url": "https://www.openstreetmap.org/copyright",
            "query": osm.query,
            "retrievedAt": osm.retrievedAt,
            "sha256": osm.sha256,
        }
    ]
    for bl in lines:
        if bl.usgs is not None:
            sources.append(
                {
                    "name": "USGS 3DEP elevation",
                    "spdx": "LicenseRef-US-Public-Domain",
                    "attribution": USGS_ATTRIBUTION,
                    "url": "https://www.usgs.gov/3d-elevation-program",
                    "query": f"{bl.usgs.url} {bl.usgs.query} (line {bl.line.id})",
                    "retrievedAt": bl.usgs.retrievedAt,
                    "sha256": bl.usgs.sha256,
                }
            )
    drift = max((d for bl in lines for d in bl.drift.values()), default=0.0)
    return {
        "origin": "gis-pipeline",
        "author": "tools/gis",
        "createdAt": created_at,
        "tool": {
            "name": "tools/gis/src/tbgis/network.py",
            "version": __version__,
            "configRef": f"tools/gis/networks/{cfg.id}.json",
        },
        "sources": sources,
        "modified": True,
        "modifications": (
            f"{len(cfg.lines)} real {cfg.waysLabel} paths stitched through the OSM graph, heading "
            "Gaussian-smoothed, positions re-integrated from heading, then pinned back onto the real "
            f"junctions (largest drift closed {drift:.1f} m, spread back along each line), resampled at "
            f"{cfg.sampleSpacingM:g} m with curvature from the sampled positions; land elevation from 3DEP "
            "low-pass filtered, bridge decks synthesized (3DEP is bare earth); lanes simplified to the "
            "configured cross-section; junction connector roads synthesized (a turn, a straight and a turn)"
        ),
    }


@dataclass
class NetworkBake:
    network: Json
    roads: list[Json]
    routes: list[Json]
    report: Json


def bake_network(
    cfg: NetworkConfig, osm: FetchMeta, ways: list[Way], land: Land, created_at: str
) -> NetworkBake:
    lines = {ln.id: bake_line(cfg, ln, ways, land) for ln in cfg.lines}
    for b in cfg.branches:
        if b.of not in lines or b.line not in lines:
            raise ValueError(f"branch {b.id}: unknown line {b.of if b.of not in lines else b.line}")
    prov = provenance(cfg, created_at, osm, list(lines.values()))
    notes = (
        f"Baked by tools/gis from networks/{cfg.id}.json: real geometry, gameplay-fied (see "
        "provenance.modifications). Regenerate with `tbgis network`; never hand-edit."
    )

    # Junction pieces on each main line: (s0, s1, label).
    pieces: dict[str, list[tuple[float, float, str]]] = {lid: [] for lid in lines}
    centre: dict[str, float] = {}
    for b in cfg.branches:
        main = lines[b.of]
        for kind, at, piece, shift in (
            ("leave", b.leave.at, b.leave.pieceM, b.leave.shiftM),
            ("join", b.join.at, b.join.pieceM, b.join.shiftM),
        ):
            s = main.s_at(at) + shift
            key = f"{b.tag}-{kind}"
            centre[key] = s
            pieces[b.of].append((r4(s - piece / 2), r4(s + piece / 2), key))
    for lid, ps in pieces.items():
        ps.sort()
        for (_, a1, la), (b0, _, lb) in pairwise(ps):
            if b0 - a1 < 2 * PIECE_CLEAR_M:
                raise ValueError(f"line {lid}: junctions {la} and {lb} are too close")

    # Cut every line into pieces and ordinary roads.
    order: list[Piece] = []
    by_line: dict[str, list[tuple[Piece, str | None]]] = {}
    for lid, bl in lines.items():
        cuts = line_cuts(cfg, bl, pieces[lid])
        ordinary = [sp for sp in cuts.spans if sp[2] is None]
        if len(ordinary) != len(bl.line.roads):
            spans = ", ".join(
                f"{sa:.0f}-{sb:.0f} m ({longest_name(bl.p, *idx(bl, sa, sb)) or 'unnamed'})"
                for sa, sb, _ in ordinary
            )
            raise ValueError(
                f"line {lid} cuts into {len(ordinary)} roads ({spans}); config names {len(bl.line.roads)}"
            )
        names = iter(bl.line.roads)
        out: list[tuple[Piece, str | None]] = []
        prev: RoadName | None = None
        for sa, sb, label in cuts.spans:
            if label is None:
                rn = next(names)
                ln = bl.line
                pc = make_piece(
                    cfg, bl, sa, sb, rn, rn.id, rn.name, rn.tags, ln.sides_of(rn.id), ln.lanes_of(rn.id)
                )
                prev = rn
            else:
                # A junction piece dresses and lanes like the road before it.
                pid = f"{cfg.id}-{label}"
                tags_before, sides = (prev.tags, bl.line.sides_of(prev.id)) if prev else ([], SideTags())
                cs = bl.line.lanes_of(prev.id) if prev else bl.line.crossSection
                pc = make_piece(cfg, bl, sa, sb, None, pid, f"{label} junction", tags_before, sides, cs)
            out.append((pc, label))
        by_line[lid] = out

    junctions: list[Json] = []

    def new_junction(x: float, y: float, z: float) -> Json:
        j: Json = {
            "id": f"{cfg.id}-j{len(junctions)}",
            "x": r4(x),
            "y": r4(y),
            "z": r4(z),
            "ends": [],
            "connectors": [],
            "control": "none",
        }
        junctions.append(j)
        return j

    by_label: dict[str, Json] = {}
    for lid, seq in by_line.items():
        bl = lines[lid]
        first = seq[0][0]
        j0 = new_junction(first.x[0], first.y[0], first.z[0])
        j0["ends"].append({"road": first.id, "end": "from"})
        first.frm = j0["id"]
        for k, (pc, label) in enumerate(seq):
            nxt = seq[k + 1] if k + 1 < len(seq) else None
            if label is not None:
                before, after = seq[k - 1][0], nxt[0] if nxt else None
                if after is None or k == 0:
                    raise ValueError(f"junction {label} must sit between two roads of line {lid}")
                x, y, z, _ = bl.at(centre[label])
                j = new_junction(x, y, z)
                by_label[label] = j
                pc.frm = pc.to = j["id"]
                before.to = j["id"]
                after.frm = j["id"]
                j["ends"] += [{"road": before.id, "end": "to"}, {"road": after.id, "end": "from"}]
                # One row per drive lane both roads have (a lane that ends at the junction has none).
                after_lanes = {ln["id"] for ln in after.lane_section["lanes"] if ln["kind"] == "drive"}
                for ln in pc.lane_section["lanes"]:
                    if ln["kind"] != "drive" or ln["id"] not in after_lanes:
                        continue
                    j["connectors"].append(
                        {
                            "id": f"cx-{pc.id}-{ln['id'].lower()}",
                            "road": pc.id,
                            "from": {"road": before.id, "end": "to", "lane": ln["id"]},
                            "to": {"road": after.id, "end": "from", "lane": ln["id"]},
                        }
                    )
                continue
            if nxt is not None and nxt[1] is None:
                j = new_junction(pc.x[-1], pc.y[-1], pc.z[-1])
                j["ends"] += [{"road": pc.id, "end": "to"}, {"road": nxt[0].id, "end": "from"}]
                pc.to = j["id"]
                nxt[0].frm = j["id"]
        last = seq[-1][0]
        if not last.to:
            je = new_junction(last.x[-1], last.y[-1], last.z[-1])
            je["ends"].append({"road": last.id, "end": "to"})
            last.to = je["id"]
        order += [pc for pc, _ in seq]

    # Branch connectors.
    branch_roads: dict[str, list[str]] = {}
    report_branches: list[Json] = []
    for b in cfg.branches:
        main, line = lines[b.of], lines[b.line]
        mseq, bseq = by_line[b.of], by_line[b.line]
        k_leave = next(i for i, (_, lab) in enumerate(mseq) if lab == f"{b.tag}-leave")
        k_join = next(i for i, (_, lab) in enumerate(mseq) if lab == f"{b.tag}-join")
        if k_join <= k_leave:
            raise ValueError(f"branch {b.id}: it must rejoin after it leaves")
        before, after = mseq[k_leave - 1][0], mseq[k_join + 1][0]
        first, last = bseq[0][0], bseq[-1][0]
        if b.id != first.id:
            # The game derives a branch's id from its first road (docs/content-packs.md, Branches);
            # a named one keeps that id, so a career's `route#id` holds either way.
            raise ValueError(f"branch {b.id}: name it {first.id}, the id the game derives")
        land_in, land_out = bl_tags(bseq[0]), bl_tags(bseq[-1])
        leave_pt = offset_point(main, centre[f"{b.tag}-leave"] - b.leave.pieceM / 2, b.leave.offsetM)
        land_pt = offset_point(line, b.leave.insetM, b.leave.toOffsetM)
        kin = curve_piece(
            f"{cfg.id}-{b.tag}-in",
            f"{b.tag} turn-off",
            leave_pt,
            land_pt,
            b.leave.turnsM,
            b.connectorWidthM,
            cfg.sampleSpacingM,
            min(before.speed, first.speed),
            land_in,
        )
        s_last = float(line.p.s[-1]) - b.join.insetM
        a2 = offset_point(line, s_last, b.join.fromOffsetM)
        t2 = offset_point(main, centre[f"{b.tag}-join"] + b.join.pieceM / 2, b.join.offsetM)
        kout = curve_piece(
            f"{cfg.id}-{b.tag}-out",
            f"{b.tag} rejoin",
            a2,
            t2,
            b.join.turnsM,
            b.connectorWidthM,
            cfg.sampleSpacingM,
            min(last.speed, after.speed),
            land_out,
        )
        js, jm = by_label[f"{b.tag}-leave"], by_label[f"{b.tag}-join"]
        # The branch line's own end junctions become the split and merge junctions.
        junctions[:] = [j for j in junctions if j["id"] not in (first.frm, last.to)]
        first.frm, last.to = js["id"], jm["id"]
        kin.frm = kin.to = js["id"]
        kout.frm = kout.to = jm["id"]
        js["ends"].append({"road": first.id, "end": "from"})
        jm["ends"].append({"road": last.id, "end": "to"})
        before_len = float(np.sum(np.hypot(np.diff(before.x), np.diff(before.z))))
        js["connectors"].append(
            {
                "id": f"cx-{kin.id}",
                "road": kin.id,
                "from": {"road": before.id, "end": "to", "lane": b.leave.lane},
                "to": {"road": first.id, "end": "from", "lane": b.leave.toLane},
                "splitZone": {
                    "s0": r4(before_len - b.leave.zone.lengthM),
                    "s1": r4(before_len),
                    "d0": b.leave.zone.d0,
                    "d1": b.leave.zone.d1,
                },
            }
        )
        jm["connectors"].append(
            {
                "id": f"cx-{kout.id}",
                "road": kout.id,
                "from": {"road": last.id, "end": "to", "lane": b.join.fromLane},
                "to": {"road": after.id, "end": "from", "lane": b.join.lane},
            }
        )
        order += [kin, kout]
        branch_roads[b.id] = [kin.id, *(pc.id for pc, _ in bseq), kout.id]
        main_len = centre[f"{b.tag}-join"] - centre[f"{b.tag}-leave"]
        branch_len = (
            float(np.sum(np.hypot(np.diff(kin.x), np.diff(kin.z))))
            + sum(float(np.sum(np.hypot(np.diff(pc.x), np.diff(pc.z)))) for pc, _ in bseq)
            + float(np.sum(np.hypot(np.diff(kout.x), np.diff(kout.z))))
            - b.leave.pieceM / 2
            - b.join.pieceM / 2
        )
        report_branches.append(
            {
                "id": b.id,
                "mainM": round(main_len, 1),
                "branchM": round(branch_len, 1),
                "savesM": round(main_len - branch_len, 1),
            }
        )

    # Junction ids in order (the branch lines' own end junctions were folded into their split and
    # merge junctions above).
    rename = {j["id"]: f"{cfg.id}-j{i}" for i, j in enumerate(junctions)}
    for j in junctions:
        j["id"] = rename[j["id"]]
    for pc in order:
        pc.frm, pc.to = rename[pc.frm], rename[pc.to]

    # Road order: each line's roads in order, then the branch connectors.
    roads_json = [road_json(cfg, pc, prov, notes) for pc in order]
    by_id = {r["id"]: r for r in roads_json}

    routes = [route_json(cfg, rt, by_line, branch_roads, by_id, prov) for rt in cfg.routes]
    network = {
        "type": "road-network",
        "id": cfg.id,
        "name": cfg.name,
        "region": cfg.region,
        "crs": {
            "kind": "tmerc",
            "originLatDeg": cfg.crs.originLatDeg,
            "originLonDeg": cfg.crs.originLonDeg,
            "originElevM": 0,
        },
        "chunking": {"kind": "none"},
        "roads": [r["id"] for r in roads_json],
        "junctions": junctions,
        "provenance": prov,
        "meta": {"status": "live", "notes": cfg.networkNotes},
    }
    report = {
        "network": cfg.id,
        "lines": {
            lid: {
                "lengthM": round(float(bl.p.s[-1]), 1),
                "lanesPerDirection": bl.line.crossSection.lanesPerDirection,
                "driftClosedM": {k: round(v, 2) for k, v in bl.drift.items()},
            }
            for lid, bl in lines.items()
        },
        "branches": report_branches,
        "routes": {r["id"]: round(route_length(r, by_id), 1) for r in routes},
        "roads": len(roads_json),
        "junctions": len(junctions),
    }
    return NetworkBake(network, roads_json, routes, report)


def idx(bl: BakedLine, a: float, b: float) -> tuple[int, int]:
    return int(np.argmin(np.abs(bl.p.s - a))), int(np.argmin(np.abs(bl.p.s - b)))


def bl_tags(entry: tuple[Piece, str | None]) -> list[str]:
    """The land tags of an ordinary road (for the connector beside it)."""
    pc = entry[0]
    return sorted({t["tag"] for t in pc.tags if t["tag"] != "bridge" and not t["tag"].startswith("water-")})


def route_length(route: Json, by_id: dict[str, Json]) -> float:
    path = route["mainPath"]
    total = sum(by_id[r]["lengthM"] for r in path)
    total -= route["start"]["s"]
    total -= by_id[path[-1]]["lengthM"] - route["finish"]["s"]
    # The connector pieces between main-path roads count too.
    allowed = set(route["allowedRoads"])
    for r in by_id.values():
        if (
            r["id"] in allowed
            and r["id"] not in path
            and r["from"] == r["to"]
            and r["laneSections"][0]["lanes"][0]["kind"] != "shortcut"
        ):
            total += r["lengthM"]
    return float(total)


def route_json(
    cfg: NetworkConfig,
    rt: NetRoute,
    by_line: dict[str, list[tuple[Piece, str | None]]],
    branch_roads: dict[str, list[str]],
    by_id: dict[str, Json],
    prov: Json,
) -> Json:
    seq = by_line[rt.line]
    ids = [pc.id for pc, _ in seq]
    for rid in (rt.startRoad, rt.finishRoad):
        if rid not in ids or seq[ids.index(rid)][1] is not None:
            raise ValueError(f"route {rt.id}: {rid} is not an ordinary road of line {rt.line}")
    i0, i1 = ids.index(rt.startRoad), ids.index(rt.finishRoad)
    if i1 < i0:
        raise ValueError(f"route {rt.id}: the finish road comes before the start road")
    span = seq[i0 : i1 + 1]
    allowed = {pc.id for pc, _ in span}
    branches: list[Json] = []
    labels = {lab for _, lab in span if lab}
    for b in cfg.branches:
        if b.of == rt.line and f"{b.tag}-leave" in labels and f"{b.tag}-join" in labels:
            allowed |= set(branch_roads[b.id])
            named: Json = {"id": b.id}
            if b.kind:
                named["kind"] = b.kind
            named["marked"] = b.marked
            if b.sign:
                named["sign"] = b.sign
            branches.append({**named, "roads": branch_roads[b.id]})
    finish_len = by_id[rt.finishRoad]["lengthM"]
    finish_s = finish_len + rt.finishS if rt.finishS < 0 else rt.finishS
    main = [pc.id for pc, lab in span if lab is None]
    out: Json = {
        "type": "route",
        "id": rt.id,
        "name": rt.name,
        "network": cfg.id,
        "start": {"road": rt.startRoad, "s": rt.startS, "dir": 1},
        "finish": {"road": rt.finishRoad, "s": r4(finish_s)},
        "mainPath": main,
        "allowedRoads": [r for r in by_id if r in allowed],
        "checkpoints": [{"road": r, "s": r4(by_id[r]["lengthM"] / 2)} for r in main[1:-1]],
    }
    if branches:
        out["branches"] = branches
    out |= {
        "closed": False,
        "startGrid": rt.startGrid.model_dump(),
        "meta": {
            "status": "live",
            "notes": rt.notes,
            "provenance": {k: prov[k] for k in ("origin", "author", "createdAt", "tool", "sources")},
        },
    }
    return out
