"""The bake config: one JSON file per baked stretch (``tools/gis/configs/<id>.json``)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal, cast, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator

# The road format's vocabularies, exactly as the game reads them (src/road/validate.ts
# FEATURE_KINDS, src/core/surfaces.ts BARRIER_LOOKS, src/road/types.ts GAP_RESPAWNS; playtest 3's
# contract, K0b). tests/test_capabilities.py reads those files and fails when the two drift apart.
FeatureKind = Literal[
    "ramp",
    "gap",
    "hazard",
    "roadsideZone",
    "copSpawn",
    "raceMarker",
    "billboard",
    "boostPad",
    "rampTruck",
    "landmark",
]
FEATURE_KINDS: tuple[str, ...] = get_args(FeatureKind)
BarrierLook = Literal["railing"]
BARRIER_LOOKS: tuple[str, ...] = get_args(BarrierLook)
GapRespawn = Literal["far", "main"]
GAP_RESPAWNS: tuple[str, ...] = get_args(GapRespawn)
FEATURE_ID = r"^[a-z0-9]+(-[a-z0-9]+)*$"
# A feature's params: free-form in the road format, so numbers, words, switches (a landmark's
# overRoad, a solid hazard's solid) and lists of words (a roadside zone's `kinds`, playtest 3's
# zone-local people and animals) all pass through as JSON gives them.
Params = dict[str, bool | float | str | list[str]]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LatLon(Strict):
    lat: float
    lon: float

    def tup(self) -> tuple[float, float]:
        return (self.lat, self.lon)


class Crs(Strict):
    """The region frame; the same origin as the hand-made network, so both share one frame."""

    originLatDeg: float  # noqa: N815 (pack field names)
    originLonDeg: float  # noqa: N815


class Smoothing(Strict):
    headingSigmaM: float = Field(35.0, gt=0)  # noqa: N815 (Gaussian sigma on heading(s))


class Compression(Strict):
    """Gameplay-fy: long straights are shortened (the real Keys are long and straight)."""

    enabled: bool = True
    straightKappaMax: float = Field(1 / 4000, gt=0)  # noqa: N815
    minStraightM: float = Field(500.0, gt=0)  # noqa: N815 (only straights longer than this)
    keepFraction: float = Field(0.6, gt=0, le=1)  # noqa: N815
    minKeepM: float = Field(400.0, gt=0)  # noqa: N815
    onBridges: bool = False  # noqa: N815 (bridges keep their real length)


class Elevation(Strict):
    """Land from USGS 3DEP (bare earth, so it has no bridge decks); decks are synthesized."""

    sampleEveryM: float = Field(20.0, gt=0)  # noqa: N815
    lowPassSigmaM: float = Field(60.0, gt=0)  # noqa: N815
    minLandM: float = Field(1.0, gt=0)  # noqa: N815 (water is y = 0; land never dips under it)
    landExaggeration: float = Field(1.0, gt=0)  # noqa: N815
    deckM: float = Field(4.0, gt=0)  # noqa: N815 (low deck above the water)
    deckRampM: float = Field(80.0, gt=0)  # noqa: N815 (land to deck)
    humpHeightM: float = Field(12.0, ge=0)  # noqa: N815 (navigation hump above the deck, exaggerated)
    humpLengthM: float = Field(420.0, gt=0)  # noqa: N815
    humpMinBridgeM: float = Field(800.0, gt=0)  # noqa: N815 (only long bridges get a hump)
    # Where the hump stands on the real map (playtest 3: the Seven Mile Bridge humps over Moser
    # Channel). Only the long bridge that holds that point gets the hump; None: each long bridge
    # humps at its middle, as every bake before it.
    humpAt: LatLon | None = None  # noqa: N815
    # "sea": decks sit deckM above the water (y = 0), as on the Keys. "span": a deck runs straight
    # between the land heights at its two ends, for a bridge over a creek or a ravine in high
    # country, where 3DEP reads the valley floor under it.
    bridgeDeck: Literal["sea", "span"] = "sea"  # noqa: N815
    # A "span" deck crosses a creek or a ravine, so it gets no water tag. Set, a span deck at least
    # this long (m) does stand over open water, as the Golden Gate's does: it gets `water-open` like
    # a sea deck. None (the default): no span deck gets one.
    waterBridgeMinM: float | None = Field(None, gt=0)  # noqa: N815


RAMP_KEYS = ("heightM", "lengthM", "backM")


class Feature(Strict):
    """A feature range in road space (metres along this road; d positive to the right).

    The kinds are the road file's (docs/content-packs.md, "Road file"), boost pads, ramp trucks and
    playtest 3's landmarks included; a pad or truck with ``params.slot`` is one candidate for that
    slot, and each race's seed picks one per slot. A ``billboard`` slot names one region ``item`` or
    a ``pool``.

    A ``ramp`` with ``params.heightM`` is a lip the bake builds into the elevation, as the hand-made
    compiler does (src/road/compile.ts ``rampProfile``): a kicker rising ``heightM`` over
    ``lengthM`` (``y = h u^2``), then a back dropping to the road over ``backM`` (default 0). Its
    range is the kicker and the back, so ``s1`` is ``s0 + lengthM + backM``; the bake moves the lip
    onto a sample and the range with it. A ``ramp`` without ``heightM`` only marks a range.
    """

    kind: FeatureKind
    id: str = Field(pattern=FEATURE_ID)
    s0: float
    s1: float
    d0: float
    d1: float
    item: str | None = None
    pool: Literal["signs", "billboards"] | None = None
    params: Params | None = None

    @model_validator(mode="after")
    def _ramp_range(self) -> Feature:
        if self.kind != "ramp" or not self.params or "heightM" not in self.params:
            return self
        vals = {k: self.params.get(k, 0.0) for k in RAMP_KEYS}
        if not all(isinstance(v, float | int) and not isinstance(v, bool) for v in vals.values()):
            raise ValueError(f"ramp {self.id}: heightM, lengthM and backM are numbers")
        h, run, back = (float(cast("float", vals[k])) for k in RAMP_KEYS)
        if not (h > 0 and run > 0 and back >= 0):
            raise ValueError(f"ramp {self.id}: heightM and lengthM above 0, backM at least 0")
        if abs(self.s1 - (self.s0 + run + back)) > 1e-3:
            raise ValueError(
                f"ramp {self.id}: s1 {self.s1} is not s0 + lengthM + backM ({self.s0 + run + back:g})"
            )
        return self

    def ramp_spec(self) -> tuple[float, float, float] | None:
        """(heightM, lengthM, backM) of a ramp the bake builds, or None."""
        if self.kind != "ramp" or not self.params or "heightM" not in self.params:
            return None
        h, run, back = (float(cast("float", self.params.get(k, 0.0))) for k in RAMP_KEYS)
        return h, run, back


class Barrier(Strict):
    """A rail or wall along one side of a road (docs/content-packs.md, "Barriers"), beside the rails
    the bake puts on every bridge. ``s1`` may be ``"end"``. Playtest 3: ``jumpable`` (a wall only)
    lets an airborne rider over it; ``look`` draws it as a bridge railing."""

    s0: float = Field(ge=0)
    s1: float | Literal["end"]
    side: Literal["left", "right", "both"]
    kind: Literal["rail", "wall"]
    heightM: float = Field(1.0, gt=0)  # noqa: N815
    jumpable: bool | None = None
    look: BarrierLook | None = None

    @model_validator(mode="after")
    def _jumpable_wall(self) -> Barrier:
        if self.jumpable and self.kind != "wall":
            raise ValueError(f"a {self.kind} cannot be jumpable: only a wall may be")
        return self

    def as_json(self, length: float) -> dict[str, object]:
        out = self.model_dump(exclude_none=True)
        out["s1"] = length if self.s1 == "end" else min(float(self.s1), length)
        return out


class BridgeBarrier(Strict):
    """What stands along both sides of every bridge (default: a rail ``bridgeRailHeightM`` tall).
    The Golden Gate's is a wall that looks like a railing: it stops tumble bodies."""

    kind: Literal["rail", "wall"] = "rail"
    heightM: float | None = Field(None, gt=0)  # noqa: N815 (None: the config's bridgeRailHeightM)
    look: BarrierLook | None = None


