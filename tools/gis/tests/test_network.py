"""Network bakes (run W-S): real roads joined at their real junctions, the loop-closure drift
closed, junction choices as branches with split zones, and routes drawn from the network."""

from __future__ import annotations

import json
import math
from dataclasses import replace
from itertools import pairwise
from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest
from pydantic import ValidationError

from tbgis.config import BakeConfig
from tbgis.fetch import FetchMeta
from tbgis.lint import lint_network
from tbgis.network import (
    BakedLine,
    CrossSection,
    NetworkBake,
    NetworkConfig,
    Shape,
    TrafficFrame,
    align_traffic_height,
    bake_line,
    bake_network,
    connector_shape,
    correction,
    curve_piece,
    directed_piece_frame,
    fit_access_profile,
    join_host_surface,
    lane_section,
    piece_surface,
    quads_overlap,
    ribbon_quads,
    road_json,
    solve_shape,
    stretch_config,
    traffic_chain_collar,
    traffic_ingress_piece,
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


def traffic_config(**over: Any) -> NetworkConfig:
    data = config().model_dump(exclude_none=True)
    data["branches"][0].update(
        traffic="road",
        trafficIngress={"offsetM": 3, "lane": "R1", "widthM": 4, "turnsM": [15, 15], "minRadiusM": 20},
    )
    data["branches"][0].update(over)
    return NetworkConfig.model_validate(data)


def test_optional_traffic_permissions_preserve_old_configs_and_refuse_invalid_values() -> None:
    assert config().branches[0].traffic is None
    assert config().branches[0].trafficIngress is None
    assert traffic_config().branches[0].traffic == "road"
    assert traffic_config(traffic="none", trafficIngress=None).branches[0].traffic == "none"
    with pytest.raises(ValidationError):
        traffic_config(traffic="all")
    with pytest.raises(ValidationError, match="trafficIngress needs traffic road"):
        traffic_config(traffic="none")
    with pytest.raises(ValidationError, match="turnsM must be positive"):
        traffic_config(trafficIngress={"offsetM": 3, "lane": "R1", "turnsM": [0, 15]})


@pytest.mark.parametrize("lane,offset", [("L1", -3), ("R1", 8)])
def test_a_traffic_ingress_refuses_opposing_lanes_and_off_centre_starts(lane: str, offset: float) -> None:
    cfg = traffic_config(trafficIngress={"offsetM": offset, "lane": lane, "minRadiusM": 20})
    with pytest.raises(ValueError, match="must be a forward drive lane centred"):
        bake_network(cfg, OSM, WAYS, flat, "2026-10-02")


def test_traffic_ingress_is_additive_legal_and_does_not_change_rider_defaults(baked: NetworkBake) -> None:
    cfg = traffic_config()
    traffic = bake_network(cfg, OSM, WAYS, flat, "2026-10-02")
    by_id = {r["id"]: r for r in traffic.roads}
    rid = "osm-test-net-b-road-traffic-in"
    ingress = by_id[rid]
    assert ingress["laneSections"][0]["lanes"] == [
        {"id": "R1", "dCenterM": 0, "widthM": 4, "direction": 1, "kind": "drive"}
    ]
    original = next(
        j
        for j in baked.network["junctions"]
        if any(c["road"] == "osm-test-net-b-road-in" for c in j["connectors"])
    )
    junction = next(j for j in traffic.network["junctions"] if j["id"] == original["id"])
    assert junction["connectors"][:-1] == original["connectors"]
    row = junction["connectors"][-1]
    assert row["road"] == rid and "splitZone" not in row and row["trafficOnly"] is True
    assert row["from"] == {"road": "osm-test-a1", "end": "to", "lane": "R1"}
    assert row["to"] == {"road": "osm-test-b", "end": "from", "lane": "R1"}
    for road in baked.roads:
        actual = by_id[road["id"]]
        if road["id"] in {"osm-test-net-b-road-in", "osm-test-net-b-road-out"}:
            # Traffic needs one shared sloping surface. Preserve every other field, the planar
            # path and both endpoint heights; the old byte-for-byte elevation guarantee is replaced.
            data = road["samples"]["data"]
            for end in (0, -1):
                assert actual["samples"]["data"]["y"][end] == data["y"][end]
            actual = {
                **actual,
                "samples": {
                    **actual["samples"],
                    "data": {**actual["samples"]["data"], **{k: data[k] for k in ("y", "grade", "bankRad")}},
                },
            }
        assert actual == road
    full, short = traffic.routes
    assert full["branches"][0]["traffic"] == "road"
    assert rid in full["branches"][0]["roads"] and rid in full["allowedRoads"]
    assert rid not in short["allowedRoads"]
    assert traffic.report["routes"] == baked.report["routes"]
    assert lint_network(traffic.network, traffic.roads, traffic.routes) == []


def test_explicit_traffic_ingress_replaces_only_the_direction_valid_rider_ambient_entry(
    baked: NetworkBake,
) -> None:
    traffic = bake_network(traffic_config(), OSM, WAYS, flat, "2026-10-02")
    by_id = {r["id"]: r for r in traffic.roads}
    rider = next(c for j in traffic.network["junctions"] for c in j["connectors"] if "splitZone" in c)
    dedicated = next(c for j in traffic.network["junctions"] for c in j["connectors"] if c.get("trafficOnly"))
    # Unlike an opposing-lane rider entry, this ordinary shortcut remains a legal forward
    # lane-row candidate. Ambient selection must exclude it without removing rider access.
    for endpoint in (rider["from"], rider["to"]):
        lanes = by_id[endpoint["road"]]["laneSections"][0]["lanes"]
        lane = next(ln for ln in lanes if ln["id"] == endpoint["lane"])
        assert lane["direction"] == 1 and lane["kind"] == "drive"
    assert by_id[rider["road"]]["laneSections"][0]["lanes"][0]["direction"] == 1

    full, short = traffic.routes
    branch, original = full["branches"][0], baked.routes[0]["branches"][0]
    assert rider["road"] not in branch["roads"]
    assert dedicated["road"] in branch["roads"]
    assert set(branch["roads"]) == (set(original["roads"]) - {rider["road"]}) | {dedicated["road"]}
    assert set(full["allowedRoads"]) == set(baked.routes[0]["allowedRoads"]) | {dedicated["road"]}
    assert rider["road"] in full["allowedRoads"]
    assert {k: v for k, v in branch.items() if k not in {"roads", "traffic"}} == {
        k: v for k, v in original.items() if k != "roads"
    }
    assert {k: v for k, v in full.items() if k not in {"branches", "allowedRoads"}} == {
        k: v for k, v in baked.routes[0].items() if k not in {"branches", "allowedRoads"}
    }
    assert short == baked.routes[1]
    assert traffic.report["routes"] == baked.report["routes"]
    assert lint_network(traffic.network, traffic.roads, traffic.routes) == []


@pytest.mark.parametrize("permission", [None, "none", "road"])
def test_without_explicit_ingress_the_full_branch_membership_is_preserved(
    permission: str | None, baked: NetworkBake
) -> None:
    cfg = traffic_config(traffic=permission, trafficIngress=None)
    actual = bake_network(cfg, OSM, WAYS, flat, "2026-10-02")
    expected_routes = [dict(route) for route in baked.routes]
    if permission is not None:
        original = baked.routes[0]["branches"][0]
        expected_routes[0]["branches"] = [{**original, "traffic": permission}]
    assert actual.routes == expected_routes
    assert actual.network == baked.network
    assert actual.roads == baked.roads
    assert actual.report == baked.report


def test_the_committed_traffic_ingress_joins_forward_lane_centres_without_moving_rider_rows() -> None:
    repo = Path(__file__).resolve().parents[3]
    region = repo / "packs/region-pnw/regions/pacific-northwest"
    source = NetworkConfig.load(repo / "tools/gis/networks/osm-pnw-portland.json")
    branch = source.branches[0]
    assert branch.traffic == "road" and branch.trafficIngress is not None
    rid = f"{source.id}-{branch.tag}-traffic-in"
    road = json.loads((region / "roads" / f"{rid}.json").read_text(encoding="utf-8"))
    net = json.loads((region / "networks" / f"{source.id}.json").read_text(encoding="utf-8"))
    route = json.loads((region / "routes/osm-bridge-city-run.json").read_text(encoding="utf-8"))
    row = next(c for j in net["junctions"] for c in j["connectors"] if c["road"] == rid)
    assert row["from"]["lane"] == branch.trafficIngress.lane == "R1"
    assert row["to"]["lane"] == branch.leave.toLane == "R1"
    assert "splitZone" not in row
    assert row["trafficOnly"] is True
    assert rid in net["roads"] and rid in route["allowedRoads"]
    assert rid in route["branches"][0]["roads"] and route["branches"][0]["traffic"] == "road"
    ends = (("from", -1, branch.trafficIngress.offsetM), ("to", 0, branch.leave.toOffsetM))
    frames: list[tuple[float, float, float, float]] = []
    for end, index, offset in ends:
        parent = json.loads((region / "roads" / f"{row[end]['road']}.json").read_text(encoding="utf-8"))
        cols = parent["samples"]["data"]
        a, b = (-2, -1) if index == -1 else (0, 1)
        h = math.atan2(cols["x"][b] - cols["x"][a], -(cols["z"][b] - cols["z"][a]))
        actual = road["samples"]["data"]
        k = 0 if end == "from" else -1
        assert actual["x"][k] == pytest.approx(cols["x"][index] + offset * math.cos(h), abs=0.03)
        assert actual["z"][k] == pytest.approx(cols["z"][index] + offset * math.sin(h), abs=0.03)
        assert actual["y"][k] == pytest.approx(cols["y"][index], abs=1e-4)
        frames.append(
            (
                cols["x"][index] + offset * math.cos(h),
                cols["y"][index],
                cols["z"][index] + offset * math.sin(h),
                h,
            )
        )
    # Offline reconstruction proves the configured solver parameters reproduce every planar sample,
    # not only endpoints and radius. The main-line overlap height is checked separately by geometry QA.
    piece = traffic_ingress_piece(
        rid,
        frames[0],
        frames[1],
        branch.trafficIngress,
        source.sampleSpacingM,
        road["speedLimitMps"],
        [],
    )
    rebuilt = road_json(source, piece, {}, "")["samples"]["data"]
    for column in ("x", "z", "kappa"):
        assert rebuilt[column] == pytest.approx(road["samples"]["data"][column], abs=1e-5)


def reverse_config(**over: Any) -> NetworkConfig:
    movement = {
        "offsetM": -3,
        "lane": "L1",
        "branchOffsetM": -2,
        "branchLane": "L1",
        "widthM": 4,
        "turnsM": [15, 15],
        "minRadiusM": 20,
    }
    return traffic_config(trafficReverse={"leave": movement, "join": movement}, **over)


CHAIN_WAYS = [
    *WAYS,
    Way(
        3,
        {"highway": "secondary", "name": "C Road", "oneway": "yes"},
        polyline([(1700, 80), (1500, 80), (1300, 0), (1400, -140), (1600, -220), (1400, -220)]),
    ),
]


def chain_config() -> NetworkConfig:
    data = reverse_config().model_dump(exclude_none=True)
    data["lines"][0]["roads"].insert(1, {"id": "osm-test-a-fragment", "name": "A before access"})
    data["lines"][1]["roads"].append({"id": "osm-test-b-fragment", "name": "B after access"})
    data["lines"].append(
        {
            "id": "c",
            "pathFrom": pt(1700, 80),
            "pathTo": pt(1400, -220),
            "start": pt(1700, 80),
            "end": pt(1400, -220),
            "routeTags": {"name": "^C Road$"},
            "smoothing": {"headingSigmaM": 15},
            "crossSection": {"oneWay": True},
            "roads": [{"id": "osm-test-access", "name": "C Road"}],
        }
    )
    data["trafficChains"] = [
        {
            "id": "reverse-access",
            "line": "c",
            "branch": "osm-test-b",
            "from": {"line": "a", "at": pt(1800, 0), "lane": "L1", "offsetM": -3, "minRadiusM": 20},
            "to": {"line": "b", "at": pt(1200, -300), "lane": "L1", "offsetM": -2, "minRadiusM": 20},
        }
    ]
    return NetworkConfig.model_validate(data)


def chain_land(sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 100)
    return s, (18 + 0.01 * s) if sc.id.endswith("-c") else (3 + 0.005 * s), None


def test_a_source_traffic_chain_joins_reverse_interior_lanes_on_two_host_lines() -> None:
    cfg = chain_config()
    actual = bake_network(cfg, OSM, CHAIN_WAYS, chain_land, "2026-10-02")
    rows = {c["road"]: c for j in actual.network["junctions"] for c in j["connectors"]}
    before = rows["osm-test-net-reverse-access-from"]
    after = rows["osm-test-net-reverse-access-to"]
    assert before["from"] == {"road": "osm-test-a2", "end": "from", "lane": "L1"}
    assert before["to"] == {"road": "osm-test-access", "end": "from", "lane": "R1"}
    assert after["from"] == {"road": "osm-test-access", "end": "to", "lane": "R1"}
    assert after["to"] == {"road": "osm-test-b", "end": "to", "lane": "L1"}
    for row in (before, after):
        assert row["trafficOnly"] is True and "splitZone" not in row
    assert lint_network(actual.network, actual.roads, actual.routes) == []


def test_one_way_tail_offset_preserves_forward_lane_centre_without_an_opposing_lane() -> None:
    ordinary = lane_section(CrossSection(oneWay=True))
    tail = lane_section(CrossSection(oneWay=True, oneWayOffsetM=2))
    assert ordinary["lanes"] == [{"id": "R1", "dCenterM": 0, "widthM": 4, "direction": 1, "kind": "drive"}]
    assert tail["lanes"] == [{**ordinary["lanes"][0], "dCenterM": 2}]
    with pytest.raises(ValidationError, match="oneWayOffsetM needs oneWay"):
        CrossSection(oneWayOffsetM=2)
    for bad in (math.nan, math.inf):
        with pytest.raises(ValidationError):
            CrossSection(oneWay=True, oneWayOffsetM=bad)


def test_chain_selects_the_reverse_host_after_a_one_way_tail_piece() -> None:
    data = chain_config().model_dump(by_alias=True, exclude_none=True)
    data["lines"][0]["roadLanes"] = {"osm-test-a-fragment": {"oneWay": True, "oneWayOffsetM": 3}}
    actual = bake_network(NetworkConfig.model_validate(data), OSM, CHAIN_WAYS, chain_land, "2026-10-02")
    through = next(r for r in actual.roads if r["id"] == "osm-test-net-reverse-access-from-host")
    assert not any(ln["id"] == "L1" for ln in through["laneSections"][0]["lanes"])
    assert through["laneSections"][0]["lanes"][0]["dCenterM"] == 3
    row = next(
        c
        for j in actual.network["junctions"]
        for c in j["connectors"]
        if c["road"] == "osm-test-net-reverse-access-from"
    )
    assert row["from"] == {"road": "osm-test-a2", "end": "from", "lane": "L1"}
    assert lint_network(actual.network, actual.roads, actual.routes) == []


def test_forward_chain_selects_before_to_then_after_from() -> None:
    data = chain_config().model_dump(by_alias=True, exclude_none=True)
    data["trafficChains"][0]["from"].update(lane="R1", offsetM=3)
    data["trafficChains"][0]["to"].update(lane="R1", offsetM=2)
    data["lines"][-1].update(
        pathFrom=pt(1900, 80), start=pt(1900, 80), pathTo=pt(1100, -220), end=pt(1100, -220)
    )
    ways = [
        *WAYS,
        Way(
            3,
            {"highway": "secondary", "name": "C Road", "oneway": "yes"},
            polyline([(1900, 80), (2100, 80), (2300, 0), (2200, -140), (900, -220), (1100, -220)]),
        ),
    ]
    actual = bake_network(NetworkConfig.model_validate(data), OSM, ways, chain_land, "2026-10-02")
    rows = {c["road"]: c for j in actual.network["junctions"] for c in j["connectors"]}
    assert rows["osm-test-net-reverse-access-from"]["from"] == {
        "road": "osm-test-a-fragment",
        "end": "to",
        "lane": "R1",
    }
    assert rows["osm-test-net-reverse-access-to"]["to"] == {
        "road": "osm-test-b-fragment",
        "end": "from",
        "lane": "R1",
    }
    assert lint_network(actual.network, actual.roads, actual.routes) == []


def test_omitting_traffic_chains_and_explicit_empty_relations_preserve_default_output(
    baked: NetworkBake,
) -> None:
    actual = bake_network(config(trafficChains=[]), OSM, WAYS, flat, "2026-10-02")
    assert actual == baked


def test_source_chain_preserves_its_profile_crossing_and_matches_directed_endpoint_surfaces() -> None:
    cfg = chain_config()
    actual = bake_network(cfg, OSM, CHAIN_WAYS, chain_land, "2026-10-02")
    by_id = {r["id"]: r for r in actual.roads}
    access = by_id["osm-test-access"]
    source = bake_line(cfg, cfg.line("c"), CHAIN_WAYS, chain_land)
    cols = access["samples"]["data"]
    stations = np.linspace(0, source.p.s[-1], len(cols["y"]))
    for name in ("x", "y", "z"):
        assert cols[name] == pytest.approx(
            np.interp(stations, source.p.s, getattr(source.p, name)), abs=0.0001
        )
    main = bake_line(cfg, cfg.line("a"), CHAIN_WAYS, chain_land)
    crossing = int(np.argmin(np.abs(cols["z"])))
    s_main, distance = main.project(cols["x"][crossing], cols["z"][crossing])
    assert distance < 2
    assert cols["y"][crossing] - main.at(s_main)[1] > 8
    for row in (
        c
        for j in actual.network["junctions"]
        for c in j["connectors"]
        if c["road"].startswith("osm-test-net-reverse-access-") and c.get("trafficOnly")
    ):
        collar = by_id[row["road"]]["samples"]["data"]
        for side, k in (("from", 0), ("to", -1)):
            endpoint = row[side]
            parent = by_id[endpoint["road"]]
            p = parent["samples"]["data"]
            lane = next(ln for ln in parent["laneSections"][0]["lanes"] if ln["id"] == endpoint["lane"])
            i, a, b = (0, 0, 1) if endpoint["end"] == "from" else (-1, -2, -1)
            h = math.atan2(p["x"][b] - p["x"][a], p["z"][a] - p["z"][b])
            d, direction = lane["dCenterM"], lane["direction"]
            expected = (
                p["x"][i] + d * math.cos(h),
                p["y"][i] - d * p["bankRad"][i],
                p["z"][i] + d * math.sin(h),
            )
            for column, value in zip(("x", "y", "z"), expected, strict=True):
                assert collar[column][k] == pytest.approx(value, abs=0.0002)
            assert collar["grade"][k] == pytest.approx(p["grade"][i] * direction, abs=0.00002)
            assert collar["bankRad"][k] == 0
            ca, cb = (0, 1) if k == 0 else (-2, -1)
            ch = math.atan2(collar["x"][cb] - collar["x"][ca], collar["z"][ca] - collar["z"][cb])
            assert math.cos(ch - h - (math.pi if direction == -1 else 0)) > 0.9999


def test_chain_cuts_preserve_rider_identity_through_routes_and_permission_membership() -> None:
    cfg = chain_config()
    actual = bake_network(cfg, OSM, CHAIN_WAYS, chain_land, "2026-10-02")
    baseline = bake_network(reverse_config(), OSM, WAYS, chain_land, "2026-10-02")
    by_id = {r["id"]: r for r in actual.roads}
    full, short = actual.routes
    assert full["start"] == baseline.routes[0]["start"]
    assert full["finish"] == baseline.routes[0]["finish"]
    assert actual.report["routes"][full["id"]] == pytest.approx(
        baseline.report["routes"][full["id"]], abs=0.01
    )
    branch = full["branches"][0]
    assert branch["id"] == "osm-test-b" and branch["sign"] == baseline.routes[0]["branches"][0]["sign"]

    def split(result: NetworkBake) -> dict[str, Any]:
        return next(c for j in result.network["junctions"] for c in j["connectors"] if "splitZone" in c)

    assert split(actual) == split(baseline)
    added = {"osm-test-access", "osm-test-net-reverse-access-from", "osm-test-net-reverse-access-to"}
    assert added <= set(full["allowedRoads"]) and added <= set(branch["roads"])
    assert not added.intersection(short["allowedRoads"])
    # Each legitimate main fragment owns its own generated checkpoint, in path order.
    assert [c["road"] for c in full["checkpoints"]] == full["mainPath"][1:-1]
    for checkpoint in full["checkpoints"]:
        assert checkpoint["s"] == pytest.approx(by_id[checkpoint["road"]]["lengthM"] / 2, abs=0.0001)
    for junction in actual.network["junctions"]:
        chain_rows = [c for c in junction["connectors"] if c["road"] in added]
        if not chain_rows:
            continue
        assert all(c.get("trafficOnly") and "splitZone" not in c for c in chain_rows)
        through = [c for c in junction["connectors"] if not c.get("trafficOnly")]
        assert through
        for row in through:
            assert row["from"]["lane"] == row["to"]["lane"]
            assert row["from"]["end"] == "to" and row["to"]["end"] == "from"

    data = cfg.model_dump(by_alias=True, exclude_none=True)
    data["branches"][0].update(traffic="none", trafficIngress=None, trafficReverse=None)
    excluded = bake_network(NetworkConfig.model_validate(data), OSM, CHAIN_WAYS, chain_land, "2026-10-02")
    assert excluded.routes[0]["branches"][0]["traffic"] == "none"
    assert added <= set(excluded.routes[0]["branches"][0]["roads"])


@pytest.mark.parametrize(
    "change,message",
    [
        ({"branch": "missing"}, "existing branch owner"),
        ({"line": "b"}, "access line must be dedicated"),
        ({"from": {"line": "b", "at": pt(1200, -300), "lane": "L1", "offsetM": -2}}, "two different lines"),
    ],
)
def test_traffic_chain_refuses_invalid_ownership(change: dict[str, Any], message: str) -> None:
    data = chain_config().model_dump(by_alias=True, exclude_none=True)
    data["trafficChains"][0].update(change)
    with pytest.raises(ValidationError, match=message):
        NetworkConfig.model_validate(data)


def test_traffic_chain_refuses_reused_lines_and_two_way_overrides() -> None:
    data = chain_config().model_dump(by_alias=True, exclude_none=True)
    data["trafficChains"].append({**data["trafficChains"][0], "id": "another"})
    with pytest.raises(ValidationError, match="unique ids and dedicated lines"):
        NetworkConfig.model_validate(data)
    data["trafficChains"].pop()
    data["lines"][-1]["roadLanes"] = {"osm-test-access": {"oneWay": False}}
    with pytest.raises(ValidationError, match="one-way R1"):
        NetworkConfig.model_validate(data)


def test_traffic_chain_refuses_overlapping_access_profile_fits() -> None:
    cfg = chain_config()
    source = bake_line(cfg, cfg.line("c"), CHAIN_WAYS, chain_land)
    span = float(source.p.s[-1]) * 0.6
    data = cfg.model_dump(by_alias=True, exclude_none=True)
    data["trafficChains"][0]["from"]["accessProfileFitM"] = span
    data["trafficChains"][0]["to"]["accessProfileFitM"] = span
    with pytest.raises(ValueError, match="access profile fits must not overlap"):
        bake_network(NetworkConfig.model_validate(data), OSM, CHAIN_WAYS, chain_land, "2026-10-02")
    del data["trafficChains"][0]["from"]["accessProfileFitM"]
    with pytest.raises(ValidationError, match="accessProfileOffsetM needs accessProfileFitM"):
        data["trafficChains"][0]["from"]["accessProfileOffsetM"] = -0.6
        NetworkConfig.model_validate(data)


@pytest.mark.parametrize(
    "patch,message",
    [
        ({"offsetM": -4}, "drive lane centred"),
        ({"lane": "L0", "offsetM": -10}, "directed drive lane"),
        ({"at": pt(0, 0)}, "host cut must be interior"),
        ({"at": pt(800, 0)}, "too close"),
    ],
)
def test_traffic_chain_refuses_invalid_host_cuts_and_lane_centres(
    patch: dict[str, Any], message: str
) -> None:
    data = chain_config().model_dump(by_alias=True, exclude_none=True)
    data["trafficChains"][0]["from"].update(patch)
    with pytest.raises(ValueError, match=message):
        bake_network(NetworkConfig.model_validate(data), OSM, CHAIN_WAYS, chain_land, "2026-10-02")


def test_directed_surface_frame_reverses_grade_and_bank_and_collars_reject_nonzero_bank() -> None:
    pc = curve_piece(
        "frame", "frame", (0, 3, 0, 0), (0, 8, -100, 0), Shape(0, 0, 0, 10, 80, 10), 4, 2, 20, []
    )
    pc.y = 3 + np.linspace(0, 5, len(pc.x))
    pc.bank = np.full_like(pc.x, 0.1)
    forward = directed_piece_frame(pc, "to", -2, 1)
    reverse = directed_piece_frame(pc, "to", -2, -1)
    assert forward.y == reverse.y == pytest.approx(8.2)
    assert reverse.grade == pytest.approx(-forward.grade)
    assert reverse.bank == -forward.bank == -0.1
    assert math.cos(reverse.heading - forward.heading) == pytest.approx(-1)
    cfg = chain_config()
    target = TrafficFrame(20, 10, -200, 0, 0, 0)
    with pytest.raises(ValueError, match="zero-bank endpoint"):
        traffic_chain_collar("bad", forward, target, cfg.trafficChains[0].from_, 2, 20, [])


def test_traffic_chain_collar_preserves_its_endpoint_fitted_height_profile() -> None:
    cfg = chain_config()
    spec = cfg.trafficChains[0].from_
    a = TrafficFrame(0, 3, 0, 0, 0.02, 0)
    b = TrafficFrame(20, 8, -100, 0, 0.01, 0)
    shape = connector_shape(
        (a.x, a.z, a.heading),
        (b.x, b.z, b.heading),
        spec.turnsM,
        spec.widthM,
        spec.minRadiusM,
        "height-profile-control",
    )
    expected = curve_piece(
        "expected",
        "expected",
        a.point(),
        b.point(),
        shape,
        spec.widthM,
        2,
        20,
        [],
        endpoint_grades=(a.grade, b.grade),
    )
    step = float(np.sum(np.hypot(np.diff(expected.x), np.diff(expected.z)))) / (len(expected.x) - 1)
    expected.y[0], expected.y[-1] = a.y, b.y
    expected.y[1], expected.y[-2] = a.y + a.grade * step, b.y - b.grade * step
    actual = traffic_chain_collar("actual", a, b, spec, 2, 20, [])

    assert actual.y == pytest.approx(expected.y)


def test_access_profile_fit_changes_only_its_endpoint_span_and_preserves_endpoint_grade() -> None:
    access = curve_piece(
        "access", "access", (0, 10, 0, 0), (0, 16, -200, 0), Shape(0, 0, 0, 10, 180, 10), 4, 2, 20, []
    )
    host = curve_piece(
        "host", "host", (0, 7, 0, 0), (0, 9, -200, 0), Shape(0, 0, 0, 10, 180, 10), 4, 2, 20, []
    )
    station = np.concatenate(([0.0], np.cumsum(np.hypot(np.diff(access.x), np.diff(access.z)))))
    access.y = 10 + 0.03 * station
    original_x, original_y, original_z = access.x.copy(), access.y.copy(), access.z.copy()

    fit_access_profile(access, host, 50, -0.6, True)

    target = piece_surface(host, float(access.x[0]), float(access.z[0]))[1] - 0.6
    assert access.x == pytest.approx(original_x)
    assert access.z == pytest.approx(original_z)
    assert access.y[0] == pytest.approx(target)
    assert (access.y[1] - access.y[0]) / (station[1] - station[0]) == pytest.approx(0.03)
    assert access.y[station >= 50] == pytest.approx(original_y[station >= 50])

    access.y = original_y.copy()
    fit_access_profile(access, host, 50, 0, False)
    target = piece_surface(host, float(access.x[-1]), float(access.z[-1]))[1]
    assert access.y[-1] == pytest.approx(target)
    assert (access.y[-1] - access.y[-2]) / (station[-1] - station[-2]) == pytest.approx(0.03)
    assert access.y[station <= station[-1] - 50] == pytest.approx(original_y[station <= station[-1] - 50])


def test_host_surface_join_does_not_latch_onto_an_unrelated_later_crossing() -> None:
    collar = curve_piece(
        "collar", "collar", (0, 3, 0, 0), (0, 3, -100, 0), Shape(0, 0, 0, 10, 80, 10), 4, 2, 20, []
    )
    host = replace(
        collar,
        id="host",
        x=np.array((0.0, 0.0, 20.0, 20.0, 0.0, 0.0)),
        y=np.full(6, 10.0),
        z=np.array((0.0, -10.0, -10.0, -80.0, -80.0, -90.0)),
        bank=np.zeros(6),
    )
    original = collar.y.copy()

    join_host_surface(collar, host, 30, True)

    later = int(np.argmin(np.hypot(collar.x, collar.z + 80)))
    assert collar.y[later] == pytest.approx(original[later])
    assert collar.y[0] == pytest.approx(10)


def test_traffic_chain_collar_can_join_a_host_surface_over_an_authored_profile_span() -> None:
    cfg = chain_config()
    base_spec = cfg.trafficChains[0].to
    spec = base_spec.model_copy(update={"surfaceJoinM": 30.0})
    a = TrafficFrame(20, 3, 0, 0, 0.01, 0)
    b = TrafficFrame(0, 7, -100, 0, 0.02, 0)
    baseline = traffic_chain_collar("baseline", a, b, base_spec, 2, 20, [])
    host = curve_piece(
        "host", "host", (0, 6.6, -80, 0), (0, 8.6, -180, 0), Shape(0, 0, 0, 10, 80, 10), 4, 2, 20, []
    )
    host.y = 6.6 + 0.02 * np.linspace(0, 100, len(host.y))
    host.bank = np.zeros_like(host.y)

    actual = traffic_chain_collar("actual", a, b, spec, 2, 20, [], host, False)
    station = np.concatenate(([0.0], np.cumsum(np.hypot(np.diff(actual.x), np.diff(actual.z)))))
    distance = station[-1] - station
    sampled = [piece_surface(host, float(x), float(z)) for x, z in zip(actual.x, actual.z, strict=True)]
    host_y = np.array([row[1] for row in sampled])
    overlaps = np.array([any(quads_overlap(a, b) for b in ribbon_quads(host)) for a in ribbon_quads(actual)])
    connected = []
    for i in range(len(overlaps) - 1, -1, -1):
        if not overlaps[i]:
            break
        connected.append(i)
    points = np.zeros(len(actual.x), dtype=np.bool_)
    points[min(connected) : max(connected) + 2] = True
    boundary = float(max(distance[points]))
    weight = np.clip((30 - distance) / (30 - boundary), 0, 1)
    weight = weight * weight * (3 - 2 * weight)
    weight[points] = 1
    expected = baseline.y + weight * (host_y - baseline.y)
    step = station[1] - station[0]
    expected[0], expected[-1] = a.y, b.y
    expected[1], expected[-2] = a.y + a.grade * step, b.y - b.grade * step

    assert actual.y == pytest.approx(expected)
    assert actual.y[distance > 30] == pytest.approx(baseline.y[distance > 30])
    assert actual.y[0] == pytest.approx(a.y)
    assert actual.y[1] == pytest.approx(a.y + a.grade * step)
    assert actual.y[-2] == pytest.approx(b.y - b.grade * step)
    assert actual.y[-1] == pytest.approx(b.y)

    start_host = replace(
        host,
        id="start-host",
        x=np.full(11, 20.0),
        y=np.linspace(2.6, 3.0, 11),
        z=np.linspace(20.0, 0.0, 11),
        bank=np.zeros(11),
    )
    departing = traffic_chain_collar("departing", a, b, spec, 2, 20, [], start_host, True)
    assert departing.y[0] == pytest.approx(a.y)
    assert departing.y[1] == pytest.approx(a.y + a.grade * step)
    assert departing.y[station > 30] == pytest.approx(baseline.y[station > 30])

    too_short = base_spec.model_copy(update={"surfaceJoinM": float(station[-2])})
    with pytest.raises(ValueError, match="leaves no untouched collar profile"):
        traffic_chain_collar("short", a, b, too_short, 2, 20, [], host, False)


def test_shared_junction_height_preserves_paths_and_endpoints_and_leaves_the_main_surface() -> None:
    class FlatMain:
        def project(self, x: float, z: float) -> tuple[float, float]:
            return -z, abs(x)

        def at(self, s: float) -> tuple[float, float, float, float]:
            return 0, 3.5, -s, 0

    pc = curve_piece("new", "new", (0, 3, 0, 0), (0, 3, -100, 0), Shape(0, 0, 0, 10, 80, 10), 4, 2, 20, [])
    original_x, original_z = pc.x.copy(), pc.z.copy()
    far = replace(pc, x=pc.x + 1000, y=pc.y.copy())
    main = cast(BakedLine, FlatMain())
    align_traffic_height(far, main, 10, 3)
    assert np.allclose(far.y, 3)
    align_traffic_height(pc, main, 10, 3)
    assert pc.y[len(pc.y) // 2] == pytest.approx(3.5)
    assert pc.y[0] == pc.y[-1] == 3
    assert np.array_equal(pc.x, original_x) and np.array_equal(pc.z, original_z)


def test_traffic_ribbon_matches_a_sloping_main_surface_across_its_width() -> None:
    class SlopingMain:
        def project(self, x: float, z: float) -> tuple[float, float]:
            return -z, abs(x)

        def at(self, s: float) -> tuple[float, float, float, float]:
            return 0, s / 10, -s, 0

    h = math.pi / 4
    pc = curve_piece(
        "turn", "turn", (0, 0, 0, h), (70.71, 7.071, -70.71, h), Shape(h, 0, 0, 10, 80, 10), 5, 2, 20, []
    )
    align_traffic_height(pc, cast(BakedLine, SlopingMain()), 200, 7.071)
    assert pc.bank is not None
    assert pc.bank[0] == pc.bank[-1] == 0
    for i in range(1, len(pc.x) - 1):
        for d in (-2.5, 0, 2.5):
            z = pc.z[i] + d * math.sin(h)
            assert pc.y[i] - d * pc.bank[i] == pytest.approx(-z / 10, abs=1e-5)


def test_reverse_traffic_adds_both_legal_movements_and_keeps_existing_geometry() -> None:
    before = bake_network(traffic_config(), OSM, WAYS, flat, "2026-10-02")
    after = bake_network(reverse_config(), OSM, WAYS, flat, "2026-10-02")
    by_id = {r["id"]: r for r in after.roads}
    for road in before.roads:
        assert by_id[road["id"]] == road
    for end in ("leave", "join"):
        rid = f"osm-test-net-b-road-traffic-reverse-{end}"
        road = by_id[rid]
        assert road["laneSections"][0]["lanes"] == [
            {"id": "L1", "direction": -1, "dCenterM": 0, "widthM": 4, "kind": "drive"}
        ]
        row = next(c for j in after.network["junctions"] for c in j["connectors"] if c["road"] == rid)
        assert row["trafficOnly"] is True and "splitZone" not in row
        assert row["from"]["lane"] == row["to"]["lane"] == "L1"
        assert rid in after.routes[0]["branches"][0]["roads"]
        assert rid not in after.routes[1]["allowedRoads"]
    assert lint_network(after.network, after.roads, after.routes) == []


def test_reverse_traffic_refuses_an_opposing_or_off_centre_lane() -> None:
    data = reverse_config().model_dump(exclude_none=True)
    data["branches"][0]["trafficReverse"]["join"]["lane"] = "R1"
    with pytest.raises(ValueError, match="reverse drive lane centred"):
        bake_network(NetworkConfig.model_validate(data), OSM, WAYS, flat, "2026-10-02")


@pytest.mark.parametrize("end", ["leave", "join"])
def test_committed_reverse_movements_match_authored_lanes_and_reproduce_the_curve(end: str) -> None:
    repo = Path(__file__).resolve().parents[3]
    region = repo / "packs/region-pnw/regions/pacific-northwest"
    source = NetworkConfig.load(repo / "tools/gis/networks/osm-pnw-portland.json")
    reverse = source.branches[0].trafficReverse
    assert reverse is not None
    spec = reverse.leave if end == "leave" else reverse.join
    rid = f"{source.id}-morrison-traffic-reverse-{end}"
    road = json.loads((region / "roads" / f"{rid}.json").read_text(encoding="utf-8"))
    net = json.loads((region / "networks/osm-pnw-portland.json").read_text(encoding="utf-8"))
    row = next(c for j in net["junctions"] for c in j["connectors"] if c["road"] == rid)
    frames = []
    offsets = (spec.offsetM, spec.branchOffsetM) if end == "leave" else (spec.branchOffsetM, spec.offsetM)
    for side, offset in zip(("from", "to"), offsets, strict=True):
        parent = json.loads((region / "roads" / f"{row[side]['road']}.json").read_text(encoding="utf-8"))
        lane = next(ln for ln in parent["laneSections"][0]["lanes"] if ln["id"] == row[side]["lane"])
        assert lane["direction"] == -1 and lane["kind"] == "drive" and lane["dCenterM"] == offset
        c = parent["samples"]["data"]
        i, a, b = (-1, -2, -1) if side == "from" else (0, 0, 1)
        h = math.atan2(c["x"][b] - c["x"][a], -(c["z"][b] - c["z"][a]))
        p = (c["x"][i] + offset * math.cos(h), c["y"][i], c["z"][i] + offset * math.sin(h), h)
        k = 0 if side == "from" else -1
        for column, value in zip(("x", "y", "z"), p[:3], strict=True):
            assert road["samples"]["data"][column][k] == pytest.approx(value, abs=0.03)
        assert road["provenance"]["sources"] == parent["provenance"]["sources"]
        frames.append(p)
    piece = traffic_ingress_piece(
        rid,
        frames[0],
        frames[1],
        spec,
        source.sampleSpacingM,
        road["speedLimitMps"],
        [],
        direction=-1,
        leaves_main=end == "leave",
    )
    rebuilt = road_json(source, piece, {}, "")
    assert road["laneSections"] == rebuilt["laneSections"]
    for column in ("x", "z", "kappa"):
        assert rebuilt["samples"]["data"][column] == pytest.approx(road["samples"]["data"][column], abs=1e-5)
