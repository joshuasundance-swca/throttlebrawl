"""Emit the baked road format (docs/content-packs.md, "Road networks, roads and routes").

One network with pass-through junctions (two ends, no connectors) joining the roads end to end,
one road per land stretch or long bridge, and one route over the whole stretch.
"""

from __future__ import annotations

import math
from collections import Counter
from itertools import pairwise
from typing import Any

import numpy as np

from tbgis import __version__
from tbgis.config import BakeConfig
from tbgis.fetch import FetchMeta
from tbgis.stretch import Profile, runs_of

type Json = dict[str, Any]

# One lane each way plus shoulders: the lane table of the hand-made M1 road, so every mover
# lane that works there works here. The real road has two lanes each way on some stretches.
LANES: list[Json] = [
    {"id": "L0", "dCenterM": -4.15, "widthM": 1.5, "direction": -1, "kind": "shoulder"},
    {"id": "L1", "dCenterM": -1.7, "widthM": 3.4, "direction": -1, "kind": "drive"},
    {"id": "R1", "dCenterM": 1.7, "widthM": 3.4, "direction": 1, "kind": "drive"},
    {"id": "R0", "dCenterM": 4.15, "widthM": 1.5, "direction": 1, "kind": "shoulder"},
]
D_MAX = max(abs(ln["dCenterM"]) + ln["widthM"] / 2 for ln in LANES)

OSM_ATTRIBUTION = "© OpenStreetMap contributors"
USGS_ATTRIBUTION = "Map services and data available from U.S. Geological Survey, National Geospatial Program."


def r4(v: float) -> float:
    return round(float(v), 4)


def r5(v: float) -> float:
    return float(f"{float(v):.5g}")


def road_splits(cfg: BakeConfig, p: Profile) -> list[tuple[int, int]]:
    """Grid index ranges [a, b] (inclusive ends, shared at junctions) for each road."""
    cuts = [0]
    for a, b in runs_of(p.bridge):
        if (b - a) * p.h >= cfg.splitBridgeMinM:
            cuts += [a, b - 1]
    cuts.append(len(p.s) - 1)
    cuts = sorted(set(cuts))
    return list(pairwise(cuts))


def provenance(cfg: BakeConfig, created_at: str, osm: FetchMeta, usgs: FetchMeta | None, p: Profile) -> Json:
    sources: list[Json] = [
        {
            "name": "OpenStreetMap",
            "spdx": "ODbL-1.0",
            "attribution": OSM_ATTRIBUTION,
            "url": "https://www.openstreetmap.org/copyright",
            "query": osm.query,
            "retrievedAt": osm.retrievedAt,
            "sha256": osm.sha256,
        }
    ]
    if usgs is not None:
        sources.append(
            {
                "name": "USGS 3DEP elevation",
                "spdx": "LicenseRef-US-Public-Domain",
                "attribution": USGS_ATTRIBUTION,
                "url": "https://www.usgs.gov/3d-elevation-program",
                "query": f"{usgs.url} {usgs.query}",
                "retrievedAt": usgs.retrievedAt,
                "sha256": usgs.sha256,
            }
        )
    e, c = cfg.elevation, cfg.compression
    kept = ", ".join(f"{b - a:.0f} m to {100 * f:.0f}%" for a, b, f in p.compressed) or "none"
    return {
        "origin": "gis-pipeline",
        "author": "tools/gis",
        "createdAt": created_at,
        "tool": {
            "name": "tools/gis/src/tbgis/cli.py",
            "version": __version__,
            "configRef": f"tools/gis/configs/{cfg.id}.json",
        },
        "sources": sources,
        "modified": True,
        "modifications": (
            f"US 1 ways stitched along the travel carriageway, heading Gaussian-smoothed "
            f"(sigma {cfg.smoothing.headingSigmaM:g} m), positions re-integrated from heading, "
            f"resampled at {cfg.sampleSpacingM:g} m; long straights compressed ({kept}; "
            f"{'bridges kept' if not c.onBridges else 'bridges included'}); land elevation from 3DEP "
            f"low-pass filtered (sigma {e.lowPassSigmaM:g} m), floored at {e.minLandM:g} m; bridge decks "
            f"synthesized (3DEP is bare earth): {e.deckM:g} m deck, {e.humpHeightM:g} m x "
            f"{e.humpLengthM:g} m hump on bridges over {e.humpMinBridgeM:g} m (not measured); lanes "
            f"simplified to one each way plus shoulders"
        ),
    }


