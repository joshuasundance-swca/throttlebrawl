"""Street routes and high country: waypoints, one-way choice, tag filters, name splits, span decks,
the fun report, and the staging output root (the head-start bakes for the new regions)."""

from __future__ import annotations

import hashlib
import json
import math
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest

from tbgis.cli import out_root
from tbgis.config import BakeConfig
from tbgis.elevation import parse_samples
from tbgis.emit import bake
from tbgis.fetch import USGS_MAX_POINTS, FetchMeta, _store, cached, post_retry, usgs_samples
from tbgis.fun import fun_report
from tbgis.lint import lint_bake
from tbgis.osm import Way
from tbgis.stretch import build_profile, real_path

LAT0, LON0 = 37.8, -122.42
M_LAT = 1 / 111_000.0
M_LON = 1 / (111_320.0 * math.cos(math.radians(LAT0)))


def ll(east_m: float, north_m: float) -> tuple[float, float]:
    return (LAT0 + north_m * M_LAT, LON0 + east_m * M_LON)


def line(x0: float, y0: float, x1: float, y1: float, step: float = 100.0) -> list[tuple[float, float]]:
    n = max(1, round(math.hypot(x1 - x0, y1 - y0) / step))
    return [ll(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]


def street(wid: int, pts: list[tuple[float, float]], name: str, **tags: str) -> Way:
    return Way(id=wid, tags={"highway": "residential", "name": name, **tags}, coords=pts)


# A Street north 1.2 km; B Street (one-way, drawn westbound) from C Street's foot to A Street at
# 600 m; C Street north from there. X Street crosses A Street at 300 m and is never routed on.
STREETS = [
    street(1, line(0, 0, 0, 1200), "A Street"),
    street(2, line(600, 600, 0, 600), "B Street", oneway="yes"),
    street(3, line(600, 600, 600, 1800), "C Street"),
    street(4, line(-200, 300, 200, 300), "X Street"),
]
OSM = FetchMeta(
    "OpenStreetMap via Overpass API", "https://example.invalid", "q", "2026-10-01T00:00:00Z", "0" * 64, 1
)


def cfg(**over: Any) -> BakeConfig:
    base: dict[str, Any] = {
        "id": "osm-test-streets",
        "name": "Test streets",
        "region": "test-region",
        "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
        "osmExtract": "unused",
        "elevationExtract": "unused",
        "pathFrom": {"lat": ll(0, 0)[0], "lon": ll(0, 0)[1]},
        "via": [
            {"lat": ll(0, 600)[0], "lon": ll(0, 600)[1]},
            {"lat": ll(600, 600)[0], "lon": ll(600, 600)[1]},
        ],
        "pathTo": {"lat": ll(600, 1800)[0], "lon": ll(600, 1800)[1]},
        "start": {"lat": ll(0, 40)[0], "lon": ll(0, 40)[1]},
        "end": {"lat": ll(600, 1700)[0], "lon": ll(600, 1700)[1]},
        "respectOneway": False,
        "routeTags": {"name": "^(A|B|C) Street$"},
        "smoothing": {"headingSigmaM": 12},
        "compression": {"enabled": False},
        "elevation": {"sampleEveryM": 10, "lowPassSigmaM": 10},
        "roads": [{"id": "osm-test-streets-run", "name": "Run"}],
        "route": {"id": "osm-test-streets-route", "name": "Route"},
        "realName": "Test Streets",
        "waysLabel": "Test street",
        "networkNotes": "A staging test network.",
    }
    base.update(over)
    return BakeConfig.model_validate(base)


def test_waypoints_take_the_named_turns() -> None:
    rp = real_path(cfg(), STREETS)
    ways = list(dict.fromkeys(int(w) for w in rp.seg_way))
    assert ways == [1, 2, 3]
    assert float(rp.cum[-1]) == pytest.approx(600 + 600 + 1200, rel=0.01)


def test_one_way_is_respected_unless_the_config_lifts_it() -> None:
    with pytest.raises(ValueError, match="no drivable path"):
        real_path(cfg(respectOneway=True), STREETS)


def test_route_tags_keep_cross_streets_off_the_path() -> None:
    # Without the filter, X Street is still never on a shortest path here; with a filter that drops
    # A Street, no path exists at all.
    with pytest.raises(ValueError, match="no drivable path"):
        real_path(cfg(routeTags={"name": "^(B|C|X) Street$"}), STREETS)


def test_a_waypoint_that_forces_a_u_turn_is_refused() -> None:
    back = [{"lat": ll(0, 900)[0], "lon": ll(0, 900)[1]}, {"lat": ll(0, 600)[0], "lon": ll(0, 600)[1]}]
    with pytest.raises(ValueError, match="U-turn"):
        real_path(cfg(via=back), STREETS)


def hill(rp_len: float) -> tuple[Any, Any]:
    # A tent-shaped hill on A Street: up 20% for 100 m, down 20% for 100 m, flat elsewhere.
    s = np.arange(0.0, rp_len + 10, 10.0)
    y = 20.0 + np.clip(20.0 - np.abs(s - 300.0) * 0.2, 0.0, None)
    return s, y


def test_fun_report_counts_corners_junctions_and_launch_crests() -> None:
    c = cfg()
    rp = real_path(c, STREETS)
    s, y = hill(float(rp.cum[-1]))
    p = build_profile(c, rp, y, s)
    fun = fun_report(c, rp, p, STREETS)
    assert fun.junctions == 2  # X Street at 300 m, and A Street running on past the turn at 600 m
    assert 10 < fun.tightest_radius_m < 60
    assert fun.corners == 2
    assert fun.max_grade_pct == pytest.approx(20, abs=3)
    assert fun.launch_crests >= 1
    assert fun.launch_speed_mps is not None and fun.launch_speed_mps < 44.7
    assert fun.max_deviation_m < 25
    flat = fun_report(c, rp, build_profile(c, rp, np.full_like(s, 20.0), s), STREETS)
    assert flat.launch_crests == 0 and flat.launch_speed_mps is None


def test_span_decks_follow_the_land_not_the_sea() -> None:
    ways = [
        street(1, line(0, 0, 0, 1200), "A Street"),
        street(2, line(0, 1200, 0, 1500), "Creek Bridge", bridge="yes"),
        street(3, line(0, 1500, 0, 2400), "A Street"),
    ]
    over = {
        "via": [],
        "pathTo": {"lat": ll(0, 2400)[0], "lon": ll(0, 2400)[1]},
        "end": {"lat": ll(0, 2300)[0], "lon": ll(0, 2300)[1]},
        "routeTags": {},
    }
    s = np.arange(0.0, 2410.0, 10.0)
    y = np.where((s > 1250) & (s < 1450), 10.0, 50.0)  # a ravine under the bridge
    sea = cfg(**over)
    span = cfg(**over, elevation={"sampleEveryM": 10, "lowPassSigmaM": 10, "bridgeDeck": "span"})
    p_sea = build_profile(sea, real_path(sea, ways), y, s)
    p_span = build_profile(span, real_path(span, ways), y, s)
    on = p_span.bridge
    assert float(p_span.y[on].min()) > 45 and float(p_span.y[on].max()) < 55
    assert float(p_sea.y[p_sea.bridge].min()) < 20
    # Real banks start before OSM's bridge does, and the road climbs: the deck must still meet the
    # land smoothly at both ends (no step where the deck and the low-passed land disagree).
    banks = 50.0 + 0.03 * s - 40.0 * np.clip((150.0 - np.abs(s - 1350.0)) / 40.0, 0.0, 1.0)
    rough = cfg(**over, elevation={"sampleEveryM": 10, "lowPassSigmaM": 30, "bridgeDeck": "span"})
    p_rough = build_profile(rough, real_path(rough, ways), banks, s)
    assert float(np.abs(p_rough.grade).max()) < 0.15
    assert float(p_rough.y[p_rough.bridge].min()) > 60  # spans the valley, never dips into it


def test_name_splits_and_osm_real_names() -> None:
    c = cfg(
        splitOnNameChange=True,
        realNameFromOsm=True,
        roads=[
            {"id": "osm-test-a", "name": "A"},
            {"id": "osm-test-b", "name": "B"},
            {"id": "osm-test-c", "name": "C"},
        ],
    )
    rp = real_path(c, STREETS)
    network, roads, route = bake(c, build_profile(c, rp, None, None), OSM, None, "2026-10-01")
    assert [r["realName"] for r in roads] == ["A Street", "B Street", "C Street"]
    assert lint_bake(network, roads, route) == []
    assert "Test street ways stitched" in roads[0]["provenance"]["modifications"]
    assert network["meta"]["notes"] == "A staging test network."
    with pytest.raises(ValueError, match="B Street"):
        bake(cfg(splitOnNameChange=True), build_profile(c, rp, None, None), OSM, None, "2026-10-01")


def test_out_root_defaults_to_the_pack_and_honours_staging(tmp_path: Path) -> None:
    assert out_root(cfg(), tmp_path) == tmp_path / "packs" / "base" / "regions" / "test-region"
    staged = cfg(outRoot="tools/gis/staging/test-region")
    assert out_root(staged, tmp_path) == tmp_path / "tools" / "gis" / "staging" / "test-region"


def test_post_retry_rides_out_a_busy_server() -> None:
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(504 if len(calls) < 3 else 200, content=b"{}")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        res = post_retry(client, "https://example.invalid", {"data": "q"}, attempts=4, wait=lambda _: None)
    assert res.status_code == 200 and len(calls) == 3
    busy = httpx.MockTransport(lambda _: httpx.Response(429))
    with httpx.Client(transport=busy) as client, pytest.raises(httpx.HTTPStatusError):
        post_retry(client, "https://example.invalid", {}, attempts=2, wait=lambda _: None)


def test_the_keys_defaults_keep_the_committed_provenance_text() -> None:
    # The Keys bake predates these options: its defaults must reproduce its committed wording.
    keys = cfg(
        routeTags={},
        respectOneway=True,
        via=[],
        realName="Overseas Highway",
        waysLabel="US 1",
        networkNotes=BakeConfig.model_fields["networkNotes"].default,
        elevation={},
    )
    p = build_profile(keys, real_path(keys, STREETS[:1]), None, None)
    network, roads, _ = bake(keys, p, OSM, None, "2026-10-01")
    mods = roads[0]["provenance"]["modifications"]
    assert mods.startswith("US 1 ways stitched along the travel carriageway, heading Gaussian-smoothed")
    assert "4 m deck, 12 m x 420 m hump on bridges over 800 m (not measured); lanes simplified" in mods
    assert network["meta"]["notes"].endswith("The same frame as keys-m1, so the two line up.")
    assert roads[0]["realName"] == "Overseas Highway"


def test_a_cached_extract_is_reused_only_for_the_same_query(tmp_path: Path) -> None:
    raw = tmp_path / "x.json"
    assert cached(raw, "q1") is None
    _store(raw, b"{}", "src", "https://example.invalid", "q1")
    hit = cached(raw, "q1")
    assert hit is not None and hit.sha256 == hashlib.sha256(b"{}").hexdigest()
    assert cached(raw, "q2") is None  # an edited query or moved points fetch again


def test_split_at_cuts_a_long_road_into_named_sections() -> None:
    c = cfg(
        splitAt=[{"lat": ll(0, 300)[0], "lon": ll(0, 300)[1]}],
        roads=[{"id": "osm-test-one", "name": "One"}, {"id": "osm-test-two", "name": "Two"}],
    )
    network, roads, route = bake(c, build_profile(c, real_path(c, STREETS), None, None), OSM, None, "x")
    assert roads[0]["lengthM"] == pytest.approx(260, abs=3)  # from the start at 40 m to the cut at 300 m
    assert lint_bake(network, roads, route) == []
    assert route["checkpoints"] == []  # two roads: no interior road, so no checkpoint


def test_usgs_samples_batches_past_the_service_cap(tmp_path: Path) -> None:
    sizes: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        form = dict(x.split("=", 1) for x in req.content.decode().split("&"))
        geom = json.loads(urllib.parse.unquote_plus(form["geometry"]))
        n = len(geom["points"])
        sizes.append(n)
        # The service numbers each request's samples from 0 and reports the point's longitude.
        samples = [{"locationId": i, "value": str(geom["points"][i][0])} for i in range(n)]
        return httpx.Response(200, json={"samples": samples})

    pts = [(float(i), 37.0) for i in range(USGS_MAX_POINTS * 2 + 5)]
    raw = tmp_path / "e.json"
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        meta = usgs_samples(pts, raw, client=client)
    assert sizes == [USGS_MAX_POINTS, USGS_MAX_POINTS, 5]
    assert "in 3 request(s)" in meta.query
    values = parse_samples(raw, len(pts))
    assert np.array_equal(values, np.arange(len(pts), dtype=np.float64))  # every point, in order
