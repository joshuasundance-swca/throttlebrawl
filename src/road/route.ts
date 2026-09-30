// Races as routes (docs/architecture.md, "Races as routes"): a distance-to-finish table over the
// route's allowed edges. Race progress, placing and rubber-banding all read this one number.
//
// The table (road-2):
//  - main-path edges, and the connector roads between consecutive main-path roads, measure the
//    distance along the main path;
//  - every other allowed edge (a shortcut and its connectors) measures the true distance forward
//    along itself to where it rejoins, plus the rejoined edge's distance there.
// So distance to finish falls steadily along either path and never rises: a rider who takes the
// shortcut gains its saving the moment it enters the shortcut's connector, and a rider who stays
// on the main path sees no jump at all. Progress is route length minus distance to finish.
import type { RouteQueries } from '../core';
import type { EdgeLink, RoadNetwork } from './network';
import type { BakedRoute } from './types';

/** A checkpoint on the route, with its progress (distance from the start). */
export interface RouteCheckpoint {
  edge: number;
  s: number;
  progress: number;
}

/** A split zone on the route that leads onto a shortcut, and what taking it saves. */
export interface RouteShortcut {
  /** The main-path edge the zone is on, its s range, and the d range that picks the shortcut. */
  edge: number;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  /** The connector edge the zone leads into. */
  toEdge: number;
  /** Distance to finish saved by taking it, metres (positive when it is a real shortcut). */
  gainM: number;
}

export interface RouteProgress extends RouteQueries {
  readonly routeId: string;
  /** Route length from the start position to the finish, in metres. */
  readonly length: number;
  readonly start: { edge: number; s: number; dir: 1 | -1 };
  readonly finish: { edge: number; s: number };
  /** Checkpoints in route order. */
  readonly checkpoints: readonly RouteCheckpoint[];
  /** The start grid from the route file, when it has one. */
  readonly startGrid: { rows: number; perRow: number; rowGapM: number } | null;
  /** The edges of the main path in order, connector roads included. */
  readonly mainEdges: readonly number[];
  /** Split zones leading onto shortcuts, in route order. */
  readonly shortcuts: readonly RouteShortcut[];
  /** Distance from the start along the route (0 at the start line), or -Infinity off the route. */
  progressAt(edge: number, s: number): number;
  /** Whether the edge is in the route's allowed set. */
  allows(edge: number): boolean;
}

/** One edge's row in the table: travel orientation along s and the distance to finish at its exit end. */
interface Row {
  o: 1 | -1;
  exitDtf: number;
}

