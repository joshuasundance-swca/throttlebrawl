"""Tags over part of one side of a road (playtest 4, P4-19, C4: `spanTags`). Chuckanut's bay side is a
`bluff` only where the ground really drops to the water, and its uphill side a `rock-cut` only where the
slope rises from the road; Lake Samish's shore drive is `lake` only where the water is beside it. A road's
`tags` cover both sides of all of it, so these need ranges and a side. Like the land tags, a span tag never
reaches a deck."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from pydantic import ValidationError

from tbgis.config import BakeConfig
from tbgis.emit import bake
from tbgis.fetch import FetchMeta
from tbgis.network import NetworkConfig, bake_network
from tbgis.osm import Way
from tbgis.stretch import F64, RealPath, build_profile, real_path

LAT0, LON0 = 48.66, -122.47
M_LAT = 1 / 111_200.0
M_LON = 1 / 73_600.0
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-10-05T00:00:00Z", "0" * 64, 1
)


def pt(east_m: float) -> dict[str, float]:
    return {"lat": LAT0, "lon": LON0 + east_m * M_LON}


def line_of(x0: float, x1: float, step: float = 20.0) -> list[tuple[float, float]]:
    n = max(1, round((x1 - x0) / step))
    return [(LAT0, LON0 + (x0 + (x1 - x0) * i / n) * M_LON) for i in range(n + 1)]


# Land, a 4 km straight bridge, land: east along one parallel.
WAY_TAGS = {"highway": "secondary", "name": "Test Drive"}
WAYS = [
    Way(1, dict(WAY_TAGS), line_of(-400, 0)),
    Way(2, {**WAY_TAGS, "bridge": "yes"}, line_of(0, 4000)),
    Way(3, dict(WAY_TAGS), line_of(4000, 4400)),
]


def flat(_sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 50)
    return s, np.full_like(s, 1.0), None


SPANS: list[dict[str, Any]] = [
    {"s0": 100, "s1": 300, "side": "right", "tag": "bluff"},
    {"s0": 50, "s1": "end", "side": "left", "tag": "rock-cut"},
]
ROADS: list[dict[str, Any]] = [
    {"id": "osm-test-west", "name": "West", "tags": ["forest"], "spanTags": SPANS},
    # Across the deck: the span tag stops at the bridge, as the land tags do.
    {"id": "osm-test-bridge", "name": "Bridge", "tags": ["forest"], "spanTags": [SPANS[1]]},
    {"id": "osm-test-east", "name": "East", "tags": ["forest"]},
]


def stretch(roads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    c = BakeConfig.model_validate(
        {
            "id": "osm-test-stretch",
            "name": "Test stretch",
            "region": "pacific-northwest",
            "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
            "osmExtract": "unused",
            "elevationExtract": "unused",
            "pathFrom": pt(-400),
            "pathTo": pt(4400),
            "start": pt(-300),
            "end": pt(4300),
            "compression": {"enabled": False},
            "roads": roads,
            "route": {"id": "osm-test-run", "name": "Test run"},
        }
    )
    _, out, _ = bake(c, build_profile(c, real_path(c, WAYS), None, None), OSM, None, "2026-10-05")
    return out


def network(roads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cfg = NetworkConfig.model_validate(
        {
            "id": "osm-test-spans",
            "name": "Test spans",
            "region": "pacific-northwest",
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
                    "roads": roads,
                }
            ],
            "routes": [
                {
                    "id": "osm-test-spans-run",
                    "name": "Test",
                    "line": "main",
                    "startRoad": "osm-test-west",
                    "finishRoad": "osm-test-east",
                }
            ],
        }
    )
    return bake_network(cfg, OSM, WAYS, flat, "2026-10-05").roads


def rows(road: dict[str, Any], tag: str) -> list[tuple[float, float, str]]:
    return [(t["s0"], t["s1"], t["side"]) for t in road["tags"] if t["tag"] == tag]


@pytest.mark.parametrize("bake_roads", [stretch, network])
def test_a_span_tag_covers_its_range_on_its_side_only(bake_roads: Any) -> None:
    roads = {r["id"]: r for r in bake_roads(ROADS)}
    west = roads["osm-test-west"]
    assert rows(west, "bluff") == [(100, 300, "right")]
    assert rows(west, "rock-cut") == [(50, west["lengthM"], "left")]
    # The road's own tags are unchanged: both sides, all of it.
    assert rows(west, "forest") == [(0, west["lengthM"], "both")]
    # A road without span tags has none.
    assert rows(roads["osm-test-east"], "bluff") == rows(roads["osm-test-east"], "rock-cut") == []


@pytest.mark.parametrize("bake_roads", [stretch, network])
def test_a_span_tag_never_reaches_a_deck(bake_roads: Any) -> None:
    bridge = next(r for r in bake_roads(ROADS) if r["id"] == "osm-test-bridge")
    decks = [(t["s0"], t["s1"]) for t in bridge["tags"] if t["tag"] == "bridge"]
    assert decks
    for s0, s1, _ in rows(bridge, "rock-cut"):
        assert all(s1 <= d0 or s0 >= d1 for d0, d1 in decks), (s0, s1, decks)


def test_a_span_tag_off_its_road_is_refused() -> None:
    far = [{**ROADS[0], "spanTags": [{"s0": 100, "s1": 99_000, "side": "right", "tag": "bluff"}]}, *ROADS[1:]]
    with pytest.raises(ValueError, match="span tag bluff"):
        stretch(far)
    with pytest.raises(ValueError, match="span tag bluff"):
        network(far)


def test_a_span_tag_needs_a_side_and_a_range() -> None:
    for bad in (
        {"s0": 100, "s1": 300, "side": "up", "tag": "bluff"},
        {"s0": 300, "s1": 100, "side": "right", "tag": "bluff"},
        {"s0": 100, "s1": 300, "side": "right", "tag": ""},
    ):
        with pytest.raises(ValidationError):
            BakeConfig.model_validate(
                {
                    "id": "osm-test-stretch",
                    "name": "Test",
                    "region": "pacific-northwest",
                    "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
                    "osmExtract": "unused",
                    "elevationExtract": "unused",
                    "pathFrom": pt(-400),
                    "pathTo": pt(4400),
                    "start": pt(-300),
                    "end": pt(4300),
                    "roads": [{**ROADS[0], "spanTags": [bad]}, *ROADS[1:]],
                    "route": {"id": "osm-test-run", "name": "Test run"},
                }
            )


def test_a_connector_beside_a_road_never_takes_its_span_tags() -> None:
    """A branch's connector is dressed like the road it leaves or joins (`bl_tags`), but a span tag lies
    beside part of one side only: Lake Samish's lake ended up on both sides of the rejoin connector."""
    from test_network import OSM as NET_OSM
    from test_network import WAYS as NET_WAYS
    from test_network import config
    from test_network import flat as net_flat

    cfg = config()
    raw = cfg.model_dump(exclude_none=True)
    raw["lines"][1]["roads"][0]["spanTags"] = [{"s0": 100, "s1": 300, "side": "right", "tag": "lake"}]
    roads = {
        r["id"]: r
        for r in bake_network(
            NetworkConfig.model_validate(raw), NET_OSM, NET_WAYS, net_flat, "2026-10-05"
        ).roads
    }
    assert rows(roads["osm-test-b"], "lake") == [(100, 300, "right")]
    # The connectors into and out of the branch road, dressed like the roads beside them.
    for c in (roads["osm-test-net-b-road-in"], roads["osm-test-net-b-road-out"]):
        assert rows(c, "lake") == [], c["id"]
        assert c["tags"] != [], c["id"]
