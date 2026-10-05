"""Network bakes (run W-S): real roads joined at their real junctions, the loop-closure drift
closed, junction choices as branches with split zones, and routes drawn from the network."""

from __future__ import annotations

import math
from itertools import pairwise
from typing import Any, cast

import numpy as np
import pytest

from tbgis.config import BakeConfig
from tbgis.fetch import FetchMeta
from tbgis.lint import lint_network
from tbgis.network import (
    BakedLine,
    NetworkBake,
    NetworkConfig,
    Shape,
    bake_line,
    bake_network,
    connector_shape,
    correction,
    curve_piece,
    solve_shape,
    stretch_config,
)
from tbgis.osm import Way
from tbgis.stretch import F64, RealPath, build_profile, real_path
from tbgis.tmerc import Frame

LAT0, LON0 = 25.0, -81.0
M_LAT = 1 / 111_000.0
M_LON = 1 / (111_320.0 * math.cos(math.radians(LAT0)))
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-10-02T00:00:00Z", "0" * 64, 1
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


# A Road runs east 3 km. B Road leaves it at 800 m, swings 300 m south through four corners and
# rejoins it at 2200 m: a real loop, so B's baked line drifts off the map before the closure.
WAYS = [
    Way(1, {"highway": "primary", "name": "A Road", "maxspeed": "45 mph"}, polyline([(0, 0), (3000, 0)])),
    Way(
        2,
        {"highway": "secondary", "name": "B Road"},
        polyline([(800, 0), (900, -100), (1000, -300), (2000, -300), (2100, -100), (2200, 0)]),
    ),
]


def flat(_sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 50)
    return s, np.full_like(s, 3.0), None


def config(**over: Any) -> NetworkConfig:
    base: dict[str, Any] = {
        "id": "osm-test-net",
        "name": "Test network",
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
                "crossSection": {"lanesPerDirection": 2, "medianM": 2, "medianKind": "grass"},
                "roads": [
                    {"id": "osm-test-a1", "name": "A west", "tags": ["palms"]},
                    {"id": "osm-test-a2", "name": "A middle", "tags": ["palms"]},
                    {"id": "osm-test-a3", "name": "A east", "tags": ["town"]},
                ],
            },
            {
                "id": "b",
                "pathFrom": pt(800, 0),
                "pathTo": pt(2200, 0),
                "routeTags": {"name": "^B Road$"},
                "smoothing": {"headingSigmaM": 20},
                "roads": [{"id": "osm-test-b", "name": "B Road", "tags": ["beach"]}],
            },
        ],
        "branches": [
            {
                "id": "osm-test-b",
                "label": "b-road",
                "line": "b",
                "of": "a",
                "kind": "detour",
                "sign": "B ROAD: KEEP RIGHT. Longer. Prettier.",
                "leave": {
                    "at": pt(800, 0),
                    "offsetM": 8,
                    "lane": "R2",
                    "zone": {"lengthM": 40, "d0": 6, "d1": 10.5},
                    "toOffsetM": 2,
                },
                "join": {"at": pt(2200, 0), "offsetM": 7, "lane": "R2", "fromOffsetM": 2},
            }
        ],
        "routes": [
            {
                "id": "osm-test-full",
                "name": "Full",
                "line": "a",
                "startRoad": "osm-test-a1",
                "finishRoad": "osm-test-a3",
            },
            {
                "id": "osm-test-short",
                "name": "Short",
                "line": "a",
                "startRoad": "osm-test-a1",
                "finishRoad": "osm-test-a2",
            },
        ],
    }
    base.update(over)
    return NetworkConfig.model_validate(base)


@pytest.fixture(scope="module")
def baked() -> NetworkBake:
    return bake_network(config(), OSM, WAYS, flat, "2026-10-02")


def test_the_closure_correction_is_zero_at_the_start_and_exact_at_each_anchor() -> None:
    s = np.linspace(0, 1000, 1001)
    ex, ez = correction(s, [(400.0, 6.0, -2.0), (900.0, 1.0, 1.0)])
    assert ex[0] == 0 and ez[0] == 0
    assert ex[400] == pytest.approx(6.0) and ez[400] == pytest.approx(-2.0)
    assert ex[900] == pytest.approx(1.0) and ez[1000] == pytest.approx(1.0)
    # Smooth: no step bigger than the anchors' slope allows.
    assert np.abs(np.diff(ex)).max() < 0.03


