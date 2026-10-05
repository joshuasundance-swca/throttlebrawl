"""Two switches the Keys bakes need (playtest 3, T9.2; critic C1): the navigation hump at a real
point (the Seven Mile Bridge humps over Moser Channel, not at its middle), and tags written over a
road's bridges (`deckTags`: the Old Seven Mile Bridge's `old-bridge` deck look; land tags stay off
every deck). Both are off by default, so every committed bake is unchanged."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from tbgis.config import BakeConfig, Feature
from tbgis.emit import bake
from tbgis.fetch import FetchMeta
from tbgis.network import NetworkConfig, bake_network
from tbgis.osm import Way
from tbgis.stretch import F64, RealPath, build_profile, real_path

LAT0, LON0 = 24.7, -81.1
M_LAT = 1 / 110_760.0
M_LON = 1 / 101_190.0
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-10-04T00:00:00Z", "0" * 64, 1
)


def ll(east_m: float) -> tuple[float, float]:
    return (LAT0, LON0 + east_m * M_LON)


def pt(east_m: float, north_m: float = 0.0) -> dict[str, float]:
    return {"lat": LAT0 + north_m * M_LAT, "lon": LON0 + east_m * M_LON}


def line_of(x0: float, x1: float, step: float = 20.0) -> list[tuple[float, float]]:
    n = max(1, round((x1 - x0) / step))
    return [ll(x0 + (x1 - x0) * i / n) for i in range(n + 1)]


# Land, a 4 km straight bridge, land: east along one parallel.
TAGS = {"highway": "trunk", "name": "Test Highway"}
WAYS = [
    Way(1, dict(TAGS), line_of(-400, 0)),
    Way(2, {**TAGS, "bridge": "yes"}, line_of(0, 4000)),
    Way(3, dict(TAGS), line_of(4000, 4400)),
]


def flat(_sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 50)
    return s, np.full_like(s, 1.0), None


ROADS: list[dict[str, Any]] = [
    {"id": "osm-test-west", "name": "West", "tags": ["palms"]},
    {"id": "osm-test-bridge", "name": "Bridge", "tags": ["palms"], "deckTags": ["old-bridge"]},
    {"id": "osm-test-east", "name": "East", "tags": ["palms"]},
]


def network(elevation: dict[str, Any]) -> list[dict[str, Any]]:
    cfg = NetworkConfig.model_validate(
        {
            "id": "osm-test-hump",
            "name": "Test hump",
            "region": "florida-keys",
            "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
            "osmQuery": "q",
            "osmExtract": "unused",
            "outRoot": "unused",
            "networkNotes": "A test network.",
            "lines": [
                {
                    "id": "main",
                    "pathFrom": pt(-400),
                    "pathTo": pt(4400),
                    "start": pt(-300),
                    "end": pt(4300),
                    "elevation": {"humpHeightM": 10, "humpLengthM": 400, **elevation},
                    "roads": ROADS,
                }
            ],
            "routes": [
                {
                    "id": "osm-test-hump-run",
                    "name": "Test",
                    "line": "main",
                    "startRoad": "osm-test-west",
                    "finishRoad": "osm-test-east",
                }
            ],
        }
    )
    return bake_network(cfg, OSM, WAYS, flat, "2026-10-04").roads


def peak_east_m(roads: list[dict[str, Any]]) -> float:
    """Where the bridge road is highest, in metres east of the bridge's west end (x = 0)."""
    bridge = next(r for r in roads if r["id"] == "osm-test-bridge")
    d = bridge["samples"]["data"]
    i = int(np.argmax(d["y"]))
    x0 = next(r for r in roads if r["id"] == "osm-test-west")["samples"]["data"]["x"][-1]
    # The line runs due east, so world x is metres east (the west road ends where the bridge begins).
    return float(d["x"][i] - x0)


def test_the_hump_stands_mid_bridge_by_default() -> None:
    assert math.isclose(peak_east_m(network({})), 2000, abs_tol=10)


def test_hump_at_puts_the_hump_over_the_real_point() -> None:
    roads = network({"humpAt": pt(900, 30)})
    assert math.isclose(peak_east_m(roads), 900, abs_tol=10)
    bridge = next(r for r in roads if r["id"] == "osm-test-bridge")
    y = np.array(bridge["samples"]["data"]["y"])
    x = np.array(bridge["samples"]["data"]["x"])
    x0 = next(r for r in roads if r["id"] == "osm-test-west")["samples"]["data"]["x"][-1]
    # One hump only, the configured height above the deck (4 m), and none at the middle.
    assert math.isclose(float(y.max()), 4 + 10, abs_tol=0.05)
    assert float(y[int(np.argmin(np.abs(x - x0 - 2000)))]) < 4.5


def tag_rows(road: dict[str, Any], tag: str) -> list[tuple[float, float]]:
    return [(t["s0"], t["s1"]) for t in road["tags"] if t["tag"] == tag]


def test_deck_tags_cover_the_bridges_and_land_tags_stay_off_them_network() -> None:
    roads = {r["id"]: r for r in network({})}
    bridge = roads["osm-test-bridge"]
    assert tag_rows(bridge, "old-bridge") == tag_rows(bridge, "bridge") != []
    assert tag_rows(bridge, "palms") == []
    # A land road takes its land tags and no deck tag.
    assert tag_rows(roads["osm-test-west"], "old-bridge") == []
    assert tag_rows(roads["osm-test-west"], "palms") != []


def test_deck_tags_in_a_stretch_bake_too() -> None:
    c = BakeConfig.model_validate(
        {
            "id": "osm-test-stretch",
            "name": "Test stretch",
            "region": "florida-keys",
            "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
            "osmExtract": "unused",
            "elevationExtract": "unused",
            "pathFrom": pt(-400),
            "pathTo": pt(4400),
            "start": pt(-300),
            "end": pt(4300),
            "compression": {"enabled": False},
            "roads": ROADS,
            "route": {"id": "osm-test-run", "name": "Test run"},
        }
    )
    _, roads, _ = bake(c, build_profile(c, real_path(c, WAYS), None, None), OSM, None, "2026-10-04")
    bridge = next(r for r in roads if r["id"] == "osm-test-bridge")
    assert tag_rows(bridge, "old-bridge") == tag_rows(bridge, "bridge") != []
    assert tag_rows(bridge, "palms") == []


def test_a_roadside_zone_names_its_kinds() -> None:
    """A zone's `kinds` (zone-local people and animals, playtest 3) is a list of words: the config
    takes it, and the feature carries it through unchanged (T10.4: Duval's crowd)."""
    f = Feature.model_validate(
        {
            "kind": "roadsideZone",
            "id": "test-zone",
            "s0": 10,
            "s1": 90,
            "d0": 5.6,
            "d1": 10.6,
            "params": {"spawns": "pedestrians", "kinds": ["street-performer", "cruise-day-tripper"]},
        }
    )
    assert f.model_dump(exclude_none=True)["params"] == {
        "spawns": "pedestrians",
        "kinds": ["street-performer", "cruise-day-tripper"],
    }
