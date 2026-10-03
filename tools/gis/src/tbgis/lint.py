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
    # San Francisco's downtown (run W-R) and the Keys' district tags (run W-Q; docs/content-packs.md,
    # "District tags"): a key- tag says which key a stretch is on, beside its land tags.
    "towers",
    "plaza",
    "cross-street",
    "cable-crossing",
    "key-fishing",
    "key-resort",
    "key-junkyard",
    "key-party",
    # San Francisco's waterfront (run W-U; docs/content-packs.md, "San Francisco's waterfront").
    "promenade",
    "pier-shed",
    "ferry-hall",
    "sea-lions",
    "wharf",
    "side-street",
    "ferry-plaza",
    "wharf-lot",
}


def lint_road(
    road: Json, junctions: dict[str, Json], *, end_tol: dict[str, float] | None = None, ends: bool = True
) -> list[str]:
    """One road's own rules. ``end_tol`` widens the end check per junction (a junction with connector
    roads lets its ends lie within 60 m, the connectors span the gap); ``ends`` False skips it (a
    connector road, checked against the road ends it joins instead)."""
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
    for end, idx in (("from", 0), ("to", count - 1)) if ends else ():
        j = junctions.get(road[end])
        if j is None:
            errs.append(f"{rid}: {end} junction {road[end]} missing")
            continue
        gap = math.dist((xs[idx], data["y"][idx], zs[idx]), (j["x"], j["y"], j["z"]))
        tol = (end_tol or {}).get(j["id"], JUNCTION_TOL_M)
        if gap > tol:
            errs.append(f"{rid}: {end} end is {gap:.3f} m from junction {j['id']} (limit {tol} m)")
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


# Network bakes (tbgis network): junctions with connector roads, as src/road/validate.ts checks them.
JUNCTION_RADIUS_M = 60.0
JOIN_ANGLE_RAD = 0.0524  # 3 degrees


def end_frame(road: Json, end: str) -> tuple[float, float, float, float, float]:
    """(x, y, z, tx, tz) at a road end, the tangent pointing along increasing s."""
    d = road["samples"]["data"]
    xs, ys, zs = d["x"], d["y"], d["z"]
    i, k, sign = (0, 1, 1) if end == "from" else (len(xs) - 1, len(xs) - 2, -1)
    tx, tz = sign * (xs[k] - xs[i]), sign * (zs[k] - zs[i])
    n = math.hypot(tx, tz) or 1.0
    return xs[i], ys[i], zs[i], tx / n, tz / n


def lanes_of(road: Json) -> list[Json]:
    return [ln for s in road["laneSections"] for ln in s["lanes"]]


def join_check(c: Json, c_end: str, r: Json, r_end: str) -> str | None:
    """A connector's end meets a road end: within 0.5 m along it and vertically, inside its width,
    and pointing the same way within 3 degrees."""
    cx, cy, cz, ctx, ctz = end_frame(c, c_end)
    rx, ry, rz, rtx, rtz = end_frame(r, r_end)
    dx, dz = cx - rx, cz - rz
    along = dx * rtx + dz * rtz
    lat = -dx * rtz + dz * rtx
    half = max(
        max(abs(ln["dCenterM"] - ln["widthM"] / 2), abs(ln["dCenterM"] + ln["widthM"] / 2))
        for ln in lanes_of(r)
    )
    if abs(along) > JUNCTION_TOL_M or abs(cy - ry) > JUNCTION_TOL_M or abs(lat) > half:
        return (
            f"the {c_end} end of {c['id']} misses the {r_end} end of {r['id']}: {along:.3f} m along, "
            f"{lat:.3f} m across (width +-{half} m), {cy - ry:.3f} m up"
        )
    sigma = -1 if c_end == r_end else 1
    if sigma * (ctx * rtx + ctz * rtz) < 1 - JOIN_ANGLE_RAD**2 / 2:
        return f"the {c_end} end of {c['id']} does not line up with the {r_end} end of {r['id']}"
    return None


