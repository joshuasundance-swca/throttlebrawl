"""Reading Overpass JSON (``out tags geom``) into plain way records."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

EARTH_R = 6_371_008.8  # mean Earth radius, metres (for rough lengths only; the bake projects properly)


@dataclass(frozen=True)
class Way:
    id: int
    tags: dict[str, str]
    coords: list[tuple[float, float]]  # (lat, lon)

    @property
    def is_bridge(self) -> bool:
        return self.tags.get("bridge", "no") not in ("no", "")

    @property
    def oneway(self) -> bool:
        return self.tags.get("oneway") in ("yes", "1", "true", "-1")


def load_ways(raw: Path) -> list[Way]:
    doc = json.loads(raw.read_text(encoding="utf-8"))
    ways: list[Way] = []
    for el in doc.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [(float(p["lat"]), float(p["lon"])) for p in el["geometry"]]
        ways.append(Way(id=int(el["id"]), tags=dict(el.get("tags", {})), coords=coords))
    return ways


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def polyline_length_m(coords: list[tuple[float, float]]) -> float:
    return sum(haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))
