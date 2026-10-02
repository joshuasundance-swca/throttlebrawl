"""The bake config: one JSON file per baked stretch (``tools/gis/configs/<id>.json``)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    # "sea": decks sit deckM above the water (y = 0), as on the Keys. "span": a deck runs straight
    # between the land heights at its two ends, for a bridge over a creek or a ravine in high
    # country, where 3DEP reads the valley floor under it.
    bridgeDeck: Literal["sea", "span"] = "sea"  # noqa: N815


class Feature(Strict):
    """A feature range in road space (metres along this road; d positive to the right).

    The kinds are the road file's (docs/content-packs.md, "Road file"), boost pads and ramp trucks
    included; a pad or truck with ``params.slot`` is one candidate for that slot, and each race's
    seed picks one per slot. A ``billboard`` slot names one region ``item`` or a ``pool``.
    """

    kind: Literal[
        "ramp",
        "gap",
        "hazard",
        "roadsideZone",
        "copSpawn",
        "raceMarker",
        "billboard",
        "boostPad",
        "rampTruck",
    ]
    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    s0: float
    s1: float
    d0: float
    d1: float
    item: str | None = None
    pool: Literal["signs", "billboards"] | None = None
    params: dict[str, str | float] | None = None


class RoadName(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")
    name: str
    # Scenery tags for both sides of the whole road, except over its bridges (scenery stands on
    # land only: playtest 1c item 3).
    tags: list[str] = []
    features: list[Feature] = []


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
