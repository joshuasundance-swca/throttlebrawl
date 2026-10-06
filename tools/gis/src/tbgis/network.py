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
from pydantic import Field, model_validator

from tbgis import __version__
from tbgis.config import (
    FEATURE_ID,
    BakeConfig,
    BridgeBarrier,
    Compression,
    Crs,
    Elevation,
    Feature,
    LatLon,
    RoadName,
    Route,
    SideRun,
    Smoothing,
    Stitch,
    Strict,
    Verges,
    bridge_barriers,
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
from tbgis.features import bake_ramps, plus, real_station, stitch_features, stitch_span
from tbgis.fetch import FetchMeta
from tbgis.fun import fun_report
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


type Surface = Literal["asphalt", "concrete", "brick", "cobbles", "gravel", "dirt", "sand", "grass"]


class CrossSection(Strict):
    """A line's lanes: as the stretch config's cross-section fields (docs/content-packs.md)."""

    laneWidthM: float = Field(4.0, ge=2.5, le=5.0)  # noqa: N815
    lanesPerDirection: int = Field(1, ge=1, le=3)  # noqa: N815
    medianM: float = Field(0.0, ge=0, le=30)  # noqa: N815
    medianKind: Literal["paint", "kerb", "grass", "barrier"] = "paint"  # noqa: N815
    verges: Verges | None = None
    # One lane, forward, centred on the line, with no shoulders: a one-way street as narrow as its
    # one lane (the crooked block of Lombard Street, whose 5 m hairpins a two-way table would fail
    # the |kappa| * dMax rule on). A join with the two-way roads either side narrows like any lane
    # drop (src/sim/riders/funnel.ts).
    oneWay: bool = False  # noqa: N815

    @model_validator(mode="after")
    def _one_way(self) -> CrossSection:
        if self.oneWay and (self.lanesPerDirection != 1 or self.medianM != 0):
            raise ValueError("a one-way section is one lane: lanesPerDirection 1 and no median")
        return self


class SideTags(Strict):
    left: list[str] = Field(default_factory=list)
    right: list[str] = Field(default_factory=list)


class Landmark(Strict):
    """A real structure placed from its lat/lon (playtest 3: "real landmarks"): it becomes a
    ``landmark`` feature on the road beside it (src/road/types.ts ``landmarkParams``). The point is
    projected onto the line's real OSM polyline, so its (s, d) are right against the real road, then
    mapped into the baked road; the report says how far that lands from the real point. Its box is
    ``footprintM`` [along, across] centred there. ``side`` says which side it must fall on (a bake
    that finds it on the other refuses: a typo in the lat/lon, or the wrong line)."""

    id: str = Field(pattern=FEATURE_ID)
    model: str = Field(pattern=r"^[^#\s]+#[^#\s]+$")  # <asset id>#<node>
    at: LatLon
    footprintM: tuple[float, float]  # noqa: N815
    side: Literal["left", "right"] | None = None
    yawDeg: float | None = Field(None, ge=-180, le=180)  # noqa: N815
    scale: float | None = Field(None, gt=0, le=4)
    farM: float | None = Field(None, gt=0)  # noqa: N815
    # A landmark by a finish line that the finish shot frames whole (camera/finish-shot.ts): its height, m.
    frameHeightM: float | None = Field(None, gt=0)  # noqa: N815
    overRoad: bool = False  # noqa: N815 (a structure the road passes through or under)
    # An island of its own in open water (playtest 4, Pigeon Key): boats and islets keep off its box.
    island: bool = False
    # A per-instance number a model's text surface shows (a mile post's); the sign's words carry `{n}`.
    number: int | None = Field(None, ge=0)

    @model_validator(mode="after")
    def _footprint(self) -> Landmark:
        if not (self.footprintM[0] > 0 and self.footprintM[1] > 0):
            raise ValueError(f"landmark {self.id}: footprintM [along, across] above 0")
        return self

    def params(self) -> dict[str, object]:
        out: dict[str, object] = {"model": self.model}
        for k in ("yawDeg", "scale", "farM", "frameHeightM"):
            v = getattr(self, k)
            if v is not None:
                out[k] = float(v)
        if self.overRoad:
            out["overRoad"] = True
        if self.island:
            out["island"] = True
        if self.number is not None:
            out["number"] = self.number
        return out


MILE_M = 1609.344  # one statute mile, m


class Milepost(Strict):
    """Mile-marker posts along a line (playtest 4, P4-19: the identity study's S3). A post stands at
    every whole mile number, ``everyM`` apart in the game's own metres, beside the road: a ``landmark``
    feature on the road that holds it, with its number in ``params.number`` for the model's text
    surface. ``mile`` is the number at the real point ``at`` (the Seven Mile Bridge's east end is mile
    46.804: Wikipedia, "Overseas Highway", "40.011-46.804"); numbers ``falling`` along the line, as US 1's
    do toward Key West. The post stands ``offsetM`` from the centre line on a bridge (just outside the
    rail) and ``landOffsetM`` (default the same) on land, where the verge is wider. A post within
    ``marginM`` of a road's end is left out, so none straddles a junction, and one that would stand in a
    junction's connector (not a road of the line) is left out too."""

    model: str = Field(pattern=r"^[^#\s]+#[^#\s]+$")
    mile: float = Field(ge=0)
    at: LatLon
    falling: bool = True
    everyM: float = Field(MILE_M, gt=100)  # noqa: N815
    side: Literal["left", "right"] = "right"
    offsetM: float = Field(6.1, gt=0)  # noqa: N815
    landOffsetM: float | None = Field(None, gt=0)  # noqa: N815
    yawDeg: float = Field(180.0, ge=-180, le=180)  # noqa: N815
    marginM: float = Field(12.0, ge=0)  # noqa: N815


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
    # As the stretch config's: groups of regexes, any one of which a way must match ("@id": its id).
    wayFilter: list[dict[str, str]] = Field(default_factory=list)  # noqa: N815
    # OSM way ids that count as bridge though the map leaves the tag off (see BakeConfig).
    bridgeWays: list[int] = Field(default_factory=list)  # noqa: N815
    # Spans the map does not draw, joined by a straight deck; a gap stitch also writes a gap there.
    stitches: list[Stitch] = Field(default_factory=list)
    landmarks: list[Landmark] = Field(default_factory=list)
    mileposts: Milepost | None = None
    # What stands along every bridge (None: a rail of the network's bridgeRailHeightM).
    bridgeBarrier: BridgeBarrier | None = None  # noqa: N815
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
    surface: Surface = "asphalt"
    # Per road id: its own surface where it differs from the line's (a brick block in an asphalt street).
    roadSurface: dict[str, Surface] = Field(default_factory=dict)  # noqa: N815
    # The ordinary roads, in order: the pieces between every cut (name changes, long bridges,
    # splitAt points and junction pieces), leaving out the junction pieces themselves.
    roads: list[RoadName]
    # Per road id: its own cross-section (a boulevard narrowing to a side street; lanes carry over
    # a join by id, and traffic merges out of the lanes that end) and tags for one side only (the
    # sea on one side of a beach road).
    roadLanes: dict[str, CrossSection] = Field(default_factory=dict)  # noqa: N815
    sideTags: dict[str, SideTags] = Field(default_factory=dict)  # noqa: N815

    def surface_of(self, rid: str) -> Surface:
        return self.roadSurface.get(rid, self.surface)

    def lanes_of(self, rid: str) -> CrossSection:
        return self.roadLanes.get(rid, self.crossSection)

    def sides_of(self, rid: str) -> SideTags:
        return self.sideTags.get(rid, SideTags())


class Zone(Strict):
    """The split zone: the last ``lengthM`` of the road the branch leaves, between d0 and d1."""

    lengthM: float = Field(gt=0)  # noqa: N815
    d0: float
    d1: float


class Staging(Strict):
    """A synthetic branch end (playtest 3: the Seven Mile's staging platforms): the branch leaves
    or joins the main line where the map has no junction (``at`` is any point on the main line), on
    a connector of a turn, a straight and a turn back. ``turnDeg`` is the first turn, positive to
    the right (the second turns back by about as much), ``turnRadiusM`` the tightest radius of each
    eased turn and ``straightM`` the straight between them. The bake starts the branch's own road
    where that connector lands on the branch line, then solves the connector exactly onto it, which
    nudges the straight and the turn angle (the report says by how much). ``features`` stand on the
    straight, s measured from its start (a ramp truck and a gap); the bake moves them onto the
    staging road (``roadId``). Off by default: a real junction's connector is solved from
    ``turnsM`` and ``insetM``."""

    synthetic: bool = False
    turnRadiusM: float | None = Field(None, gt=0)  # noqa: N815
    turnDeg: float | None = Field(None, ge=-90, le=90)  # noqa: N815
    straightM: float | None = Field(None, gt=0)  # noqa: N815
    features: list[Feature] = Field(default_factory=list)
    # The connector's scenery tags (None: the land tags of the branch road beside it).
    tags: list[str] | None = None
    # The staging road's id (None: <network>-<label>-staging-in or -staging-out). A junction's road
    # ends lie within 250 m of it (src/road/validate.ts), so a synthetic end is two roads: the
    # junction's connector (the turn off the main road, or onto it) and this ordinary staging road
    # (the straight and the other turn), joined end to end with the branch line's own road. A
    # synthetic leave's staging road is the branch's first road, so the branch's id is its id.
    roadId: str | None = Field(None, pattern=OSM_ID)  # noqa: N815

    @model_validator(mode="after")
    def _staging(self) -> Staging:
        if self.synthetic and (self.turnRadiusM is None or not self.turnDeg or self.straightM is None):
            raise ValueError("a synthetic branch end needs turnRadiusM, a non-zero turnDeg and straightM")
        if self.features and not self.synthetic:
            raise ValueError(
                "features on a connector need a synthetic branch end (its straight is configured)"
            )
        for f in self.features:
            if f.s0 < 0 or (self.straightM is not None and f.s1 > self.straightM):
                raise ValueError(
                    f"connector feature {f.id}: {f.s0:g}..{f.s1:g} is off the {self.straightM:g} m straight"
                )
        return self


class Leave(Staging):
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

    @model_validator(mode="after")
    def _centred(self) -> Leave:
        if self.synthetic and self.toOffsetM != 0:
            raise ValueError("a synthetic leave's staging road meets the branch road end to end: toOffsetM 0")
        return self


class Join(Staging):
    at: LatLon  # the real junction on the main line where the branch line ends
    pieceM: float = Field(40.0, gt=0)  # noqa: N815
    shiftM: float = 0.0  # noqa: N815 (as Leave.shiftM; positive = later, past the real junction)
    offsetM: float  # noqa: N815 (across the main road's start, where the branch connector lands)
    lane: str
    insetM: float = Field(40.0, gt=0)  # noqa: N815 (back from the branch line's end, where its last road ends)
    fromOffsetM: float = 0.0  # noqa: N815 (across the branch's last road, where the connector starts)
    fromLane: str = "R1"  # noqa: N815
    turnsM: tuple[float, float] = (15.0, 15.0)  # noqa: N815

    @model_validator(mode="after")
    def _centred(self) -> Join:
        if self.synthetic and self.fromOffsetM != 0:
            raise ValueError(
                "a synthetic join's staging road meets the branch road end to end: fromOffsetM 0"
            )
        return self


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
    # The share of rivals that take it, 0 to 1 (playtest 3, round 3: "rivals and cops stay on the
    # highway"); None leaves it to the AI's own rule (src/road/types.ts BakedRouteBranch.aiTake).
    aiTake: float | None = Field(None, ge=0, le=1)  # noqa: N815
    connectorWidthM: float = Field(6.0, gt=0, le=12)  # noqa: N815 (the connectors' one shortcut lane)
    # Names the junction roads the bake makes for it (<network>-<label>-leave, -join, -in, -out);
    # the line id when left out. The route-facing `id` keeps the id the game would derive (the
    # branch's first road), so a career's `route#id` never changes with it.
    label: str | None = Field(None, pattern=ID)
    # The tightest bend either connector may have, m (playtest 4, P4-4 and P4-8; the road lint's
    # shortcut rule, src/road/validate.ts): the bake picks turn lengths that keep to it, and refuses
    # a leave or join with no room for them. None: the first turn lengths that fit the lane.
    minRadiusM: float | None = Field(None, gt=0)  # noqa: N815

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
        wayFilter=ln.wayFilter,
        bridgeWays=ln.bridgeWays,
        stitches=ln.stitches,
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

    def project(self, x: float, z: float) -> tuple[float, float]:
        """The arc length of the profile's point nearest (x, z), and the distance to it."""
        p = self.p
        ax, az = p.x[:-1], p.z[:-1]
        dx, dz = np.diff(p.x), np.diff(p.z)
        ll = np.maximum(dx * dx + dz * dz, 1e-12)
        t = np.clip(((x - ax) * dx + (z - az) * dz) / ll, 0.0, 1.0)
        dist = np.hypot(ax + t * dx - x, az + t * dz - z)
        i = int(np.argmin(dist))
        return float(p.s[i] + t[i] * (p.s[i + 1] - p.s[i])), float(dist[i])


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


_TURN_SCALES = (1.0, 1.5, 0.75, 2.0, 0.5, 2.5, 0.35, 3.0)


def connector_shape(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    turns: tuple[float, float],
    width: float,
    min_radius: float | None = None,
    label: str = "",
) -> Shape:
    """The curve from point a to point b (x, z, heading), with the given turns or others; refused
    when even the best one bends too hard for its lane (the road lint wants |kappa| x half-width
    under 0.5; this keeps it under 0.45). With ``min_radius`` (the shortcut lint's bend rule: a rider
    arriving at speed has to hold it) the first of the turn lengths that keeps every bend at or
    above that radius wins, and a connector that cannot is refused, naming the radius it did reach."""
    best: Shape | None = None
    worst_kd = math.inf
    # With a radius to keep, the turn lengths are tried in small steps from the shortest up, so the
    # first fit is the least sweeping one that keeps to it.
    scales = [round(0.3 + 0.05 * i, 2) for i in range(75)] if min_radius is not None else _TURN_SCALES
    for scale in scales:
        sh = solve_shape(a[0], a[1], a[2], b[0], b[1], b[2], turns[0] * scale, turns[1] * scale)
        if sh is None:
            continue
        kappa = max(abs(sh.kappa(u)) for u in np.linspace(0, sh.length, 200))
        kd = kappa * (width / 2)
        if kd < worst_kd:
            best, worst_kd = sh, kd
        if min_radius is not None:
            if kappa * min_radius <= 1.0 and kd < 0.45:
                return sh
        elif kd < 0.35:
            break
    if best is None or worst_kd >= 0.45:
        prefix = f"{label}: " if label else ""
        raise ValueError(f"{prefix}no connector fits from {a} to {b} (|kappa| x half-width {worst_kd:.2f})")
    if min_radius is not None:
        radius = (width / 2) / worst_kd
        raise ValueError(
            f"{label}: no connector from {a} to {b} keeps every bend at {min_radius:g} m or more "
            f"(the best has a radius of {radius:.1f} m): move the junction piece or the branch's "
            f"inset so the turn has room"
        )
    return best


# An eased turn's curvature peaks at 1.875 times its mean (ease_rate's peak, 30/16, at t = 0.5).
EASE_PEAK = 1.875


def turn_length(radius: float, deg: float) -> float:
    """The length of an eased turn through ``deg`` whose tightest radius is ``radius``."""
    return EASE_PEAK * radius * math.radians(abs(deg))


def max_kappa(sh: Shape) -> float:
    return max(abs(sh.kappa(u)) for u in np.linspace(0, sh.length, 400))


@dataclass(frozen=True)
class Staged:
    """A synthetic branch end, solved: the connector curve, and where on the branch line it lands
    (a leave) or departs (a join)."""

    shape: Shape
    s_line: float


def solve_staging(
    st: Staging,
    main_pt: tuple[float, float, float, float],
    line: BakedLine,
    offset: float,
    leaving: bool,
    label: str,
    width: float,
) -> Staged:
    """The configured turn, straight and turn back, from the main road's end (a leave) or onto it (a
    join); the branch line meets it where that shape ends, and the connector is then solved exactly
    onto the branch line there, keeping the configured turns' lengths."""
    assert st.turnRadiusM is not None and st.turnDeg is not None and st.straightM is not None
    turn = turn_length(st.turnRadiusM, st.turnDeg)
    phi = math.radians(st.turnDeg)
    mx, _, mz, mh = main_pt
    guess = Shape(mh, phi, -phi, turn, st.straightM, turn)
    n = max(64, round(guess.length / 0.25))
    if leaving:
        ex, ez = guess.end(mx, mz, n)
    else:
        dx, dz = guess.end(0.0, 0.0, n)
        ex, ez = mx - dx, mz - dz
    s_line, miss = line.project(ex, ez)
    if not 1.0 < s_line < float(line.p.s[-1]) - 1.0:
        raise ValueError(f"{label}: the staging lands off the branch line (at s {s_line:.1f})")
    bx, _, bz, bh = offset_point(line, s_line, offset)
    sh = (
        solve_shape(mx, mz, mh, bx, bz, bh, turn, turn)
        if leaving
        else solve_shape(bx, bz, bh, mx, mz, mh, turn, turn)
    )
    if sh is None:
        raise ValueError(f"{label}: no connector of these turns reaches the branch line ({miss:.1f} m off)")
    if max_kappa(sh) * (width / 2) >= 0.45:
        raise ValueError(f"{label}: the turns are too tight for the connector's width")
    return Staged(sh, s_line)


def staging_report(sh: Shape, road: str, on: float) -> Json:
    """What the solve made of a synthetic end: the first turn, the straight (starting at ``on`` on
    the staging road), and the tightest radius."""
    return {
        "road": road,
        "turnDeg": round(math.degrees(sh.phi1), 2),
        "straightM": round(sh.ls, 4),
        "tightestRadiusM": round(1 / max_kappa(sh), 1),
        "straightStartM": round(on, 4),
    }


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
    # The span of its line it was cut from (line s), for features placed in line s.
    s_a: float = 0.0
    s_b: float = 0.0
    # Its tags over part of one side only (`sideRuns`): they say nothing of a connector beside it.
    run_tags: frozenset[str] = frozenset()


def lane_section(cs: CrossSection) -> Json:
    section: Json
    if cs.oneWay:
        lane = {"id": "R1", "dCenterM": 0, "widthM": cs.laneWidthM, "direction": 1, "kind": "drive"}
        section = {"s0": 0, "lanes": [lane]}
    else:
        section = {"s0": 0, "lanes": lanes(cs.laneWidthM, cs.lanesPerDirection, cs.medianM)}
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


def tag_ranges(
    bl: BakedLine,
    a: float,
    b: float,
    land: list[str],
    sides: SideTags,
    deck: list[str] | None = None,
    runs: list[SideRun] | None = None,
    road: str = "",
) -> list[Json]:
    """Tags for the line stretch [a, b]: bridges (and the sea under a sea deck) by the real map, with
    the road's ``deck`` tags over them, and the road's tags (both sides, then each side's own, then its
    ``spans`` over part of one side) everywhere else (scenery stands on land only: playtest 1c item 3)."""
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
            min_m = bl.line.elevation.waterBridgeMinM
            if water or (min_m is not None and (rb - ra) * float(p.h) >= min_m):
                tags.append({"s0": t0, "s1": t1, "side": "both", "tag": "water-open"})
            tags += [{"s0": t0, "s1": t1, "side": "both", "tag": t} for t in deck or []]
    tags += [
        {"s0": r4(t0), "s1": r4(t1), "side": side, "tag": t}
        for side, names in (("both", land), ("left", sides.left), ("right", sides.right))
        for t in names
        for t0, t1 in without(0, length, decks)
    ]
    # A tag on one side over a run of s (playtest 4, P4-19: B9's `sideRuns` in a stretch bake, and since C4 in
    # a network bake too: Lake Samish's `lake`), off the decks like the land tags.
    for run in runs or []:
        if run.s1 > r4(length) + 1e-6:
            raise ValueError(
                f"{road}: side run {run.tag} at {run.s0}..{run.s1} is off the {r4(length)} m road"
            )
        tags += [
            {"s0": r4(t0), "s1": r4(t1), "side": run.side, "tag": run.tag}
            for t0, t1 in without(run.s0, run.s1, decks)
        ]
    return tags


@dataclass
class LineCuts:
    """A line cut into pieces: (s_a, s_b, piece label or None for an ordinary road)."""

    spans: list[tuple[float, float, str | None]]


def line_cuts(
    cfg: NetworkConfig,
    bl: BakedLine,
    pieces: list[tuple[float, float, str]],
    ends: tuple[float | None, float | None] = (None, None),
) -> LineCuts:
    """The line's ordinary roads and junction pieces, in order along it. A branch line's roads run
    from ``insetM`` to ``insetM`` short of its end, or between its synthetic ends (``ends``)."""
    p = bl.p
    br = branch_of_line(cfg, bl.line.id)
    lo = ends[0] if ends[0] is not None else (br.leave.insetM if br else 0.0)
    hi = ends[1] if ends[1] is not None else float(p.s[-1]) - (br.join.insetM if br else 0.0)
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


def milepost_features(cfg: NetworkConfig, bl: BakedLine, a: float, b: float, tags: list[Json]) -> list[Json]:
    """The line's mile-marker posts that fall on the piece from line s ``a`` to ``b``, as ``landmark``
    features in the piece's own s (see ``Milepost``)."""
    mp = bl.line.mileposts
    if mp is None:
        return []
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    s_real, _, _, _ = real_station(bl.rp, frame, mp.at.lat, mp.at.lon)
    s_anchor = float(np.interp(s_real, bl.p.s_real, bl.p.s))
    sign = -1.0 if mp.falling else 1.0
    lo, hi = a + mp.marginM, b - mp.marginM
    # s = s_anchor + sign * (n - mile) * everyM for the whole number n; the n whose s is inside [lo, hi].
    n_a = mp.mile + (lo - s_anchor) / (sign * mp.everyM)
    n_b = mp.mile + (hi - s_anchor) / (sign * mp.everyM)
    out: list[Json] = []
    bridges = [(t["s0"], t["s1"]) for t in tags if t["tag"] == "bridge"]
    for n in range(math.ceil(min(n_a, n_b) - 1e-9), math.floor(max(n_a, n_b) + 1e-9) + 1):
        s_line = s_anchor + sign * (n - mp.mile) * mp.everyM
        if not lo <= s_line <= hi:
            continue
        s = s_line - a
        on_bridge = any(t0 <= s <= t1 for t0, t1 in bridges)
        off = mp.offsetM if on_bridge or mp.landOffsetM is None else mp.landOffsetM
        d = off if mp.side == "right" else -off
        out.append(
            {
                "kind": "landmark",
                "id": f"mile-{n}",
                "s0": r4(s - 0.3),
                "s1": r4(s + 0.3),
                "d0": r4(d - 0.3),
                "d1": r4(d + 0.3),
                "params": {"model": mp.model, "yawDeg": float(mp.yawDeg), "number": n},
            }
        )
    return out


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
    spacing = (rn.sampleSpacingM if rn else None) or cfg.sampleSpacingM
    _, x, y, z = resample_line(bl, a, b, spacing)
    tags = tag_ranges(bl, a, b, land, sides, rn.deckTags if rn else None, rn.sideRuns if rn else None, pid)
    features: list[Json] = []
    length = r4(b - a)
    for f in rn.features if rn else []:
        if not 0 <= f.s0 <= f.s1 <= length:
            raise ValueError(f"{pid}: feature {f.id} at {f.s0}..{f.s1} is off the {length} m road")
        features.append(f.model_dump(exclude_none=True))
    if rn is not None:
        features += milepost_features(cfg, bl, a, b, tags)
    barriers = [
        *bridge_barriers(tags, cfg.bridgeRailHeightM, bl.line.bridgeBarrier),
        *(br.as_json(length) for br in (rn.barriers if rn else [])),
    ]
    p = bl.p
    i0 = int(np.argmin(np.abs(p.s - a)))
    i1 = int(np.argmin(np.abs(p.s - b)))
    real = (rn.realName if rn else None) or longest_name(p, i0, i1) or bl.line.realName or name
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
        surface=bl.line.surface_of(pid),
        tags=tags,
        barriers=barriers,
        features=features,
        connector=rn is None,
        s_a=a,
        s_b=b,
        run_tags=frozenset(r.tag for r in rn.sideRuns) - frozenset(land) if rn else frozenset(),
    )


