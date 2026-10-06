"""District tags on ONE side of a road over a run of s (playtest 4, P4-19, B9): the Gorge's guard walls
stand on its cliff side, Chuckanut's madrones lean out over its bay side. The config names the runs
(`sideRuns`); `tbgis.drops` is how they were found from the ground either side. Land tags are both-sided
and stay off bridge decks, and a side run is neither: one side, and off decks too."""

from __future__ import annotations

from typing import Any

import pytest
from test_keys_pt3 import OSM, ROADS, WAYS, pt

from tbgis.config import BakeConfig
from tbgis.drops import FAR_DROP_M, JOIN_GAP_M, MIN_RUN_M, NEAR_DROP_M, Station, runs_of
from tbgis.emit import bake
from tbgis.stretch import build_profile, real_path


def stretch(side_runs: list[dict[str, Any]], on: int = 0) -> list[dict[str, Any]]:
    roads = [dict(r) for r in ROADS]
    roads[on]["sideRuns"] = side_runs
    c = BakeConfig.model_validate(
        {
            "id": "osm-test-stretch",
            "name": "Test stretch",
            "region": "florida-keys",
            "crs": {"originLatDeg": 24.7, "originLonDeg": -81.1},
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
    _, baked, _ = bake(c, build_profile(c, real_path(c, WAYS), None, None), OSM, None, "2026-10-05")
    return baked


def rows(road: dict[str, Any], tag: str) -> list[tuple[float, float, str]]:
    return [(t["s0"], t["s1"], t["side"]) for t in road["tags"] if t["tag"] == tag]


def test_a_side_run_is_written_on_its_side_only_over_the_s_it_names() -> None:
    west = stretch([{"tag": "guard-wall", "side": "left", "s0": 20, "s1": 90}])[0]
    assert rows(west, "guard-wall") == [(20.0, 90.0, "left")]
    # The land tags are still both-sided and whole.
    assert [r[2] for r in rows(west, "palms")] == ["both"]


def test_a_side_run_stays_off_the_bridge_decks() -> None:
    # The first road is 300 m of land; a run reaching past its end onto the deck is refused...
    with pytest.raises(ValueError, match="off the"):
        stretch([{"tag": "guard-wall", "side": "left", "s0": 20, "s1": 9000}])
    # ...and on the bridge road itself a run gives no rows at all (a deck has its own rail).
    baked = stretch([{"tag": "guard-wall", "side": "right", "s0": 5, "s1": 900}], on=1)
    bridge = baked[1]
    assert rows(bridge, "bridge") != []
    assert rows(bridge, "guard-wall") == []


def test_a_side_run_must_run_forward_and_name_a_side() -> None:
    for bad in (
        {"tag": "guard-wall", "side": "left", "s0": 90, "s1": 20},
        {"tag": "guard-wall", "side": "both", "s0": 20, "s1": 90},
    ):
        with pytest.raises(ValueError):
            stretch([bad])


def station(s: float, y: float, near: dict[str, float | None], far: dict[str, float | None]) -> Station:
    return Station(s, y, near, far)


def ground(s: float, drop_right: float | None, drop_left: float | None) -> Station:
    """A station at height 100 whose ground is that far below it 14 m out, and 30 m out (twice as far)."""

    def pair(d: float | None) -> tuple[float | None, float | None]:
        return (None, None) if d is None else (100 - d, 100 - 2 * d)

    r, left = pair(drop_right), pair(drop_left)
    return station(s, 100.0, {"R": r[0], "L": left[0]}, {"R": r[1], "L": left[1]})


def test_a_drop_is_ground_well_below_the_road_at_both_offsets() -> None:
    line = [ground(10.0 * i, 8.0, 0.0) for i in range(20)]
    assert runs_of(line, "right") == [(0.0, 190.0)]
    assert runs_of(line, "left") == []
    # Only the near ground falls (a ditch, then level), or only the far ground (a bank): no drop.
    near_only = [
        station(10.0 * i, 100.0, {"R": 90.0, "L": 100.0}, {"R": 100.0, "L": 100.0}) for i in range(20)
    ]
    far_only = [
        station(10.0 * i, 100.0, {"R": 100.0, "L": 100.0}, {"R": 80.0, "L": 100.0}) for i in range(20)
    ]
    assert runs_of(near_only, "right") == [] == runs_of(far_only, "right")
    # The thresholds are the documented ones.
    assert NEAR_DROP_M == 5.0 and FAR_DROP_M == 12.0


def test_short_runs_are_left_out_and_close_ones_join() -> None:
    drop, flat = 8.0, 0.0
    stations = (
        # 20 m of drop: too short to be a run.
        [ground(10.0 * i, drop, None) for i in range(3)]
        + [ground(30.0 + 10.0 * i, flat, None) for i in range(10)]
        # 60 m of drop, a 40 m gap (joins), 60 m more: one run.
        + [ground(130.0 + 10.0 * i, drop, None) for i in range(7)]
        + [ground(200.0 + 10.0 * i, flat, None) for i in range(3)]
        + [ground(230.0 + 10.0 * i, drop, None) for i in range(7)]
        # A 60 m gap (too far to join), then 60 m: its own run.
        + [ground(300.0 + 10.0 * i, flat, None) for i in range(6)]
        + [ground(360.0 + 10.0 * i, drop, None) for i in range(7)]
    )
    assert runs_of(stations, "right") == [(130.0, 290.0), (360.0, 420.0)]
    assert MIN_RUN_M == 30.0 and JOIN_GAP_M == 40.0
    # No data (water, a gap in the survey) never makes a drop.
    assert runs_of([ground(10.0 * i, None, None) for i in range(20)], "right") == []
