import type { SimConfig } from '../types';
import type { World } from '../world';
import { lanesAt, toCorridor } from './corridor';
import { isKerb, isParked, kerbAhead, laneClear, typeOf, type TrafficState } from './index';
import { buildTrafficGraph, type TrafficGraph } from './network';

const incomingCache = new WeakMap<TrafficGraph, Map<string, Set<string>>>();

/** Resolve requests from phase-start occupancy, before any mover advances. */
export function mergeStops(world: World, config: SimConfig, st: TrafficState): number[] {
  const graph = buildTrafficGraph(config);
  let incoming = incomingCache.get(graph);
  if (!incoming) {
    incoming = new Map<string, Set<string>>();
    graph.rows.forEach((row, source) => {
      for (const [dir, links] of [
        [1, row.plus],
        [-1, row.minus],
      ] as const)
        for (const l of links) {
          const key = `${l.edge}:${l.entersAt}:${l.toLane}`;
          const set = incoming!.get(key) ?? new Set<string>();
          set.add(`${source}:${dir}:${l.fromLane}`);
          incoming!.set(key, set);
        }
    });
    incomingCache.set(graph, incoming);
  }
  const requests: { k: number; key: string; at: number; edge: number; lane: string }[] = [];
  const stops = st.id.map(() => Infinity);
  for (let k = 0; k < st.id.length; k++) {
    const path = st.paths[k];
    const mover = world.movers[st.id[k] ?? -1];
    if (isParked(typeOf(config, st, k))) {
      st.waitTick[k] = -1;
      st.reservation[k] = '';
      continue;
    }
    if (!path || !mover || st.owner[k]) continue;
    const c = path.c;
    const p = toCorridor(c, mover.pos);
    if (!p) continue;
    const half = typeOf(config, st, k).lengthM / 2;
    let request: (typeof requests)[number] | undefined;
    for (let i = 1; i < c.edges.length; i++) {
      const edge = c.edges[i] ?? -1;
      const at = c.off[i] ?? 0;
      const lane = path.lane[i] ?? '';
      const key = `${edge}:${c.o[i] === 1 ? 'from' : 'to'}:${lane}`;
      if ((incoming.get(key)?.size ?? 0) < 2 || at - p.u > 80 || p.u - half >= at + 3) continue;
      request = { k, key, at, edge, lane };
      break;
    }
    if (!request) {
      st.waitTick[k] = -1;
      st.reservation[k] = '';
      continue;
    }
    if ((st.waitTick[k] ?? -1) < 0) st.waitTick[k] = world.tick;
    requests.push(request);
  }
  requests.sort(
    (a, b) =>
      Number(st.reservation[b.k] === b.key) - Number(st.reservation[a.k] === a.key) ||
      (st.waitTick[a.k] ?? 0) - (st.waitTick[b.k] ?? 0) ||
      (st.id[a.k] ?? 0) - (st.id[b.k] ?? 0),
  );
  const granted = new Set<string>();
  for (const req of requests) {
    const path = st.paths[req.k];
    if (!path) continue;
    const t = typeOf(config, st, req.k);
    const target = config.road
      .lanesAt(
        req.edge,
        path.c.o[path.c.edges.indexOf(req.edge)] === 1 ? 0 : (config.road.edges[req.edge]?.length ?? 0),
      )
      .find((l) => l.id === req.lane);
    const d = target
      ? (target.dCenterM - (path.c.dOff?.[path.c.edges.indexOf(req.edge)] ?? 0)) *
        (path.c.o[path.c.edges.indexOf(req.edge)] ?? 1)
      : 0;
    let room = true;
    for (let j = 0; j < st.id.length; j++) {
      if (j === req.k) continue;
      const other = world.movers[st.id[j] ?? -1];
      const p = other ? toCorridor(path.c, other.pos) : null;
      if (!p) continue;
      const tj = typeOf(config, st, j);
      if (Math.abs(p.cd - d) >= (t.widthM + tj.widthM) / 2 + 0.3) continue;
      if (p.u + tj.lengthM / 2 > req.at - 0.1 && p.u - tj.lengthM / 2 < req.at + t.lengthM + 3) {
        room = false;
        break;
      }
    }
    if (!granted.has(req.key) && (room || st.reservation[req.k] === req.key)) {
      granted.add(req.key);
      st.reservation[req.k] = req.key;
    } else {
      st.reservation[req.k] = '';
      stops[req.k] = req.at - 0.3;
    }
  }
  return stops;
}

/** A committed turn may need an earlier lane change; do not take it while still in another lane. */
export function prepareTurn(config: SimConfig, st: TrafficState, view: TrafficState, k: number): number {
  const path = st.paths[k];
  if (!path) return Infinity;
  const u = view.u[k] ?? 0;
  let i = 0;
  while (i + 1 < path.c.edges.length && (path.c.off[i + 1] ?? Infinity) <= u) i++;
  const at = path.c.off[i + 1] ?? Infinity;
  if (at - u > 160) return Infinity;
  const id = path.exitLane[i];
  if (!id) return Infinity;
  const physical = config.road.lanesAt(
    path.c.edges[i] ?? 0,
    path.c.o[i] === 1 ? u - (path.c.off[i] ?? 0) : (path.c.len[i] ?? 0) - u + (path.c.off[i] ?? 0),
  );
  const lane = physical.find((l) => l.id === id);
  if (!lane) return at - 0.3;
  const cd = (lane.dCenterM - (path.c.dOff?.[i] ?? 0)) * (path.c.o[i] ?? 1);
  const rank = lanesAt(config.road, path.c, u, 1).findIndex((l) => Math.abs(l.cd - cd) < 0.01);
  const type = typeOf(config, st, k);
  if (isKerb(type)) {
    const kerb = kerbAhead(config, view, u, 1, type.widthM / 2);
    return kerb?.rank === rank ? Infinity : at - 0.3;
  }
  if (rank >= 0 && laneClear(config, view, u, 1, rank, typeOf(config, st, k), 3, k)) view.rank[k] = rank;
  return Math.abs((view.cd[k] ?? 0) - cd) > Math.max(0.2, (lane.widthM - typeOf(config, st, k).widthM) / 2)
    ? at - 0.3
    : Infinity;
}
