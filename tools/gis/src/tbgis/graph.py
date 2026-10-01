"""A directed graph over OSM ways, and the travel path between two points.

Nodes are matched by their exact coordinates (``out tags geom`` gives geometry, not node ids;
shared nodes carry identical coordinates). One-way ways are traversed forward only (``-1``
backward only); others both ways. On a dual carriageway the path therefore follows the
carriageway for its direction of travel, which is the line a rider actually drives.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from itertools import pairwise

from tbgis.osm import Way, haversine_m

type Key = tuple[float, float]


def key(p: tuple[float, float]) -> Key:
    return (round(p[0], 7), round(p[1], 7))


@dataclass(frozen=True)
class Step:
    """One path segment: from ``a`` to ``b`` along way ``way``."""

    a: Key
    b: Key
    way: Way
    length_m: float


class Graph:
    def __init__(self, ways: list[Way], *, respect_oneway: bool = True) -> None:
        self.out: dict[Key, list[Step]] = {}
        for w in ways:
            pts = [key(c) for c in w.coords]
            direction = w.tags.get("oneway") if respect_oneway else None
            forward = direction != "-1"
            backward = direction not in ("yes", "1", "true", "-1") or direction == "-1"
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]
                d = haversine_m(a, b)
                if forward:
                    self.out.setdefault(a, []).append(Step(a, b, w, d))
                if backward:
                    self.out.setdefault(b, []).append(Step(b, a, w, d))
                self.out.setdefault(a, [])
                self.out.setdefault(b, [])

    def nearest(self, p: tuple[float, float]) -> Key:
        return min(self.out, key=lambda k: haversine_m(k, p))

    def path(self, start: tuple[float, float], end: tuple[float, float]) -> list[Step]:
        """Shortest drivable path from the node nearest ``start`` to the node nearest ``end``."""
        src, dst = self.nearest(start), self.nearest(end)
        dist: dict[Key, float] = {src: 0.0}
        prev: dict[Key, Step] = {}
        heap: list[tuple[float, Key]] = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == dst:
                break
            if d > dist.get(u, float("inf")):
                continue
            for st in self.out[u]:
                nd = d + st.length_m
                if nd < dist.get(st.b, float("inf")):
                    dist[st.b] = nd
                    prev[st.b] = st
                    heapq.heappush(heap, (nd, st.b))
        if dst not in prev and dst != src:
            raise ValueError(f"no drivable path from {src} to {dst}")
        steps: list[Step] = []
        at = dst
        while at != src:
            st = prev[at]
            steps.append(st)
            at = st.a
        steps.reverse()
        return steps


def path_via(graph: Graph, points: list[tuple[float, float]]) -> list[Step]:
    """The shortest drivable path through each point in turn; a U-turn at a waypoint is refused.

    The road format has no U-turns (a dead end is a barrier), so a waypoint placed where the next
    leg would double straight back is a config error, reported with the waypoint.
    """
    steps: list[Step] = []
    for a, b in pairwise(points):
        leg = graph.path(a, b)
        if steps and leg and leg[0].b == steps[-1].a:
            raise ValueError(f"the path makes a U-turn at waypoint {a}; move the waypoint")
        steps += leg
    return steps


def degrees(ways: list[Way]) -> dict[Key, int]:
    """Undirected degree of every node: how many distinct neighbours any way gives it."""
    nbrs: dict[Key, set[Key]] = {}
    for w in ways:
        pts = [key(c) for c in w.coords]
        for a, b in pairwise(pts):
            if a != b:
                nbrs.setdefault(a, set()).add(b)
                nbrs.setdefault(b, set()).add(a)
    return {k: len(v) for k, v in nbrs.items()}
