"""Playtest 3's bake capabilities (T9.1; real-world spec L1, critic C1): ramp lips baked into the
elevation, stitched gaps over a missing span, landmarks placed from lat/lon, per-road sample
spacing, synthetic branch ends with features on the connector straight, a per-line way filter, the
barrier look, and the feature-kind list the game's road format reads (src/road/types.ts)."""

from __future__ import annotations

import copy
import json
import math
import re
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from pydantic import ValidationError

from tbgis.config import BARRIER_LOOKS, FEATURE_KINDS, GAP_RESPAWNS, BakeConfig, Feature
from tbgis.emit import bake
from tbgis.features import RampSpec, ramp_profile
from tbgis.fetch import FetchMeta
from tbgis.lint import lint_bake, lint_network
from tbgis.network import MILE_M, Landmark, Milepost, NetworkBake, NetworkConfig, bake_network
from tbgis.osm import Way
from tbgis.stretch import F64, RealPath, build_profile, real_path, route_ways
from tbgis.tmerc import Frame

REPO = Path(__file__).resolve().parents[3]
LAT0, LON0 = 24.7, -81.1
M_LAT = 1 / 110_760.0
M_LON = 1 / 101_190.0
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-10-04T00:00:00Z", "0" * 64, 1
)


def ll(east_m: float, north_m: float) -> tuple[float, float]:
    return (LAT0 + north_m * M_LAT, LON0 + east_m * M_LON)


def pt(east_m: float, north_m: float) -> dict[str, float]:
    lat, lon = ll(east_m, north_m)
    return {"lat": lat, "lon": lon}


def polyline(points: list[tuple[float, float]], step: float = 20.0) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for (x0, y0), (x1, y1) in pairwise(points):
        n = max(1, round(math.hypot(x1 - x0, y1 - y0) / step))
        out += [ll(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n)]
    out.append(ll(*points[-1]))
    return out


def world(east_m: float, north_m: float) -> tuple[float, float]:
    return Frame(LAT0, LON0).to_world(*ll(east_m, north_m))


def flat(_sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 50)
    return s, np.full_like(s, 3.0), None


# ----------------------------------------------------------------------------------------------
# The contract the game reads


def ts_list(path: str, name: str) -> list[str]:
    """A `const NAME ... = [ 'a', 'b' ]` string list from the game's TypeScript."""
    text = (REPO / path).read_text(encoding="utf-8")
    m = re.search(rf"\b{name}\b[^=]*=\s*\[(.*?)\]", text, re.S)
    assert m, f"{name} not found in {path}"
    return re.findall(r"'([^']+)'", m.group(1))


def test_the_feature_kinds_barrier_looks_and_gap_respawns_are_the_games() -> None:
    # The bake writes what the game's road lint accepts, nothing more and nothing less.
    assert sorted(FEATURE_KINDS) == sorted(ts_list("src/road/validate.ts", "FEATURE_KINDS"))
    assert "landmark" in FEATURE_KINDS
    assert list(BARRIER_LOOKS) == ts_list("src/core/surfaces.ts", "BARRIER_LOOKS")
    assert list(GAP_RESPAWNS) == ts_list("src/road/types.ts", "GAP_RESPAWNS")


GIS = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("path", sorted((GIS / "configs").glob("*.json")), ids=lambda p: p.stem)
def test_every_committed_stretch_config_still_loads(path: Path) -> None:
    assert BakeConfig.load(path).id == path.stem


@pytest.mark.parametrize("path", sorted((GIS / "networks").glob("*.json")), ids=lambda p: p.stem)
def test_every_committed_network_config_still_loads(path: Path) -> None:
    assert NetworkConfig.load(path).id == path.stem


def test_feature_params_keep_booleans_and_numbers() -> None:
    # A landmark's overRoad (and a solid hazard's solid) is a JSON boolean, never a string or 1.0.
    f = Feature.model_validate(
        {
            "kind": "landmark",
            "id": "gg-south-tower",
            "s0": 0,
            "s1": 10,
            "d0": -5,
            "d1": 5,
            "params": {"model": "models/landmarks/golden-gate#tower", "overRoad": True, "scale": 2},
        }
    )
    dumped = f.model_dump(exclude_none=True)
    assert dumped["params"]["overRoad"] is True
    assert dumped["params"]["scale"] == 2 and dumped["params"]["model"].endswith("#tower")


