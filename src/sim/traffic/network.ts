// Bounded committed paths are coordinate views over ONE physical population. No per-road pools,
// race-progress collision coordinate, complete-route enumeration or population RNG consumption.
import type { LaneTransition, RoadNetwork, RoadPos } from '../../road';
import type { SimConfig } from '../types';
import { buildCorridor, fromCorridor, type Corridor } from './corridor';

export interface TrafficGraph {
  enabled: boolean;
  rows: { plus: LaneTransition[]; minus: LaneTransition[] }[];
  reference: Corridor;
  allowed: number[];
  viable: { plus: boolean; minus: boolean }[];
  windowLinks: { edge: number; exitsAt: 'from' | 'to'; entersAt: 'from' | 'to' }[][];
}

export interface TrafficPath {
  c: Corridor;
  /** Lane of each committed edge, and source lane at each exit. */
  lane: string[];
  exitLane: string[];
  occurrence: number;
  terminal: boolean;
  currentEdge?: number;
  /** Directed edges already committed, bounded by the network rather than journey length. */
  visited?: number[];
}

const graphs = new WeakMap<SimConfig['route'], TrafficGraph>();

export function buildTrafficGraph(config: Pick<SimConfig, 'road' | 'route'>): TrafficGraph {
  const cached = graphs.get(config.route);
  if (cached) return cached;
  const reference = buildCorridor(config as SimConfig);
  const extra = new Set(config.route.trafficRoads);
  const excluded = new Set(config.route.trafficExcludedRoads);
  const baseline = reference.edges.filter(
    (_e, i) =>
      (reference.off[i] ?? 0) < reference.hi &&
      (reference.off[i] ?? 0) + (reference.len[i] ?? 0) > reference.lo,
  );
  const allowed = new Set([...baseline, ...extra]);
  for (const e of excluded) allowed.delete(e);
  const road = config.road;
  const permitted = (e: number) => allowed.has(e) && !road.featuresOf(e, 'gap').length;
  const rows = road.edges.map((e) => ({
    plus: permitted(e.index) ? road.laneTransitions(e.index, 'to').filter((r) => permitted(r.edge)) : [],
    minus: permitted(e.index) ? road.laneTransitions(e.index, 'from').filter((r) => permitted(r.edge)) : [],
  }));
  const viable = road.edges.map((e) => {
    const i = reference.edges.indexOf(e.index);
    if (i < 0) return { plus: false, minus: false };
    const a = reference.off[i] ?? 0;
    const b = a + (reference.len[i] ?? 0);
    const o = reference.o[i] ?? 1;
    return {
      plus: (o === 1 ? reference.hi : reference.lo) >= a && (o === 1 ? reference.hi : reference.lo) <= b,
      minus: (o === -1 ? reference.hi : reference.lo) >= a && (o === -1 ? reference.hi : reference.lo) <= b,
    };
  });
  // A finite finish inside an edge is an exit, even if the authored road continues into a lap.
  rows.forEach((row, edge) => {
    if (viable[edge]?.plus) row.plus = [];
    if (viable[edge]?.minus) row.minus = [];
  });
  for (let pass = 0; pass < road.edges.length * 2; pass++) {
    let changed = false;
    rows.forEach((row, edge) => {
      for (const direction of ['plus', 'minus'] as const) {
        if (viable[edge]?.[direction]) continue;
        if (row[direction].some((l) => viable[l.edge]?.[l.entersAt === 'from' ? 'plus' : 'minus'])) {
          viable[edge]![direction] = true;
          changed = true;
        }
      }
    });
    if (!changed) break;
  }
  rows.forEach((row) => {
    for (const direction of ['plus', 'minus'] as const)
      row[direction] = row[direction].filter(
        (l) => viable[l.edge]?.[l.entersAt === 'from' ? 'plus' : 'minus'],
      );
  });
  const reachable = road.edges.map((e) => ({
    plus:
      baseline.includes(e.index) &&
      e.sections.some((s) => s.lanes.some((l) => l.kind === 'drive' && l.direction === 1)),
    minus:
      baseline.includes(e.index) &&
      e.sections.some((s) => s.lanes.some((l) => l.kind === 'drive' && l.direction === -1)),
  }));
  for (let pass = 0; pass < road.edges.length * 2; pass++) {
    let changed = false;
    rows.forEach((row, edge) => {
      for (const direction of ['plus', 'minus'] as const) {
        if (!reachable[edge]?.[direction]) continue;
        for (const l of row[direction]) {
          const travel = l.entersAt === 'from' ? 'plus' : 'minus';
          if (!reachable[l.edge]?.[travel]) {
            reachable[l.edge]![travel] = true;
            changed = true;
          }
        }
      }
    });
    if (!changed) break;
  }
  viable.forEach((v, e) => {
    v.plus &&= reachable[e]?.plus ?? false;
    v.minus &&= reachable[e]?.minus ?? false;
  });
  const windowLinks: TrafficGraph['windowLinks'] = road.edges.map(() => []);
  const connect = (from: number, exitsAt: 'from' | 'to', to: number, entersAt: 'from' | 'to') => {
    const list = windowLinks[from];
    if (list && !list.some((l) => l.edge === to && l.exitsAt === exitsAt && l.entersAt === entersAt))
      list.push({ edge: to, exitsAt, entersAt });
  };
  rows.forEach((row, source) => {
    for (const [end, links] of [
      ['to', row.plus],
      ['from', row.minus],
    ] as const)
      for (const l of links) {
        connect(source, end, l.edge, l.entersAt);
        connect(l.edge, l.entersAt, source, end);
      }
  });
  const graph = {
    enabled: extra.size > 0 || excluded.size > 0,
    reference,
    rows,
    allowed: [...allowed].filter(
      (e) => permitted(e) && (baseline.includes(e) || viable[e]?.plus || viable[e]?.minus),
    ),
    viable,
    windowLinks,
  };
  graphs.set(config.route, graph);
  return graph;
}