def test_a_loop_drifts_off_the_map_before_the_closure_and_meets_it_after() -> None:
    cfg = config()
    line = cfg.line("b")
    # Before: the stretch bake's line, integrated from its smoothed heading, misses the real
    # rejoin point (the 6 m drift the routes lane measured on a city block).
    sc = stretch_config(cfg, line)
    rp = real_path(sc, WAYS)
    s, y, _ = flat(sc, rp)
    raw = build_profile(sc, rp, y, s)
    end = ll(2200, 0)
    ex, ez = Frame(LAT0, LON0).to_world(*end)
    miss_before = math.hypot(float(raw.x[-1]) - ex, float(raw.z[-1]) - ez)
    assert miss_before > 2.0
    closed = bake_line(cfg, line, WAYS, flat)
    miss_after = math.hypot(float(closed.p.x[-1]) - ex, float(closed.p.z[-1]) - ez)
    assert miss_after < 0.05
    assert closed.drift["b-road join"] == pytest.approx(miss_before, abs=0.5)
    # Still a road: uniform spacing, and curvature from its own positions.
    assert np.ptp(np.diff(closed.p.s)) < 1e-9


def test_the_network_passes_the_road_lint(baked: NetworkBake) -> None:
    assert lint_network(baked.network, baked.roads, baked.routes) == []


def test_the_branch_leaves_through_a_split_zone_and_rejoins(baked: NetworkBake) -> None:
    rows = {c["id"]: (j, c) for j in baked.network["junctions"] for c in j["connectors"]}
    j, kin = rows["cx-osm-test-net-b-road-in"]
    assert kin["from"] == {"road": "osm-test-a1", "end": "to", "lane": "R2"}
    assert kin["to"] == {"road": "osm-test-b", "end": "from", "lane": "R1"}
    a1 = next(r for r in baked.roads if r["id"] == "osm-test-a1")
    assert kin["splitZone"] == {
        "s0": pytest.approx(a1["lengthM"] - 40),
        "s1": a1["lengthM"],
        "d0": 6,
        "d1": 10.5,
    }
    # The main road goes on through the junction in every drive lane, both ways.
    through = sorted(c["to"]["lane"] for c in j["connectors"] if c["road"] == "osm-test-net-b-road-leave")
    assert through == ["L1", "L2", "R1", "R2"]
    _, kout = rows["cx-osm-test-net-b-road-out"]
    assert kout["to"] == {"road": "osm-test-a3", "end": "from", "lane": "R2"}
    # Traffic never takes the branch: its connectors carry one shortcut lane.
    for rid in ("osm-test-net-b-road-in", "osm-test-net-b-road-out"):
        road = next(r for r in baked.roads if r["id"] == rid)
        assert [ln["kind"] for ln in road["laneSections"][0]["lanes"]] == ["shortcut"]


def test_routes_name_the_branches_inside_their_span(baked: NetworkBake) -> None:
    full, short = baked.routes
    assert full["mainPath"] == ["osm-test-a1", "osm-test-a2", "osm-test-a3"]
    assert full["branches"] == [
        {
            "id": "osm-test-b",
            "kind": "detour",
            "marked": True,
            "sign": "B ROAD: KEEP RIGHT. Longer. Prettier.",
            "roads": ["osm-test-net-b-road-in", "osm-test-b", "osm-test-net-b-road-out"],
        }
    ]
    assert "osm-test-net-b-road-leave" in full["allowedRoads"]
    # The short route ends before the branch rejoins, so it never offers it.
    assert "branches" not in short
    assert "osm-test-b" not in short["allowedRoads"]
    assert baked.report["branches"][0]["savesM"] < -300  # a detour: longer than the main road


def test_lanes_tags_and_provenance(baked: NetworkBake) -> None:
    a2 = next(r for r in baked.roads if r["id"] == "osm-test-a2")
    lanes = a2["laneSections"][0]
    assert [ln["id"] for ln in lanes["lanes"]] == ["L0", "L2", "L1", "R1", "R2", "R0"]
    assert lanes["median"] == {"widthM": 2, "kind": "grass"}
    assert {t["tag"] for t in a2["tags"]} == {"palms"}
    assert a2["speedLimitMps"] == pytest.approx(20.1, abs=0.1)
    assert a2["realName"] == "A Road"
    assert a2["provenance"]["sources"][0]["spdx"] == "ODbL-1.0"
    assert "closed" in a2["provenance"]["modifications"]


def test_the_report_carries_each_lines_fun_numbers(baked: NetworkBake) -> None:
    # A network replaces stretch bakes (run W-U: Russian Hill), so its report keeps what a
    # stretch's fun report said, per line: computed from the closed profile, never typed.
    a, b = baked.report["lines"]["a"]["fun"], baked.report["lines"]["b"]["fun"]
    assert a["game_length_m"] == pytest.approx(2980, abs=5)
    assert a["corners"] == 0 and a["tightest_radius_m"] > 1000  # A Road is straight
    assert b["corners"] >= 2  # B Road swings south and back through its corners
    # The smoothed corners stray a few metres from the real polyline (the closure pins only the
    # junctions), well inside the 10 m the routes lane measured on real city blocks.
    assert 0 < b["max_deviation_m"] < 10