def test_a_barrier_is_jumpable_only_as_a_wall() -> None:
    road = {"id": "osm-x", "name": "X", "barriers": [{"s0": 0, "s1": "end", "side": "left", "kind": "rail"}]}
    road["barriers"][0]["jumpable"] = True  # type: ignore[index]
    with pytest.raises(ValidationError, match="only a wall"):
        BakeConfig.model_validate({**stretch_base(), "roads": [road]})


# ----------------------------------------------------------------------------------------------
# Ramp lips, exactly as the hand-made compiler bakes them (src/road/compile.ts rampProfile)


def test_the_ramp_profile_is_the_compilers_formula() -> None:
    r = [RampSpec(s0=100.0, lengthM=16.0, heightM=2.0, backM=8.0)]
    # Kicker y = h u^2 over the run, then the back drops as h v^2; nothing outside.
    cases = {
        100.0: (0.0, 0.0),
        104.0: (0.125, 0.0625),
        108.0: (0.5, 0.125),
        116.0: (2.0, 0.25),
        120.0: (0.5, -0.25),
        124.0: (0.0, 0.0),
        130.0: (0.0, 0.0),
    }
    for s, (y, g) in cases.items():
        assert ramp_profile(r, s) == pytest.approx((y, g), abs=1e-12), s


# A stretch: west 1.5 km, a 2 km bridge, a bend to the north and 1 km more (test_pipeline's line).
A, B, C, D, E = ll(0, 0), ll(-1500, 0), ll(-3500, 0), ll(-3700, 200), ll(-3700, 1200)


def kw(wid: int, pts: list[tuple[float, float]], **tags: str) -> Way:
    return Way(id=wid, tags={"highway": "trunk", "ref": "US 1", "maxspeed": "55 mph", **tags}, coords=pts)


STRETCH_WAYS = [
    kw(1, [A, B]),
    kw(2, [B, C], bridge="yes", layer="1"),
    kw(3, [C, ll(-3620, 30), ll(-3680, 90), D]),
    kw(4, [D, E]),
]


def stretch_base() -> dict[str, Any]:
    return {
        "id": "osm-test-stretch",
        "name": "Test stretch",
        "region": "florida-keys",
        "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
        "osmExtract": "unused",
        "elevationExtract": "unused",
        "pathFrom": pt(0, 0),
        "pathTo": pt(-3700, 1200),
        "start": pt(-100, 0),
        "end": pt(-3700, 1100),
        "compression": {"enabled": False},
        "roads": [
            {"id": "osm-test-approach", "name": "Approach", "tags": ["palms"]},
            {"id": "osm-test-bridge", "name": "Bridge"},
            {"id": "osm-test-bend", "name": "Bend"},
        ],
        "route": {"id": "osm-test-run", "name": "Test run"},
    }


def stretch(**over: Any) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    c = BakeConfig.model_validate({**stretch_base(), **over})
    p = build_profile(c, real_path(c, STRETCH_WAYS), None, None)
    return bake(c, p, OSM, None, "2026-10-04")


RAMP = {
    "kind": "ramp",
    "id": "boat-ramp",
    "s0": 401.3,
    "s1": 401.3 + 15 + 6,
    "d0": -5,
    "d1": 5,
    "params": {"heightM": 1.5, "lengthM": 15, "backM": 6},
}


def with_road_feature(road: int, *features: dict[str, Any]) -> list[dict[str, Any]]:
    roads: list[dict[str, Any]] = copy.deepcopy(stretch_base()["roads"])
    roads[road]["features"] = list(features)
    return roads


def test_a_ramp_lip_is_baked_into_the_elevation_on_a_sample() -> None:
    _, plain, _ = stretch()
    network, roads, route = stretch(roads=with_road_feature(0, RAMP))
    road, base = roads[0], plain[0]
    sp = road["sampleSpacingM"]
    (f,) = road["features"]
    # The lip moved onto a sample, and the feature's range moved with it (the compiler's rule).
    lip = f["s0"] + 15
    assert lip / sp == pytest.approx(round(lip / sp), abs=1e-3)
    assert abs(f["s0"] - 401.3) <= sp / 2 + 1e-4
    assert f["s1"] == pytest.approx(f["s0"] + 21)
    spec = [RampSpec(s0=f["s0"], lengthM=15, heightM=1.5, backM=6)]
    ys, yb = road["samples"]["data"]["y"], base["samples"]["data"]["y"]
    gs, gb = road["samples"]["data"]["grade"], base["samples"]["data"]["grade"]
    n = len(ys) - 1
    for i in range(n + 1):
        s = road["lengthM"] if i == n else i * sp
        dy, dg = ramp_profile(spec, s)
        assert ys[i] - yb[i] == pytest.approx(dy, abs=1e-4 + 1e-6)  # r4 rounding of the samples
        assert gs[i] - gb[i] == pytest.approx(dg, rel=1e-4, abs=1e-4)
    assert max(ys) - max(yb) == pytest.approx(1.5, abs=1e-3)  # the full lip height is sampled
    assert lint_bake(network, roads, route) == []