/** A stable local choice stream. A sole continuation consumes no random state. */
function choice(seed: number, entity: number, generation: number, occurrence: number): number {
  let h =
    (seed ^
      Math.imul(entity + 1, 0x9e3779b9) ^
      Math.imul(generation + 1, 0x85ebca6b) ^
      Math.imul(occurrence + 1, 0xc2b2ae35)) >>>
    0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Build/extend only the actual chosen itinerary, bounded in metres and edge occurrences. */
export function commitPath(
  road: RoadNetwork,
  graph: TrafficGraph,
  pos: RoadPos,
  seed: number,
  entity: number,
  generation: number,
  aheadM: number,
  previous?: TrafficPath,
): TrafficPath {
  const path: TrafficPath = previous ?? {
    c: {
      edges: [pos.edge],
      o: [pos.dir],
      off: [0],
      len: [road.edges[pos.edge]?.length ?? 0],
      length: road.edges[pos.edge]?.length ?? 0,
      routeDir: 1,
      lo: 0,
      hi: road.edges[pos.edge]?.length ?? 0,
      dOff: [0],
    },
    lane: [nearestLane(road, pos)],
    exitLane: [],
    occurrence: 0,
    terminal: false,
  };
  const c = path.c;
  path.visited ??= c.edges.map((e, i) => e * 2 + (c.o[i] === 1 ? 0 : 1));
  const last = c.edges.length - 1;
  const refLast = graph.reference.edges.indexOf(c.edges[last] ?? -1);
  if (refLast >= 0) {
    const refO = graph.reference.o[refLast] ?? 1;
    const refOff = graph.reference.off[refLast] ?? 0;
    const refLen = graph.reference.len[refLast] ?? 0;
    const bound = (c.o[last] ?? 1) * refO === 1 ? graph.reference.hi : graph.reference.lo;
    if (bound >= refOff && bound <= refOff + refLen) {
      const s = refO === 1 ? bound - refOff : refOff + refLen - bound;
      c.hi = (c.off[last] ?? 0) + (c.o[last] === 1 ? s : (c.len[last] ?? 0) - s);
      path.terminal = true;
    }
  }
  const current = c.edges.findIndex((edge, i) => edge === pos.edge && c.o[i] === pos.dir);
  const u = (c.off[current] ?? 0) + (pos.dir > 0 ? pos.s : (c.len[current] ?? 0) - pos.s);
  // Retain enough rear geometry for long bodies and nearby contacts. Offsets stay absolute:
  // trimming cannot move a vehicle, change a committed choice or recycle a visited cycle.
  let cleared = 0;
  while (cleared + 1 < c.edges.length && (c.off[cleared + 1] ?? Infinity) < u - 120) cleared++;
  if (cleared > 0) {
    for (const list of [c.edges, c.o, c.off, c.len, c.dOff, path.lane, path.exitLane])
      list?.splice(0, cleared);
    c.lo = c.off[0] ?? 0;
  }
  for (let guard = 0; !path.terminal && c.length - u < aheadM && guard < 64; guard++) {
    const i = c.edges.length - 1;
    const edge = c.edges[i] ?? pos.edge;
    const o = c.o[i] ?? 1;
    const all = o === 1 ? graph.rows[edge]?.plus : graph.rows[edge]?.minus;
    const canExit = (start: LaneTransition): boolean => {
      const pending = [start.edge * 2 + (start.entersAt === 'from' ? 0 : 1)];
      const seen = new Set(path.visited);
      for (let head = 0; head < pending.length; head++) {
        const key = pending[head]!;
        if (seen.has(key)) continue;
        seen.add(key);
        const onward =
          key % 2 === 0 ? graph.rows[Math.floor(key / 2)]?.plus : graph.rows[Math.floor(key / 2)]?.minus;
        if (onward?.length === 0) return true;
        for (const link of onward ?? []) pending.push(link.edge * 2 + (link.entersAt === 'from' ? 0 : 1));
      }
      return false;
    };
    const alternatives = (all ?? []).filter((r) => {
      // Reject a short cycle: finite traffic has no persistent loop. Old closed-route bounds are
      // retained by stopping at the same reference endpoints, not by following the race's lap.
      return !path.visited!.includes(r.edge * 2 + (r.entersAt === 'from' ? 0 : 1)) && canExit(r);
    });
    const distinct = [...new Set(alternatives.map((r) => `${r.edge}:${r.entersAt}`))];
    const movement =
      distinct[Math.floor(choice(seed, entity, generation, path.occurrence) * distinct.length)];
    const matching = alternatives.filter((r) => `${r.edge}:${r.entersAt}` === movement);
    const row = matching.find((r) => r.fromLane === path.lane[i]) ?? matching[0];
    if (!row) {
      path.terminal = true;
      break;
    }
    path.exitLane[i] = row.fromLane;
    const targetO = row.entersAt === 'from' ? 1 : -1;
    const sigma = o * targetO;
    const shift = sigma * (c.dOff?.[i] ?? 0) + (row.dShift ?? 0);
    c.edges.push(row.edge);
    path.visited.push(row.edge * 2 + (targetO === 1 ? 0 : 1));
    c.o.push(targetO);
    c.off.push(c.length);
    c.len.push(road.edges[row.edge]?.length ?? 0);
    c.dOff?.push(shift);
    c.length += road.edges[row.edge]?.length ?? 0;
    c.hi = c.length;
    path.lane.push(row.toLane);
    path.occurrence++;
    // The reference's finite finish clips this path too, despite different branch length.
    const refI = graph.reference.edges.indexOf(row.edge);
    if (refI >= 0) {
      const refO = graph.reference.o[refI] ?? 1;
      const refStart = graph.reference.off[refI] ?? 0;
      const refLen = graph.reference.len[refI] ?? 0;
      const bound = targetO * refO === 1 ? graph.reference.hi : graph.reference.lo;
      if (bound >= refStart && bound <= refStart + refLen) {
        const s = refO === 1 ? bound - refStart : refStart + refLen - bound;
        const along = targetO === 1 ? s : (c.len.at(-1) ?? 0) - s;
        c.hi = (c.off.at(-1) ?? 0) + along;
        path.terminal = true;
      }
    }
  }
  return path;
}

export function nearestLane(road: RoadNetwork, pos: RoadPos): string {
  return (
    [...road.lanesAt(pos.edge, pos.s)]
      .filter((l) => l.direction === pos.dir && (l.kind === 'drive' || l.kind === 'shortcut'))
      .sort(
        (a, b) => Math.abs(a.dCenterM - pos.d) - Math.abs(b.dCenterM - pos.d) || a.id.localeCompare(b.id),
      )[0]?.id ?? ''
  );
}

export function pathPosition(path: TrafficPath, u: number, cd: number): RoadPos {
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  fromCorridor(path.c, u, cd, 1, pos);
  return pos;
}