def bridge_barriers(
    tags: list[dict[str, object]], height: float, spec: BridgeBarrier | None
) -> list[dict[str, object]]:
    """A barrier along both sides of each ``bridge`` tag's range."""
    out: list[dict[str, object]] = []
    for t in tags:
        if t["tag"] != "bridge":
            continue
        b: dict[str, object] = {
            "s0": t["s0"],
            "s1": t["s1"],
            "side": "both",
            "kind": "rail",
            "heightM": height,
        }
        if spec is not None:
            b["kind"] = spec.kind
            b["heightM"] = spec.heightM if spec.heightM is not None else height
            if spec.look is not None:
                b["look"] = spec.look
        out.append(b)
    return out


class Kicker(Strict):
    """A baked ramp whose lip is a gap's start (the Moser Channel jump: 2.0 m over 16 m)."""

    heightM: float = Field(gt=0)  # noqa: N815
    lengthM: float = Field(gt=0)  # noqa: N815


class Stitch(Strict):
    """Joins two OSM way ends across a span the map does not draw (playtest 3: the Old Seven Mile
    Bridge's missing span). The bake adds a straight deck between the way ends nearest ``from`` and
    ``to`` (each within ``snapM``), and for ``kind: "gap"`` a ``gap`` feature over it, ``trimM`` in
    from each end and across the road's width (or ``d0``..``d1``), with ``params`` (killDepthM,
    respawn, respawnPastM). ``kicker`` adds a baked ramp whose lip is the gap's start. A ``deck``
    stitch only joins the ends."""

    id: str = Field(pattern=FEATURE_ID)
    from_: LatLon = Field(alias="from")
    to: LatLon
    kind: Literal["gap", "deck"] = "gap"
    trimM: float = Field(0.0, ge=0)  # noqa: N815
    snapM: float = Field(5.0, gt=0)  # noqa: N815
    d0: float | None = None
    d1: float | None = None
    params: Params | None = None
    kicker: Kicker | None = None

    @model_validator(mode="after")
    def _gap_only(self) -> Stitch:
        if self.kind == "deck" and (self.kicker or self.params):
            raise ValueError(f"stitch {self.id}: a deck stitch has no gap, so no kicker or params")
        if (self.d0 is None) != (self.d1 is None):
            raise ValueError(f"stitch {self.id}: give both d0 and d1, or neither")
        return self


