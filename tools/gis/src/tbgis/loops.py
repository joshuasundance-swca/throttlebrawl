"""The junction-choice probe (run W-U): where the real map offers a way off a route and back on.

A network bake turns a real loop into a junction choice (``tbgis network``); this finds the loops.
Every junction on a route's real path (a node another public road meets) is a place to leave it.
From each, the shortest way through the other public roads (driveways, parking aisles and private
roads left out; the route's own segments removed; the search stops where it touches the route
again) is a loop when it comes back onto the route further along. A loop is a race choice, not a
way to skip the race, when it is 0.7 to 2 times the stretch it replaces (or up to 1.5 km longer),
and that stretch is at most 6 km (Key West's Boulevard replaces 4.5 km): a route that comes back
on itself (Russian Hill) has cross streets between its first and last legs that would skip nearly
all of it. A way that runs mostly on
the route's own street names is the other carriageway of a divided road, not a choice.

Nothing here touches a pack: it reads the cached extract a stretch or a network line bakes from.
"""

from __future__ import annotations

import heapq
from dataclasses import asdict, dataclass
from itertools import pairwise

from tbgis.config import BakeConfig
from tbgis.graph import Key, key
from tbgis.osm import Way, haversine_m
from tbgis.stretch import project_s, real_path
from tbgis.tmerc import Frame

PUBLIC = frozenset(
    {
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "unclassified",
        "residential",
        "living_street",
        "motorway_link",
        "trunk_link",
        "primary_link",
        "secondary_link",
        "tertiary_link",
    }
)
SEARCH_M = 8000.0  # the farthest a loop is followed
MIN_MAIN_M = 100.0  # a stretch shorter than this is one junction, not a choice
MAX_MAIN_M = 6000.0
MIN_RATIO = 0.7
MAX_RATIO = 2.0
MAX_LONGER_M = 1500.0
OWN_NAME_SHARE = 0.5
# More than this either way makes a shortcut or a detour (the game's ROUTE_BRANCH_ALTERNATE_M).
ALTERNATE_M = 15.0


@dataclass(frozen=True)
class Loop:
    leaveM: float  # noqa: N815 (metres along the route, from its start, where the loop leaves)
    joinM: float  # noqa: N815
    mainM: float  # noqa: N815 (the stretch of route it replaces)
    loopM: float  # noqa: N815
    streets: list[str]
    leave: tuple[float, float]  # (lat, lon) of the real junctions, for a network config
    join: tuple[float, float]

    @property
    def kind(self) -> str:
        gain = self.mainM - self.loopM
        return "alternate" if abs(gain) <= ALTERNATE_M else ("shortcut" if gain > 0 else "detour")

    def as_dict(self) -> dict[str, object]:
        return {**asdict(self), "kind": self.kind, "ratio": round(self.loopM / self.mainM, 3)}


def public(w: Way) -> bool:
    return w.tags.get("highway") in PUBLIC and w.tags.get("access") not in ("private", "no")


def street(w: Way) -> str:
    return w.tags.get("name") or w.tags.get("ref") or f"({w.tags.get('highway', 'road')})"


def find_loops(cfg: BakeConfig, ways: list[Way], max_streets: int | None = None) -> list[Loop]:
    """The real loops off the route a stretch config (or a network line) bakes, closest to the
    stretch they replace first; one per sequence of streets."""
    rp = real_path(cfg, ways)
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    s0 = project_s(rp, *frame.to_world(*cfg.start.tup()))
    s1 = project_s(rp, *frame.to_world(*cfg.end.tup()))
    verts = [key((float(a), float(b))) for a, b in zip(rp.lat, rp.lon, strict=True)]
    s_of: dict[Key, float] = {}
    for v, s in zip(verts, rp.cum, strict=True):
        if s0 <= s <= s1:
            s_of.setdefault(v, float(s))
    route_segs = {frozenset(p) for p in pairwise(verts)}
    own = {n for n in rp.names.values() if n}
    # The public roads both ways (a race closes the streets), without the route's own segments.
    adj: dict[Key, list[tuple[Key, float, str]]] = {}
    for w in ways:
        if not public(w):
            continue
        pts = [key(c) for c in w.coords]
        for a, b in pairwise(pts):
            if frozenset((a, b)) in route_segs:
                continue
            d = haversine_m(a, b)
            adj.setdefault(a, []).append((b, d, street(w)))
            adj.setdefault(b, []).append((a, d, street(w)))
    best: dict[tuple[str, ...], Loop] = {}
    for a, sa in sorted(s_of.items(), key=lambda kv: kv[1]):
        if a not in adj:
            continue
        dist: dict[Key, float] = {a: 0.0}
        prev: dict[Key, tuple[Key, float, str]] = {}
        heap: list[tuple[float, Key]] = [(0.0, a)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist.get(u, float("inf")) or d > SEARCH_M:
                continue
            if u != a and u in s_of:
                continue  # back on the route: a loop ends here
            for v, step, name in adj.get(u, []):
                if d + step < dist.get(v, float("inf")):
                    dist[v] = d + step
                    prev[v] = (u, step, name)
                    heapq.heappush(heap, (d + step, v))
        for b, sb in s_of.items():
            main = sb - sa
            if b not in dist or main < MIN_MAIN_M or main > MAX_MAIN_M:
                continue
            alt = dist[b]
            if alt < MIN_RATIO * main or alt > max(MAX_RATIO * main, main + MAX_LONGER_M):
                continue
            names: list[str] = []
            own_m = 0.0
            at = b
            while at != a:
                at, step, name = prev[at]
                own_m += step if name in own else 0.0
                if not names or names[-1] != name:
                    names.append(name)
            if own_m > OWN_NAME_SHARE * alt:
                continue  # the other carriageway of the route's own road
            names.reverse()
            # Distinct streets (a loop may come back onto one it used: Latourell Road, three times).
            if max_streets is not None and len(set(names)) > max_streets:
                continue
            lp = Loop(round(sa - s0, 1), round(sb - s0, 1), round(main, 1), round(alt, 1), names, a, b)
            sig = tuple(names)
            old = best.get(sig)
            if old is None or abs(lp.loopM / lp.mainM - 1) < abs(old.loopM / old.mainM - 1):
                best[sig] = lp
    return sorted(best.values(), key=lambda lp: (abs(lp.loopM / lp.mainM - 1), lp.leaveM))
