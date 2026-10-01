"""The documented road lint, run on the baked JSON before it is written.

These mirror docs/content-packs.md ("Road file" and "Validation") so a bad bake fails here, in the
tool, before the pack check sees it. The pack check (tools/packs, src/road/validate.ts) stays the
gate; this is the bake's own guard.
"""

from __future__ import annotations

import math
from itertools import pairwise
from typing import Any

type Json = dict[str, Any]

JUNCTION_TOL_M = 0.5
KAPPA_D_MAX = 0.5
KAPPA_AGREE_TOL = 2e-4  # 1/m: stored curvature vs. the turn between consecutive samples
TAGS = {
    "water-open",
    "water-shallow",
    "mangrove",
    "beach",
    "bridge",
    "causeway",
    "palms",
    "marina",
    "strip-mall",
    "trailer-park",
    "swamp",
    "town",
    "landmark",
    # The region packs' own tags (the Pacific Northwest and San Francisco), which the renderer reads
    # as land themes (src/render/scenery.ts) or as atmosphere (fog, cable-line).
    "forest",
    "sawmill",
    "row-houses",
    "painted-houses",
    "warehouses",
    "piers",
    "gardens",
    "fog",
    "cable-line",
}


def lint_road(road: Json, junctions: dict[str, Json]) -> list[str]:
    rid = road["id"]
    errs: list[str] = []
    length, spacing = float(road["lengthM"]), float(road["sampleSpacingM"])
    data = road["samples"]["data"]
    count = len(data["x"])
    n = round(length / spacing)
    if not 1 <= spacing <= 10:
        errs.append(f"{rid}: sampleSpacingM {spacing} outside 1..10")
    if count != n + 1:
        errs.append(f"{rid}: {count} samples, expected n + 1 = {n + 1}")
    if abs(spacing * n - length) >= 1e-6:
        errs.append(f"{rid}: sampleSpacingM * n = {spacing * n}, lengthM {length}")
    for col in road["samples"]["columns"]:
        if len(data[col]) != count:
            errs.append(f"{rid}: column {col} has {len(data[col])} values, x has {count}")
        if not all(math.isfinite(v) for v in data[col]):
            errs.append(f"{rid}: column {col} has a non-finite value")
    xs, zs, ks = data["x"], data["z"], data["kappa"]
    d_max = max(abs(ln["dCenterM"]) + ln["widthM"] / 2 for s in road["laneSections"] for ln in s["lanes"])
    worst_kd = max(abs(k) for k in ks) * d_max
    if worst_kd >= KAPPA_D_MAX:
        errs.append(f"{rid}: |kappa| * dMax = {worst_kd:.3f} (limit {KAPPA_D_MAX})")
    for i in range(count - 1):
        seg = math.hypot(xs[i + 1] - xs[i], zs[i + 1] - zs[i])
        if abs(seg - spacing) > 0.01:
            errs.append(f"{rid}: sample {i} chord {seg:.4f} m, spacing {spacing:.4f} m")
            break
    worst = 0.0
    for i in range(1, count - 1):
        h0 = math.atan2(xs[i] - xs[i - 1], -(zs[i] - zs[i - 1]))
        h1 = math.atan2(xs[i + 1] - xs[i], -(zs[i + 1] - zs[i]))
        turn = (h1 - h0 + math.pi) % (2 * math.pi) - math.pi
        worst = max(worst, abs(turn / spacing - ks[i]))
    if worst > KAPPA_AGREE_TOL:
        errs.append(f"{rid}: curvature disagrees with positions by {worst:.2e} 1/m")
    for end, idx in (("from", 0), ("to", count - 1)):
        j = junctions.get(road[end])
        if j is None:
            errs.append(f"{rid}: {end} junction {road[end]} missing")
            continue
        gap = math.dist((xs[idx], data["y"][idx], zs[idx]), (j["x"], j["y"], j["z"]))
        if gap > JUNCTION_TOL_M:
            errs.append(f"{rid}: {end} end is {gap:.3f} m from junction {j['id']}")
    for sec in road["laneSections"]:
        for ln in sec["lanes"]:
            if ln["widthM"] <= 0:
                errs.append(f"{rid}: lane {ln['id']} width {ln['widthM']}")
    for group in ("tags", "features", "barriers"):
        for t in road.get(group, []):
            if not 0 <= t["s0"] <= t["s1"] <= length:
                errs.append(f"{rid}: {group} range {t['s0']}..{t['s1']} outside 0..{length}")
    for t in road.get("tags", []):
        if t["tag"] not in TAGS:
            errs.append(f"{rid}: tag {t['tag']} is not in the closed list")
    if not rid.startswith("osm-"):
        errs.append(f"{rid}: OSM-derived files use the osm- prefix")
    if not any(s.get("spdx") == "ODbL-1.0" for s in road.get("provenance", {}).get("sources", [])):
        errs.append(f"{rid}: no ODbL source in provenance")
    return errs


def lint_bake(network: Json, roads: list[Json], route: Json) -> list[str]:
    errs: list[str] = []
    junctions = {j["id"]: j for j in network["junctions"]}
    by_id = {r["id"]: r for r in roads}
    if [r["id"] for r in roads] != network["roads"]:
        errs.append("network roads list differs from the baked roads")
    for road in roads:
        errs += lint_road(road, junctions)
    ends: dict[tuple[str, str], str] = {}
    for j in network["junctions"]:
        for e in j["ends"]:
            ends[(e["road"], e["end"])] = j["id"]
        if len(j["ends"]) > 2 or (len(j["ends"]) == 2 and j["connectors"]):
            errs.append(f"{j['id']}: only pass-through or dead-end junctions are baked")
    for road in roads:
        for end in ("from", "to"):
            if ends.get((road["id"], end)) != road[end]:
                errs.append(f"{road['id']}: {end} end not listed at junction {road[end]}")
    path = route["mainPath"]
    for rid in path:
        if rid not in by_id:
            errs.append(f"route {route['id']}: unknown road {rid}")
    for a, b in pairwise(path):
        if a in by_id and b in by_id and by_id[a]["to"] != by_id[b]["from"]:
            errs.append(f"route {route['id']}: {a} does not join {b}")
    for rid in path:
        if rid not in route["allowedRoads"]:
            errs.append(f"route {route['id']}: {rid} on mainPath but not allowed")
    for key in ("start", "finish"):
        r = by_id.get(route[key]["road"])
        if r is None or not 0 <= route[key]["s"] <= r["lengthM"]:
            errs.append(f"route {route['id']}: {key} is not on its road")
    return errs
