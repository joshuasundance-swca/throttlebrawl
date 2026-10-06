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
from tbgis.config import BakeConfig, bridge_barriers
from tbgis.features import bake_ramps, plus
from tbgis.fetch import FetchMeta
from tbgis.stretch import Profile, runs_of
from tbgis.tmerc import Frame

type Json = dict[str, Any]

OSM_ATTRIBUTION = "© OpenStreetMap contributors"
USGS_ATTRIBUTION = "Map services and data available from U.S. Geological Survey, National Geospatial Program."
SHOULDER_M = 1.5


def r4(v: float) -> float:
    return round(float(v), 4)


def r5(v: float) -> float:
    return float(f"{float(v):.5g}")


def lanes(width: float = 3.4, per_direction: int = 1, median: float = 0.0) -> list[Json]:
    """`per_direction` drive lanes each way (1 to 3, W-Q's 4-6 lane highways) plus shoulders, set
    apart by a `median` gap. One each way with no median is the lane table of the hand-made roads,
    so every mover lane that works there works here: at the default 3.4 m the M1 table the Keys bake
    carries; the region bakes use 4.0 m, as the hand-made roads have since playtest 1. Lane ids
    count out from the middle (L1, L2, L3 and R1, R2, R3); L0 and R0 are the shoulders."""
    if not 1 <= per_direction <= 3:
        raise ValueError(f"lanes per direction {per_direction}: 1 to 3")
    inner = median / 2
    edge = r4(inner + per_direction * width + SHOULDER_M / 2)
    left = [
        {
            "id": f"L{k}",
            "dCenterM": -r4(inner + (k - 0.5) * width),
            "widthM": width,
            "direction": -1,
            "kind": "drive",
        }
        for k in range(per_direction, 0, -1)
    ]
    right = [
        {
            "id": f"R{k}",
            "dCenterM": r4(inner + (k - 0.5) * width),
            "widthM": width,
            "direction": 1,
            "kind": "drive",
        }
        for k in range(1, per_direction + 1)
    ]
    return [
        {"id": "L0", "dCenterM": -edge, "widthM": SHOULDER_M, "direction": -1, "kind": "shoulder"},
        *left,
        *right,
        {"id": "R0", "dCenterM": edge, "widthM": SHOULDER_M, "direction": 1, "kind": "shoulder"},
    ]


def lane_section(cfg: BakeConfig) -> Json:
    """The one lane section every road of a bake carries: lanes, the median and verges when set."""
    section: Json = {"s0": 0, "lanes": lanes(cfg.laneWidthM, cfg.lanesPerDirection, cfg.medianM)}
    if cfg.medianM > 0:
        section["median"] = {"widthM": cfg.medianM, "kind": cfg.medianKind}
    if cfg.verges is not None:
        section["verges"] = cfg.verges.model_dump(exclude_none=True)
    return section


LANES: list[Json] = lanes()
D_MAX = max(abs(ln["dCenterM"]) + ln["widthM"] / 2 for ln in LANES)