def test_a_ramp_whose_range_is_not_its_run_and_back_is_refused() -> None:
    bad = {**RAMP, "s1": RAMP["s0"] + 15}  # type: ignore[operator]
    with pytest.raises(ValidationError, match="s0 \\+ lengthM \\+ backM"):
        BakeConfig.model_validate({**stretch_base(), "roads": with_road_feature(0, bad)})


def test_a_jump_on_a_bend_fails_the_bake_lint() -> None:
    # The jump lint (src/road/validate.ts): from a jump's start to its landing the road is straight.
    network, roads, route = stretch()
    bend = roads[2]
    k = np.abs(np.array(bend["samples"]["data"]["kappa"]))
    s_bend = float(np.argmax(k)) * bend["sampleSpacingM"]
    roads = copy.deepcopy(roads)
    roads[2]["features"] = [
        {"kind": "gap", "id": "hole", "s0": s_bend - 20, "s1": s_bend - 5, "d0": -5, "d1": 5}
    ]
    errs = lint_bake(network, roads, route)
    assert any("gap hole sits on a bend" in e for e in errs), errs


def test_per_road_sample_spacing() -> None:
    roads = copy.deepcopy(stretch_base()["roads"])
    roads[1]["sampleSpacingM"] = 6
    network, baked, route = stretch(roads=roads)
    bridge = baked[1]
    n = round(bridge["lengthM"] / bridge["sampleSpacingM"])
    assert bridge["sampleSpacingM"] == pytest.approx(6, abs=0.05)
    assert len(bridge["samples"]["data"]["x"]) == n + 1
    assert baked[0]["sampleSpacingM"] == pytest.approx(2, abs=0.01)
    assert lint_bake(network, baked, route) == []


def test_bridge_barriers_take_the_configured_kind_height_and_look() -> None:
    roads = copy.deepcopy(stretch_base()["roads"])
    roads[0]["barriers"] = [
        {"s0": 100, "s1": 160, "side": "right", "kind": "wall", "heightM": 1.2, "jumpable": True}
    ]
    _, baked, _ = stretch(roads=roads, bridgeBarrier={"kind": "wall", "heightM": 1.3, "look": "railing"})
    assert baked[0]["barriers"] == [
        {"s0": 100.0, "s1": 160.0, "side": "right", "kind": "wall", "heightM": 1.2, "jumpable": True}
    ]
    (rail,) = baked[1]["barriers"]
    assert (rail["kind"], rail["heightM"], rail["look"], rail["side"]) == ("wall", 1.3, "railing", "both")
    # Left out, a bridge keeps today's rail, byte for byte.
    _, plain, _ = stretch()
    assert set(plain[1]["barriers"][0]) == {"s0", "s1", "side", "kind", "heightM"}


def test_a_stretch_refuses_a_gap_stitch() -> None:
    # A stretch's route runs every road, and traffic runs the main path: gaps go on branch roads.
    with pytest.raises(ValueError, match="network"):
        stretch(stitches=[{"id": "hole", "from": pt(-1500, 0), "to": pt(-3500, 0), "trimM": 5}])


# ----------------------------------------------------------------------------------------------
# The way filter


def test_the_way_filter_ors_its_groups_and_reads_ids() -> None:
    ways = [
        Way(1, {"name": "Old Bridge", "highway": "pedestrian"}, [ll(0, 0), ll(10, 0)]),
        Way(2, {"bridge:name": "Old Bridge", "abandoned:highway": "trunk"}, [ll(10, 0), ll(20, 0)]),
        Way(3, {"highway": "service"}, [ll(20, 0), ll(30, 0)]),
        Way(4, {"name": "Fishing Pier", "highway": "footway"}, [ll(30, 0), ll(40, 0)]),
    ]
    c = BakeConfig.model_validate(
        {
            **stretch_base(),
            "wayFilter": [{"name": "^Old Bridge$"}, {"bridge:name": "^Old Bridge$"}, {"@id": "^3$"}],
        }
    )
    assert [w.id for w in route_ways(c, ways)] == [1, 2, 3]
    # routeTags still apply on top of it.
    c2 = c.model_copy(update={"routeTags": {"highway": "^pedestrian$"}})
    assert [w.id for w in route_ways(c2, ways)] == [1]


