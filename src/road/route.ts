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
//
// Branches (W-Q contracts; interview, 2026-10-02: "junction choices in races", marked dirt
// shortcuts): every split zone on the main path that leads onto allowed roads is a branch, picked
// by the rider's position in the zone. The off-main-path allowed edges reachable from the zone make
// up the branch. A route file's `branches` entry names it (a stable id, its kind, marked or secret,
// a sign); one it does not name is derived, with the id of its first non-connector road.
import { ROUTE_BRANCH_ALTERNATE_M, type RoadSurface, type RouteBranchKind, type RouteQueries } from '../core';
import type { EdgeLink, RoadNetwork } from './network';
import type { BakedRoute } from './types';

/** A branch off the route's main path, as the race and the career see it. */
export interface RouteBranch {
  /** The route file's id for it, or (derived) the id of its first non-connector road. */
  id: string;
  kind: RouteBranchKind;
  /** Signed and drawn at the split; false for a secret, found by riding it. */
  marked: boolean;
  /** The sign at the split, or null. */
  sign: string | null;
  /**
   * The share of rivals that take it, 0 to 1, as the route file names it (playtest 3), or null: the
   * AI's own rule decides.
   */
  aiTake: number | null;
  /** What it is made of: the surface of its longest road (`dirt` for a marked dirt shortcut). */
  surface: RoadSurface;
  /** Its edges (connectors included), in the order reached from the split. */
  edges: readonly number[];
  /** Where a rider picks it by position: the split zone on the main path, or null if none leads in. */
  choice: RouteShortcut | null;
  /** Distance to finish saved by taking it, metres (negative for a longer way); 0 without a choice. */
  gainM: number;
  /** True when the route file names it. */
  declared: boolean;
}

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
  /** Branches off the main path (W-Q), in route order of their split; named ones not reached last. */
  readonly branches: readonly RouteBranch[];
  /** Distance from the start along the route (0 at the start line), or -Infinity off the route. */
  progressAt(edge: number, s: number): number;
  /** Whether the edge is in the route's allowed set. */
  allows(edge: number): boolean;
  /**
   * The direction along the edge's s that leads toward the finish: 1 or -1, or 0 off the route. A
   * mover's road `dir` times this is its heading sign on the route: 1 racing, -1 after a U-turn.
   */
  orientation(edge: number): 1 | -1 | 0;
  /** The branch an edge belongs to, or null on the main path and off the route. */
  branchAt(edge: number): RouteBranch | null;
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
  const branches = routeBranches(net, route, new Set(mainEdges), allowed, shortcuts);
  const branchOf = new Map<number, RouteBranch>();
  for (const b of branches) for (const e of b.edges) if (!branchOf.has(e)) branchOf.set(e, b);

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
    branches,
    progressAt,
    allows: (edge) => allowed.has(edge),
    orientation: (edge) => rows.get(edge)?.o ?? 0,
    branchAt: (edge) => branchOf.get(edge) ?? null,
    distanceToFinish,
    lanesAt: (edge, s) => net.lanesAt(edge, s),
    edgeLength: (edge) => net.edges[edge]?.length ?? NaN,
    kappaAt: (edge, s) => net.kappaAt(edge, s),
  };
}

/**
 * The route's branches: one per split zone on the main path (its edges are the allowed,
 * off-main-path edges reachable from the zone's connector), named by the route file's entry whose
 * roads it reaches, then any named branch no zone reaches (no choice, gain 0).
 */
function routeBranches(
  net: RoadNetwork,
  route: BakedRoute,
  main: ReadonlySet<number>,
  allowed: ReadonlySet<number>,
  shortcuts: readonly RouteShortcut[],
): RouteBranch[] {
  // A road the network lacks is the route lint's finding; here it is just left out.
  const index = (id: string): number => {
    try {
      return net.edgeIndex(id);
    } catch {
      return -1;
    }
  };
  const named = (route.branches ?? []).map((b) => ({
    b,
    edges: new Set(b.roads.map(index).filter((e) => e >= 0 && allowed.has(e))),
  }));
  const used = new Set<number>();
  const out: RouteBranch[] = [];
  const surfaceOf = (edges: readonly number[]): RoadSurface => {
    let best: { len: number; surface: RoadSurface } | null = null;
    for (const e of edges) {
      const edge = net.edges[e];
      if (edge && (!best || edge.length > best.len)) best = { len: edge.length, surface: edge.surface };
    }
    return best?.surface ?? 'asphalt';
  };
  const kindOf = (gain: number): RouteBranchKind =>
    gain > ROUTE_BRANCH_ALTERNATE_M ? 'shortcut' : gain < -ROUTE_BRANCH_ALTERNATE_M ? 'detour' : 'alternate';
  const claimed = new Set<number>();
  for (const zone of shortcuts) {
    if (claimed.has(zone.toEdge)) continue;
    // The branch: every allowed edge off the main path reachable from the zone's connector.
    const edges: number[] = [];
    const queue = [zone.toEdge];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const e = queue.shift() as number;
      edges.push(e);
      for (const end of ['to', 'from'] as const) {
        for (const l of net.nextEdges(e, end)) {
          if (seen.has(l.edge) || main.has(l.edge) || !allowed.has(l.edge)) continue;
          seen.add(l.edge);
          queue.push(l.edge);
        }
      }
    }
    for (const e of edges) claimed.add(e);
    const i = named.findIndex((n, k) => !used.has(k) && edges.some((e) => n.edges.has(e)));
    const n = i >= 0 ? named[i] : undefined;
    if (n) used.add(i);
    const firstRoad = edges.find((e) => net.edges[e]?.isConnector === false) ?? zone.toEdge;
    out.push({
      id: n?.b.id ?? net.edges[firstRoad]?.id ?? String(firstRoad),
      kind: n?.b.kind ?? kindOf(zone.gainM),
      marked: n?.b.marked ?? true,
      sign: n?.b.sign ?? null,
      aiTake: n?.b.aiTake ?? null,
      surface: surfaceOf(edges),
      edges,
      choice: zone,
      gainM: zone.gainM,
      declared: n !== undefined,
    });
  }
  named.forEach((n, i) => {
    if (used.has(i)) return;
    const edges = [...n.edges];
    out.push({
      id: n.b.id,
      kind: n.b.kind ?? 'alternate',
      marked: n.b.marked ?? true,
      sign: n.b.sign ?? null,
      aiTake: n.b.aiTake ?? null,
      surface: surfaceOf(edges),
      edges,
      choice: null,
      gainM: 0,
      declared: true,
    });
  });
  return out;
}
