"""Which side of a baked road the ground falls away on (playtest 4, P4-19, B9).

The Historic Columbia River Highway's masonry guard walls stand on its cliff side, and Chuckanut
Drive's madrones lean out over its bay side. Neither is in the OSM data, so the bake config names
the runs (``sideRuns``), and this module is how the runs were found: sample the USGS 3DEP ground
at two offsets either side of the road, every ``STEP_M``, and call a side a drop where the ground
there is well below the road's own height.

``python -m tbgis.drops <config.json> <road id> ...`` prints each road's runs for the config.
Only the sampling touches the network (once, cached); ``runs_of`` is pure.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

from tbgis.fetch import usgs_samples
from tbgis.tmerc import Frame

STEP_M = 10.0
NEAR_M = 14.0
FAR_M = 30.0
# A side drops where the ground NEAR_M out is NEAR_DROP_M below the road and FAR_M out FAR_DROP_M below.
NEAR_DROP_M = 5.0
FAR_DROP_M = 12.0
# Runs shorter than this are left out, and runs closer than this are one run (a wall has gaps at
# drives and creeks, but a hundred small ones would be noise).
MIN_RUN_M = 30.0
JOIN_GAP_M = 40.0

ROOT = Path(__file__).resolve().parents[4]
TOOL = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Station:
    """One station of a road: s, its height, and the ground either side at both offsets (None: no data)."""

    s: float
    y: float
    near: dict[str, float | None]
    far: dict[str, float | None]


def inverse(frame: Frame, x: float, z: float) -> tuple[float, float]:
    """Latitude and longitude of a world point, by Newton steps on the forward projection."""
    lat = frame.origin_lat_deg - z / 111132.0
    lon = frame.origin_lon_deg + x / (111320.0 * math.cos(math.radians(lat)))
    for _ in range(3):
        ex, ez = frame.to_world(lat, lon)
        lat += (ez - z) / 111132.0
        lon -= (ex - x) / (111320.0 * math.cos(math.radians(lat)))
    return lat, lon


def runs_of(stations: list[Station], side: str) -> list[tuple[float, float]]:
    """The runs of s (start, end) on ``side`` ("left" or "right") where the ground falls away."""
    key = "L" if side == "left" else "R"
    runs: list[list[float]] = []
    for st in stations:
        near, far = st.near[key], st.far[key]
        if near is None or far is None:
            continue
        if st.y - near >= NEAR_DROP_M and st.y - far >= FAR_DROP_M:
            if runs and st.s - runs[-1][1] <= JOIN_GAP_M:
                runs[-1][1] = st.s
            else:
                runs.append([st.s, st.s])
    return [(a, b) for a, b in runs if b - a >= MIN_RUN_M]


def sample_stations(road: dict[str, object], frame: Frame, cache: Path) -> list[Station]:
    """The road's stations with the 3DEP ground either side (right is d > 0), cached under ``cache``."""
    data = road["samples"]["data"]  # type: ignore[index]
    xs, zs, ys = data["x"], data["z"], data["y"]
    spacing = float(road["lengthM"]) / (len(xs) - 1)  # type: ignore[arg-type]
    stride = max(1, round(STEP_M / spacing))
    points: list[tuple[float, float]] = []
    meta: list[tuple[float, float]] = []
    for i in range(0, len(xs), stride):
        a, b = max(i - 1, 0), min(i + 1, len(xs) - 1)
        tx, tz = xs[b] - xs[a], zs[b] - zs[a]
        n = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / n, tx / n  # the right-hand normal: d > 0
        meta.append((i * spacing, ys[i]))
        for off in (NEAR_M, FAR_M):
            for sign in (1.0, -1.0):
                lat, lon = inverse(frame, xs[i] + sign * off * nx, zs[i] + sign * off * nz)
                points.append((lon, lat))
    usgs_samples(points, cache)
    values: list[float | None] = [None] * len(points)
    for smp in json.loads(cache.read_text(encoding="utf-8"))["samples"]:
        try:
            v = float(smp["value"])
        except (TypeError, ValueError, KeyError):
            continue
        if v > -100:
            values[int(smp["locationId"])] = v
    out: list[Station] = []
    for m, (s, y) in enumerate(meta):
        q = values[m * 4 : m * 4 + 4]
        out.append(Station(s, y, {"R": q[0], "L": q[1]}, {"R": q[2], "L": q[3]}))
    return out


def main(argv: list[str]) -> None:
    config = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    frame = Frame(config["crs"]["originLatDeg"], config["crs"]["originLonDeg"])
    for rid in argv[1:]:
        path = ROOT / config["outRoot"] / "roads" / f"{rid}.json"
        road = json.loads(path.read_text(encoding="utf-8"))
        stations = sample_stations(road, frame, TOOL / ".cache" / "usgs" / f"drops-{rid}.json")
        for side in ("left", "right"):
            runs = [[round(a), round(b)] for a, b in runs_of(stations, side)]
            print(f"{rid} {side}: {json.dumps(runs)}")


if __name__ == "__main__":
    main(sys.argv[1:])