# ----------------------------------------------------------------------------------------------
# A Seven-Mile-like network: a new bridge east 3 km, an old bridge 80 m to its right (south) with
# an 80 m missing span, a fishing pier that would fill the span if the way filter let it, staging
# connectors on and off the old bridge with a ramp truck and a gap on each, and a landmark.

NEW = Way(1, {"highway": "trunk", "name": "New Bridge", "bridge": "yes"}, polyline([(0, 0), (3000, 0)]))
OLD_W = Way(
    2, {"highway": "pedestrian", "name": "Old Bridge", "bridge": "yes"}, polyline([(300, -80), (1400, -80)])
)
OLD_E = Way(
    3,
    {"abandoned:highway": "trunk", "bridge:name": "Old Bridge", "bridge": "yes"},
    polyline([(1480, -80), (2900, -80)]),
)
PIER = Way(
    4, {"highway": "footway", "name": "Fishing Pier", "bridge": "yes"}, polyline([(1400, -80), (1480, -80)])
)
NET_WAYS = [NEW, OLD_W, OLD_E, PIER]
STAGING: dict[str, Any] = {
    "synthetic": True,
    "turnRadiusM": 60,
    "straightM": 180,
    "tags": ["bridge", "water-open"],
}


def net_config(**over: Any) -> NetworkConfig:
    elevation = {"humpHeightM": 0}
    base: dict[str, Any] = {
        "id": "osm-test-sm",
        "name": "Test Seven Mile",
        "region": "florida-keys",
        "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
        "osmQuery": "q",
        "osmExtract": "unused",
        "outRoot": "unused",
        "networkNotes": "A test network.",
        "lines": [
            {
                "id": "new",
                "pathFrom": pt(0, 0),
                "pathTo": pt(3000, 0),
                "start": pt(10, 0),
                "end": pt(2990, 0),
                "routeTags": {"name": "^New Bridge$"},
                "splitBridgeMinM": 10000,
                "elevation": elevation,
                "bridgeBarrier": {"kind": "wall", "heightM": 1.3, "look": "railing"},
                "roads": [
                    {"id": "osm-test-sm-east", "name": "East"},
                    {"id": "osm-test-sm-middle", "name": "Middle"},
                    {"id": "osm-test-sm-west", "name": "West"},
                ],
                "landmarks": [
                    {
                        "id": "pigeon-key",
                        "model": "models/landmarks/keys-landmarks#pigeon_key",
                        "at": pt(1500, -30),
                        "footprintM": [20, 10],
                        "side": "right",
                    },
                    {
                        "id": "toll-gantry",
                        "model": "models/landmarks/sf-landmarks#toll_gantry",
                        "at": pt(2000, 0),
                        "footprintM": [4, 24],
                        "overRoad": True,
                        "yawDeg": 90,
                    },
                ],
            },
            {
                "id": "old",
                "pathFrom": pt(300, -80),
                "pathTo": pt(2900, -80),
                "wayFilter": [{"name": "^Old Bridge$"}, {"bridge:name": "^Old Bridge$"}],
                "respectOneway": False,
                "splitBridgeMinM": 10000,
                "elevation": elevation,
                "stitches": [
                    {
                        "id": "moser-gap",
                        "from": pt(1400, -80),
                        "to": pt(1480, -80),
                        "trimM": 8,
                        "kicker": {"heightM": 2, "lengthM": 16},
                        "params": {"respawn": "main"},
                    }
                ],
                "roads": [{"id": "osm-test-sm-old", "name": "Old road", "sampleSpacingM": 6}],
            },
        ],
        "branches": [
            {
                "id": "osm-test-sm-east-staging",
                "label": "old-road",
                "line": "old",
                "of": "new",
                "kind": "alternate",
                "aiTake": 0,
                "sign": "OLD ROAD: CLOSED. MOSTLY.",
                "leave": {
                    "at": pt(400, 0),
                    "offsetM": 3,
                    "lane": "R1",
                    "zone": {"lengthM": 40, "d0": 2, "d1": 6},
                    **STAGING,
                    "turnDeg": 20,
                    "roadId": "osm-test-sm-east-staging",
                    "features": [
                        {"kind": "rampTruck", "id": "east-truck", "s0": 10, "s1": 28, "d0": -1.5, "d1": 1.5},
                        {"kind": "gap", "id": "east-gap", "s0": 130, "s1": 155, "d0": -3, "d1": 3},
                    ],
                },
                "join": {
                    "at": pt(2600, 0),
                    "offsetM": 3,
                    "lane": "R1",
                    **STAGING,
                    "turnDeg": -20,
                    "roadId": "osm-test-sm-west-staging",
                    "features": [
                        {"kind": "rampTruck", "id": "west-truck", "s0": 10, "s1": 28, "d0": -1.5, "d1": 1.5},
                        {"kind": "gap", "id": "west-gap", "s0": 130, "s1": 155, "d0": -3, "d1": 3},
                    ],
                },
            }
        ],
        "routes": [
            {
                "id": "osm-test-sm-run",
                "name": "Test Seven Mile",
                "line": "new",
                "startRoad": "osm-test-sm-east",
                "finishRoad": "osm-test-sm-west",
            }
        ],
    }
    base.update(over)
    return NetworkConfig.model_validate(base)