export function createRouteProgress(net: RoadNetwork, route: BakedRoute): RouteProgress {
  const edgeLen = (e: number) => net.edges[e]?.length ?? 0;
  const allowed = new Set(route.allowedRoads.map((id) => net.edgeIndex(id)));

  // The main path, with the connector road (if any) between each pair of consecutive roads.
  const mainEdges: number[] = [];
  let prev = -1;
  for (const id of route.mainPath) {
    const edge = net.edgeIndex(id);
    if (prev >= 0) {
      const links = net.nextEdges(prev, 'to');
      const direct = links.find((l) => l.edge === edge && l.entersAt === 'from');
      const via = direct
        ? null
        : links.find(
            (l) =>
              !l.splitZone &&
              l.entersAt === 'from' &&
              net.nextEdges(l.edge, 'to').some((m) => m.edge === edge && m.entersAt === 'from'),
          );
      if (!direct && !via) {
        throw new Error(`route ${route.id}: ${id} does not follow the previous road end to end`);
      }
      if (via) mainEdges.push(via.edge);
    }
    mainEdges.push(edge);
    prev = edge;
  }
  const offsets = new Map<number, number>();
  let acc = 0;
  for (const e of mainEdges) {
    offsets.set(e, acc);
    acc += edgeLen(e);
  }
  const startEdge = net.edgeIndex(route.start.road);
  const finishEdge = net.edgeIndex(route.finish.road);
  const startAt = (offsets.get(startEdge) ?? 0) + route.start.s;
  const finishAt = (offsets.get(finishEdge) ?? 0) + route.finish.s;
  const length = finishAt - startAt;

  const rows = new Map<number, Row>();
  for (const e of mainEdges) rows.set(e, { o: 1, exitDtf: finishAt - ((offsets.get(e) ?? 0) + edgeLen(e)) });

  // Orient the other allowed edges: walk out of every oriented edge's exit end, in route order.
  const orient = new Map<number, 1 | -1>();
  const queue = [...mainEdges];
  const exitEnd = (o: 1 | -1) => (o === 1 ? 'to' : 'from');
  const orientOf = (e: number) => rows.get(e)?.o ?? orient.get(e);
  while (queue.length > 0) {
    const e = queue.shift() as number;
    const o = orientOf(e) ?? 1;
    for (const l of net.nextEdges(e, exitEnd(o))) {
      if (!allowed.has(l.edge) || rows.has(l.edge) || orient.has(l.edge)) continue;
      orient.set(l.edge, l.entersAt === 'from' ? 1 : -1);
      queue.push(l.edge);
    }
  }
  // Distance to finish at the point where a link enters its edge.
  const entryDtf = (l: EdgeLink): number => {
    const r = rows.get(l.edge);
    if (!r) return Infinity;
    const L = edgeLen(l.edge);
    const s = l.entersAt === 'from' ? 0 : L;
    return r.exitDtf + (r.o === 1 ? L - s : s);
  };
  // Rows for the oriented edges, following each exit end until it reaches a known row.
  const resolve = (e: number, seen: Set<number>): void => {
    if (rows.has(e) || seen.has(e)) return;
    seen.add(e);
    const o = orient.get(e) ?? 1;
    let best = Infinity;
    for (const l of net.nextEdges(e, exitEnd(o))) {
      if (!allowed.has(l.edge)) continue;
      resolve(l.edge, seen);
      best = Math.min(best, entryDtf(l));
    }
    if (best < Infinity) rows.set(e, { o, exitDtf: best });
  };
  for (const e of [...orient.keys()].sort((p, q) => p - q)) resolve(e, new Set());

  const distanceToFinish = (edge: number, s: number): number => {
    const r = rows.get(edge);
    if (!r) return Infinity;
    return r.exitDtf + (r.o === 1 ? edgeLen(edge) - s : s);
  };
  const progressAt = (edge: number, s: number): number => {
    const dtf = distanceToFinish(edge, s);
    return dtf === Infinity ? -Infinity : length - dtf;
  };

  const shortcuts: RouteShortcut[] = [];
  for (const zone of net.splitZones()) {
    if (!rows.has(zone.edge) || !offsets.has(zone.edge) || !rows.has(zone.toEdge)) continue;
    const L = edgeLen(zone.edge);
    const here = distanceToFinish(zone.edge, zone.end === 'to' ? L : 0);
    const link = net.nextEdges(zone.edge, zone.end).find((l) => l.edge === zone.toEdge);
    if (!link) continue;
    shortcuts.push({
      edge: zone.edge,
      s0: zone.s0,
      s1: zone.s1,
      d0: zone.d0,
      d1: zone.d1,
      toEdge: zone.toEdge,
      gainM: here - entryDtf(link),
    });
  }
  shortcuts.sort((a, b) => progressAt(a.edge, a.s0) - progressAt(b.edge, b.s0));

  const checkpoints = (route.checkpoints ?? [])
    .map((c) => {
      const edge = net.edgeIndex(c.road);
      return { edge, s: c.s, progress: progressAt(edge, c.s) };
    })
    .sort((a, b) => a.progress - b.progress);
  const grid = route.startGrid;
  return {
    routeId: route.id,
    length,
    start: { edge: startEdge, s: route.start.s, dir: route.start.dir },
    finish: { edge: finishEdge, s: route.finish.s },
    checkpoints,
    startGrid: grid ? { rows: grid.rows, perRow: grid.perRow, rowGapM: grid.rowGapM } : null,
    mainEdges,
    shortcuts,
    progressAt,
    allows: (edge) => allowed.has(edge),
    distanceToFinish,
    lanesAt: (edge, s) => net.lanesAt(edge, s),
    edgeLength: (edge) => net.edges[edge]?.length ?? NaN,
    kappaAt: (edge, s) => net.kappaAt(edge, s),
  };
}