def without(s0: float, s1: float, holes: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The range s0..s1 minus the holes (sorted or not), as the pieces at least 1 m long."""
    out: list[tuple[float, float]] = []
    at = s0
    for h0, h1 in sorted(holes):
        if h0 > at:
            out.append((at, min(h0, s1)))
        at = max(at, h1)
    if at < s1:
        out.append((at, s1))
    return [(a, b) for a, b in out if b - a >= 1]


def street_name(p: Profile, i: int) -> str:
    return p.names.get(int(p.way[i]), "") if p.way is not None else ""


def name_cuts(cfg: BakeConfig, p: Profile) -> list[int]:
    """Grid indices where the OSM street name changes, dropping pieces under ``minRoadM``."""
    if p.way is None:
        return []
    cuts: list[int] = []
    last = 0
    for i in range(1, len(p.s)):
        if street_name(p, i) != street_name(p, i - 1) and (i - last) * p.h >= cfg.minRoadM:
            cuts.append(i)
            last = i
    if cuts and (len(p.s) - 1 - cuts[-1]) * p.h < cfg.minRoadM:
        cuts.pop()  # a short last piece joins the road before it
    return cuts


def road_splits(cfg: BakeConfig, p: Profile) -> list[tuple[int, int]]:
    """Grid index ranges [a, b] (inclusive ends, shared at junctions) for each road."""
    cuts = [0]
    for a, b in runs_of(p.bridge):
        if (b - a) * p.h >= cfg.splitBridgeMinM:
            cuts += [a, b - 1]
    if cfg.splitOnNameChange:
        cuts += name_cuts(cfg, p)
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    for pt in cfg.splitAt:
        x, z = frame.to_world(pt.lat, pt.lon)
        cuts.append(int(np.argmin(np.hypot(p.x - x, p.z - z))))
    cuts.append(len(p.s) - 1)
    cuts = sorted(set(cuts))
    return list(pairwise(cuts))


def longest_name(p: Profile, a: int, b: int) -> str:
    """The OSM street name covering most of grid range [a, b]."""
    names = Counter(street_name(p, i) for i in range(a, b + 1))
    names.pop("", None)
    return names.most_common(1)[0][0] if names else ""


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
    travel = "carriageway" if cfg.respectOneway else "path, one-way streets ridden both ways"
    if e.bridgeDeck == "span":
        deck = "a straight deck between the land at each end (not measured)"
    else:
        deck = (
            f"{e.deckM:g} m deck, {e.humpHeightM:g} m x {e.humpLengthM:g} m hump on bridges over "
            f"{e.humpMinBridgeM:g} m (not measured)"
        )
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
            f"{cfg.waysLabel} ways stitched along the travel {travel}, heading Gaussian-smoothed "
            f"(sigma {cfg.smoothing.headingSigmaM:g} m), positions re-integrated from heading, "
            f"resampled at {cfg.sampleSpacingM:g} m; long straights compressed ({kept}; "
            f"{'bridges kept' if not c.onBridges else 'bridges included'}); land elevation from 3DEP "
            f"low-pass filtered (sigma {e.lowPassSigmaM:g} m), floored at {e.minLandM:g} m; bridge decks "
            f"synthesized (3DEP is bare earth): {deck}; lanes simplified to one each way plus shoulders"
        ),
    }


def bake(
    cfg: BakeConfig, p: Profile, osm: FetchMeta, usgs: FetchMeta | None, created_at: str
) -> tuple[Json, list[Json], Json]:
    if any(st.kind == "gap" for st in cfg.stitches):
        # A stretch's one route runs every road, and traffic runs the main path: a gap there would
        # swallow it (src/road/validate.ts). Gaps go on a network's branch line.
        raise ValueError("a gap stitch needs a network bake (tbgis network): it goes on a branch line")
    splits = road_splits(cfg, p)
    if len(splits) != len(cfg.roads):
        spans = ", ".join(
            f"{p.s[a]:.0f}-{p.s[b]:.0f} m" + (f" ({longest_name(p, a, b)})" if longest_name(p, a, b) else "")
            for a, b in splits
        )
        raise ValueError(
            f"the stretch splits into {len(splits)} roads ({spans}); config names {len(cfg.roads)}"
        )
    prov = provenance(cfg, created_at, osm, usgs, p)
    roads: list[Json] = []
    junctions: list[Json] = []
    for i, ((a, b), rn) in enumerate(zip(splits, cfg.roads, strict=True)):
        s_a, s_b = float(p.s[a]), float(p.s[b])
        length = r4(s_b - s_a)
        n = max(1, round(length / (rn.sampleSpacingM or cfg.sampleSpacingM)))
        spacing = length / n
        s = s_a + spacing * np.arange(n + 1)
        s[-1] = s_b
        features: list[Json] = []
        for f in rn.features:
            if not 0 <= f.s0 <= f.s1 <= length:
                raise ValueError(f"{rn.id}: feature {f.id} at {f.s0}..{f.s1} is off the {length} m road")
            features.append(f.model_dump(exclude_none=True))
        features, ramp_y, ramp_g = bake_ramps(features, length, n)
        cols = {
            "x": [r4(v) for v in np.interp(s, p.s, p.x)],
            "y": [r4(v) for v in plus(np.interp(s, p.s, p.y), ramp_y)],
            "z": [r4(v) for v in np.interp(s, p.s, p.z)],
            "kappa": [r5(v) for v in np.interp(s, p.s, p.kappa)],
            "grade": [r5(v) for v in plus(np.interp(s, p.s, p.grade), ramp_g)],
            "bankRad": [0.0] * (n + 1),
        }
        tags: list[Json] = []
        decks: list[tuple[float, float]] = []
        # A sea deck stands over open water (the Keys); a span deck crosses a creek or a ravine in
        # high country, so it gets no water tag (no boats far below it).
        water = cfg.elevation.bridgeDeck == "sea"
        for ra, rb in runs_of(p.bridge[a : b + 1]):
            t0, t1 = r4(p.s[a + ra] - s_a), r4(min(p.s[a + rb - 1] - s_a, length))
            if t1 - t0 < 1:
                continue  # the shared junction sample of a neighbouring bridge road
            decks.append((t0, t1))
            tags.append({"s0": t0, "s1": t1, "side": "both", "tag": "bridge"})
            min_m = cfg.elevation.waterBridgeMinM
            if water or (min_m is not None and (rb - ra) * p.h >= min_m):
                tags.append({"s0": t0, "s1": t1, "side": "both", "tag": "water-open"})
            tags += [{"s0": t0, "s1": t1, "side": "both", "tag": t} for t in rn.deckTags]
        # The config's land tags cover the road except its bridges: a land tag on a bridge would
        # stand scenery on the deck (playtest 1c item 3).
        tags += [
            {"s0": r4(t0), "s1": r4(t1), "side": "both", "tag": t}
            for t in rn.tags
            for t0, t1 in without(0, length, decks)
        ]
        # Tags over part of one side (playtest 4, P4-19, C4), off the decks as well.
        tags += [row for st in rn.spanTags for row in st.ranges(length, decks, rn.id)]
        barriers = [
            *bridge_barriers(tags, cfg.bridgeRailHeightM, cfg.bridgeBarrier),
            *(b.as_json(length) for b in rn.barriers),
        ]
        speeds = [round(v, 1) for v in p.speed[a : b + 1] if math.isfinite(v)]
        speed = Counter(speeds).most_common(1)[0][0] if speeds else 24.6
        roads.append(
            {
                "type": "road",
                "id": rn.id,
                "name": rn.name,
                "realName": rn.realName or (cfg.realNameFromOsm and longest_name(p, a, b)) or cfg.realName,
                "network": cfg.id,
                "from": f"{cfg.id}-j{i}",
                "to": f"{cfg.id}-j{i + 1}",
                "lengthM": length,
                "sampleSpacingM": spacing,
                "speedLimitMps": speed,
                "surface": "asphalt",
                "laneSections": [lane_section(cfg)],
                "tags": tags,
                "features": features,
                "barriers": barriers,
                "samples": {"encoding": "json-columns", "columns": list(cols), "data": cols},
                "provenance": prov,
                "meta": {
                    "status": "live",
                    "notes": f"Baked by tools/gis from {cfg.id}.json. Real {cfg.waysLabel} geometry, "
                    "gameplay-fied (see provenance.modifications). Regenerate with the bake; "
                    "never hand-edit.",
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
            "notes": cfg.networkNotes,
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
            "notes": cfg.route.notes,
            "provenance": {k: prov[k] for k in ("origin", "author", "createdAt", "tool", "sources")},
        },
    }
    return network, roads, route
