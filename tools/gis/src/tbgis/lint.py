"""The documented road lint, run on the baked JSON before it is written.

These mirror docs/content-packs.md ("Road file" and "Validation") so a bad bake fails here, in the
tool, before the pack check sees it. The pack check (tools/packs, src/road/validate.ts) stays the
gate; this is the bake's own guard.
"""

from __future__ import annotations

import math
from itertools import pairwise
from typing import Any

from tbgis.config import BARRIER_LOOKS, GAP_RESPAWNS

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
    # Big Pine's Key deer (playtest 4, P4-19, B5): the road they graze beside.
    "key-deer",
    # San Francisco's waterfront (run W-U; docs/content-packs.md, "San Francisco's waterfront").
    "promenade",
    "pier-shed",
    "ferry-hall",
    "sea-lions",
    "wharf",
    "wharf-street",
    "ferry-plaza",
    "wharf-lot",
    # Playtest 3's real places (docs/content-packs.md, "Gaps and landmarks").
    "conch-houses",
    "key-oldtown",
    "old-bridge",
    "pdx-blocks",
    "pdx-deck",
    "gg-deck",
    "rail-line",
    "brick-street",
    "headlands",
}

# The jump lint (src/road/validate.ts ROAD_LINT, docs/content-packs.md "Jump lint"): from a ramp,
# gap or ramp truck to where a bike at the starter bike's top speed lands, the road is straight.
JUMP_SPEED_MPS = 44.7
JUMP_MAX_KAPPA = 0.002
GAP_RUN_OUT_M = 20.0
GRAVITY = 9.81
RAMP_TRUCK = {"rampLengthM": 11.5, "lipHeightM": 2.8}  # src/road/types.ts RAMP_TRUCK_DEFAULTS


def _js_round(v: float) -> int:
    return math.floor(v + 0.5)  # JavaScript's Math.round, which the game's lint uses


def _positive(f: Json, key: str, fallback: float) -> float:
    v = (f.get("params") or {}).get(key)
    ok = isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v) and v > 0
    return float(v) if ok else fallback  # type: ignore[arg-type]


def flight_end(f: Json, ys: list[float], sp: float) -> float:
    """Where a jump's expected flight ends, in s (src/road/validate.ts expectedFlightEnd)."""
    count = len(ys)
    length = (count - 1) * sp
    if f["kind"] == "gap":
        return float(min(length, f["s1"] + GAP_RUN_OUT_M))
    if f["kind"] == "rampTruck":
        run = _positive(f, "rampLengthM", RAMP_TRUCK["rampLengthM"])
        lip_h = _positive(f, "lipHeightM", RAMP_TRUCK["lipHeightM"])
        lip = min(count - 1, _js_round((f["s0"] + run) / sp))
        slope = lip_h / run
        y_lip = ys[lip] + lip_h
    else:
        i_a = max(0, math.floor(f["s0"] / sp))
        i_b = min(count - 1, math.ceil(f["s1"] / sp))
        lip = i_a
        for i in range(i_a, i_b + 1):
            if ys[i] > ys[lip]:
                lip = i
        slope = (ys[lip] - ys[lip - 1]) / sp if lip > 0 else 0.0
        y_lip = ys[lip]
    for i in range(lip + 1, count):
        dx = (i - lip) * sp
        t = dx / JUMP_SPEED_MPS
        if y_lip + slope * dx - 0.5 * GRAVITY * t * t <= ys[i]:
            return i * sp
    return length


def lint_jumps(road: Json) -> list[str]:
    """Ramps, gaps and ramp trucks sit on road that is straight to their expected landing."""
    errs: list[str] = []
    data = road["samples"]["data"]
    ys, ks = data["y"], data["kappa"]
    sp = float(road["sampleSpacingM"])
    last = len(ys) - 1
    for f in road.get("features", []):
        if f["kind"] not in ("ramp", "gap", "rampTruck"):
            continue
        s0 = max(0.0, float(f["s0"]))
        s1 = min(last * sp, flight_end(f, ys, sp))
        i0, i1 = math.floor(s0 / sp), min(last, math.ceil(s1 / sp))
        worst, at = 0.0, i0
        for i in range(i0, i1 + 1):
            if abs(ks[i]) > worst:
                worst, at = abs(ks[i]), i
        if worst > JUMP_MAX_KAPPA:
            errs.append(
                f"{road['id']}: {f['kind']} {f['id']} sits on a bend: |kappa| {worst:.3g} at s {at * sp:.1f} "
                f"is over {JUMP_MAX_KAPPA} between s {s0:.1f} and its expected landing at s {s1:.1f}"
            )
    return errs


