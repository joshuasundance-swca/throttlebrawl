import { clamp, nextFloat } from '../../core';
import type { RoadPos } from '../../road';
import type { SimConfig } from '../types';
import type { World } from '../world';
import { fromCorridor, laneEndOnMap, lanesAt, toCorridor } from './corridor';
import {
  capPerDirection,
  densityFor,
  hairpinSpawnBlocked,
  IDM,
  isParked,
  isKerb,
  pickType,
  riderViews,
  spawnCd,
  TRAFFIC,
  trafficAreaAt,
  typeOf,
  type TrafficState,
} from './index';
import { buildTrafficGraph, commitPath, type TrafficGraph } from './network';
import { pathView, placeRoadVehicle } from './path-view';
import { junctionSpawnAllowed } from './junctions';
import { protectedVehicle } from './vehicle-control';

interface Window {
  edge: number;
  lo: number;
  hi: number;
  entryS: number;
  distance: number;
}

/** Physical intervals reached from every racer, deduplicated later by road/lane metres. */
export function trafficWindows(
  world: World,
  config: SimConfig,
  graph: TrafficGraph,
  range = TRAFFIC.windowM,
): Window[] {
  const allowed = new Set(graph.allowed);
  const windows: Window[] = [];
  for (const anchor of world.movers) {
    const def = config.riders[anchor.riderIndex];
    if (anchor.kind !== 'rider' || def?.faction === 'law') continue;
    let pos = anchor.pos;
    if (!allowed.has(pos.edge)) {
      // Retain rejoin coverage for an excluded rider-only choice. Race progress is used ONLY
      // to allocate population windows, never for following or contacts.
      const start = toCorridor(graph.reference, {
        ...pos,
        edge: config.route.start.edge,
        s: config.route.start.s,
      });
      const dtf = config.route.distanceToFinish(pos.edge, pos.s);
      const startDtf = config.route.distanceToFinish(config.route.start.edge, config.route.start.s);
      if (!start || !Number.isFinite(dtf)) continue;
      pos = { ...pos };
      fromCorridor(graph.reference, start.u + graph.reference.routeDir * (startDtf - dtf), 0, 1, pos);
    }
    const frontier = [{ edge: pos.edge, s: pos.s, distance: 0 }];
    const visited = new Map<string, number>();
    for (let head = 0; head < frontier.length && head < config.road.edges.length * 4; head++) {
      const item = frontier[head];
      if (!item || item.distance > range || !allowed.has(item.edge)) continue;
      const key = `${item.edge}:${item.s === 0 ? 'from' : item.s === config.road.edges[item.edge]?.length ? 'to' : 'anchor'}`;
      if ((visited.get(key) ?? Infinity) <= item.distance) continue;
      visited.set(key, item.distance);
      const edge = config.road.edges[item.edge];
      if (!edge) continue;
      let lo = Math.max(0, item.s - range + item.distance);
      let hi = Math.min(edge.length, item.s + range - item.distance);
      const ref = toCorridor(graph.reference, { edge: item.edge, s: 0, d: 0, dir: 1 });
      if (ref) {
        const i = graph.reference.edges.indexOf(item.edge);
        const o = graph.reference.o[i] ?? 1;
        const a = o * (graph.reference.lo - ref.u);
        const b = o * (graph.reference.hi - ref.u);
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (hi > lo) windows.push({ edge: item.edge, lo, hi, entryS: item.s, distance: item.distance });
      for (const [end, travel] of [
        ['from', item.s],
        ['to', edge.length - item.s],
      ] as const) {
        const distance = item.distance + travel;
        if (distance > range) continue;
        for (const link of graph.windowLinks[item.edge] ?? []) {
          if (link.exitsAt !== end) continue;
          if (!allowed.has(link.edge)) continue;
          // Windows are undirected physical coverage. Movement still uses legal lane rows.
          frontier.push({
            edge: link.edge,
            s: link.entersAt === 'from' ? 0 : (config.road.edges[link.edge]?.length ?? 0),
            distance,
          });
        }
      }
    }
  }
  return windows;
}

function distanceAt(windows: readonly Window[], edge: number, s: number): number {
  let nearest = Infinity;
  for (const w of windows)
    if (w.edge === edge) nearest = Math.min(nearest, w.distance + Math.abs(s - w.entryS));
  return nearest;
}

/** One target and reuse policy per direction across the entire race. */
export function populateNetwork(world: World, config: SimConfig, st: TrafficState, initial = false): void {
  const graph = buildTrafficGraph(config);
  const windows = trafficWindows(world, config, graph);
  const retirementWindows = trafficWindows(world, config, graph, TRAFFIC.windowM + TRAFFIC.despawnMarginM);
  if (!windows.length || !st.types.length) return;
  const intervals = new Map<number, [number, number][]>();
  for (const w of windows) {
    const spans = intervals.get(w.edge) ?? [];
    spans.push([w.lo, w.hi]);
    intervals.set(w.edge, spans);
  }
  for (const [edge, spans] of intervals) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    intervals.set(edge, merged);
  }
  for (const dir of [1, -1] as const) {
    const candidates: RoadPos[] = [];
    let metres = 0;
    const density = densityFor(world, st, dir);
    for (const [edge, spans] of intervals) {
      const orientation =
        config.route.orientation(edge) || graph.reference.o[graph.reference.edges.indexOf(edge)] || 1;
      const travel = orientation * dir * graph.reference.routeDir === 1 ? 1 : -1;
      if (!graph.viable[edge]?.[travel === 1 ? 'plus' : 'minus']) continue;
      for (const [lo, hi] of spans) {
        const lanes = config.road
          .lanesAt(edge, (lo + hi) / 2)
          .filter((l) => l.direction === travel && (l.kind === 'drive' || l.kind === 'shortcut'));
        if (!lanes.length) continue;
        metres +=
          (hi - lo) * (1 + (lanes.length - 1) * clamp(world.params['traffic.extraLaneDensity'] ?? 0.6, 0, 1));
        for (
          let s = Math.max(lo + 5, 6);
          s < Math.min(hi - 5, (config.road.edges[edge]?.length ?? 0) - 6);
          s += TRAFFIC.slotStepM
        ) {
          if (distanceAt(windows, edge, s) < st.reactionM || distanceAt(windows, edge, s) > TRAFFIC.windowM)
            continue;
          for (const lane of config.road.lanesAt(edge, s))
            if (lane.direction === travel && (lane.kind === 'drive' || lane.kind === 'shortcut'))
              candidates.push({ edge, s, d: lane.dCenterM, dir: travel });
        }
      }
    }
    const target = Math.min(capPerDirection(world), Math.floor((metres * density) / TRAFFIC.baseSpacingM));
    let active = st.id.filter((_id, k) => st.dir[k] === dir && st.retired[k] === 0).length;
    const gone = (k: number) => {
      if (protectedVehicle(world, st, k)) return false;
      const m = world.movers[st.id[k] ?? -1];
      const path = st.paths[k];
      return (
        !m ||
        distanceAt(retirementWindows, m.pos.edge, m.pos.s) > TRAFFIC.windowM + TRAFFIC.despawnMarginM ||
        (path?.terminal === true && (st.u[k] ?? 0) >= path.c.hi - 0.1)
      );
    };
    const place = (pos: RoadPos, type: number, v0: number, slot: number): number => {
      const t = config.trafficTypes[type];
      if (
        !t ||
        distanceAt(windows, pos.edge, pos.s) < st.reactionM ||
        distanceAt(windows, pos.edge, pos.s) > TRAFFIC.windowM
      )
        return -1;
      const movementGraph = isKerb(t) ? buildTrafficGraph(config, true) : graph;
      if (!movementGraph.viable[pos.edge]?.[pos.dir === 1 ? 'plus' : 'minus']) return -1;
      const path = commitPath(
        config.road,
        movementGraph,
        pos,
        config.seed,
        slot < 0 ? world.movers.length : st.id[slot]!,
        (st.generation[slot] ?? 0) + 1,
        220,
      );
      const p = toCorridor(path.c, pos);
      if (!p) return -1;
      const view = pathView(world, config, st, path);
      const lanes = lanesAt(config.road, path.c, p.u, 1);
      let rank = lanes.reduce(
        (best, lane, i) => (Math.abs(lane.cd - p.cd) < Math.abs(lanes[best]!.cd - p.cd) ? i : best),
        0,
      );
      while (rank > 0 && laneEndOnMap(view.laneMap, p.u, 1, rank, TRAFFIC.mergeLookM) < Infinity) rank--;
      const cd = spawnCd(config, path.c, t, p.u, 1, lanes[rank]?.cd ?? 0);
      fromCorridor(path.c, p.u, cd, 1, pos);
      if (
        !isParked(t) &&
        hairpinSpawnBlocked(world, config, view, riderViews(world, config, view), p.u, 1, v0)
      )
        return -1;
      if (!junctionSpawnAllowed(config, pos, t.lengthM, t.widthM)) return -1;
      const len = config.road.edges[pos.edge]?.length ?? 0;
      if (pos.s < t.lengthM / 2 + 2 || pos.s + t.lengthM / 2 + 2 > len) return -1;
      const point = config.road.toWorld(pos.edge, pos.s, pos.d, 0);
      for (const m of world.movers) {
        if (m.id === st.id[slot] || (m.kind !== 'vehicle' && m.kind !== 'rider')) continue;
        const other = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
        const reach =
          m.kind === 'rider'
            ? st.reactionM
            : (t.lengthM + typeOf(config, st, st.id.indexOf(m.id)).lengthM) / 2 + TRAFFIC.spawnGapM;
        const dx = point.x - other.x;
        const dz = point.z - other.z;
        if (Math.abs(point.y - other.y) < 3 && dx * dx + dz * dz < reach * reach) return -1;
      }
      const k = placeRoadVehicle(world, config, { type, pos, v0 }, slot);
      st.spawns++;
      if (slot >= 0) st.recycles++;
      return k;
    };
    const spawn = (slot: number): boolean => {
      const typeRoll = nextFloat(world.rng.traffic);
      const speedRoll = 0.9 + 0.2 * nextFloat(world.rng.traffic);
      const first = Math.floor(nextFloat(world.rng.traffic) * candidates.length);
      const jitter = nextFloat(world.rng.traffic) * 3;
      for (let pass = 0; pass < candidates.length; pass++) {
        const candidate = candidates[(first + pass) % candidates.length];
        if (!candidate) continue;
        const pos = { ...candidate, s: candidate.s + jitter };
        if (distanceAt(windows, pos.edge, pos.s) < st.reactionM) continue;
        const ref = {
          edges: [pos.edge],
          o: [1],
          off: [0],
          len: [config.road.edges[pos.edge]?.length ?? 0],
          length: config.road.edges[pos.edge]?.length ?? 0,
          lo: 0,
          hi: config.road.edges[pos.edge]?.length ?? 0,
          routeDir: 1,
        };
        const type = pickType(world, config, st, dir, typeRoll, trafficAreaAt(config, ref, pos.s));
        const t = config.trafficTypes[type];
        if (!t) continue;
        const bendClear = world.params['traffic.driftBendClearM'] ?? 0;
        let tight = false;
        for (let offset = -bendClear; offset <= bendClear; offset += 5)
          if (Math.abs(config.road.kappaAt(pos.edge, pos.s + offset)) >= 1 / 75) tight = true;
        if (tight && bendClear > 0) continue;
        const v0 = t.cruiseMps * speedRoll;
        const lead = place(pos, type, v0, slot);
        if (lead < 0) continue;
        const n = Math.max(1, Math.min(4, Math.floor(t.behaviour?.convoy ?? 1)));
        if (n > 1) {
          const extra = 1 + Math.floor(nextFloat(world.rng.traffic) * (n - 1));
          const step = t.lengthM + IDM.minGapM + v0 * IDM.timeGapS + TRAFFIC.convoyExtraGapM;
          for (let i = 1; i <= extra; i++) {
            const count = st.id.filter((_id, k) => st.dir[k] === dir && st.retired[k] === 0).length;
            if (count >= target) break;
            if (place({ ...pos, s: pos.s - pos.dir * i * step }, type, v0, -1) < 0) break;
          }
        }
        return true;
      }
      return false;
    };
    for (let k = 0; k < st.id.length; k++) {
      if (st.dir[k] !== dir || st.retired[k] !== 0 || !gone(k)) continue;
      if (active > target) {
        st.retired[k] = 1;
        active--;
      } else if (spawn(k)) {
        // Recycling a leader can also add convoy followers. Reconcile the shared count before
        // deciding whether the next pass may top up again.
        active = st.id.filter((_id, j) => st.dir[j] === dir && st.retired[j] === 0).length;
      }
    }
    let adds = 0;
    for (let k = 0; k < st.id.length && active < target; k++) {
      if (st.retired[k] !== 1 || !gone(k)) continue;
      if (spawn(k)) active = st.id.filter((_id, j) => st.dir[j] === dir && st.retired[j] === 0).length;
    }
    while (active < target && adds < (initial ? capPerDirection(world) : TRAFFIC.maxAddsPerPass)) {
      if (!spawn(-1)) break;
      active = st.id.filter((_id, j) => st.dir[j] === dir && st.retired[j] === 0).length;
      adds++;
    }
  }
}
