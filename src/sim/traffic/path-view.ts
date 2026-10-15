// Coordinate adapters read the shared physical movers. They are never extra populations and
// never simulation state: building a view cannot change a future decision or state hash.
import type { RoadPos } from '../../road';
import type { SimConfig } from '../types';
import type { Mover, World } from '../world';
import { buildLaneMap, fromCorridor, lanesAt, riderOnCorridor, toCorridor } from './corridor';
import { isKerb, placeVehicle, TRAFFIC, trafficState, type TrafficState } from './index';
import { buildTrafficGraph, commitPath, type TrafficPath } from './network';

const views = new WeakMap<TrafficPath, { shape: string; state: TrafficState }>();
const physicalRanks = new WeakMap<Mover, RoadPos & { road: SimConfig['road']; rank: number }>();

function rankAt(config: SimConfig, at: RoadPos): number {
  let nearest = Infinity;
  let center = Infinity;
  const lanes = config.road.lanesAt(at.edge, at.s);
  for (const lane of lanes)
    if (lane.direction === at.dir && (lane.kind === 'drive' || lane.kind === 'shortcut')) {
      const gap = Math.abs(lane.dCenterM - at.d);
      if (gap < nearest) {
        nearest = gap;
        center = Math.abs(lane.dCenterM);
      }
    }
  if (nearest === Infinity) return -2;
  let rank = 0;
  for (const lane of lanes)
    if (
      lane.direction === at.dir &&
      (lane.kind === 'drive' || lane.kind === 'shortcut') &&
      Math.abs(lane.dCenterM) < center
    )
      rank++;
  return rank;
}

function physicalRank(config: SimConfig, m: Mover): number {
  const p = m.pos;
  const cached = physicalRanks.get(m);
  // Position rather than tick: movement and contacts can change a body within the same tick.
  if (
    cached &&
    cached.road === config.road &&
    cached.edge === p.edge &&
    cached.s === p.s &&
    cached.d === p.d &&
    cached.dir === p.dir
  )
    return cached.rank;
  const rank = rankAt(config, p);
  physicalRanks.set(m, { ...p, road: config.road, rank });
  return rank;
}

export function pathView(
  world: World,
  config: SimConfig,
  st: TrafficState,
  path: TrafficPath,
  subject = -1,
): TrafficState {
  let view = views.get(path);
  if (!view) {
    view = {
      shape: '',
      state: {
        ...st,
        corridor: path.c,
        laneMap: buildLaneMap(config.road, path.c),
        u: [],
        cd: [],
        dir: [],
        rank: [],
      },
    };
    views.set(path, view);
  }
  const v = view.state;
  v.clockS = st.clockS;
  const shape = `${path.c.off[0]}:${path.c.length}:${path.c.edges.length}`;
  if (view.shape !== shape) {
    v.laneMap = buildLaneMap(config.road, path.c);
    view.shape = shape;
  }
  const nearU = subject >= 0 ? st.u[subject] : undefined;
  for (let j = 0; j < st.id.length; j++) {
    const m = world.movers[st.id[j] ?? -1];
    const own = m ? toCorridor(path.c, m.pos, nearU) : null;
    const p = own ?? (m ? riderOnCorridor(config.road, path.c, m.pos, TRAFFIC.maxContactH, nearU) : null);
    v.u[j] = p?.u ?? Infinity;
    v.cd[j] = p?.cd ?? Infinity;
    v.dir[j] = p?.dir ?? 0;
    let best = -2;
    if (p && m) {
      // Lane rank is physical (nearest the road center), independent of a path's lateral shift.
      // Avoid allocating and sorting a corridor lane array for every pair in every view.
      if (own) best = physicalRank(config, m);
      else {
        const at = { ...m.pos };
        fromCorridor(path.c, p.u, p.cd, p.dir, at);
        best = rankAt(config, at);
      }
    }
    v.rank[j] = best;
  }
  return v;
}

/** Place an ambient car by a physical road position; authored scripts retain placeVehicle. */
export function placeRoadVehicle(
  world: World,
  config: SimConfig,
  spec: { type: number; pos: RoadPos; v0?: number; speed?: number },
  slot = -1,
): number {
  const st = trafficState(world);
  const graph = buildTrafficGraph(config, isKerb(config.trafficTypes[spec.type]));
  if (
    !graph.allowed.includes(spec.pos.edge) ||
    !graph.viable[spec.pos.edge]?.[spec.pos.dir === 1 ? 'plus' : 'minus']
  )
    throw new Error('traffic: road placement has no legal finite exit');
  const entity = slot >= 0 ? (st.id[slot] ?? 0) : world.movers.length;
  const generation = (st.generation[slot] ?? 0) + 1;
  const path = commitPath(config.road, graph, spec.pos, config.seed, entity, generation, 220);
  path.currentEdge = spec.pos.edge;
  const p = toCorridor(path.c, spec.pos);
  if (!p) throw new Error('traffic: placement has no committed path');
  const lanes = lanesAt(config.road, path.c, p.u, 1);
  let rank = 0;
  for (let i = 1; i < lanes.length; i++)
    if (Math.abs(lanes[i]!.cd - p.cd) < Math.abs(lanes[rank]!.cd - p.cd)) rank = i;
  const orientation =
    config.route.orientation(spec.pos.edge) ||
    graph.reference.o[graph.reference.edges.indexOf(spec.pos.edge)] ||
    1;
  return placeVehicle(
    world,
    config,
    {
      type: spec.type,
      u: p.u,
      dir: 1,
      path,
      rank,
      trafficDirection:
        orientation * spec.pos.dir === 1
          ? (graph.reference.routeDir as 1 | -1)
          : (-graph.reference.routeDir as 1 | -1),
      ...(spec.v0 !== undefined ? { v0: spec.v0 } : {}),
      ...(spec.speed !== undefined ? { speed: spec.speed } : {}),
    },
    slot,
  );
}
