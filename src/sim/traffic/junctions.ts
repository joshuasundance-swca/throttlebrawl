// Local junction arbitration for opted-in connector surfaces that overlap the reference road.
// Derived geometry is cached; waiting and scheduled ownership are ordinary hashed sim state.
import type { RoadPos } from '../../road';
import type { SimConfig } from '../types';
import type { World } from '../world';
import { toCorridor } from './corridor';
import { isParked, typeOf, type TrafficState } from './index';
import { buildTrafficGraph, type TrafficGraph } from './network';

interface Range {
  edge: number;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}
interface Region {
  key: string;
  ranges: Range[];
}
const regions = new WeakMap<TrafficGraph, Region[]>();

function conflictRegions(config: SimConfig): Region[] {
  const graph = buildTrafficGraph(config);
  const cached = regions.get(graph);
  if (cached) return cached;
  const road = config.road;
  const result: Region[] = [];
  for (const edge of config.route.trafficRoads) {
    if (!graph.allowed.includes(edge) || !road.edges[edge]?.isConnector) continue;
    const rangeByEdge = new Map<number, Range>();
    let start = Infinity;
    let end = -Infinity;
    const lanes = road.lanesAt(edge, 0).filter((l) => l.kind === 'drive' || l.kind === 'shortcut');
    for (let s = 0; s <= (road.edges[edge]?.length ?? 0); s += 2) {
      for (const lane of lanes)
        for (const d of [lane.dCenterM - lane.widthM / 2, lane.dCenterM, lane.dCenterM + lane.widthM / 2]) {
          for (const other of graph.reference.edges) {
            const p = road.surfaceUnder({ edge, s, d, dir: 1 }, 0.2, (candidate) => candidate === other);
            if (!p) continue;
            start = Math.min(start, s);
            end = Math.max(end, s);
            const row = rangeByEdge.get(other) ?? { edge: other, s0: p.s, s1: p.s, d0: p.d, d1: p.d };
            row.s0 = Math.min(row.s0, p.s);
            row.s1 = Math.max(row.s1, p.s);
            row.d0 = Math.min(row.d0, p.d);
            row.d1 = Math.max(row.d1, p.d);
            rangeByEdge.set(other, row);
          }
        }
    }
    if (!rangeByEdge.size) continue;
    const d0 = Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2));
    const d1 = Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2));
    result.push({
      key: `junction:${road.edges[edge]?.id}`,
      ranges: [
        { edge, s0: Math.max(0, start - 2), s1: Math.min(road.edges[edge]?.length ?? 0, end + 2), d0, d1 },
        ...[...rangeByEdge.values()].map((r) => ({
          ...r,
          s0: Math.max(0, r.s0 - 2),
          s1: Math.min(road.edges[r.edge]?.length ?? 0, r.s1 + 2),
        })),
      ],
    });
  }
  regions.set(graph, result);
  return result;
}

/** Do not materialize a car inside an arbitration region, even when its center is clear. */
export function junctionSpawnAllowed(
  config: SimConfig,
  pos: RoadPos,
  lengthM: number,
  widthM: number,
): boolean {
  return !conflictRegions(config).some((region) =>
    region.ranges.some(
      (range) =>
        range.edge === pos.edge &&
        pos.s + lengthM / 2 >= range.s0 &&
        pos.s - lengthM / 2 <= range.s1 &&
        pos.d + widthM / 2 >= range.d0 &&
        pos.d - widthM / 2 <= range.d1,
    ),
  );
}

/** Existing occupants clear first. The oldest waiter then drains the junction of new entrants
 * and gets the next passage, so a continuous oncoming stream cannot starve a committed turn.
 */
export function junctionStops(world: World, config: SimConfig, st: TrafficState): number[] {
  const stops = st.id.map(() => Infinity);
  const groups = new Map<string, { k: number; entry: number; ownU: number; occupied: boolean }[]>();
  const topology = conflictRegions(config);
  for (let k = 0; k < st.id.length; k++) {
    const path = st.paths[k];
    const c = path?.c ?? st.corridor;
    const m = world.movers[st.id[k] ?? -1];
    const p = m ? toCorridor(c, m.pos) : null;
    if (!p) continue;
    const t = typeOf(config, st, k);
    const u = p.u * p.dir;
    let selected: { region: Region; entry: number; exit: number } | undefined;
    for (const region of topology) {
      let entry = Infinity;
      let exit = -Infinity;
      for (const range of region.ranges) {
        // Parked oddities have no future passage. Count their real body if it obstructs a
        // conflict surface, but never reserve the next road on their unused itinerary.
        if (
          isParked(t) &&
          (!m ||
            range.edge !== m.pos.edge ||
            m.pos.s + t.lengthM / 2 < range.s0 ||
            m.pos.s - t.lengthM / 2 > range.s1)
        )
          continue;
        const i = c.edges.indexOf(range.edge);
        if (i < 0) continue;
        const expected = config.road
          .lanesAt(range.edge, (range.s0 + range.s1) / 2)
          .find((l) => l.id === path?.lane[i]);
        const d =
          m?.pos.edge === range.edge
            ? m.pos.d
            : (expected?.dCenterM ?? p.cd * (c.o[i] ?? 1) + (c.dOff?.[i] ?? 0));
        if (d + t.widthM / 2 < range.d0 || d - t.widthM / 2 > range.d1) continue;
        const a = toCorridor(c, { edge: range.edge, s: range.s0, d, dir: 1 });
        const b = toCorridor(c, { edge: range.edge, s: range.s1, d, dir: 1 });
        if (!a || !b) continue;
        entry = Math.min(entry, p.dir * a.u, p.dir * b.u);
        exit = Math.max(exit, p.dir * a.u, p.dir * b.u);
      }
      if (exit + t.lengthM / 2 + 1 < u || entry - u > Math.max(80, (m?.speed ?? 0) * 3)) continue;
      if (entry < Infinity && (!selected || entry < selected.entry)) selected = { region, entry, exit };
    }
    if (!selected) {
      st.junctionWait[k] = -1;
      st.junctionReservation[k] = '';
      continue;
    }
    if ((st.junctionWait[k] ?? -1) < 0) st.junctionWait[k] = world.tick;
    const list = groups.get(selected.region.key) ?? [];
    list.push({
      k,
      entry: selected.entry,
      ownU: u,
      occupied: u + t.lengthM / 2 >= selected.entry && u - t.lengthM / 2 <= selected.exit + 1,
    });
    groups.set(selected.region.key, list);
  }
  for (const [key, list] of groups) {
    list.sort(
      (a, b) =>
        Number(st.junctionReservation[b.k] === key) - Number(st.junctionReservation[a.k] === key) ||
        (st.junctionWait[a.k] ?? 0) - (st.junctionWait[b.k] ?? 0) ||
        (st.id[a.k] ?? 0) - (st.id[b.k] ?? 0),
    );
    const winner = list[0];
    if (!winner) continue;
    for (const req of list) {
      const p = world.movers[st.id[req.k] ?? -1];
      const c = st.paths[req.k]?.c ?? st.corridor;
      const own = p ? toCorridor(c, p.pos) : null;
      const blocked = !req.occupied && (req !== winner || list.some((r) => r !== req && r.occupied));
      if (blocked && own) stops[req.k] = own.dir * (req.entry - 0.5);
      st.junctionReservation[req.k] = req === winner ? key : '';
    }
  }
  return stops;
}