def lint_playtest3(road: Json) -> list[str]:
    """Gap and landmark params, and jumpable walls (src/road/validate.ts lintPlaytest3); the
    footprint rule (landmark-clear) needs the derived verges, so the pack check alone runs it."""
    errs: list[str] = []
    rid = road["id"]
    for f in road.get("features", []):
        p = f.get("params") or {}
        if f["kind"] == "gap":
            if "respawn" in p and p["respawn"] not in GAP_RESPAWNS:
                errs.append(
                    f"{rid}: gap {f['id']}: respawn {p['respawn']!r} is not one of {', '.join(GAP_RESPAWNS)}"
                )
            for k in ("killDepthM", "respawnPastM"):
                if k in p and _positive(f, k, -1.0) < 0:
                    errs.append(f"{rid}: gap {f['id']}: {k} {p[k]!r} is not a number above 0")
        if f["kind"] == "landmark":
            if not isinstance(p.get("model"), str) or not p["model"]:
                errs.append(f"{rid}: landmark {f['id']} names no model (<asset id>#<node>)")
            yaw, scale = p.get("yawDeg", 0.0), p.get("scale", 1.0)
            if not (isinstance(yaw, int | float) and -180 <= yaw <= 180):
                errs.append(f"{rid}: landmark {f['id']}: yawDeg {yaw!r} is not in [-180, 180]")
            if not (isinstance(scale, int | float) and 0 < scale <= 4):
                errs.append(f"{rid}: landmark {f['id']}: scale {scale!r} is not in (0, 4]")
            if "farM" in p and _positive(f, "farM", -1.0) < 0:
                errs.append(f"{rid}: landmark {f['id']}: farM {p['farM']!r} is not a number above 0")
    for b in road.get("barriers", []):
        if b.get("jumpable") is True and b["kind"] != "wall":
            errs.append(f"{rid}: a {b['kind']} cannot be jumpable: only a wall may be")
        if "look" in b and b["look"] not in BARRIER_LOOKS:
            errs.append(f"{rid}: barrier look {b['look']!r} is not one of {', '.join(BARRIER_LOOKS)}")
    return errs


def gaps_on_main_path(route: Json, by_id: dict[str, Json]) -> list[str]:
    """Traffic runs a route's main path, so a gap there would swallow it: gaps go on branch roads."""
    errs: list[str] = []
    for rid in route["mainPath"]:
        hole = next((f for f in by_id.get(rid, {}).get("features", []) if f["kind"] == "gap"), None)
        if hole is not None:
            errs.append(
                f"route {route['id']}: road {rid} holds gap {hole['id']}: traffic runs the main path, "
                "so put gaps on branch roads"
            )
    return errs


def lint_road(
    road: Json, junctions: dict[str, Json], *, end_tol: dict[str, float] | None = None, ends: bool = True
) -> list[str]:
    """One road's own rules. ``end_tol`` widens the end check per junction (a junction with connector
    roads lets its ends lie within 250 m, the connectors span the gap); ``ends`` False skips it (a
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
    errs += lint_grade(road)
    errs += lint_jumps(road)
    errs += lint_playtest3(road)
    return errs


GRADE_ABS_TOL = 0.01  # src/road/validate.ts ROAD_LINT.gradeAbsTol


def lint_grade(road: Json) -> list[str]:
    """Stored grade agrees with the elevations (src/road/validate.ts, "Grade from elevations"): the
    central difference of y against the stored grade, each averaged over five samples, outside every
    ramp's range and two samples either side (a lip is a deliberate kink)."""
    data = road["samples"]["data"]
    ys, gs = data["y"], data["grade"]
    sp = float(road["sampleSpacingM"])
    last = len(ys) - 1
    if last < 1:
        return []
    g_pos = [
        (ys[min(i + 1, last)] - ys[max(i - 1, 0)]) / ((min(i + 1, last) - max(i - 1, 0)) * sp)
        for i in range(last + 1)
    ]
    lips = [f for f in road.get("features", []) if f["kind"] == "ramp"]

    def smooth(v: list[float], i: int) -> float:
        win = v[max(0, i - 2) : min(last, i + 2) + 1]
        return sum(win) / len(win)

    for i in range(last + 1):
        s = i * sp
        if any(f["s0"] - 2 * sp <= s <= f["s1"] + 2 * sp for f in lips):
            continue
        if abs(smooth(g_pos, i) - smooth(gs, i)) > GRADE_ABS_TOL:
            return [f"{road['id']}: grade disagrees with the elevations at s {s:.1f}"]
    return []


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
    errs += gaps_on_main_path(route, by_id)
    return errs


# Network bakes (tbgis network): junctions with connector roads, as src/road/validate.ts checks them.
JUNCTION_RADIUS_M = 250.0  # was 60: the shortcut rule's wide connectors (playtest 4, P4-4)
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
    errs += gaps_on_main_path(route, by_id)
    return errs