def bake(
    cfg: BakeConfig, p: Profile, osm: FetchMeta, usgs: FetchMeta | None, created_at: str
) -> tuple[Json, list[Json], Json]:
    splits = road_splits(cfg, p)
    if len(splits) != len(cfg.roads):
        spans = ", ".join(f"{p.s[a]:.0f}-{p.s[b]:.0f} m" for a, b in splits)
        raise ValueError(
            f"the stretch splits into {len(splits)} roads ({spans}); config names {len(cfg.roads)}"
        )
    prov = provenance(cfg, created_at, osm, usgs, p)
    roads: list[Json] = []
    junctions: list[Json] = []
    for i, ((a, b), rn) in enumerate(zip(splits, cfg.roads, strict=True)):
        s_a, s_b = float(p.s[a]), float(p.s[b])
        length = r4(s_b - s_a)
        n = max(1, round(length / cfg.sampleSpacingM))
        spacing = length / n
        s = s_a + spacing * np.arange(n + 1)
        s[-1] = s_b
        cols = {
            "x": [r4(v) for v in np.interp(s, p.s, p.x)],
            "y": [r4(v) for v in np.interp(s, p.s, p.y)],
            "z": [r4(v) for v in np.interp(s, p.s, p.z)],
            "kappa": [r5(v) for v in np.interp(s, p.s, p.kappa)],
            "grade": [r5(v) for v in np.interp(s, p.s, p.grade)],
            "bankRad": [0.0] * (n + 1),
        }
        tags: list[Json] = []
        for ra, rb in runs_of(p.bridge[a : b + 1]):
            t0, t1 = r4(p.s[a + ra] - s_a), r4(min(p.s[a + rb - 1] - s_a, length))
            if t1 - t0 < 1:
                continue  # the shared junction sample of a neighbouring bridge road
            tags += [
                {"s0": t0, "s1": t1, "side": "both", "tag": "bridge"},
                {"s0": t0, "s1": t1, "side": "both", "tag": "water-open"},
            ]
        tags += [{"s0": 0, "s1": length, "side": "both", "tag": t} for t in rn.tags]
        barriers = [
            {"s0": tg["s0"], "s1": tg["s1"], "side": "both", "kind": "rail", "heightM": cfg.bridgeRailHeightM}
            for tg in tags
            if tg["tag"] == "bridge"
        ]
        features: list[Json] = []
        for f in rn.features:
            if not 0 <= f.s0 <= f.s1 <= length:
                raise ValueError(f"{rn.id}: feature {f.id} at {f.s0}..{f.s1} is off the {length} m road")
            features.append(f.model_dump(exclude_none=True))
        speeds = [round(v, 1) for v in p.speed[a : b + 1] if math.isfinite(v)]
        speed = Counter(speeds).most_common(1)[0][0] if speeds else 24.6
        roads.append(
            {
                "type": "road",
                "id": rn.id,
                "name": rn.name,
                "realName": "Overseas Highway",
                "network": cfg.id,
                "from": f"{cfg.id}-j{i}",
                "to": f"{cfg.id}-j{i + 1}",
                "lengthM": length,
                "sampleSpacingM": spacing,
                "speedLimitMps": speed,
                "surface": "asphalt",
                "laneSections": [{"s0": 0, "lanes": LANES}],
                "tags": tags,
                "features": features,
                "barriers": barriers,
                "samples": {"encoding": "json-columns", "columns": list(cols), "data": cols},
                "provenance": prov,
                "meta": {
                    "status": "live",
                    "notes": f"Baked by tools/gis from {cfg.id}.json. Real US 1 geometry, gameplay-fied "
                    "(see provenance.modifications). Regenerate with the bake; never hand-edit.",
                },
            }
        )
        junctions.append({"i": i, "k": a})
    junctions.append({"i": len(splits), "k": splits[-1][1]})

    def ends(i: int) -> list[Json]:
        out: list[Json] = []
        if i > 0:
            out.append({"road": cfg.roads[i - 1].id, "end": "to"})
        if i < len(cfg.roads):
            out.append({"road": cfg.roads[i].id, "end": "from"})
        return out

    network = {
        "type": "road-network",
        "id": cfg.id,
        "name": cfg.name,
        "region": cfg.region,
        "crs": {
            "kind": "tmerc",
            "originLatDeg": cfg.crs.originLatDeg,
            "originLonDeg": cfg.crs.originLonDeg,
            "originElevM": 0,
        },
        "chunking": {"kind": "none"},
        "roads": [r.id for r in cfg.roads],
        "junctions": [
            {
                "id": f"{cfg.id}-j{j['i']}",
                "x": r4(float(p.x[j["k"]])),
                "y": r4(float(p.y[j["k"]])),
                "z": r4(float(p.z[j["k"]])),
                "ends": ends(j["i"]),
                "connectors": [],
                "control": "none",
            }
            for j in junctions
        ],
        "provenance": prov,
        "meta": {
            "status": "live",
            "notes": "Real-road alternative to the hand-made network (gis-1 side quest). Roads joined end "
            "to end by pass-through junctions. The same frame as keys-m1, so the two line up.",
        },
    }
    last = roads[-1]
    route = {
        "type": "route",
        "id": cfg.route.id,
        "name": cfg.route.name,
        "network": cfg.id,
        "start": {"road": roads[0]["id"], "s": cfg.route.startS, "dir": 1},
        "finish": {"road": last["id"], "s": r4(last["lengthM"] - cfg.route.finishBeforeEndM)},
        "mainPath": [r["id"] for r in roads],
        "allowedRoads": [r["id"] for r in roads],
        "checkpoints": [{"road": r["id"], "s": r4(r["lengthM"] / 2)} for r in roads[1:-1]],
        "closed": False,
        "startGrid": {"rows": 3, "perRow": 2, "rowGapM": 8},
        "meta": {
            "status": "live",
            "notes": "An alternative route on the real road; no event points at it yet (road-4 decides).",
            "provenance": {k: prov[k] for k in ("origin", "author", "createdAt", "tool", "sources")},
        },
    }
    return network, roads, route
