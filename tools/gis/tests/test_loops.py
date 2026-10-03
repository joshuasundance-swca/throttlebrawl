"""The junction-choice probe (run W-U): where the real map offers a way off a route and back."""

from __future__ import annotations

from typing import Any

import pytest
from test_network import LAT0, LON0, WAYS, polyline, pt

from tbgis.config import BakeConfig
from tbgis.loops import find_loops
from tbgis.osm import Way


def stretch(
    name: str, path_from: tuple[float, float], path_to: tuple[float, float], **over: Any
) -> BakeConfig:
    """A stretch config over the synthetic map: the road named `name`, clipped 10 m in at each end."""
    base: dict[str, Any] = {
        "id": "osm-test-loops",
        "name": "Loops test",
        "region": "test-region",
        "crs": {"originLatDeg": LAT0, "originLonDeg": LON0},
        "osmExtract": "unused",
        "elevationExtract": "unused",
        "pathFrom": pt(*path_from),
        "pathTo": pt(*path_to),
        "start": pt(*path_from),
        "end": pt(*path_to),
        "routeTags": {"name": f"^{name}$"},
        "roads": [{"id": "osm-test-a", "name": "A"}],
        "route": {"id": "osm-test-run", "name": "Run"},
    }
    return BakeConfig.model_validate(base | over)


A_ROAD = stretch("A Road", (10, 0), (2990, 0))


def test_a_side_road_that_leaves_and_comes_back_is_a_loop() -> None:
    loops = find_loops(A_ROAD, WAYS)
    assert len(loops) == 1
    lp = loops[0]
    # B Road leaves A Road 790 m along the route (it starts 10 m in) and rejoins at 2190 m. (The
    # test map places points with a rounded metres-per-degree, so the projected metres differ by
    # about 1.2%.)
    assert lp.leaveM == pytest.approx(790, rel=0.02)
    assert lp.joinM == pytest.approx(2190, rel=0.02)
    assert lp.mainM == pytest.approx(1400, rel=0.02)
    assert lp.loopM == pytest.approx(1730, rel=0.02)  # four corners and the 1 km behind the dunes
    assert lp.streets == ["B Road"]
    assert lp.kind == "detour"


def test_max_streets_counts_distinct_streets() -> None:
    # B Road again, but its middle renamed and its last stretch named B Road once more: two
    # distinct streets over three runs.
    c: list[tuple[float, float]] = [
        (800, 0),
        (900, -100),
        (1000, -300),
        (2000, -300),
        (2100, -100),
        (2200, 0),
    ]
    ways = [
        WAYS[0],
        Way(2, {"highway": "secondary", "name": "B Road"}, polyline(c[:3])),
        Way(3, {"highway": "secondary", "name": "Dune Lane"}, polyline(c[2:4])),
        Way(4, {"highway": "secondary", "name": "B Road"}, polyline(c[3:])),
    ]
    assert [lp.streets for lp in find_loops(A_ROAD, ways, max_streets=2)] == [
        ["B Road", "Dune Lane", "B Road"]
    ]
    assert find_loops(A_ROAD, ways, max_streets=1) == []


def test_driveways_the_other_carriageway_and_a_dead_end_are_not_loops() -> None:
    extra = [
        # A parking aisle (service) from 300 m round to 600 m.
        Way(10, {"highway": "service"}, polyline([(300, 0), (300, 60), (600, 60), (600, 0)])),
        # The other carriageway of A Road, 12 m north, from 2400 m to 2900 m.
        Way(
            11,
            {"highway": "primary", "name": "A Road"},
            polyline([(2400, 0), (2400, 12), (2900, 12), (2900, 0)]),
        ),
        # A dead-end street.
        Way(12, {"highway": "residential", "name": "Cul Road"}, polyline([(1500, 0), (1500, 200)])),
    ]
    loops = find_loops(A_ROAD, WAYS + extra)
    assert [lp.streets for lp in loops] == [["B Road"]]


def test_a_cross_street_that_skips_most_of_the_race_is_not_a_choice() -> None:
    # U Road doubles back: a 150 m cross street between its legs would skip 2 km of the race.
    u = [
        Way(
            1,
            {"highway": "primary", "name": "U Road"},
            polyline([(0, 0), (1000, 0), (1000, -150), (0, -150)]),
        ),
        Way(2, {"highway": "residential", "name": "Cross Street"}, polyline([(200, 0), (200, -150)])),
    ]
    assert find_loops(stretch("U Road", (0, 0), (0, -150)), u) == []
