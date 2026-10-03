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

/**
 * Corridor coordinates of a rider (run W-U fixes' re-check): its own road position on the corridor,
 * or else, where its ground point lies on a corridor road's asphalt at the same height (within
 * `heightM`), the corridor position of that point, with `over` true. #423 bent the Keys boardwalk's
 * and sandbar's ends across the main road, and a rider still on the branch road there had no
 * contact with the cars it rode through. Null when the rider is on no corridor road at all.
 */
export function riderOnCorridor(
  road: RoadNetwork,
  c: Corridor,
  pos: RoadPos,
  heightM: number,
): { u: number; cd: number; dir: number; over: boolean } | null {
  const own = toCorridor(c, pos);
  if (own) return { ...own, over: false };
  const under = road.surfaceUnder(pos, heightM, (edge) => linkOf(c, edge) >= 0);
  const p = under ? toCorridor(c, under) : null;
  return p ? { ...p, over: true } : null;
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
 * How many drive lanes each way the corridor has along its length (W-R multi-lane roads): segment
 * starts in u (ascending) and the lane counts toward +u (`plus`) and -u (`minus`) on each segment,
 * neighbours with equal counts merged. Built exactly from the lane sections, so a road with one lane
 * each way all along is one segment.
 */
export interface LaneMap {
  u0: number[];
  plus: number[];
  minus: number[];
}

export function buildLaneMap(road: RoadNetwork, c: Corridor): LaneMap {
  const segs: { u0: number; plus: number; minus: number }[] = [];
  c.edges.forEach((edge, i) => {
    const e = road.edges[edge];
    if (!e) return;
    const o = c.o[i] ?? 1;
    const off = c.off[i] ?? 0;
    const len = c.len[i] ?? 0;
    e.sections.forEach((sec, j) => {
      const clampS = (s: number) => (s < 0 ? 0 : s > len ? len : s);
      const s0 = j === 0 ? 0 : clampS(sec.s0);
      const next = e.sections[j + 1];
      const s1 = next ? clampS(next.s0) : len;
      if (s1 <= s0) return;
      let plus = 0;
      let minus = 0;
      for (const l of sec.lanes) {
        if (l.kind !== 'drive') continue;
        if (l.direction * o === 1) plus++;
        else minus++;
      }
      segs.push({ u0: o === 1 ? off + s0 : off + len - s1, plus, minus });
    });
  });
  segs.sort((a, b) => a.u0 - b.u0);
  const out: LaneMap = { u0: [], plus: [], minus: [] };
  for (const s of segs) {
    const n = out.u0.length;
    if (n > 0 && out.plus[n - 1] === s.plus && out.minus[n - 1] === s.minus) continue;
    out.u0.push(s.u0);
    out.plus.push(s.plus);
    out.minus.push(s.minus);
  }
  return out;
}

/**
 * How far ahead (in corridor direction `dir`) the lane of `rank` ends, within `range` metres: 0 when
 * it has already ended at u, Infinity when it goes on past the range (W-R multi-lane roads).
 */
export function laneEndOnMap(m: LaneMap, u: number, dir: number, rank: number, range: number): number {
  const n = m.u0.length;
  if (n === 0) return Infinity;
  const count = dir === 1 ? m.plus : m.minus;
  let i = 0;
  while (i + 1 < n && (m.u0[i + 1] ?? Infinity) <= u) i++;
  if ((count[i] ?? 0) <= rank) return 0;
  if (dir === 1) {
    for (let j = i + 1; j < n; j++) {
      const at = (m.u0[j] ?? 0) - u;
      if (at > range) return Infinity;
      if ((count[j] ?? 0) <= rank) return at;
    }
  } else {
    for (let j = i - 1; j >= 0; j--) {
      const at = u - (m.u0[j + 1] ?? 0);
      if (at > range) return Infinity;
      if ((count[j] ?? 0) <= rank) return at;
    }
  }
  return Infinity;
}

/** How many drive lanes carry corridor direction `dir` at u, from the lane map (W-R). */
export function laneCountOnMap(m: LaneMap, u: number, dir: number): number {
  const n = m.u0.length;
  if (n === 0) return 0;
  let i = 0;
  while (i + 1 < n && (m.u0[i + 1] ?? Infinity) <= u) i++;
  return (dir === 1 ? m.plus[i] : m.minus[i]) ?? 0;
}

/**
 * Lane-metres past one lane per direction between a and b (W-R): what a stretch with more lanes adds
 * to a direction's traffic. 0 on a road with one lane each way.
 */
export function extraLaneMetres(m: LaneMap, a: number, b: number, dir: number): number {
  const count = dir === 1 ? m.plus : m.minus;
  let extra = 0;
  for (let j = 0; j < m.u0.length; j++) {
    const lanes = count[j] ?? 0;
    if (lanes <= 1) continue;
    const lo = Math.max(a, m.u0[j] ?? 0);
    const hi = Math.min(b, m.u0[j + 1] ?? Infinity);
    if (hi > lo) extra += (hi - lo) * (lanes - 1);
  }
  return extra;
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