def lint_network(network: Json, roads: list[Json], routes: list[Json]) -> list[str]:
    """The network rules src/road/validate.ts applies, so a bad bake fails in the tool."""
    errs: list[str] = []
    junctions = {j["id"]: j for j in network["junctions"]}
    by_id = {r["id"]: r for r in roads}
    if [r["id"] for r in roads] != network["roads"]:
        errs.append("network roads list differs from the baked roads")
    rows = [(j, c) for j in network["junctions"] for c in j["connectors"]]
    connector_ids = {c["road"] for _, c in rows}
    radius = {j["id"]: JUNCTION_RADIUS_M for j in network["junctions"] if j["connectors"]}
    ends: dict[tuple[str, str], list[str]] = {}
    for j in network["junctions"]:
        for e in j["ends"]:
            ends.setdefault((e["road"], e["end"]), []).append(j["id"])
        if len(j["ends"]) > 2 and not j["connectors"]:
            errs.append(f"{j['id']}: {len(j['ends'])} road ends and no connector rows")
    for road in roads:
        conn = road["id"] in connector_ids
        errs += lint_road(road, junctions, end_tol=radius, ends=not conn)
        for end in ("from", "to"):
            listed = ends.get((road["id"], end), [])
            if conn:
                owners = {j["id"] for j, c in rows if c["road"] == road["id"]}
                if listed or owners != {road["from"]} or road["from"] != road["to"]:
                    errs.append(f"{road['id']}: a connector runs from and to the one junction naming it")
            elif listed != [road[end]]:
                errs.append(f"{road['id']}: {end} end listed at {listed}, not exactly at {road[end]}")
    for j, c in rows:
        a, k, b = by_id.get(c["from"]["road"]), by_id.get(c["road"]), by_id.get(c["to"]["road"])
        if a is None or k is None or b is None:
            errs.append(f"{j['id']} row {c['id']}: unknown road")
            continue
        for side, rd in (("from", a), ("to", b)):
            if c[side]["lane"] not in {ln["id"] for ln in lanes_of(rd)}:
                errs.append(f"row {c['id']}: {rd['id']} has no lane {c[side]['lane']}")
            if (c[side]["road"], c[side]["end"]) not in {(e["road"], e["end"]) for e in j["ends"]}:
                errs.append(
                    f"row {c['id']}: the {c[side]['end']} end of {c[side]['road']} is not at {j['id']}"
                )
        for msg in (join_check(k, "from", a, c["from"]["end"]), join_check(k, "to", b, c["to"]["end"])):
            if msg:
                errs.append(f"row {c['id']}: {msg}")
        z = c.get("splitZone")
        if z:
            length = a["lengthM"]
            if c["from"]["end"] == "to":
                at_end = abs(z["s1"] - length) <= JUNCTION_TOL_M
            else:
                at_end = abs(z["s0"]) <= JUNCTION_TOL_M
            if not (0 <= z["s0"] < z["s1"] <= length and z["d0"] < z["d1"]) or not at_end:
                errs.append(
                    f"row {c['id']}: the split zone must lie in {a['id']} "
                    f"and reach its {c['from']['end']} end"
                )
        shortcut = any(ln["kind"] == "shortcut" for rd in (a, b) for ln in lanes_of(rd))
        if shortcut and any(ln["kind"] == "drive" for ln in lanes_of(k)):
            errs.append(f"row {c['id']}: a connector onto or off a shortcut road carries a drive lane")
    for route in routes:
        errs += lint_net_route(route, by_id, junctions)
    return errs


def lint_net_route(route: Json, by_id: dict[str, Json], junctions: dict[str, Json]) -> list[str]:
    errs: list[str] = []
    rid = route["id"]
    path, allowed = route["mainPath"], set(route["allowedRoads"])
    for key in ("start", "finish"):
        r = by_id.get(route[key]["road"])
        if r is None or not 0 <= route[key]["s"] <= r["lengthM"] or r["id"] not in allowed:
            errs.append(f"route {rid}: {key} is not on an allowed road")
    if not path or path[0] != route["start"]["road"] or path[-1] != route["finish"]["road"]:
        errs.append(f"route {rid}: the main path must run from the start road to the finish road")
    for x, y in pairwise(path):
        ok = False
        j = junctions.get(by_id[x]["to"]) if x in by_id else None
        if j is not None and not j["connectors"]:
            ok = len(j["ends"]) == 2 and {"road": y, "end": "from"} in j["ends"]
        elif j is not None:
            via = [
                c["road"]
                for c in j["connectors"]
                if c["from"]["road"] == x and c["to"]["road"] == y and "splitZone" not in c
            ]
            ok = bool(via) and all(v in allowed for v in via)
        if not ok:
            errs.append(f"route {rid}: {x} does not lead into {y} at a junction")
    for r in [*path, *(r for b in route.get("branches", []) for r in b["roads"])]:
        if r not in allowed or r not in by_id:
            errs.append(f"route {rid}: {r} is not an allowed road")
    seen: set[str] = set()
    for b in route.get("branches", []):
        for r in b["roads"]:
            if r in path or r in seen:
                errs.append(f"route {rid}: branch {b['id']} road {r} is on the main path or another branch")
            seen.add(r)
    return errs
