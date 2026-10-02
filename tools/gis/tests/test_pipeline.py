"""The bake pipeline on synthetic OSM ways, plus the lint on good and broken output."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tbgis.config import BakeConfig
from tbgis.emit import bake, lanes
from tbgis.fetch import FetchMeta
from tbgis.graph import Graph
from tbgis.lint import lint_bake
from tbgis.osm import Way
from tbgis.stretch import build_profile, gaussian, real_path, runs_of

LAT0, LON0 = 24.7, -81.1
M_LAT = 1 / 110_760.0  # degrees per metre north, near 24.7 N (close enough for fixtures)
M_LON = 1 / 101_190.0  # degrees per metre east


def ll(east_m: float, north_m: float) -> tuple[float, float]:
    return (LAT0 + north_m * M_LAT, LON0 + east_m * M_LON)


def way(wid: int, pts: list[tuple[float, float]], **tags: str) -> Way:
    return Way(id=wid, tags={"highway": "trunk", "ref": "US 1", "maxspeed": "55 mph", **tags}, coords=pts)


# Heading west 1.5 km, a 2 km bridge, then a 90-degree bend to the north and 1 km more.
A, B, C, D = ll(0, 0), ll(-1500, 0), ll(-3500, 0), ll(-3700, 200)
E = ll(-3700, 1200)
WAYS = [
    way(1, [A, B]),
    way(2, [B, C], bridge="yes", layer="1"),
    way(3, [C, ll(-3620, 30), ll(-3680, 90), D]),
    way(4, [D, E]),
    # A one-way carriageway going the other way must never be used westbound.
    way(5, [ll(-1400, 0), ll(-3400, 5)], oneway="yes"),
]
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-09-30T00:00:00Z", "0" * 64, 1
)


def cfg(**over: Any) -> BakeConfig:
    base: dict[str, Any] = {
        "id": "osm-test-stretch",
        "name": "Test stretch",
        "region": "florida-keys",
        "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
        "osmExtract": "unused",
        "elevationExtract": "unused",
        "pathFrom": {"lat": A[0], "lon": A[1]},
        "pathTo": {"lat": E[0], "lon": E[1]},
        "start": {"lat": ll(-100, 0)[0], "lon": ll(-100, 0)[1]},
        "end": {"lat": ll(-3700, 1100)[0], "lon": ll(-3700, 1100)[1]},
        "roads": [
            {"id": "osm-test-approach", "name": "Approach", "tags": ["palms"]},
            {"id": "osm-test-bridge", "name": "Bridge"},
            {"id": "osm-test-bend", "name": "Bend"},
        ],
        "route": {"id": "osm-test-run", "name": "Test run"},
    }
    base.update(over)
    return BakeConfig.model_validate(base)


def test_graph_respects_oneway() -> None:
    g = Graph(WAYS)
    steps = g.path(A, E)
    assert {s.way.id for s in steps} == {1, 2, 3, 4}
    back = g.path(C, B)  # westbound one-way cannot be driven east...
    assert all(s.way.id != 5 for s in back)
    fwd = g.path(ll(-1400, 0), ll(-3400, 5))  # ...but is used in its own direction
    assert [s.way.id for s in fwd] == [5]


def test_gaussian_keeps_constants_and_ends() -> None:
    v = np.full(50, 3.0)
    assert np.allclose(gaussian(v, 5.0), 3.0)
    step = np.concatenate([np.zeros(50), np.ones(50)])
    out = gaussian(step, 4.0)
    assert out[0] == pytest.approx(0) and out[-1] == pytest.approx(1)
    assert 0.4 < out[50] < 0.6


def profile(c: BakeConfig) -> Any:
    rp = real_path(c, WAYS)
    return build_profile(c, rp, None, None)


def test_profile_keeps_the_turn_and_agrees_with_itself() -> None:
    p = profile(cfg(compression={"enabled": False}))
    total_turn = math.degrees(float(p.heading[-1] - p.heading[0]))
    assert total_turn == pytest.approx(90, abs=1.0)  # west to north is a right turn: +90
    assert float(np.trapezoid(p.kappa, p.s)) == pytest.approx(math.radians(total_turn), abs=1e-3)
    assert p.s[-1] == pytest.approx(p.real_length, rel=1e-6)
    # Re-integrated positions stay near the real line (smoothing cuts the corner a little).
    assert abs(p.x[-1] - (-3700)) < 30 and abs(p.z[-1] - (-1100)) < 30


def bridge_len(p: Any) -> float:
    return float(max((b - a) * p.h for a, b in runs_of(p.bridge)))


def test_compression_shortens_straights_not_bridges() -> None:
    plain = profile(cfg(compression={"enabled": False}))
    short = profile(cfg())
    assert short.s[-1] < plain.s[-1] - 300
    assert bridge_len(short) == pytest.approx(bridge_len(plain), abs=3)
    assert float(short.heading[-1] - short.heading[0]) == pytest.approx(
        float(plain.heading[-1] - plain.heading[0]), abs=1e-6
    )


def test_bridge_deck_and_hump() -> None:
    c = cfg()
    p = profile(c)
    (a, b) = max(runs_of(p.bridge), key=lambda r: r[1] - r[0])
    e = c.elevation
    assert float(p.y[a]) == pytest.approx(e.minLandM, abs=0.01)  # meets the land level
    assert float(p.y[a:b].max()) == pytest.approx(e.deckM + e.humpHeightM, abs=0.05)
    assert float(np.abs(p.grade).max()) < 0.15


def baked(c: BakeConfig | None = None) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    c = c or cfg()
    return bake(c, profile(c), OSM, None, "2026-09-30")


def test_bake_splits_at_the_long_bridge_and_passes_lint() -> None:
    network, roads, route = baked()
    assert [r["id"] for r in roads] == ["osm-test-approach", "osm-test-bridge", "osm-test-bend"]
    assert roads[1]["barriers"] and roads[1]["barriers"][0]["kind"] == "rail"
    assert not roads[0]["barriers"]
    assert lint_bake(network, roads, route) == []
    assert all(r["provenance"]["sources"][0]["spdx"] == "ODbL-1.0" for r in roads)


def test_bake_refuses_a_config_that_names_the_wrong_roads() -> None:
    c = cfg(roads=[{"id": "osm-only-one", "name": "One"}])
    with pytest.raises(ValueError, match="splits into 3 roads"):
        baked(c)


def broken(mutate: Any) -> list[str]:
    network, roads, route = baked()
    network, roads, route = copy.deepcopy(network), copy.deepcopy(roads), copy.deepcopy(route)
    mutate(network, roads, route)
    return lint_bake(network, roads, route)


def _drop_sample(n: Any, r: Any, _: Any) -> None:
    for col in r[0]["samples"]["data"].values():
        col.pop()


def _bend_kappa(n: Any, r: Any, _: Any) -> None:
    k = r[0]["samples"]["data"]["kappa"]
    k[len(k) // 2] += 0.01


def _move_junction(n: Any, r: Any, _: Any) -> None:
    n["junctions"][1]["x"] += 1.0


def _rename(n: Any, r: Any, _: Any) -> None:
    r[0]["id"] = "test-approach"
    n["roads"][0] = "test-approach"


def _no_odbl(n: Any, r: Any, _: Any) -> None:
    r[0]["provenance"] = {"sources": []}


def _tag_off_road(n: Any, r: Any, _: Any) -> None:
    r[0]["tags"].append({"s0": 0, "s1": r[0]["lengthM"] + 5, "side": "both", "tag": "palms"})


def _break_route(n: Any, r: Any, route: Any) -> None:
    route["mainPath"] = [route["mainPath"][0], route["mainPath"][2]]


def _spacing(n: Any, r: Any, _: Any) -> None:
    r[0]["sampleSpacingM"] = 0.5


@pytest.mark.parametrize(
    ("mutate", "expect"),
    [
        (_drop_sample, "samples, expected"),
        (_bend_kappa, "curvature disagrees"),
        (_move_junction, "from junction"),
        (_rename, "osm- prefix"),
        (_no_odbl, "no ODbL source"),
        (_tag_off_road, "outside 0.."),
        (_break_route, "does not join"),
        (_spacing, "outside 1..10"),
    ],
)
def test_lint_fires(mutate: Any, expect: str) -> None:
    errs = broken(mutate)
    assert any(expect in e for e in errs), errs


PACK = Path(__file__).resolve().parents[3] / "packs" / "base" / "regions" / "florida-keys"


def test_committed_bake_passes_the_lint() -> None:
    network = json.loads((PACK / "networks" / "osm-keys-bahia-honda.json").read_text(encoding="utf-8"))
    roads = [
        json.loads((PACK / "roads" / f"{rid}.json").read_text(encoding="utf-8")) for rid in network["roads"]
    ]
    route = json.loads((PACK / "routes" / "osm-bahia-honda-run.json").read_text(encoding="utf-8"))
    assert lint_bake(network, roads, route) == []
    total = sum(r["lengthM"] for r in roads)
    assert 5000 <= total <= 8000  # the 5-8 km stretch
    bridges = [t["s1"] - t["s0"] for r in roads for t in r["tags"] if t["tag"] == "bridge"]
    assert max(bridges) >= 1500  # includes a long bridge


def test_default_lane_table_is_the_m1_one() -> None:
    # One lane each way, no median, no verges: every committed bake's table, byte for byte.
    assert lanes(3.4) == [
        {"id": "L0", "dCenterM": -4.15, "widthM": 1.5, "direction": -1, "kind": "shoulder"},
        {"id": "L1", "dCenterM": -1.7, "widthM": 3.4, "direction": -1, "kind": "drive"},
        {"id": "R1", "dCenterM": 1.7, "widthM": 3.4, "direction": 1, "kind": "drive"},
        {"id": "R0", "dCenterM": 4.15, "widthM": 1.5, "direction": 1, "kind": "shoulder"},
    ]
    _, roads, _ = baked()
    assert all(set(r["laneSections"][0]) == {"s0", "lanes"} for r in roads)


def test_six_lane_highway_with_a_median_and_verges() -> None:
    # W-Q cross-section (interview, 2026-10-02: 4-6 lane highways): three lanes each way, a 2 m
    # kerbed median between them, and grass verges ending in a fence on the right.
    c = cfg(
        laneWidthM=4.0,
        lanesPerDirection=3,
        medianM=2.0,
        medianKind="kerb",
        verges={"right": {"widthM": 6, "surface": "grass", "edge": "fence"}},
    )
    network, roads, route = baked(c)
    section = roads[0]["laneSections"][0]
    ids = [ln["id"] for ln in section["lanes"]]
    assert ids == ["L0", "L3", "L2", "L1", "R1", "R2", "R3", "R0"]
    d = {ln["id"]: ln["dCenterM"] for ln in section["lanes"]}
    assert (d["L1"], d["R1"], d["R3"], d["R0"]) == (-3.0, 3.0, 11.0, 13.75)
    assert d["R1"] - 2.0 - (d["L1"] + 2.0) == pytest.approx(2.0)  # the median's gap
    assert section["median"] == {"widthM": 2.0, "kind": "kerb"}
    assert section["verges"] == {"right": {"widthM": 6.0, "surface": "grass", "edge": "fence"}}
    assert lint_bake(network, roads, route) == []


def test_lanes_refuses_a_fourth_lane_each_way() -> None:
    with pytest.raises(ValueError, match="1 to 3"):
        lanes(4.0, 4)
    with pytest.raises(ValueError):
        cfg(lanesPerDirection=4)
