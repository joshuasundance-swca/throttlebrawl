"""What the Golden Gate and Lombard bakes (playtest 3, T9.3) needed beyond T9.1's switches: a way the map
leaves untagged that still carries a deck (`bridgeWays`), open water under a long span deck
(`waterBridgeMinM`), a one-way section as wide as its one lane (`oneWay`, for a 5 m hairpin that a
two-way table fails the |kappa| * dMax rule on) and a surface per road (`roadSurface`). Every switch
is off by default: the first tests here bake without them and check what the game had before."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from pydantic import ValidationError

from tbgis.config import BakeConfig
from tbgis.emit import bake
from tbgis.fetch import FetchMeta
from tbgis.lint import lint_bake, lint_network
from tbgis.network import NetworkBake, NetworkConfig, bake_network
from tbgis.osm import Way
from tbgis.stretch import F64, RealPath, build_profile, real_path
from tbgis.tmerc import Frame

LAT0, LON0 = 37.8, -122.4
M_LAT = 1 / 111_200.0
M_LON = 1 / 88_000.0
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-10-04T00:00:00Z", "0" * 64, 1
)


def ll(east_m: float, north_m: float) -> tuple[float, float]:
    return (LAT0 + north_m * M_LAT, LON0 + east_m * M_LON)


def pt(east_m: float, north_m: float) -> dict[str, float]:
    lat, lon = ll(east_m, north_m)
    return {"lat": lat, "lon": lon}


def flat(_sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 50)
    return s, np.full_like(s, 60.0), None


# ----------------------------------------------------------------------------------------------
# A long deck and a short one, and a viaduct the map leaves untagged: a stretch of 1.2 km of road,
# a 100 m untagged viaduct, a 2 km bridge, a land bend and a 12 m overpass.


def straight(x0: float, x1: float, step: float = 20.0) -> list[tuple[float, float]]:
    n = max(1, round(abs(x1 - x0) / step))
    return [ll(x0 + (x1 - x0) * i / n, 0) for i in range(n + 1)]


def way(wid: int, pts: list[tuple[float, float]], **tags: str) -> Way:
    return Way(id=wid, tags={"highway": "motorway", "name": "Deck Road", **tags}, coords=pts)


DECK_WAYS = [
    way(1, straight(0, 1200)),
    way(2, straight(1200, 1300)),  # the viaduct: no bridge tag in the map
    way(3, straight(1300, 3300), bridge="yes"),
    way(4, straight(3300, 3900)),
    way(5, straight(3900, 3912), bridge="yes"),  # an overpass, 12 m long
    way(6, straight(3912, 4500)),
]


def deck_stretch(**over: Any) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    cfg: dict[str, Any] = {
        "id": "osm-test-deck",
        "name": "Test deck",
        "region": "san-francisco",
        "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
        "osmExtract": "unused",
        "elevationExtract": "unused",
        "pathFrom": pt(0, 0),
        "pathTo": pt(4500, 0),
        "start": pt(10, 0),
        "end": pt(4490, 0),
        "compression": {"enabled": False},
        "elevation": {"bridgeDeck": "span", "humpHeightM": 0},
        "splitBridgeMinM": 10000,
        "roads": [{"id": "osm-test-deck-all", "name": "All"}],
        "route": {"id": "osm-test-deck-run", "name": "Test deck run"},
        **over,
    }
    c = BakeConfig.model_validate(cfg)
    p = build_profile(c, real_path(c, DECK_WAYS), None, None)
    return bake(c, p, OSM, None, "2026-10-04")


def tag_ranges(road: dict[str, Any], tag: str) -> list[tuple[float, float]]:
    return [(t["s0"], t["s1"]) for t in road["tags"] if t["tag"] == tag]


def test_a_way_the_map_leaves_untagged_is_a_bridge_only_when_the_config_says_so() -> None:
    # Before: the 100 m viaduct is land, and the long bridge starts where the map tags it (s ~ 1290).
    _, plain, _ = deck_stretch()
    a, b = tag_ranges(plain[0], "bridge")[0]
    assert a == pytest.approx(1290, abs=3) and b == pytest.approx(3290, abs=3), (a, b)
    # After: the viaduct carries the deck too, so the deck starts where the viaduct does (s ~ 1190).
    _, dressed, _ = deck_stretch(bridgeWays=[2])
    a, b = tag_ranges(dressed[0], "bridge")[0]
    assert a == pytest.approx(1190, abs=3) and b == pytest.approx(3290, abs=3), (a, b)
    # And it is the whole run: one deck from the viaduct to the end of the bridge way.
    assert len(tag_ranges(dressed[0], "bridge")) == 2  # the long deck and the 12 m overpass


def test_a_span_deck_gets_open_water_only_when_it_is_long_enough_and_asked() -> None:
    # Default: a span deck crosses a ravine, so no water tag (every bake so far).
    _, plain, _ = deck_stretch()
    assert tag_ranges(plain[0], "water-open") == []
    _, wet, _ = deck_stretch(elevation={"bridgeDeck": "span", "humpHeightM": 0, "waterBridgeMinM": 800})
    water = tag_ranges(wet[0], "water-open")
    # The 2 km deck stands over open water; the 12 m overpass does not (it crosses a road).
    assert len(water) == 1 and water[0][1] - water[0][0] > 1900, water
    assert len(tag_ranges(wet[0], "bridge")) == 2


# ----------------------------------------------------------------------------------------------
# A hairpin of a 6 m radius: the cross-section rule |kappa| * dMax < 0.5 forbids it on a two-way
# table (dMax 4.75 m) and allows it on one lane (dMax 2 m).


def hairpin_points() -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = [(float(x), 0.0) for x in range(0, 201, 10)]
    r, cx, cz = 6.0, 200.0, 6.0
    # 150 degrees of left turn, a point every half metre of arc.
    n = round(math.radians(150) * r / 0.5)
    for i in range(1, n + 1):
        th = math.radians(-90 + 150 * i / n)
        pts.append((cx + r * math.cos(th), cz + r * math.sin(th)))
    hx, hz = pts[-1]
    hd = math.radians(60 + 90)
    for k in range(1, 21):
        pts.append((hx + 10 * k * math.cos(hd), hz + 10 * k * math.sin(hd)))
    return pts


HAIRPIN_WAY = Way(
    7,
    {"highway": "residential", "name": "Crooked Street", "oneway": "yes", "surface": "bricks"},
    [ll(x, z) for x, z in hairpin_points()],
)


def hairpin_network(**road_lanes: Any) -> NetworkConfig:
    return NetworkConfig.model_validate(
        {
            "id": "osm-test-hairpin",
            "name": "Test hairpin",
            "region": "san-francisco",
            "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
            "osmQuery": "q",
            "osmExtract": "unused",
            "outRoot": "unused",
            "networkNotes": "A test network.",
            "lines": [
                {
                    "id": "main",
                    "pathFrom": pt(0, 0),
                    "pathTo": pt(*hairpin_points()[-1]),
                    "start": pt(0, 0),
                    "end": pt(*hairpin_points()[-1]),
                    "smoothing": {"headingSigmaM": 2},
                    "splitAt": [pt(180, 0), pt(*hairpin_points()[-18])],
                    "elevation": {"humpHeightM": 0},
                    "surface": "asphalt",
                    "roadSurface": {"osm-test-hairpin-turn": "brick"},
                    "roadLanes": road_lanes,
                    "roads": [
                        {"id": "osm-test-hairpin-in", "name": "In"},
                        {"id": "osm-test-hairpin-turn", "name": "Turn", "sampleSpacingM": 1.2},
                        {"id": "osm-test-hairpin-out", "name": "Out"},
                    ],
                }
            ],
            "routes": [
                {
                    "id": "osm-test-hairpin-run",
                    "name": "Test hairpin",
                    "line": "main",
                    "startRoad": "osm-test-hairpin-in",
                    "finishRoad": "osm-test-hairpin-out",
                }
            ],
        }
    )


ONE_WAY = {"osm-test-hairpin-turn": {"laneWidthM": 4.0, "oneWay": True}}


def bake_hairpin(**road_lanes: Any) -> NetworkBake:
    return bake_network(hairpin_network(**road_lanes), OSM, [HAIRPIN_WAY], flat, "2026-10-04")


def test_a_two_way_table_fails_the_width_rule_on_a_six_metre_hairpin() -> None:
    # The negative control for the next test: the same hairpin with the default cross-section is
    # refused by the bake's own copy of the game's road lint.
    nb = bake_hairpin()
    errs = lint_network(nb.network, nb.roads, nb.routes)
    assert any("|kappa| * dMax" in e and "osm-test-hairpin-turn" in e for e in errs), errs


def test_a_one_way_section_is_one_forward_lane_with_no_shoulders_and_passes_the_width_rule() -> None:
    nb = bake_hairpin(**ONE_WAY)
    assert lint_network(nb.network, nb.roads, nb.routes) == []
    turn = next(r for r in nb.roads if r["id"] == "osm-test-hairpin-turn")
    (lanes,) = [s["lanes"] for s in turn["laneSections"]]
    assert lanes == [{"id": "R1", "dCenterM": 0, "widthM": 4.0, "direction": 1, "kind": "drive"}]
    k = max(abs(v) for v in turn["samples"]["data"]["kappa"])
    assert 1 / k < 7, f"the hairpin kept its turn: tightest radius {1 / k:.1f} m"
    assert k * 2.0 < 0.5
    # The roads either side keep the two-way table (the join narrows like any lane drop).
    inn = next(r for r in nb.roads if r["id"] == "osm-test-hairpin-in")
    assert {ln["id"] for ln in inn["laneSections"][0]["lanes"]} == {"L0", "L1", "R1", "R0"}


def test_a_one_way_section_is_one_lane_and_nothing_else() -> None:
    with pytest.raises(ValidationError, match="one lane"):
        hairpin_network(**{"osm-test-hairpin-turn": {"oneWay": True, "lanesPerDirection": 2}})
    with pytest.raises(ValidationError, match="one lane"):
        hairpin_network(**{"osm-test-hairpin-turn": {"oneWay": True, "medianM": 1, "medianKind": "barrier"}})


def test_a_surface_per_road_leaves_the_others_on_the_lines() -> None:
    nb = bake_hairpin(**ONE_WAY)
    surfaces = {r["id"]: r["surface"] for r in nb.roads}
    assert surfaces == {
        "osm-test-hairpin-in": "asphalt",
        "osm-test-hairpin-turn": "brick",
        "osm-test-hairpin-out": "asphalt",
    }


def test_a_road_can_name_itself_where_the_maps_name_is_not_the_one_to_show() -> None:
    # The picker lists a route by its roads' realName. Left out it is what every bake so far gave (a
    # stretch's configured name, a network line's longest OSM name); given, it wins.
    _, plain, _ = deck_stretch()
    assert plain[0]["realName"] == "Overseas Highway"
    _, named, _ = deck_stretch(roads=[{"id": "osm-test-deck-all", "name": "All", "realName": "The Deck"}])
    assert named[0]["realName"] == "The Deck"
    nb = bake_hairpin()
    assert {r["realName"] for r in nb.roads} == {"Crooked Street"}
    cfg = hairpin_network()
    line = cfg.lines[0].model_copy(
        update={"roads": [r.model_copy(update={"realName": "The Crook"}) for r in cfg.lines[0].roads]}
    )
    nb2 = bake_network(cfg.model_copy(update={"lines": [line]}), OSM, [HAIRPIN_WAY], flat, "2026-10-04")
    assert {r["realName"] for r in nb2.roads} == {"The Crook"}


def test_the_lint_still_refuses_what_a_stretch_bake_always_did() -> None:
    # A control for the whole file: the stretch above bakes clean and the lint is the game's own.
    network, roads, route = deck_stretch(bridgeWays=[2])
    assert lint_bake(network, roads, route) == []
    assert Frame(LAT0, LON0).to_world(*ll(0, 0)) == pytest.approx((0.0, 0.0), abs=1e-6)