def test_a_road_count_that_does_not_match_the_cuts_is_refused() -> None:
    cfg = config()
    bad = cfg.model_copy(
        update={"lines": [cfg.lines[0].model_copy(update={"roads": cfg.lines[0].roads[:2]}), cfg.lines[1]]}
    )
    with pytest.raises(ValueError, match="cuts into 3 roads"):
        bake_network(bad, OSM, WAYS, flat, "2026-10-02")


def test_a_branch_keeps_the_id_the_game_derives() -> None:
    cfg = config()
    renamed = cfg.model_copy(update={"branches": [cfg.branches[0].model_copy(update={"id": "b-road"})]})
    with pytest.raises(ValueError, match="name it osm-test-b"):
        bake_network(renamed, OSM, WAYS, flat, "2026-10-02")


def test_the_connector_solve_lands_on_its_target() -> None:
    sh = solve_shape(0, 0, 0, 30, -60, math.pi / 2, 15, 15)
    assert sh is not None
    x, z = sh.end(0, 0, 2000)
    assert math.hypot(x - 30, z + 60) < 1e-3
    assert sh.heading(sh.length) == pytest.approx(math.pi / 2)


def test_a_connector_keeps_its_minimum_radius_or_is_refused() -> None:
    """The shortcut lint's bend rule (playtest 4): a 90 degree corner taken with a radius to keep
    gets the least sweeping turns that keep it, and a corner with no room for them is refused."""
    start, end = (0.0, 0.0, 0.0), (130.0, -130.0, math.pi / 2)
    plain = connector_shape(start, end, (20.0, 20.0), 6.0)
    kept = connector_shape(start, end, (20.0, 20.0), 6.0, 40.0, "branch b leave")

    def tightest(sh: Shape) -> float:
        return 1 / max(abs(sh.kappa(u)) for u in np.linspace(0, sh.length, 400))

    assert tightest(kept) >= 39.5
    assert tightest(plain) < tightest(kept)
    with pytest.raises(ValueError, match=r"branch b leave: no connector .* keeps every bend at 80 m or more"):
        connector_shape(start, end, (20.0, 20.0), 6.0, 80.0, "branch b leave")


class _ClimbingMain:
    """A straight main road running north (heading 0) and climbing 10 percent, as far as curve_piece asks."""

    def project(self, x: float, z: float) -> tuple[float, float]:
        return -z, abs(x)

    def at(self, s: float) -> tuple[float, float, float, float]:
        return 0.0, 0.1 * s, -s, 0.0


def test_a_connector_follows_the_main_road_while_a_lane_lies_over_it_and_ends_on_the_branch() -> None:
    """Playtest 4 (P4-4): a branch that descends from a climbing main road stayed at its own height
    while its lane edge lay under the road's verge, 2 m deep on Jones Street. The lane now follows
    the main road's height while any of it is over the road's surface, and the end that joins the
    branch's own road keeps that road's height."""
    start, end = (0.0, 0.0, 0.0), (40.0, -260.0, 0.0)
    sh = connector_shape(start, end, (80.0, 80.0), 6.0)
    reach, width = 6.1, 6.0
    # The branch ends 3 m lower than where it left, while the main road climbs 14 m over the same run.
    piece = curve_piece(
        "c",
        "c",
        (0.0, 0.0, 0.0, 0.0),
        (40.0, -3.0, -260.0, 0.0),
        sh,
        width,
        2.0,
        20.0,
        [],
        None,
        cast(BakedLine, _ClimbingMain()),
        reach,
        True,
    )
    main_y = 0.1 * -piece.z
    dist = np.abs(piece.x)
    over = dist <= reach + width / 2
    # Over the road's surface (and not yet near the branch's end) the connector is at the road's height.
    near_start = over & (np.arange(len(dist)) * 2.0 < 100.0)
    assert near_start.any()
    assert np.allclose(piece.y[near_start], main_y[near_start], atol=1e-6)
    # It meets the branch's own road at the branch's height, whatever the main road does there.
    assert piece.y[-1] == pytest.approx(-3.0)
    # Far from the road the connector has come down toward the branch's height, under the main road's.
    far = dist > reach + width / 2 + 6.0
    assert far.any()
    assert np.all(piece.y[far] < main_y[far] - 1.0)