@pytest.fixture(scope="module")
def sm() -> NetworkBake:
    return bake_network(net_config(), OSM, NET_WAYS, flat, "2026-10-04")


def road_of(nb: NetworkBake, rid: str) -> dict[str, Any]:
    return next(r for r in nb.roads if r["id"] == rid)


def at_s(road: dict[str, Any], s: float) -> tuple[float, float, float]:
    """(x, z, heading) on a baked road at s, from its samples."""
    d = road["samples"]["data"]
    ss = np.arange(len(d["x"])) * road["sampleSpacingM"]
    ss[-1] = road["lengthM"]
    x, z = float(np.interp(s, ss, d["x"])), float(np.interp(s, ss, d["z"]))
    i = min(len(d["x"]) - 2, int(s // road["sampleSpacingM"]))
    h = math.atan2(d["x"][i + 1] - d["x"][i], -(d["z"][i + 1] - d["z"][i]))
    return x, z, h


def nearest_s(road: dict[str, Any], x: float, z: float) -> tuple[float, float]:
    """The s on a baked road's sample polyline nearest (x, z), and the distance to it."""
    d = road["samples"]["data"]
    best = (0.0, math.inf)
    for i in range(len(d["x"]) - 1):
        ax, az, bx, bz = d["x"][i], d["z"][i], d["x"][i + 1], d["z"][i + 1]
        ll = (bx - ax) ** 2 + (bz - az) ** 2
        t = min(1.0, max(0.0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ll))
        dist = math.hypot(ax + t * (bx - ax) - x, az + t * (bz - az) - z)
        if dist < best[1]:
            best = ((i + t) * road["sampleSpacingM"], dist)
    return best


def test_the_seven_mile_like_network_passes_the_road_lint(sm: NetworkBake) -> None:
    assert lint_network(sm.network, sm.roads, sm.routes) == []


def test_the_bake_is_deterministic() -> None:
    a = bake_network(net_config(), OSM, NET_WAYS, flat, "2026-10-04")
    b = bake_network(net_config(), OSM, NET_WAYS, flat, "2026-10-04")
    assert json.dumps([a.network, a.roads, a.routes, a.report]) == json.dumps(
        [b.network, b.roads, b.routes, b.report]
    )


def test_a_stitched_gap_spans_the_missing_span_with_a_kicker(sm: NetworkBake) -> None:
    old = road_of(sm, "osm-test-sm-old")
    gaps = [f for f in old["features"] if f["kind"] == "gap"]
    assert len(gaps) == 1
    (gap,) = gaps
    assert gap["id"] == "moser-gap" and gap["params"] == {"respawn": "main"}
    # The deck runs straight between the two way ends; the gap is trimM in from each (its start
    # moved onto the kicker's lip, a sample, so within half a sample there).
    sp = old["sampleSpacingM"]
    for s, (e, n), tol in ((gap["s0"] - 8, (1400, -80), sp / 2 + 0.5), (gap["s1"] + 8, (1480, -80), 0.5)):
        x, z, _ = at_s(old, s)
        assert math.hypot(x - world(e, n)[0], z - world(e, n)[1]) < tol
    assert gap["s1"] - gap["s0"] == pytest.approx(64, abs=sp / 2 + 0.5)
    # The deck itself passes through both way ends (the real bridge's stubs), to 0.5 m.
    d = old["samples"]["data"]
    for e, n in ((1400, -80), (1480, -80)):
        wx, wz = world(e, n)
        assert min(math.hypot(x - wx, z - wz) for x, z in zip(d["x"], d["z"], strict=True)) < sp / 2 + 0.5
        s_near, _ = nearest_s(old, wx, wz)
        x, z, _ = at_s(old, s_near)
        assert math.hypot(x - wx, z - wz) < 0.5
    # The gap spans the road's width, shoulders included.
    edge = max(abs(ln["dCenterM"]) + ln["widthM"] / 2 for ln in old["laneSections"][0]["lanes"])
    assert (gap["d0"], gap["d1"]) == (-edge, edge)
    # The kicker's lip is a sample, and the gap starts at it.
    (kick,) = [f for f in old["features"] if f["kind"] == "ramp"]
    assert kick["id"] == "moser-gap-kicker"
    lip = kick["s0"] + 16
    assert lip / sp == pytest.approx(round(lip / sp), abs=1e-3)
    assert gap["s0"] == pytest.approx(lip, abs=1e-3)
    y = old["samples"]["data"]["y"]
    i = round(lip / sp)
    assert y[i] - y[i - 2] == pytest.approx(2.0 - 2.0 * ((16 - 2 * sp) / 16) ** 2, abs=0.01)
    # The fishing pier would have filled the span: the way filter left it out.
    assert old["sampleSpacingM"] == pytest.approx(6, abs=0.05)


def test_synthetic_staging_connectors_carry_their_features_on_the_straight(sm: NetworkBake) -> None:
    rep = {b["id"]: b for b in sm.report["branches"]}["osm-test-sm-east-staging"]
    for side, rid in (("leave", "osm-test-sm-east-staging"), ("join", "osm-test-sm-west-staging")):
        solved = rep[side]
        # The solve keeps the configured turns and only nudges the straight and the turn angle.
        assert abs(solved["turnDeg"]) == pytest.approx(20, abs=1.5)
        assert solved["straightM"] == pytest.approx(180, abs=12)
        assert solved["tightestRadiusM"] == pytest.approx(60, rel=0.1)
        assert solved["road"] == rid
        road = road_of(sm, rid)
        on = solved["straightStartM"]
        kinds = {f["id"]: f for f in road["features"]}
        truck = kinds[f"{'east' if side == 'leave' else 'west'}-truck"]
        gap = kinds[f"{'east' if side == 'leave' else 'west'}-gap"]
        assert truck["s0"] == pytest.approx(on + 10, abs=1e-3)
        assert gap["s1"] == pytest.approx(on + 155, abs=1e-3)
        k = np.array(road["samples"]["data"]["kappa"])
        sp = road["sampleSpacingM"]
        straight = k[math.ceil(on / sp) : math.floor((on + solved["straightM"]) / sp)]
        assert np.abs(straight).max() < 1e-4
        assert {t["tag"] for t in road["tags"]} == {"bridge", "water-open"}


def test_the_old_road_starts_and_ends_where_the_staging_lands(sm: NetworkBake) -> None:
    old = road_of(sm, "osm-test-sm-old")
    x0, z0, _ = at_s(old, 0)
    x1, z1, _ = at_s(old, old["lengthM"])
    # Both ends on the old bridge's real line (80 m south), between the two stagings.
    assert z0 == pytest.approx(world(0, -80)[1], abs=0.5) and z1 == pytest.approx(world(0, -80)[1], abs=0.5)
    assert world(500, 0)[0] < x0 < world(800, 0)[0]
    assert world(2200, 0)[0] < x1 < world(2500, 0)[0]


def test_a_landmark_round_trips_to_its_real_position(sm: NetworkBake) -> None:
    (road, f), *_ = [(r, f) for r in sm.roads for f in r["features"] if f["id"] == "pigeon-key"]
    assert road["id"] == "osm-test-sm-middle"
    s, d = (f["s0"] + f["s1"]) / 2, (f["d0"] + f["d1"]) / 2
    assert (f["s1"] - f["s0"], f["d1"] - f["d0"]) == pytest.approx((20, 10))
    x, z, h = at_s(road, s)
    gx, gz = x + d * math.cos(h), z + d * math.sin(h)
    tx, tz = world(1500, -30)
    assert math.hypot(gx - tx, gz - tz) < 0.5
    assert d == pytest.approx(30, abs=0.5)
    assert f["params"] == {"model": "models/landmarks/keys-landmarks#pigeon_key"}
    (row,) = [r for r in sm.report["landmarks"] if r["id"] == "pigeon-key"]
    assert row["road"] == "osm-test-sm-middle" and row["placementErrorM"] < 0.5
    gantry = next(f for r in sm.roads for f in r["features"] if f["id"] == "toll-gantry")
    assert gantry["params"] == {
        "model": "models/landmarks/sf-landmarks#toll_gantry",
        "yawDeg": 90.0,
        "overRoad": True,
    }


def test_a_landmark_on_the_wrong_side_is_refused() -> None:
    cfg = net_config()
    line = cfg.lines[0]
    lm = line.landmarks[0].model_copy(update={"side": "left"})
    bad = cfg.model_copy(update={"lines": [line.model_copy(update={"landmarks": [lm]}), cfg.lines[1]]})
    with pytest.raises(ValueError, match=r"pigeon-key.*right of the road"):
        bake_network(bad, OSM, NET_WAYS, flat, "2026-10-04")


def test_the_route_names_the_branch_with_its_ai_share_and_barriers_look_like_railings(
    sm: NetworkBake,
) -> None:
    (route,) = sm.routes
    (branch,) = route["branches"]
    assert branch["aiTake"] == 0 and branch["kind"] == "alternate"
    east = road_of(sm, "osm-test-sm-east")
    assert {(b["kind"], b["heightM"], b.get("look")) for b in east["barriers"]} == {("wall", 1.3, "railing")}


def test_a_stitch_far_from_any_way_end_is_refused() -> None:
    cfg = net_config()
    old = cfg.lines[1]
    st = old.stitches[0].model_copy(
        update={"from_": old.stitches[0].from_.model_copy(update={"lat": LAT0 + 0.01})}
    )
    bad = cfg.model_copy(update={"lines": [cfg.lines[0], old.model_copy(update={"stitches": [st]})]})
    with pytest.raises(ValueError, match="moser-gap"):
        bake_network(bad, OSM, NET_WAYS, flat, "2026-10-04")


def test_a_gap_on_a_main_path_road_fails_the_network_lint(sm: NetworkBake) -> None:
    roads = copy.deepcopy(sm.roads)
    east = next(r for r in roads if r["id"] == "osm-test-sm-east")
    east["features"] = [{"kind": "gap", "id": "hole", "s0": 100, "s1": 130, "d0": -6, "d1": 6}]
    errs = lint_network(sm.network, roads, sm.routes)
    assert any("holds gap hole" in e for e in errs), errs


# ----------------------------------------------------------------------------------------------
# A branch that leaves to the left (Portland's bridge choice may need one)

LEFT_WAYS = [
    Way(1, {"highway": "primary", "name": "A Road"}, polyline([(0, 0), (3000, 0)])),
    Way(
        2,
        {"highway": "secondary", "name": "B Road"},
        polyline([(800, 0), (900, 100), (1000, 300), (2000, 300), (2100, 100), (2200, 0)]),
    ),
]


def test_a_branch_can_leave_and_rejoin_on_the_left() -> None:
    cfg = NetworkConfig.model_validate(
        {
            "id": "osm-test-left",
            "name": "Left",
            "region": "test-region",
            "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
            "osmQuery": "q",
            "osmExtract": "unused",
            "outRoot": "unused",
            "networkNotes": "A test network.",
            "lines": [
                {
                    "id": "a",
                    "pathFrom": pt(0, 0),
                    "pathTo": pt(3000, 0),
                    "start": pt(10, 0),
                    "end": pt(2990, 0),
                    "routeTags": {"name": "^A Road$"},
                    "smoothing": {"headingSigmaM": 20},
                    "crossSection": {"lanesPerDirection": 2},
                    "roads": [
                        {"id": "osm-test-l1", "name": "A west"},
                        {"id": "osm-test-l2", "name": "A middle"},
                        {"id": "osm-test-l3", "name": "A east"},
                    ],
                },
                {
                    "id": "b",
                    "pathFrom": pt(800, 0),
                    "pathTo": pt(2200, 0),
                    "routeTags": {"name": "^B Road$"},
                    "smoothing": {"headingSigmaM": 20},
                    "roads": [{"id": "osm-test-lb", "name": "B Road"}],
                },
            ],
            "branches": [
                {
                    "id": "osm-test-lb",
                    "line": "b",
                    "of": "a",
                    "leave": {
                        "at": pt(800, 0),
                        "offsetM": -8,
                        "lane": "L2",
                        "zone": {"lengthM": 40, "d0": -10.5, "d1": -6},
                        "toOffsetM": -2,
                    },
                    "join": {"at": pt(2200, 0), "offsetM": -7, "lane": "L2", "fromOffsetM": -2},
                }
            ],
            "routes": [
                {
                    "id": "osm-test-left-run",
                    "name": "Left",
                    "line": "a",
                    "startRoad": "osm-test-l1",
                    "finishRoad": "osm-test-l3",
                }
            ],
        }
    )
    nb = bake_network(cfg, OSM, LEFT_WAYS, flat, "2026-10-04")
    assert lint_network(nb.network, nb.roads, nb.routes) == []
    kin = next(c for j in nb.network["junctions"] for c in j["connectors"] if "splitZone" in c)
    assert kin["splitZone"]["d1"] < 0


# ----------------------------------------------------------------------------------------------
# Mile-marker posts and islands (playtest 4, P4-19: the Seven Mile's identity)


def mile_config(**over: Any) -> NetworkConfig:
    cfg = net_config()
    spec = {"model": "keys-identity#keys_mile_marker", "mile": 3.7, "at": pt(100, 0), **over}
    mp = Milepost.model_validate(spec)
    return cfg.model_copy(update={"lines": [cfg.lines[0].model_copy(update={"mileposts": mp}), cfg.lines[1]]})


def posts_of(nb: NetworkBake) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [(r, f) for r in nb.roads for f in r["features"] if f["id"].startswith("mile-")]


def test_mileposts_stand_a_mile_apart_with_the_numbers_falling() -> None:
    nb = bake_network(mile_config(), OSM, NET_WAYS, flat, "2026-10-04")
    posts = posts_of(nb)
    assert sorted(f["params"]["number"] for _, f in posts) == [2, 3]
    xs: dict[int, float] = {}
    for road, f in posts:
        x, _, _ = at_s(road, (f["s0"] + f["s1"]) / 2)
        xs[f["params"]["number"]] = x
    # The line runs east: mile 3 first, mile 2 a statute mile on (1,609.344 m), the number lower.
    assert xs[2] - xs[3] == pytest.approx(MILE_M, abs=0.5)
    # Mile 3.7 is at the anchor 100 m east of the origin: mile 3 stands 0.7 mile past it.
    assert xs[3] - world(100, 0)[0] == pytest.approx(0.7 * MILE_M, abs=1.0)
    for _, f in posts:
        assert f["params"] == {
            "model": "keys-identity#keys_mile_marker",
            "yawDeg": 180.0,
            "number": f["params"]["number"],
        }
        assert type(f["params"]["number"]) is int
    assert lint_network(nb.network, nb.roads, nb.routes) == []


def test_a_milepost_stands_on_its_side_of_the_road_and_the_numbers_can_rise() -> None:
    right = posts_of(bake_network(mile_config(offsetM=5.85), OSM, NET_WAYS, flat, "2026-10-04"))
    for _, f in right:
        assert (f["d0"] + f["d1"]) / 2 == pytest.approx(5.85, abs=0.01)
        assert f["s1"] - f["s0"] == pytest.approx(0.6, abs=0.01)
        assert f["d1"] - f["d0"] == pytest.approx(0.6, abs=0.01)
    left = posts_of(bake_network(mile_config(side="left"), OSM, NET_WAYS, flat, "2026-10-04"))
    assert left and all(f["d1"] < 0 for _, f in left)
    # Rising numbers run the other way: with mile 2.4 at the anchor, 3 stands 0.6 mile on, then 4.
    rising = posts_of(
        bake_network(mile_config(falling=False, mile=2.4, at=pt(130, 0)), OSM, NET_WAYS, flat, "2026-10-04")
    )
    assert sorted(f["params"]["number"] for _, f in rising) == [3, 4]


def test_a_post_near_a_roads_end_is_left_out() -> None:
    # Mile 3.0 sits at the anchor, 2 m from the line's start; the margin keeps it off the road's end.
    near = bake_network(mile_config(mile=3.0, at=pt(12, 0), marginM=40), OSM, NET_WAYS, flat, "2026-10-04")
    assert 3 not in [f["params"]["number"] for _, f in posts_of(near)]
    clear = bake_network(mile_config(mile=3.0, at=pt(12, 0), marginM=0), OSM, NET_WAYS, flat, "2026-10-04")
    assert 3 in [f["params"]["number"] for _, f in posts_of(clear)]


def test_an_island_and_a_number_reach_the_landmark_params() -> None:
    lm = Landmark.model_validate(
        {
            "id": "pigeon-key",
            "model": "seven-mile-kit#pigeon_key",
            "at": pt(1500, -30),
            "footprintM": [110, 54],
            "island": True,
        }
    )
    assert lm.params() == {"model": "seven-mile-kit#pigeon_key", "island": True}
    post = Landmark.model_validate(
        {
            "id": "m",
            "model": "keys-identity#keys_mile_marker",
            "at": pt(1, 1),
            "footprintM": [1, 1],
            "number": 46,
        }
    )
    assert post.params()["number"] == 46
    with pytest.raises(ValidationError):
        Landmark.model_validate(
            {"id": "m", "model": "a#b", "at": pt(1, 1), "footprintM": [1, 1], "number": -2}
        )
