// The traffic corridor: the chain of road edges traffic lives on, as one straight coordinate `u`.
// Built once at race start by walking the network's junction links from the route's start edge,
// both ways, taking at each junction only a road that has drive lanes and no shortcut lane, and
// preferring the route's own roads (docs/milestones/M1.md, traffic-1 and road-2: "vehicles never
// route onto shortcut lanes, and take only drive-lane connectors, in both directions").
//
// Each chain link has an orientation `o`: +1 when u grows with the edge's s, -1 when a junction
// joined the edge the other way round. A corridor direction `c` (+1 toward growing u) maps to an
// edge direction `c·o`, and a corridor lateral offset `cd` to an edge offset `cd·o`, so a vehicle
// crosses any junction without special cases and never loses or doubles distance.
import type { EdgeLink, RoadNetwork, RoadPos } from '../../road';
import type { SimConfig } from '../types';

/** Plain data (kept in sim state, so it hashes and serializes). */
export interface Corridor {
  edges: number[];
  /** Orientation per link, +1 or -1. */
  o: number[];
  /** u at the start of each link. */
  off: number[];
  len: number[];
  length: number;
  /** The route's travel direction in corridor terms (+1 or -1). */
  routeDir: number;
  /**
   * The span traffic uses, lo..hi in u. It ends at the finish line: past it, finished riders roll
   * to a stop at the road's end, and cars queued behind them would wall off the line itself.
   */
  lo: number;
  hi: number;
}

/** A drive lane in corridor terms. */
export interface CorridorLane {
  cd: number;
  width: number;
}

function edgeLanes(road: RoadNetwork, edge: number) {
  const e = road.edges[edge];
  return e ? e.sections.flatMap((s) => s.lanes) : [];
}

/** Traffic may enter an edge only if it has a drive lane and no shortcut lane anywhere on it. */
export function trafficMayEnter(road: RoadNetwork, edge: number): boolean {
  const lanes = edgeLanes(road, edge);
  return lanes.some((l) => l.kind === 'drive') && !lanes.some((l) => l.kind === 'shortcut');
}

/**
 * Route choice at a junction: among the links out of an edge end, the first road traffic may
 * enter, preferring the route's roads, then the lowest edge index (so the choice is deterministic).
 */
export function pickLink(
  road: RoadNetwork,
  links: readonly EdgeLink[],
  onRoute: (edge: number) => boolean,
): EdgeLink | null {
  const ok = links.filter((l) => trafficMayEnter(road, l.edge));
  ok.sort((a, b) => Number(onRoute(b.edge)) - Number(onRoute(a.edge)) || a.edge - b.edge);
  return ok[0] ?? null;
}

export function buildCorridor(config: SimConfig): Corridor {
  const road = config.road;
  const route = config.route;
  const onRoute = (edge: number) => route.allows(edge);
  const start = route.start.edge;
  const visited = new Set<number>([start]);
  // Forward: from the start edge's `to` end (orientation +1 on the start edge).
  const fwd: { edge: number; o: number }[] = [];
  let cur = { edge: start, o: 1 };
  for (;;) {
    const link = pickLink(road, road.nextEdges(cur.edge, cur.o === 1 ? 'to' : 'from'), onRoute);
    if (!link || visited.has(link.edge)) break;
    visited.add(link.edge);
    cur = { edge: link.edge, o: link.entersAt === 'from' ? 1 : -1 };
    fwd.push(cur);
  }
  // Backward: from the start edge's `from` end.
  const back: { edge: number; o: number }[] = [];
  cur = { edge: start, o: 1 };
  for (;;) {
    const link = pickLink(road, road.nextEdges(cur.edge, cur.o === 1 ? 'from' : 'to'), onRoute);
    if (!link || visited.has(link.edge)) break;
    visited.add(link.edge);
    cur = { edge: link.edge, o: link.entersAt === 'to' ? 1 : -1 };
    back.push(cur);
  }
  const chain = [...back.reverse(), { edge: start, o: 1 }, ...fwd];
  const corridor: Corridor = {
    edges: [],
    o: [],
    off: [],
    len: [],
    length: 0,
    routeDir: route.start.dir,
    lo: 0,
    hi: 0,
  };
  for (const link of chain) {
    const len = road.edges[link.edge]?.length ?? 0;
    corridor.edges.push(link.edge);
    corridor.o.push(link.o);
    corridor.off.push(corridor.length);
    corridor.len.push(len);
    corridor.length += len;
  }
  corridor.hi = corridor.length;
  const finish = toCorridor(corridor, { edge: route.finish.edge, s: route.finish.s, d: 0, dir: 1 });
  if (finish) {
    if (corridor.routeDir === 1) corridor.hi = finish.u;
    else corridor.lo = finish.u;
  }
  return corridor;
}

/** The chain index holding an edge, or -1 when the edge is off the corridor. */
export function linkOf(c: Corridor, edge: number): number {
  return c.edges.indexOf(edge);
}

/** Corridor coordinates of a road position, or null off the corridor. */
export function toCorridor(c: Corridor, pos: RoadPos): { u: number; cd: number; dir: number } | null {
  const i = linkOf(c, pos.edge);
  if (i < 0) return null;
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  return { u: off + (o === 1 ? pos.s : len - pos.s), cd: pos.d * o, dir: pos.dir * o };
}

/** The chain index containing u (clamped to the corridor). */
export function linkAt(c: Corridor, u: number): number {
  let i = 0;
  while (i < c.edges.length - 1 && u >= (c.off[i + 1] ?? Infinity)) i++;
  return i;
}

/** Writes the road position of corridor coordinates into `pos` (u is clamped to the corridor). */
export function fromCorridor(c: Corridor, u: number, cd: number, dir: number, pos: RoadPos): void {
  const uu = u < 0 ? 0 : u > c.length ? c.length : u;
  const i = linkAt(c, uu);
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  let s = o === 1 ? uu - off : off + len - uu;
  s = s < 0 ? 0 : s > len ? len : s;
  pos.edge = c.edges[i] ?? 0;
  pos.s = s;
  pos.d = cd * o;
  pos.dir = dir * o === -1 ? -1 : 1;
}

/**
 * Drive lanes at u carrying corridor direction `dir`, innermost (nearest the centre line) first.
 * Rank 0 is the innermost lane; a lane change moves one rank.
 */
export function lanesAt(road: RoadNetwork, c: Corridor, u: number, dir: number): CorridorLane[] {
  const i = linkAt(c, u < 0 ? 0 : u > c.length ? c.length : u);
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  const s = o === 1 ? u - off : off + len - u;
  return road
    .lanesAt(c.edges[i] ?? 0, s)
    .filter((l) => l.kind === 'drive' && l.direction * o === dir)
    .map((l) => ({ cd: l.dCenterM * o, width: l.widthM }))
    .sort((a, b) => Math.abs(a.cd) - Math.abs(b.cd) || a.cd - b.cd);
}
