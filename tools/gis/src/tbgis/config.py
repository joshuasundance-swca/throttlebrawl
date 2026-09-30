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


class Feature(Strict):
    """A feature range in road space (metres along this road; d positive to the right)."""

    kind: Literal["ramp", "gap", "hazard", "roadsideZone", "copSpawn", "raceMarker", "billboard"]
    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    s0: float
    s1: float
    d0: float
    d1: float
    params: dict[str, str] | None = None


class RoadName(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")
    name: str
    tags: list[str] = []
    features: list[Feature] = []


class Route(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")
    name: str
    startS: float = 40.0  # noqa: N815 (on the first road)
    finishBeforeEndM: float = 40.0  # noqa: N815 (on the last road)


class BakeConfig(Strict):
    id: str = Field(pattern=r"^osm-[a-z0-9]+(-[a-z0-9]+)*$")  # the network id
    name: str
    region: str
    crs: Crs
    osmExtract: str  # noqa: N815 (cache path, relative to tools/gis)
    elevationExtract: str  # noqa: N815
    pathFrom: LatLon  # noqa: N815 (a node on the travel carriageway, upstream of the stretch)
    pathTo: LatLon  # noqa: N815 (a node downstream of the stretch)
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

    @staticmethod
    def load(path: Path) -> BakeConfig:
        return BakeConfig.model_validate_json(path.read_text(encoding="utf-8"))
