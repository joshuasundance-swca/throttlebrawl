"""Side runs in a network bake (playtest 4, P4-19, C4): Lake Samish's `lake` lies beside part of one side of
East Shore Drive, a road of the I-5 network. B9's `sideRuns` (tests/test_side_runs.py) wrote them in a stretch
bake only; a network bake writes them the same way, on their side, over the s they name and off the decks, and
a branch's connector, dressed like the road beside it, never takes them (the lake ended up on both sides of
the rejoin connector)."""

from __future__ import annotations

from typing import Any

import pytest
from test_keys_pt3 import OSM as KEYS_OSM
from test_keys_pt3 import ROADS as KEYS_ROADS
from test_keys_pt3 import WAYS as KEYS_WAYS
from test_keys_pt3 import flat as keys_flat
from test_keys_pt3 import pt as keys_pt
from test_network import OSM as NET_OSM
from test_network import WAYS as NET_WAYS
from test_network import config as net_config
from test_network import flat as net_flat

from tbgis.network import NetworkConfig, bake_network


def rows(road: dict[str, Any], tag: str) -> list[tuple[float, float, str]]:
    return [(t["s0"], t["s1"], t["side"]) for t in road["tags"] if t["tag"] == tag]


def keys_network(side_runs: list[dict[str, Any]], on: int) -> dict[str, dict[str, Any]]:
    """Land, a 4 km bridge and land on one line (test_keys_pt3's), with side runs on one road."""
    roads = [dict(r) for r in KEYS_ROADS]
    roads[on]["sideRuns"] = side_runs
    cfg = NetworkConfig.model_validate(
        {
            "id": "osm-test-runs",
            "name": "Test runs",
            "region": "florida-keys",
            "crs": {"originLatDeg": 24.7, "originLonDeg": -81.1},
            "osmQuery": "q",
            "osmExtract": "unused",
            "outRoot": "unused",
            "networkNotes": "A test network.",
            "lines": [
                {
                    "id": "main",
                    "pathFrom": keys_pt(-400),
                    "pathTo": keys_pt(4400),
                    "start": keys_pt(-300),
                    "end": keys_pt(4300),
                    "roads": roads,
                }
            ],
            "routes": [
                {
                    "id": "osm-test-runs-run",
                    "name": "Test",
                    "line": "main",
                    "startRoad": "osm-test-west",
                    "finishRoad": "osm-test-east",
                }
            ],
        }
    )
    return {r["id"]: r for r in bake_network(cfg, KEYS_OSM, KEYS_WAYS, keys_flat, "2026-10-05").roads}


def test_a_side_run_in_a_network_bake_is_on_its_side_only_over_its_s() -> None:
    roads = keys_network([{"tag": "lake", "side": "right", "s0": 20, "s1": 60}], 0)
    west = roads["osm-test-west"]
    assert rows(west, "lake") == [(20.0, 60.0, "right")]
    # The land tags are still both-sided and whole, and no other road has the run.
    assert rows(west, "palms") == [(0.0, west["lengthM"], "both")]
    assert rows(roads["osm-test-east"], "lake") == []


def test_a_side_run_in_a_network_bake_never_reaches_a_deck() -> None:
    bridge = keys_network([{"tag": "lake", "side": "left", "s0": 0, "s1": 3000}], 1)["osm-test-bridge"]
    decks = [(a, b) for a, b, _ in rows(bridge, "bridge")]
    assert decks
    for s0, s1, _ in rows(bridge, "lake"):
        assert all(s1 <= d0 or s0 >= d1 for d0, d1 in decks), (s0, s1, decks)


def test_a_side_run_off_its_road_is_refused_in_a_network_bake() -> None:
    with pytest.raises(ValueError, match="side run lake"):
        keys_network([{"tag": "lake", "side": "right", "s0": 20, "s1": 99_000}], 0)


def test_a_connector_beside_a_road_never_takes_its_side_runs() -> None:
    raw = net_config().model_dump(exclude_none=True)
    raw["lines"][1]["roads"][0]["sideRuns"] = [{"tag": "lake", "side": "right", "s0": 100, "s1": 300}]
    cfg = NetworkConfig.model_validate(raw)
    roads = {r["id"]: r for r in bake_network(cfg, NET_OSM, NET_WAYS, net_flat, "2026-10-05").roads}
    assert rows(roads["osm-test-b"], "lake") == [(100.0, 300.0, "right")]
    # The connectors into and out of the branch road, dressed like the roads beside them.
    for c in (roads["osm-test-net-b-road-in"], roads["osm-test-net-b-road-out"]):
        assert rows(c, "lake") == [], c["id"]
        assert c["tags"] != [], c["id"]
