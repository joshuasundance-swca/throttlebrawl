// Races as routes (docs/architecture.md, "Races as routes"): a distance-to-finish table over the
// route's edges. Race progress, placing and rubber-banding all read this one number. M1 app-1
// covers a main path of edges joined the same way round; road-2 adds the shortcut's edges.
import type { RouteQueries } from '../core';
import type { RoadNetwork } from './network';
import type { BakedRoute } from './types';

/** A checkpoint on the route, with its progress (distance from the start). */
export interface RouteCheckpoint {
  edge: number;
  s: number;
  progress: number;
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
  /** Distance from the start along the route (0 at the start line), or -Infinity off the route. */
  progressAt(edge: number, s: number): number;
  /** Whether the edge is in the route's allowed set. */
  allows(edge: number): boolean;
}

export function createRouteProgress(net: RoadNetwork, route: BakedRoute): RouteProgress {
  // Cumulative distance at s = 0 of each main-path edge.
  const offsets = new Map<number, number>();
  let acc = 0;
  let prev = -1;
  for (const id of route.mainPath) {
    const edge = net.edgeIndex(id);
    if (prev >= 0) {
      const link = net.edges[prev]?.next;
      if (!link || link.edge !== edge || link.entersAt !== 'from') {
        throw new Error(`route ${route.id}: ${id} does not follow the previous road end to end`);
      }
    }
    offsets.set(edge, acc);
    acc += net.edges[edge]?.length ?? 0;
    prev = edge;
  }
  const allowed = new Set(route.allowedRoads.map((id) => net.edgeIndex(id)));
  const startEdge = net.edgeIndex(route.start.road);
  const finishEdge = net.edgeIndex(route.finish.road);
  const startAt = (offsets.get(startEdge) ?? 0) + route.start.s;
  const finishAt = (offsets.get(finishEdge) ?? 0) + route.finish.s;

  const progressAt = (edge: number, s: number): number => {
    const off = offsets.get(edge);
    return off === undefined ? -Infinity : off + s - startAt;
  };
  const checkpoints = (route.checkpoints ?? [])
    .map((c) => {
      const edge = net.edgeIndex(c.road);
      return { edge, s: c.s, progress: progressAt(edge, c.s) };
    })
    .sort((a, b) => a.progress - b.progress);
  const grid = route.startGrid;
  return {
    routeId: route.id,
    length: finishAt - startAt,
    start: { edge: startEdge, s: route.start.s, dir: route.start.dir },
    finish: { edge: finishEdge, s: route.finish.s },
    checkpoints,
    startGrid: grid ? { rows: grid.rows, perRow: grid.perRow, rowGapM: grid.rowGapM } : null,
    progressAt,
    allows: (edge) => allowed.has(edge),
    distanceToFinish: (edge, s) => {
      const off = offsets.get(edge);
      return off === undefined ? Infinity : finishAt - (off + s);
    },
    lanesAt: (edge, s) => net.lanesAt(edge, s),
    edgeLength: (edge) => net.edges[edge]?.length ?? NaN,
    kappaAt: (edge, s) => net.kappaAt(edge, s),
  };
}