class SideRun(Strict):
    """A tag on ONE side of a road over a run of s (playtest 4, P4-19, B9): the Historic Columbia
    River Highway's `guard-wall` along its cliff side, Chuckanut Drive's `bay-bluff` along its bay
    side. `tbgis.drops` is how the runs were found. A run never covers a bridge deck (a deck has
    its own rail), and a district tag says nothing about the ground."""

    tag: str
    side: Literal["left", "right"]
    s0: float = Field(ge=0)
    s1: float = Field(gt=0)

    @model_validator(mode="after")
    def _ordered(self) -> SideRun:
        if not self.s0 < self.s1:
            raise ValueError(f"side run {self.tag}: s0 {self.s0} is not before s1 {self.s1}")
        return self


class RoadName(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")
    name: str
    # What the picker calls the real road when the map's own name is not the one to show (the
    # Golden Gate's deck is OSM's "Golden Gate Bridge"; the game says "Golden Gate"). None: the
    # longest OSM name along it, as every bake so far.
    realName: str | None = None  # noqa: N815
    # Scenery tags for both sides of the whole road, except over its bridges (scenery stands on
    # land only: playtest 1c item 3).
    tags: list[str] = []
    # Tags over the road's bridges only, beside `bridge` (playtest 3: the Old Seven Mile Bridge's
    # `old-bridge` deck look). The land tags above never reach a deck.
    deckTags: list[str] = []  # noqa: N815
    # District tags on one side over a run of s, never over a deck (see `SideRun`).
    sideRuns: list[SideRun] = []  # noqa: N815
    features: list[Feature] = []
    # This road's own sample spacing (1-10 m, the lint's range); None: the config's. A long straight
    # bridge at 6 m costs a third of the road data it would at 2 m (the Seven Mile, critic C1).
    sampleSpacingM: float | None = Field(None, ge=1, le=10)  # noqa: N815
    barriers: list[Barrier] = []


ROUTE_NOTES = "An alternative route on the real road; no event points at it yet (road-4 decides)."


class Route(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")
    name: str
    startS: float = 40.0  # noqa: N815 (on the first road)
    finishBeforeEndM: float = 40.0  # noqa: N815 (on the last road)
    notes: str = ROUTE_NOTES


class Verge(Strict):
    """A verge band past the outermost lane (docs/content-packs.md, "Cross-section")."""

    widthM: float = Field(ge=0, le=40)  # noqa: N815
    surface: Literal["shoulder", "dirt", "gravel", "sand", "grass", "kerb"]
    edge: Literal["soft", "brush", "water", "hard", "fence", "rail"]


class Verges(Strict):
    left: Verge | None = None
    right: Verge | None = None


class BakeConfig(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")  # the network id
    name: str
    region: str
    crs: Crs
    osmExtract: str  # noqa: N815 (cache path, relative to tools/gis)
    elevationExtract: str  # noqa: N815
    # The one Overpass query whose response is osmExtract; None means the Keys US 1 query.
    osmQuery: str | None = None  # noqa: N815
    # Where the bake writes, relative to the repo root; None means packs/base/regions/<region>.
    # A staging bake (tools/gis/staging/...) is outside the pack until its region pack exists.
    outRoot: str | None = None  # noqa: N815
    pathFrom: LatLon  # noqa: N815 (a node on the travel carriageway, upstream of the stretch)
    pathTo: LatLon  # noqa: N815 (a node downstream of the stretch)
    # Waypoints between pathFrom and pathTo: the path is the shortest drivable path through each in
    # turn, so a street route can take named turns instead of the overall shortest line.
    via: list[LatLon] = []
    # Only ways whose tags match every regex here carry the path (for example {"ref": "^SR 11$"});
    # every way in the extract still counts toward the junctions report.
    routeTags: dict[str, str] = {}  # noqa: N815
    # And, when given, only ways that match one of these groups (each group: every regex matches;
    # the key "@id" matches the way id), so a line can path over ways with different tags, such as
    # an old bridge drawn as highway=pedestrian, abandoned:highway=trunk and a bare bridge:name.
    wayFilter: list[dict[str, str]] = []  # noqa: N815
    # OSM way ids that count as bridge though the map leaves the tag off (the Golden Gate's Marin
    # approach viaduct, which crosses a gulch: bare-earth land under it must not pull the deck down).
    bridgeWays: list[int] = []  # noqa: N815
    # Spans the map does not draw, joined by a straight deck (and a gap feature on a network line).
    stitches: list[Stitch] = []
    # False lets a street route run against a one-way street (a race closes the streets).
    respectOneway: bool = True  # noqa: N815
    # Split a road at the grid point nearest each of these (named sections on a long rural road).
    splitAt: list[LatLon] = []  # noqa: N815
    # Split a road wherever the OSM street name changes (pieces under minRoadM join the one before).
    splitOnNameChange: bool = False  # noqa: N815
    minRoadM: float = Field(150.0, gt=0)  # noqa: N815
    realName: str = "Overseas Highway"  # noqa: N815 (each road's realName, unless realNameFromOsm)
    realNameFromOsm: bool = False  # noqa: N815 (each road's realName is its longest OSM street name)
    waysLabel: str = "US 1"  # noqa: N815 (what was stitched, for provenance.modifications)
    networkNotes: str = (  # noqa: N815
        "Real-road alternative to the hand-made network (gis-1 side quest). Roads joined end "
        "to end by pass-through junctions. The same frame as keys-m1, so the two line up."
    )
    start: LatLon
    end: LatLon
    splitBridgeMinM: float = Field(800.0, gt=0)  # noqa: N815 (bridges this long become their own road)
    roads: list[RoadName]
    route: Route
    smoothing: Smoothing = Smoothing()
    compression: Compression = Compression()
    elevation: Elevation = Elevation()
    sampleSpacingM: float = Field(2.0, ge=1, le=10)  # noqa: N815
    bridgeRailHeightM: float = Field(1.0, gt=0)  # noqa: N815 (a rail along both sides of every bridge)
    bridgeBarrier: BridgeBarrier | None = None  # noqa: N815 (None: that rail, as every bake so far)
    # Each travel lane's width. 3.4 m is the M1 lane table the Keys bake has; the hand-made roads
    # went to 4.0 m after playtest 1 ("road too narrow to weave"), and the region bakes match them.
    laneWidthM: float = Field(3.4, ge=2.5, le=5.0)  # noqa: N815
    # The cross-section (W-Q; interview, 2026-10-02: 4-6 lane highways). Drive lanes each way: 1 is
    # the M1 table every bake so far carries; 3 makes a six-lane highway.
    lanesPerDirection: int = Field(1, ge=1, le=3)  # noqa: N815
    # A median between the two directions (0: none). The lanes are set apart to leave its gap.
    medianM: float = Field(0.0, ge=0, le=30)  # noqa: N815
    medianKind: Literal["paint", "kerb", "grass", "barrier"] = "paint"  # noqa: N815
    # Verge bands for every road's lane section. None (the default) leaves them out, and the game
    # derives them from each road's tags and barriers (src/road/cross-section.ts).
    verges: Verges | None = None

    @staticmethod
    def load(path: Path) -> BakeConfig:
        return BakeConfig.model_validate_json(path.read_text(encoding="utf-8"))