def offset_point(bl: BakedLine, s: float, d: float) -> tuple[float, float, float, float]:
    """(x, y, z, heading) at s on a line, d metres to the right of it."""
    x, y, z, h = bl.at(s)
    return x + d * math.cos(h), y, z + d * math.sin(h), h


# Over this distance past a main road's surface, a connector's height eases from the road's to its own.
MAIN_BLEND_M = 14.0
# Within this of the end that joins the branch's own road, a connector keeps that road's height.
MAIN_END_FREE_M = 20.0
# A main road's verge, which the renderer draws past the lanes (road-mesh VERGE_M).
MAIN_VERGE_M = 0.6


def surface_reach(section: Json, right: bool) -> float:
    """How far a road's lanes (and its verge) reach from the centre line on one side."""
    lanes_ = section["lanes"]
    if right:
        return float(max(ln["dCenterM"] + ln["widthM"] / 2 for ln in lanes_)) + MAIN_VERGE_M
    return -float(min(ln["dCenterM"] - ln["widthM"] / 2 for ln in lanes_)) + MAIN_VERGE_M


def curve_piece(
    pid: str,
    name: str,
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    sh: Shape,
    width: float,
    spacing: float,
    speed: float,
    land: list[str],
    span: tuple[float, float] | None = None,
    main: BakedLine | None = None,
    half: float = 0.0,
    leaves_main: bool = True,
) -> Piece:
    """A branch connector road: the solved curve from a to b, its height eased between theirs. With
    ``span`` (u0, u1), only that stretch of the curve (a synthetic end's connector or staging road).
    With ``main`` (the line the connector leaves or joins) and ``half`` (how far that road's surface
    reaches on the connector's side), the height follows the main road's while any of the connector's
    lane lies over its surface and eases into its own over the next MAIN_BLEND_M: the connector leaves
    tangentially, so for tens of metres it is drawn under the road it leaves, and a steep branch
    (Jones Street) dropped 3 m under the surface before it came out (playtest 4, P4-4)."""
    fine = max(64, math.ceil(sh.length / 0.1))
    du = sh.length / fine
    fx = [a[0]]
    fz = [a[2]]
    for k in range(fine):
        h = sh.heading((k + 0.5) * du)
        fx.append(fx[-1] + math.sin(h) * du)
        fz.append(fz[-1] - math.cos(h) * du)
    u = du * np.arange(fine + 1)
    u0, u1 = span if span is not None else (0.0, sh.length)
    n = max(1, round((u1 - u0) / spacing))
    s: F64 = u0 + ((u1 - u0) / n) * np.arange(n + 1, dtype=np.float64)
    s[-1] = u1
    x = np.interp(s, u, np.array(fx))
    z = np.interp(s, u, np.array(fz))
    if u1 == sh.length:
        x[-1], z[-1] = b[0], b[2]
    y = a[1] + (b[1] - a[1]) * smoothstep(s / sh.length)
    if main is not None:
        for i in range(len(s)):
            s_main, dist = main.project(float(x[i]), float(z[i]))
            over = 1.0 - float(smoothstep(np.array((dist - half - width / 2) / MAIN_BLEND_M)))
            # The end that joins the branch's own road keeps that road's height (the two are cut
            # end to end), even where the branch runs close beside the main road.
            end = (sh.length - s[i]) if leaves_main else s[i]
            over *= float(smoothstep(np.array(min(1.0, end / MAIN_END_FREE_M))))
            y[i] += over * (main.at(s_main)[1] - y[i])
    length = float(u1 - u0)
    return Piece(
        id=pid,
        name=name,
        real_name=name,
        x=x,
        y=y,
        z=z,
        kappa_ends=(sh.kappa(u0), sh.kappa(u1)),
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
    # Ramp lips go into the elevation on the road's own samples, as the hand-made compiler does.
    features, ramp_y, ramp_g = bake_ramps(pc.features, length, n)
    y = plus(pc.y, ramp_y)
    grade = plus(grade, ramp_g)
    cols = {
        "x": [r4(v) for v in pc.x],
        "y": [r4(v) for v in y],
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
        "features": features,
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

    # Synthetic branch ends (playtest 3's staging): solve each connector first, since the branch
    # line's roads start and end where it lands.
    staged: dict[tuple[str, str], Staged] = {}
    line_ends: dict[str, tuple[float | None, float | None]] = {}
    for b in cfg.branches:
        main, line = lines[b.of], lines[b.line]
        lo: float | None = None
        hi: float | None = None
        if b.leave.synthetic:
            end_pt = offset_point(main, centre[f"{b.tag}-leave"] - b.leave.pieceM / 2, b.leave.offsetM)
            st = solve_staging(
                b.leave, end_pt, line, b.leave.toOffsetM, True, f"branch {b.id} leave", b.connectorWidthM
            )
            staged[(b.id, "leave")] = st
            lo = st.s_line
        if b.join.synthetic:
            end_pt = offset_point(main, centre[f"{b.tag}-join"] + b.join.pieceM / 2, b.join.offsetM)
            st = solve_staging(
                b.join, end_pt, line, b.join.fromOffsetM, False, f"branch {b.id} join", b.connectorWidthM
            )
            staged[(b.id, "join")] = st
            hi = st.s_line
        line_ends[b.line] = (lo, hi)

    # Cut every line into pieces and ordinary roads.
    order: list[Piece] = []
    by_line: dict[str, list[tuple[Piece, str | None]]] = {}
    for lid, bl in lines.items():
        cuts = line_cuts(cfg, bl, pieces[lid], line_ends.get(lid, (None, None)))
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

    # Features placed in line s: stitched gaps (with their kickers) and landmarks from lat/lon.
    report_landmarks: list[Json] = []
    for lid, bl in lines.items():
        place_stitches(bl, by_line[lid])
        report_landmarks += place_landmarks(cfg, bl, by_line[lid])

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
        land_in = b.leave.tags if b.leave.tags is not None else bl_tags(bseq[0])
        land_out = b.join.tags if b.join.tags is not None else bl_tags(bseq[-1])
        s_first, s_last = line_cuts_ends(b, line, staged)
        leave_pt = offset_point(main, centre[f"{b.tag}-leave"] - b.leave.pieceM / 2, b.leave.offsetM)
        land_pt = offset_point(line, s_first, b.leave.toOffsetM)
        st_in = staged.get((b.id, "leave"))
        sh_in = (
            st_in.shape
            if st_in
            else connector_shape(
                _xzh(leave_pt),
                _xzh(land_pt),
                b.leave.turnsM,
                b.connectorWidthM,
                b.minRadiusM,
                f"branch {b.id} leave",
            )
        )
        a2 = offset_point(line, s_last, b.join.fromOffsetM)
        t2 = offset_point(main, centre[f"{b.tag}-join"] + b.join.pieceM / 2, b.join.offsetM)
        st_out = staged.get((b.id, "join"))
        sh_out = (
            st_out.shape
            if st_out
            else connector_shape(
                _xzh(a2), _xzh(t2), b.join.turnsM, b.connectorWidthM, b.minRadiusM, f"branch {b.id} join"
            )
        )
        width, spacing = b.connectorWidthM, cfg.sampleSpacingM
        speed_in, speed_out = min(before.speed, first.speed), min(last.speed, after.speed)
        # A synthetic end is the junction's connector (the turn off or onto the main road) and an
        # ordinary staging road (the straight, with its features, and the other turn); see Staging.
        stage_in = stage_out = None
        if st_in is None:
            kin = curve_piece(
                f"{cfg.id}-{b.tag}-in",
                f"{b.tag} turn-off",
                leave_pt,
                land_pt,
                sh_in,
                width,
                spacing,
                speed_in,
                land_in,
                None,
                main,
                surface_reach(before.lane_section, b.leave.offsetM >= 0),
            )
        else:
            cut = sh_in.l1
            kin = curve_piece(
                f"{cfg.id}-{b.tag}-in",
                f"{b.tag} turn-off",
                leave_pt,
                land_pt,
                sh_in,
                width,
                spacing,
                speed_in,
                land_in,
                (0.0, cut),
            )
            sid = b.leave.roadId or f"{cfg.id}-{b.tag}-staging-in"
            stage_in = curve_piece(
                sid,
                f"{b.tag} staging",
                leave_pt,
                land_pt,
                sh_in,
                width,
                spacing,
                speed_in,
                land_in,
                (cut, sh_in.length),
            )
            stage_in.connector = False
            stage_in.features = straight_features(b.leave, sh_in, 0.0, f"branch {b.id} leave")
        if st_out is None:
            kout = curve_piece(
                f"{cfg.id}-{b.tag}-out",
                f"{b.tag} rejoin",
                a2,
                t2,
                sh_out,
                width,
                spacing,
                speed_out,
                land_out,
                None,
                main,
                surface_reach(after.lane_section, b.join.offsetM >= 0),
                False,
            )
        else:
            cut = sh_out.l1 + sh_out.ls
            sid = b.join.roadId or f"{cfg.id}-{b.tag}-staging-out"
            stage_out = curve_piece(
                sid, f"{b.tag} staging", a2, t2, sh_out, width, spacing, speed_out, land_out, (0.0, cut)
            )
            stage_out.connector = False
            stage_out.features = straight_features(b.join, sh_out, sh_out.l1, f"branch {b.id} join")
            kout = curve_piece(
                f"{cfg.id}-{b.tag}-out",
                f"{b.tag} rejoin",
                a2,
                t2,
                sh_out,
                width,
                spacing,
                speed_out,
                land_out,
                (cut, sh_out.length),
            )
        head = stage_in or first
        tail = stage_out or last
        if b.id != head.id:
            # The game derives a branch's id from its first road (docs/content-packs.md, Branches);
            # a named one keeps that id, so a career's `route#id` holds either way.
            raise ValueError(f"branch {b.id}: name it {head.id}, the id the game derives")
        staging: Json = {}
        if stage_in is not None:
            staging["leave"] = staging_report(sh_in, stage_in.id, 0.0)
        if stage_out is not None:
            staging["join"] = staging_report(sh_out, stage_out.id, sh_out.l1)
        js, jm = by_label[f"{b.tag}-leave"], by_label[f"{b.tag}-join"]
        # The branch line's own end junctions become the split and merge junctions; at a synthetic
        # end they stay, joining the staging road to the branch road end to end.
        drop = {first.frm} if stage_in is None else set()
        drop |= {last.to} if stage_out is None else set()
        junctions[:] = [j for j in junctions if j["id"] not in drop]
        if stage_in is not None:
            j_first = next(j for j in junctions if j["id"] == first.frm)
            j_first["ends"].insert(0, {"road": stage_in.id, "end": "to"})
            stage_in.to = first.frm
        if stage_out is not None:
            j_last = next(j for j in junctions if j["id"] == last.to)
            j_last["ends"].append({"road": stage_out.id, "end": "from"})
            stage_out.frm = last.to
        head.frm, tail.to = js["id"], jm["id"]
        kin.frm = kin.to = js["id"]
        kout.frm = kout.to = jm["id"]
        js["ends"].append({"road": head.id, "end": "from"})
        jm["ends"].append({"road": tail.id, "end": "to"})
        before_len = float(np.sum(np.hypot(np.diff(before.x), np.diff(before.z))))
        js["connectors"].append(
            {
                "id": f"cx-{kin.id}",
                "road": kin.id,
                "from": {"road": before.id, "end": "to", "lane": b.leave.lane},
                "to": {"road": head.id, "end": "from", "lane": b.leave.toLane if stage_in is None else "S1"},
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
                "from": {
                    "road": tail.id,
                    "end": "to",
                    "lane": b.join.fromLane if stage_out is None else "S1",
                },
                "to": {"road": after.id, "end": "from", "lane": b.join.lane},
            }
        )
        stages = [pc for pc in (stage_in, stage_out) if pc is not None]
        order += [kin, *stages, kout] if stages else [kin, kout]
        branch_roads[b.id] = [
            kin.id,
            *([stage_in.id] if stage_in else []),
            *(pc.id for pc, _ in bseq),
            *([stage_out.id] if stage_out else []),
            kout.id,
        ]
        main_len = centre[f"{b.tag}-join"] - centre[f"{b.tag}-leave"]
        branch_len = (
            float(np.sum(np.hypot(np.diff(kin.x), np.diff(kin.z))))
            + sum(float(np.sum(np.hypot(np.diff(pc.x), np.diff(pc.z)))) for pc, _ in bseq)
            + float(np.sum(np.hypot(np.diff(kout.x), np.diff(kout.z))))
            - b.leave.pieceM / 2
            - b.join.pieceM / 2
        )
        for pc in stages:
            branch_len += float(np.sum(np.hypot(np.diff(pc.x), np.diff(pc.z))))
        report_branches.append(
            {
                "id": b.id,
                "mainM": round(main_len, 1),
                "branchM": round(branch_len, 1),
                "savesM": round(main_len - branch_len, 1),
                **staging,
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
                # What a stretch bake's fun report says, for the closed line (run W-U: a network
                # replaces a stretch, and its README numbers still come from the bake).
                "fun": fun_report(bl.cfg, bl.rp, bl.p, ways).as_dict(),
            }
            for lid, bl in lines.items()
        },
        "branches": report_branches,
        "routes": {r["id"]: round(route_length(r, by_id), 1) for r in routes},
        "roads": len(roads_json),
        "junctions": len(junctions),
    }
    if report_landmarks:
        report["landmarks"] = report_landmarks
    return NetworkBake(network, roads_json, routes, report)


def _xzh(p: tuple[float, float, float, float]) -> tuple[float, float, float]:
    return (p[0], p[2], p[3])


def line_cuts_ends(b: Branch, line: BakedLine, staged: dict[tuple[str, str], Staged]) -> tuple[float, float]:
    """Where the branch line's own roads start and end, in its s."""
    lo = staged[(b.id, "leave")].s_line if (b.id, "leave") in staged else b.leave.insetM
    hi = staged[(b.id, "join")].s_line if (b.id, "join") in staged else float(line.p.s[-1]) - b.join.insetM
    return lo, hi


def straight_features(end: Staging, sh: Shape, on: float, label: str) -> list[Json]:
    """A synthetic end's features, from straight-relative s into the staging road's s (its straight
    starts at ``on``)."""
    out: list[Json] = []
    for f in end.features:
        if f.s1 > sh.ls + 1e-6:
            raise ValueError(
                f"{label}: feature {f.id} ends at {f.s1:g}, past the solved {sh.ls:.1f} m straight"
            )
        out.append({**f.model_dump(exclude_none=True), "s0": r4(on + f.s0), "s1": r4(on + f.s1)})
    return out


def piece_holding(seq: list[tuple[Piece, str | None]], s0: float, s1: float, what: str) -> Piece:
    """The line's road (an ordinary road or a junction piece) whose span holds s0..s1 whole."""
    for pc, _ in seq:
        if pc.s_a - 1e-6 <= s0 and s1 <= pc.s_b + 1e-6:
            return pc
    spans = ", ".join(f"{pc.id} {pc.s_a:.0f}-{pc.s_b:.0f}" for pc, _ in seq)
    raise ValueError(
        f"{what} (line s {s0:.1f}..{s1:.1f}) does not lie on one road ({spans}): move it or the cuts"
    )


def half_width(pc: Piece) -> float:
    return float(max(abs(ln["dCenterM"]) + ln["widthM"] / 2 for ln in pc.lane_section["lanes"]))


def place_stitches(bl: BakedLine, seq: list[tuple[Piece, str | None]]) -> None:
    """Each gap stitch's gap (and kicker) on the road that holds it, in that road's s."""
    for k, st in enumerate(bl.line.stitches):
        if st.kind != "gap":
            continue
        s_from, s_to = stitch_span(bl.rp, bl.p, st, k)
        lo = s_from + st.trimM - (st.kicker.lengthM if st.kicker else 0.0)
        pc = piece_holding(seq, lo, s_to - st.trimM, f"stitch {st.id}")
        for f in stitch_features(st, s_from, s_to, half_width(pc)):
            dumped = f.model_dump(exclude_none=True)
            pc.features.append({**dumped, "s0": r4(f.s0 - pc.s_a), "s1": r4(f.s1 - pc.s_a)})


def place_landmarks(cfg: NetworkConfig, bl: BakedLine, seq: list[tuple[Piece, str | None]]) -> list[Json]:
    """Each landmark as a ``landmark`` feature on the road beside it: (s, d) against the real line,
    mapped into the baked road. Returns the report rows, with how far the baked placement lands
    from the real point."""
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    rows: list[Json] = []
    for lm in bl.line.landmarks:
        s_real, d, wx, wz = real_station(bl.rp, frame, lm.at.lat, lm.at.lon)
        if lm.side is not None and (d >= 0) != (lm.side == "right"):
            other = "right" if d >= 0 else "left"
            raise ValueError(f"landmark {lm.id}: it is {abs(d):.1f} m {other} of the road, not {lm.side}")
        s = float(np.interp(s_real, bl.p.s_real, bl.p.s))
        along, across = lm.footprintM
        pc = piece_holding(seq, s - along / 2, s + along / 2, f"landmark {lm.id}")
        pc.features.append(
            {
                "kind": "landmark",
                "id": lm.id,
                "s0": r4(s - along / 2 - pc.s_a),
                "s1": r4(s + along / 2 - pc.s_a),
                "d0": r4(d - across / 2),
                "d1": r4(d + across / 2),
                "params": lm.params(),
            }
        )
        gx, _, gz, _ = offset_point(bl, s, d)
        rows.append(
            {
                "id": lm.id,
                "line": bl.line.id,
                "road": pc.id,
                "s": r4(s - pc.s_a),
                "d": r4(d),
                "placementErrorM": round(math.hypot(gx - wx, gz - wz), 2),
            }
        )
    return rows


def idx(bl: BakedLine, a: float, b: float) -> tuple[int, int]:
    return int(np.argmin(np.abs(bl.p.s - a))), int(np.argmin(np.abs(bl.p.s - b)))


def bl_tags(entry: tuple[Piece, str | None]) -> list[str]:
    """The land tags of an ordinary road (for the connector beside it), not its span tags (a lake beside
    part of one side of it is not beside the connector)."""
    pc = entry[0]
    return sorted(
        {
            t["tag"]
            for t in pc.tags
            if t["tag"] != "bridge" and not t["tag"].startswith("water-") and t["tag"] not in pc.run_tags
        }
    )


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
            if b.aiTake is not None:
                named["aiTake"] = b.aiTake
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
